import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readBindings } from "../adapter/drift.js";
import type { PromptSet, SessionBackend } from "../sessions/backend.js";
import type { State } from "../schemas/states.js";
import type { Ticket } from "../schemas/ticket.js";
import { git, resolveBaseRef, snapshotRefs, type RefSnapshot, type RunBranch } from "./git.js";
import { reviewBasis } from "./review-scope.js";
import { pidAlive } from "./tickets/mutations.js";
import { clearClaimPolicy, publishClaimPolicy, refreshRunRefeed } from "./hook-policy.js";
import { type RunJournal, runsDir } from "./journal.js";
import { SpendLedger } from "./ledger.js";
import type { Budgets } from "../schemas/budgets.js";
import type { LoadedConfig } from "./worstcase.js";

/**
 * The referee's shared ground (T-100): one context object carrying the wiring
 * every arm needs — configuration, the journal, the spend ledger, the run
 * branch, per-claim work directories — so the arms (session, gate, stage) and
 * the core compose without reaching into each other. Errors and the shared
 * constants live here too, below every arm, which is what keeps the referee's
 * internal import graph acyclic.
 */

/** States the pool resumes (C-9). Human-gated and terminal states are not in-flight. */
export const RESUMABLE: readonly State[] = [
  "DIAGNOSED",
  "IN_PROGRESS",
  "BLIND_FIX",
  "RESEARCH",
  "INFORMED_FIX",
  "REVIEW_FIX",
  "IN_REVIEW",
  "APPROVED",
];

/** Attempt-tool states: sessions the driver launches directly (R-4). The
 * diagnose/review/research sessions launch inside their `record` stages, where
 * the validator that justifies their event lives. */
export const ATTEMPT_STATES = ["IN_PROGRESS", "BLIND_FIX", "INFORMED_FIX", "REVIEW_FIX"] as const;

/** PRDR-071: review-basis body cap — 8000 dated from the uncommitted-only era. */
const DIFF_BODY_CAP = 32_000;

export class Breach extends Error {}

/**
 * T-140 (PRDR-072): a session the backend refused outright — crashed with
 * zero turns (auth outage, usage limit, spawn failure). NOT a Breach: the
 * work never happened, so no protocol was breached; the run halts and the
 * operator re-fires when the backend is back.
 */
export class SessionRefusal extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "SessionRefusal";
  }
}

export class KernelBoundaryError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "KernelBoundaryError";
  }
}

export class EscrowError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "EscrowError";
  }
}

export interface CoreOptions {
  readonly root: string;
  readonly backend: SessionBackend;
  readonly prompts: PromptSet;
  readonly worker?: string;
  readonly now?: () => number;
  /** PRDR-079: injectable pid-liveness probe for the pool's claim self-heal. */
  readonly isAlive?: (pid: number) => boolean;
  /** B-2: per-ticket worktrees, merged `--no-ff` into the run branch on DONE. */
  readonly worktree?: boolean;
}

export class RefereeContext {
  readonly root: string;
  readonly backend: SessionBackend;
  readonly prompts: PromptSet;
  readonly worker: string;
  readonly now: () => number;
  readonly isAlive: (pid: number) => boolean;
  readonly worktree: boolean;
  readonly rulesText: string;
  readonly bindingsPreamble: string;
  readonly spend: SpendLedger;
  readonly refs: RefSnapshot;
  readonly baseRef: string | null;
  private readonly workDirs = new Map<string, string>();

  constructor(
    opts: CoreOptions,
    readonly loaded: LoadedConfig,
    readonly journal: RunJournal,
    readonly runBranch: RunBranch,
  ) {
    this.root = opts.root;
    this.backend = opts.backend;
    this.prompts = opts.prompts;
    this.worker = opts.worker ?? "w1";
    this.now = opts.now ?? (() => Date.now());
    this.isAlive = opts.isAlive ?? pidAlive;
    this.worktree = opts.worktree === true;
    this.rulesText = readRules(opts.root);
    const bindings = readBindings(opts.root).bindings;
    this.bindingsPreamble = JSON.stringify(
      {
        bindings: Object.fromEntries(bindings.map((b) => [b.slot, b.resolved])),
        protected: this.loaded.config.protected,
        non_negotiables: "Only artifacts and exit codes count (P2).",
      },
      null,
      2,
    );
    this.spend = new SpendLedger(opts.root, journal, this.budgets.run_spend_usd);
    /* P7: every ref except the run branch is protected ground for this run. */
    this.refs = snapshotRefs(opts.root);
    /* V-5: the run's baseline, resolved once; null falls back to root commands. */
    this.baseRef = resolveBaseRef(opts.root, runBranch);
  }

  get budgets(): Budgets {
    return this.loaded.config.budgets;
  }

  iso(): string {
    return new Date(this.now()).toISOString();
  }

  setWorkDir(id: string, dir: string): void {
    this.workDirs.set(id, dir);
  }

  clearWorkDir(id: string): void {
    this.workDirs.delete(id);
  }

  workDirFor(id: string): string {
    return this.workDirs.get(id) ?? this.root;
  }

  /* ---- D-21 hook policy (T-120/T-121): the referee is the only writer ---- */

  publishHookPolicy(ticketId: string): void {
    publishClaimPolicy(this.root, {
      ticketId,
      protectedGlobs: this.loaded.config.protected,
      gateCommands: readBindings(this.root).bindings.map((b) => b.resolved),
      expiresAtMs: this.now() + this.budgets.ticket_wall_clock_ms,
    });
  }

  clearHookPolicy(): void {
    clearClaimPolicy(this.root);
  }

  refreshRunRefeed(active: boolean): void {
    refreshRunRefeed(this.root, active, this.now() + this.budgets.ticket_wall_clock_ms);
  }

  maybeArtifact(ticketId: string, name: string): unknown {
    const file = path.join(runsDir(this.root, ticketId), name);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  }

  /**
   * T-140 (eleventh firing): implement sessions COMMIT their work, so a
   * `git diff HEAD` review basis sees only the kernel's uncommitted
   * bookkeeping — the live reviewer judged 1200 lines of real work as an
   * empty diff, accurately, off the wrong input. The ticket's claim base —
   * HEAD at the FIRST acquire, persisted so later generations and resumes
   * judge the whole ticket — is the honest basis.
   */
  recordClaimBase(id: string, workDir: string): void {
    const file = path.join(runsDir(this.root, id), "claim_base.json");
    if (existsSync(file)) return;
    try {
      const sha = git(workDir, "rev-parse", "HEAD").trim();
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify({ schema_version: 1, sha }, null, 2)}\n`);
    } catch {
      /* No HEAD yet (empty repo): diff falls back to HEAD-relative below. */
    }
  }

  claimBase(id: string): string | null {
    const file = path.join(runsDir(this.root, id), "claim_base.json");
    if (!existsSync(file)) return null;
    try {
      const sha = (JSON.parse(readFileSync(file, "utf8")) as { sha?: unknown }).sha;
      return typeof sha === "string" ? sha : null;
    } catch {
      return null;
    }
  }

  /**
   * T-140 (PRDR-069): the claim base survives resumes BY DESIGN, so other
   * tickets' finalized commits can sit between the base and HEAD — a run
   * that stops and resumes interleaves tickets.
   *
   * PRDR-094: the surface pathspec was trusted to filter that span back down
   * to the ticket, on the assumption that surfaces are disjoint across tickets.
   * They are not, and the reviewer was shown work the ticket never wrote — a
   * finding no fix generation could resolve, because the offending hunks belong
   * to another ticket and are already DONE. Given a ticket id, the basis is now
   * that ticket's OWN commits plus whatever is still uncommitted, which keeps
   * PRDR-069's whole-ticket property without borrowing anyone else's work.
   * Unscoped callers keep the whole-tree diff.
   */
  diff(workDir: string, base?: string | null, surface?: readonly string[], ticketId?: string): string {
    try {
      /**
       * PRDR-113: the surface is matched by Detent's own matcher, never handed
       * to git as a pathspec — git's glob has no braces, and a granted
       * `src/cli{.ts,/init.ts}` was invisible to the reviewer.
       */
      const { body, untracked } = reviewBasis(workDir, base ?? null, ticketId, surface ?? []);
      const full = body + untrackedAsDiff(workDir, untracked);
      if (full.length <= DIFF_BODY_CAP) return full;
      /**
       * T-140 (PRDR-071): a silent `.slice(-8000)` fed reviewers the TAIL of
       * the span — four verdicts judged "the two test files" while the
       * criterion's test sat truncated at the front. Never truncate silently:
       * the complete file list always arrives, bodies clip with a banner, and
       * the reviewer (reads-open, S-2″) is told where the rest lives.
       */
      const stat = statFor(full) + untracked.map((name) => ` ${name} (untracked)\n`).join("");
      return (
        `[diff truncated: ${full.length} chars total, body clipped to the last ${DIFF_BODY_CAP}. ` +
        `The complete changed-file list follows; read files in the worktree for full content.]\n` +
        `${stat}\n${full.slice(-DIFF_BODY_CAP)}`
      );
    } catch {
      return "";
    }
  }
}

/**
 * T-140 (PRDR-070): B-5 lets the GATE judge untracked files ("the tree
 * as-is") but `git diff` never shows them — a worker who writes without
 * `git add` produces work the gate greens and the reviewer cannot see.
 * The review basis must equal the gate's basis, so untracked files inside
 * the scope render as new-file pseudo-diffs. Unreadable (binary) files
 * degrade to their header line.
 */
/**
 * PRDR-094: the changed-file list for a body this module assembled itself.
 * `git diff --stat` cannot describe it — the body is a concatenation of one
 * ticket's commits, not a single range — and T-140 requires the COMPLETE file
 * list to survive even when bodies clip.
 */
function statFor(body: string): string {
  const names = new Set<string>();
  for (const line of body.split("\n")) {
    const match = /^diff --git a\/(.+?) b\//.exec(line);
    if (match?.[1] !== undefined) names.add(match[1]);
  }
  return [...names].map((name) => ` ${name}\n`).join("");
}

function untrackedAsDiff(workDir: string, names: readonly string[]): string {
  let out = "";
  for (const name of names) {
    out += `\n--- /dev/null\n+++ b/${name} (untracked)\n`;
    try {
      const body = readFileSync(path.join(workDir, name), "utf8");
      out += body
        .split("\n")
        .map((line) => `+${line}`)
        .join("\n");
      out += "\n";
    } catch {
      /* header alone: the reviewer still learns the file exists. */
    }
  }
  return out;
}

export function publicTicket(ticket: Ticket): Record<string, unknown> {
  return {
    id: ticket.id,
    type: ticket.type,
    title: ticket.title,
    description: ticket.description,
    acceptance_criteria: ticket.acceptance_criteria,
    non_goals: ticket.non_goals,
    surface: ticket.surface,
  };
}

export function lastNote(ticket: Ticket): string {
  return ticket.notes.at(-1)?.text ?? "";
}

function readRules(root: string): string {
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const file = path.join(root, name);
    if (existsSync(file)) return readFileSync(file, "utf8");
  }
  return "(no rules file)";
}
