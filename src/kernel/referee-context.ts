import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { readBindings } from "../adapter/drift.js";
import type { PromptSet, SessionBackend } from "../sessions/backend.js";
import type { State } from "../schemas/states.js";
import type { Ticket } from "../schemas/ticket.js";
import { git, resolveBaseRef, snapshotRefs, type RefSnapshot, type RunBranch } from "./git.js";
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

export class Breach extends Error {}

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
  /** B-2: per-ticket worktrees, merged `--no-ff` into the run branch on DONE. */
  readonly worktree?: boolean;
}

export class RefereeContext {
  readonly root: string;
  readonly backend: SessionBackend;
  readonly prompts: PromptSet;
  readonly worker: string;
  readonly now: () => number;
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

  diff(workDir: string): string {
    try {
      return git(workDir, "diff", "HEAD").slice(-8000);
    } catch {
      return "";
    }
  }
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
