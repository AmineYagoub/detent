import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { discover } from "../adapter/discover/index.js";
import { DriftHaltError, assertNoDrift, readBindings, writeBindings } from "../adapter/drift.js";
import { needsBaseRef, substituteBase, CI_ENV } from "../adapter/normalize.js";
import { runGate, runnable, type GateResult } from "../adapter/run.js";
import { stateDir } from "../fs/layout.js";
import { parseArtifact } from "../schemas/common.js";
import { approvalSchema, hypothesisSchema, type Binding, type Hypothesis, type ResearchBrief } from "../schemas/records.js";
import type { GateSlot } from "../schemas/gates.js";
import { READ_ONLY_ROLES, roleForState, type RoleId, type SessionState } from "../schemas/roles.js";
import type { State } from "../schemas/states.js";
import type { Ticket } from "../schemas/ticket.js";
import {
  prefixHash,
  stablePrefix,
  type PromptSet,
  type SessionBackend,
  type SessionSpec,
} from "../sessions/backend.js";
import {
  budgetBreach,
  claimed,
  gateDrift,
  gateGreen,
  gateRed,
  humanApproved,
  humanRequeue,
  premiseFalsified,
  riskRequired,
  type KernelEvent,
} from "./events.js";
import { writeDossier } from "./dossier.js";
import { RerunLedger, filterFlake, ledgerFor, quarantineTicket } from "./flake.js";
import { classify } from "./classify.js";
import { currentCounters, currentGeneration, openGeneration, withCurrentCounters } from "./generations.js";
import {
  changedFiles,
  clearCurrentTicket,
  ensureRunBranch,
  ensureWorktree,
  enforceBaseGuard,
  git,
  installTrailerHook,
  markCurrentTicket,
  mergeWorktree,
  resetDirtyTracked,
  resolveBaseRef,
  snapshotRefs,
  type RefSnapshot,
  type RunBranch,
} from "./git.js";
import { RunJournal, runsDir } from "./journal.js";
import { finalizeBootstrap } from "../init/plan.js";
import { SpendExhaustedError, SpendLedger } from "./ledger.js";
import { apply, type GuardContext } from "./machine.js";
import { scrub } from "./scrub.js";
import { diagnoseStage } from "./stages/diagnose.js";
import { reviewStage } from "./stages/review.js";
import { researchStage } from "./stages/research.js";
import { allTickets, isClaimed, readTicket, ready } from "./tickets/readers.js";
import { claim, release, writeTicket, appendNote, linkDiscovered } from "./tickets/mutations.js";
import { loadConfig, type LoadedConfig } from "./worstcase.js";

/**
 * T-041 — the kernel run loop (C-9, C-11, B-5, X-1 enforcement, V-3/D-23),
 * composed at this batch with T-042 (branch contract), T-043 (diagnosis gate),
 * T-044 (review routing), T-045 (research cache), T-048 (spend backstop).
 *
 * The loop launches sessions and runs gates; it never decides an outcome a
 * validator or a gate did not establish (P2, ARCH-1) — mechanically, its
 * commit path accepts only the evidence-carrying events of `events.ts`
 * (T-054), so a bare event string cannot reach `machine.apply`.
 *
 * Remaining boundaries: real SDK transport is exercised under R-10's key gate
 * (doctor smoke, M2 exit); escalation UX is T-049; stale-claim breaking is
 * T-055's plumbing.
 */

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_NOT_READY = 2;
export const EXIT_HUMAN_GATED = 10;

/** States the pool resumes (C-9). Human-gated and terminal states are not in-flight. */
const RESUMABLE: readonly State[] = [
  "DIAGNOSED",
  "IN_PROGRESS",
  "BLIND_FIX",
  "RESEARCH",
  "INFORMED_FIX",
  "REVIEW_FIX",
  "IN_REVIEW",
  "APPROVED",
];

export interface RunOptions {
  readonly root: string;
  readonly backend: SessionBackend;
  readonly worker?: string;
  readonly maxTickets?: number;
  readonly runId?: string;
  /** B-2: per-ticket worktrees, merged `--no-ff` into the run branch on DONE. */
  readonly worktree?: boolean;
  /** Injectable wall clock (ms) for the X-1 `ticket_wall_clock_ms` fixtures. */
  readonly now?: () => number;
  /**
   * The vendored, hash-verified prompt set. Required, not defaulted: loading
   * lives in the sessions layer (`loadPromptSet`), and ARCH-1 forbids the
   * kernel reaching past the backend seam to fetch it.
   */
  readonly prompts: PromptSet;
  /**
   * C-10: escalations are handled INSIDE `run` on a TTY. When present, a
   * NEEDS_HUMAN ticket is offered here — approve / requeue-with-guidance /
   * skip / quit — and the loop continues in-process. Absent (non-TTY), the
   * ticket stays pending and the run exits 10 with the JSON summary.
   */
  readonly escalate?: (input: EscalationInput) => Promise<EscalationAction>;
  /** C-13: resume announcements and similar user-facing notices. */
  readonly announce?: (message: string) => void;
}

export interface EscalationInput {
  readonly ticket: Ticket;
  readonly reason: string;
  readonly summary: string;
}

export type EscalationAction =
  | { readonly kind: "approve"; readonly by: string }
  | { readonly kind: "requeue"; readonly by: string; readonly guidance: string }
  | { readonly kind: "skip"; readonly by: string }
  | { readonly kind: "quit" };

export interface PendingEntry {
  readonly id: string;
  readonly state: State;
  readonly reason: string;
}

export interface RunOutcome {
  readonly exitCode: 0 | 1 | 2 | 10;
  /** C-10's non-TTY machine-readable summary; schema-stable. */
  readonly summary: {
    readonly schema_version: 1;
    readonly exit: number;
    readonly pending: readonly PendingEntry[];
    readonly reason?: string;
  };
}

class Breach extends Error {}

class KernelBoundaryError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "KernelBoundaryError";
  }
}

/** C-9/C-7: `run` executes only an approved plan; R-9: config loads or nothing runs. */
export async function run(opts: RunOptions): Promise<RunOutcome> {
  const configPath = path.join(stateDir(opts.root), "config.json");
  if (!existsSync(configPath)) {
    return notReady(`no config at ${configPath} — run \`detent init\` first`);
  }
  let loaded: LoadedConfig;
  try {
    loaded = loadConfig(JSON.parse(readFileSync(configPath, "utf8")));
  } catch (err) {
    return notReady(`config rejected: ${(err as Error).message}`);
  }
  return await runWithConfig(opts, loaded);
}

/**
 * Exposed separately for the X-1 backstop fixtures: the net-sessions ceiling
 * is unreachable under any config `loadConfig` accepts, so proving the
 * enforcement fires requires budgets the load path would refuse.
 */
export async function runWithConfig(opts: RunOptions, loaded: LoadedConfig): Promise<RunOutcome> {
  const { root } = opts;
  const approval = readApproval(root);
  if (approval !== "ok") return notReady(approval);

  let journal: RunJournal;
  try {
    journal = RunJournal.open(root);
  } catch (err) {
    return notReady((err as Error).message);
  }

  try {
    const runBranch = ensureRunBranch(root, opts.runId ?? `${process.pid}-${Date.now().toString(36)}`);
    installTrailerHook(root);
    const kernel = new Kernel(opts, loaded, journal, runBranch);
    return await kernel.loop();
  } catch (err) {
    return {
      exitCode: EXIT_ERROR,
      summary: { schema_version: 1, exit: EXIT_ERROR, pending: [], reason: (err as Error).message },
    };
  } finally {
    journal.close();
  }
}

function notReady(reason: string): RunOutcome {
  return { exitCode: EXIT_NOT_READY, summary: { schema_version: 1, exit: EXIT_NOT_READY, pending: [], reason } };
}

function readApproval(root: string): string {
  const file = path.join(stateDir(root), "plan", "approval.json");
  if (!existsSync(file)) {
    return "no approved plan — `run` executes only an approved plan (C-9); approve it via `init` (C-7)";
  }
  const parsed = parseArtifact(approvalSchema, JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.ok) return `plan approval is invalid — re-approve (C-7)`;
  return "ok";
}

/** Thrown to unwind to the top when V-3 halts the run (SEC-5, D-23). */
class DriftHaltSignal extends Error {
  constructor(readonly halt: DriftHaltError) {
    super(halt.message);
    this.name = "DriftHaltSignal";
  }
}

class Kernel {
  private readonly worker: string;
  private readonly now: () => number;
  private readonly prompts: PromptSet;
  private readonly rulesText: string;
  private readonly bindingsPreamble: string;
  private readonly spend: SpendLedger;
  private readonly refs: RefSnapshot;
  private readonly baseRef: string | null;
  private processed = 0;
  private quitting = false;

  constructor(
    private readonly opts: RunOptions,
    private readonly loaded: LoadedConfig,
    private readonly journal: RunJournal,
    private readonly runBranch: RunBranch,
  ) {
    this.worker = opts.worker ?? "w1";
    this.now = opts.now ?? (() => Date.now());
    this.prompts = opts.prompts;
    this.rulesText = this.readRules();
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
    // P7: every ref except the run branch is protected ground for this run.
    this.refs = snapshotRefs(opts.root);
    // V-5: the run's baseline, resolved once; null falls back to root commands.
    this.baseRef = resolveBaseRef(opts.root, runBranch);
  }

  private get root(): string {
    return this.opts.root;
  }

  private get budgets() {
    return this.loaded.config.budgets;
  }

  // ------------------------------------------------------------- the loop

  async loop(): Promise<RunOutcome> {
    this.requeueDriftBlocked();

    for (;;) {
      if (this.quitting) return this.finish();
      const pool = this.claimables();
      if (pool.length === 0) return this.finish();

      const ticket = pool[0] as Ticket;
      if (!claim(this.root, ticket.id, this.worker)) continue;
      markCurrentTicket(this.root, ticket.id);
      try {
        await this.processTicket(ticket.id);
      } catch (err) {
        if (err instanceof DriftHaltSignal) return this.haltForDrift(err.halt);
        throw err;
      } finally {
        clearCurrentTicket(this.root);
        release(this.root, ticket.id);
      }

      this.processed += 1;
      if (this.opts.maxTickets !== undefined && this.processed >= this.opts.maxTickets) return this.finish();
    }
  }

  private claimables(): Ticket[] {
    const readyPool = ready(this.root);
    // A claimed in-flight ticket is skipped, exactly as the oracle skipped
    // them: retrying a claim that cannot succeed would spin forever. Breaking
    // a STALE claim (owner dead) is plumbing's job under C-12's discipline
    // (T-055); the loop never guesses about another process's liveness.
    const resumable = allTickets(this.root).filter(
      (t) => RESUMABLE.includes(t.state) && !isClaimed(this.root, t.id) && !readyPool.some((r) => r.id === t.id),
    );
    return [...readyPool, ...resumable];
  }

  private finish(): RunOutcome {
    const pending: PendingEntry[] = allTickets(this.root)
      .filter((t) => t.state === "NEEDS_HUMAN" || t.state === "BLOCKED")
      .map((t) => ({ id: t.id, state: t.state, reason: lastNote(t) }));
    if (pending.length > 0) {
      return { exitCode: EXIT_HUMAN_GATED, summary: { schema_version: 1, exit: EXIT_HUMAN_GATED, pending } };
    }
    return { exitCode: EXIT_OK, summary: { schema_version: 1, exit: EXIT_OK, pending: [] } };
  }

  // -------------------------------------------------- drift (V-3, D-23)

  private requeueDriftBlocked(): void {
    const bindings = readBindings(this.root).bindings;
    if (bindings.length === 0) return;
    try {
      assertNoDrift(bindings, discover(this.root));
    } catch {
      return;
    }
    for (const ticket of allTickets(this.root)) {
      if (ticket.state !== "BLOCKED" || !lastNote(ticket).startsWith("drift-blocked:")) continue;
      const requeued = this.commit(ticket, humanRequeue("verify-sync-rebaseline"));
      const generations = openGeneration(requeued, {
        at: new Date(this.now()).toISOString(),
        reason: `gate drift re-baselined via verify sync; ${lastNote(ticket)}`,
      });
      writeTicket(this.root, { ...requeued, generations });
      appendNote(this.root, ticket.id, { author: "kernel", text: "requeued after drift re-baseline (V-3/X-8)" });
    }
  }

  private haltForDrift(halt: DriftHaltError): RunOutcome {
    for (const ticket of allTickets(this.root)) {
      // Draft.7's V-3: GATE_DRIFT applies to every non-terminal CLAIMED ticket.
      if (ticket.state === "DONE" || ticket.state === "BLOCKED") continue;
      if (!isClaimed(this.root, ticket.id)) continue;
      const blocked = this.commit(ticket, gateDrift(halt));
      this.closeGeneration(blocked, "blocked");
      appendNote(this.root, ticket.id, {
        author: "kernel",
        text: `drift-blocked: ${halt.halting.map((h) => h.message).join(" | ")}`,
      });
      release(this.root, ticket.id);
    }
    return {
      exitCode: EXIT_NOT_READY,
      summary: {
        schema_version: 1,
        exit: EXIT_NOT_READY,
        pending: [],
        reason: `verification changed — re-baseline (V-3): ${halt.halting.map((h) => h.message).join(" | ")}`,
      },
    };
  }

  // ------------------------------------------------------ ticket driving

  private async processTicket(id: string): Promise<void> {
    let ticket = readTicket(this.root, id);
    const startedAt = this.now();
    const flakeLedger = ledgerFor(this.budgets);
    const workDir = this.opts.worktree === true ? ensureWorktree(this.root, id) : this.root;

    if (ticket.state === "READY") {
      ticket = this.commit(ticket, claimed());
    } else {
      // C-13: resume always announces itself, in the five-label vocabulary —
      // the caller renders it; internal state names never reach a terminal.
      this.opts.announce?.(this.resumeAnnouncement(ticket));
      // B-5: uncommitted tracked changes at resume are reset to the last
      // ticket commit; untracked files stay — the gate judges the tree as-is.
      const reset = resetDirtyTracked(workDir);
      if (reset.length > 0) {
        appendNote(this.root, id, { author: "kernel", text: `B-5 resume reset: ${reset.join(", ")}` });
      }
    }

    while (ticket.state !== "DONE" && ticket.state !== "NEEDS_HUMAN" && ticket.state !== "BLOCKED") {
      if (this.now() - startedAt > this.budgets.ticket_wall_clock_ms) {
        ticket = this.breach(ticket, "ticket wall clock ceiling (X-1)");
        break;
      }
      try {
        ticket = await this.stage(ticket, flakeLedger, workDir);
      } catch (err) {
        if (err instanceof Breach || err instanceof SpendExhaustedError) {
          ticket = this.breach(readTicket(this.root, id), (err as Error).message);
          break;
        }
        throw err;
      }
    }

    if (ticket.state === "NEEDS_HUMAN") {
      const reason = lastNote(ticket) || "escalated";
      writeDossier(this.root, readTicket(this.root, id), reason);
      this.closeGeneration(ticket, "needs_human");
      await this.offerEscalation(id, reason, flakeLedger, workDir);
    } else if (ticket.state === "BLOCKED") {
      this.closeGeneration(ticket, "blocked");
    } else if (ticket.state === "DONE") {
      this.finalize(ticket, workDir);
      this.closeGeneration(ticket, "done");
    }
  }

  private async stage(ticket: Ticket, flakeLedger: RerunLedger, workDir: string): Promise<Ticket> {
    switch (ticket.state) {
      case "IN_PROGRESS": {
        await this.session(ticket, "IN_PROGRESS", { ticket: publicTicket(ticket) }, workDir);
        const falsified = this.consumeFalsifiedSignal(ticket.id);
        if (falsified !== null) {
          return this.commit(readTicket(this.root, ticket.id), premiseFalsified(falsified));
        }
        return await this.evaluateGate(ticket, flakeLedger, workDir);
      }
      case "BLIND_FIX":
        await this.session(ticket, "BLIND_FIX", this.fixInputs(ticket, workDir), workDir);
        return await this.evaluateGate(ticket, flakeLedger, workDir);
      case "INFORMED_FIX":
        await this.session(
          ticket,
          "INFORMED_FIX",
          { ...this.fixInputs(ticket, workDir), research: this.maybeArtifact(ticket.id, "research.json") },
          workDir,
        );
        return await this.evaluateGate(ticket, flakeLedger, workDir, "informed fix failed — the ladder cannot reopen (D-13)");
      case "REVIEW_FIX":
        await this.session(
          ticket,
          "REVIEW_FIX",
          { ...this.fixInputs(ticket, workDir), review: this.maybeArtifact(ticket.id, "review.json") },
          workDir,
        );
        return await this.evaluateGate(ticket, flakeLedger, workDir);
      case "RESEARCH":
        return await this.stageResearch(ticket, workDir);
      case "IN_REVIEW":
        return await this.stageReview(ticket, workDir);
      case "APPROVED":
        return await this.stageCloseCheck(ticket, flakeLedger, workDir);
      case "DIAGNOSED":
        return await this.stageDiagnose(ticket, workDir);
      default:
        throw new KernelBoundaryError(`kernel has no handler for state ${ticket.state}`);
    }
  }

  // ---- T-043: the diagnosis gate ------------------------------------------

  private async stageDiagnose(ticket: Ticket, workDir: string): Promise<Ticket> {
    const artifactPath = path.join(runsDir(this.root, ticket.id), "hypothesis.json");
    const outcome = await diagnoseStage({
      launch: async () => {
        await this.session(ticket, "DIAGNOSED", { ticket: publicTicket(ticket) }, workDir);
      },
      readArtifact: () => this.maybeArtifact(ticket.id, "hypothesis.json"),
      writeArtifact: (h: Hypothesis) => {
        mkdirSync(path.dirname(artifactPath), { recursive: true });
        writeFileSync(artifactPath, `${JSON.stringify(h, null, 2)}\n`);
      },
      executeRepro: (command) =>
        runGate({ command, cwd: workDir, slot: "test", timeoutMs: this.budgets.gate_timeout_ms, env: CI_ENV }),
      note: (text) => appendNote(this.root, ticket.id, { author: "kernel", text }),
    });
    return this.commit(readTicket(this.root, ticket.id), outcome.event);
  }

  // ---- T-044: review consumption ------------------------------------------

  private async stageReview(ticket: Ticket, workDir: string): Promise<Ticket> {
    const hypothesisRaw = this.maybeArtifact(ticket.id, "hypothesis.json");
    const hypothesisParsed = hypothesisRaw === null ? null : parseArtifact(hypothesisSchema, hypothesisRaw);
    const hypothesis = hypothesisParsed !== null && hypothesisParsed.ok ? hypothesisParsed.value : null;
    const outcome = await reviewStage(ticket, this.diff(workDir), hypothesis, {
      launch: async (inputs) => {
        await this.session(ticket, "IN_REVIEW", inputs, workDir);
      },
      readArtifact: () => this.maybeArtifact(ticket.id, "review.json"),
      note: (text) => appendNote(this.root, ticket.id, { author: "kernel", text }),
    });
    if (outcome.kind === "breaker") throw new Breach(outcome.reason);
    return this.commit(readTicket(this.root, ticket.id), outcome.event);
  }

  // ---- T-045: research with the env-keyed cache ---------------------------

  private async stageResearch(ticket: Ticket, workDir: string): Promise<Ticket> {
    const outcome = await researchStage({
      root: this.root,
      launch: async (inputs) => {
        await this.session(ticket, "RESEARCH", inputs, workDir);
      },
      readArtifact: () => this.maybeArtifact(ticket.id, "research.json"),
      readFailureSignature: () => {
        const failure = this.maybeArtifact(ticket.id, "last_failure.json") as { signature?: string } | null;
        return failure?.signature ?? null;
      },
      toolCallCeiling: this.budgets.failure_research_tool_calls,
      note: (text) => appendNote(this.root, ticket.id, { author: "kernel", text }),
      ticketInputs: {
        ticket: publicTicket(ticket),
        failure: this.maybeArtifact(ticket.id, "last_failure.json"),
      },
    });
    if (outcome.upstream !== undefined) {
      this.linkUpstream(ticket, outcome.upstream);
    }
    return this.commit(readTicket(this.root, ticket.id), outcome.event);
  }

  private linkUpstream(ticket: Ticket, brief: ResearchBrief): void {
    const source = brief.evidence[0]?.source ?? "unknown";
    linkDiscovered(
      this.root,
      ticket.id,
      {
        id: `${ticket.id}-upstream`,
        type: "bug",
        title: `Upstream bug blocking ${ticket.id}`,
        description: `See ${source}. ${brief.upstream_bug ?? ""}`,
        acceptance_criteria: ["upstream fix released, or an approved workaround chosen"],
      },
      "related",
    );
  }

  // ---- close-check ---------------------------------------------------------

  private async stageCloseCheck(ticket: Ticket, flakeLedger: RerunLedger, workDir: string): Promise<Ticket> {
    // B-4: the ticket's own label, or the diff touching risk globs — both
    // require a human before finalize. A recorded human approval covers the
    // risk once; the kernel still re-verifies the gates below (X-3).
    const approved = ticket.notes.some((n) => n.text.startsWith("human-approved:"));
    if (!approved) {
      if (ticket.risk_label) {
        appendNote(this.root, ticket.id, { author: "kernel", text: "risk-labelled change requires human approval (B-4)" });
        // Fresh read: committing from the stale reference would overwrite the
        // note appendNote just persisted (the lost-update this loop must never do).
        return this.commit(readTicket(this.root, ticket.id), riskRequired("label"));
      }
      const globs = this.loaded.config.risk;
      if (globs.length > 0) {
        const touched = changedFiles(workDir, this.baseRef ?? this.runBranch.base).filter((f) =>
          picomatch.isMatch(f, [...globs], { dot: true }),
        );
        if (touched.length > 0) {
          appendNote(this.root, ticket.id, {
            author: "kernel",
            text: `risk-path change requires human approval (B-4): ${touched.join(", ")}`,
          });
          return this.commit(readTicket(this.root, ticket.id), riskRequired({ globs, files: touched }));
        }
      }
    }
    return await this.evaluateGate(ticket, flakeLedger, workDir, undefined, ["lint", "typecheck", "test", "build", "e2e"]);
  }

  // ---- escalation (C-10, T-049) -------------------------------------------

  /**
   * The in-run escalation flow. Approve applies HUMAN_APPROVED (the kernel
   * re-verifies from APPROVED — never a direct DONE); requeue opens a fresh
   * generation carrying the guidance (X-8); skip leaves the ticket pending;
   * quit stops the run. The human act is the answer itself.
   */
  private async offerEscalation(id: string, reason: string, flakeLedger: RerunLedger, workDir: string): Promise<void> {
    if (this.opts.escalate === undefined || this.quitting) return;
    const fresh = readTicket(this.root, id);
    const { dossierSummary, buildDossier } = await import("./dossier.js");
    const action = await this.opts.escalate({
      ticket: fresh,
      reason,
      summary: dossierSummary(fresh, buildDossier(this.root, fresh, reason)),
    });

    if (action.kind === "quit") {
      this.quitting = true;
      return;
    }
    if (action.kind === "skip") {
      appendNote(this.root, id, { author: action.by, text: `skipped at escalation (C-10)` });
      return;
    }
    if (action.kind === "approve") {
      appendNote(this.root, id, { author: action.by, text: `human-approved: by ${action.by} at escalation (C-10)` });
      const approvedTicket = this.commit(readTicket(this.root, id), humanApproved(`approved in-run by ${action.by} (C-10)`));
      this.reopenGeneration(id);
      // The kernel re-verifies: drive the ticket onward from APPROVED now.
      await this.driveOn(approvedTicket.id, flakeLedger, workDir);
      return;
    }
    // requeue with guidance
    appendNote(this.root, id, { author: action.by, text: `requeued with guidance (C-10): ${action.guidance}` });
    const requeued = this.commit(readTicket(this.root, id), humanRequeue(`requeue by ${action.by}: ${action.guidance}`));
    const generations = openGeneration(requeued, { at: this.iso(), reason: action.guidance });
    writeTicket(this.root, { ...requeued, generations });
  }

  /** After an in-run approval the closed generation reopens for the re-verify. */
  private reopenGeneration(id: string): void {
    const fresh = readTicket(this.root, id);
    const generation = currentGeneration(fresh);
    if (generation.ended_at === undefined) return;
    // exactOptionalTypes: rebuild without ended_at rather than destructuring
  // into an unused binding the lint rejects.
  const reopened = { ...generation, outcome: "in_flight" as const };
  delete (reopened as { ended_at?: string }).ended_at;
    writeTicket(this.root, {
      ...fresh,
      generations: [...fresh.generations.slice(0, -1), reopened],
    });
  }

  private async driveOn(id: string, flakeLedger: RerunLedger, workDir: string): Promise<void> {
    let ticket = readTicket(this.root, id);
    while (ticket.state !== "DONE" && ticket.state !== "NEEDS_HUMAN" && ticket.state !== "BLOCKED") {
      try {
        ticket = await this.stage(ticket, flakeLedger, workDir);
      } catch (err) {
        if (err instanceof Breach || err instanceof SpendExhaustedError) {
          ticket = this.breach(readTicket(this.root, id), (err as Error).message);
          break;
        }
        throw err;
      }
    }
    if (ticket.state === "DONE") {
      this.finalize(ticket, workDir);
      this.closeGeneration(ticket, "done");
    } else if (ticket.state === "NEEDS_HUMAN") {
      writeDossier(this.root, readTicket(this.root, id), lastNote(ticket) || "escalated");
      this.closeGeneration(ticket, "needs_human");
    } else {
      this.closeGeneration(ticket, "blocked");
    }
  }

  /** C-13: the five-label vocabulary; full state names live only in the journal. */
  private resumeAnnouncement(ticket: Ticket): string {
    const labels: Record<string, string> = {
      DIAGNOSED: "diagnosing",
      IN_PROGRESS: "implementing",
      BLIND_FIX: "fixing",
      RESEARCH: "researching the failure",
      INFORMED_FIX: "fixing, research applied",
      REVIEW_FIX: "addressing review findings",
      IN_REVIEW: "in review",
      APPROVED: "verifying",
    };
    return `resuming ${ticket.id} — ${labels[ticket.state] ?? "working"}`;
  }

  // --------------------------------------------------------------- gates

  private async evaluateGate(
    ticket: Ticket,
    flakeLedger: RerunLedger,
    workDir: string,
    escalateReason?: string,
    slots: readonly GateSlot[] = ["lint", "typecheck", "test"],
  ): Promise<Ticket> {
    const bindings = readBindings(this.root).bindings;
    try {
      assertNoDrift(bindings, discover(workDir));
    } catch (err) {
      if (err instanceof DriftHaltError) throw new DriftHaltSignal(err);
      throw err;
    }

    const result = await this.runScopedGates(bindings, slots, workDir);
    if (result === null || result.green) {
      return this.commit(readTicket(this.root, ticket.id), gateGreen(result));
    }

    // X-5: one isolated rerun for a suspected flake, through T-022's filter.
    // Isolation prefers the test_single binding; a `BASE` template resolves
    // against the run's merge-base, or falls back to the failing command when
    // the baseline is unresolvable (V-5).
    const single = bindings.find((b) => b.slot === "test_single");
    let isolationCmd = result.command;
    if (single !== undefined) {
      if (!needsBaseRef(single.resolved)) isolationCmd = single.resolved;
      else if (this.baseRef !== null) isolationCmd = substituteBase(single.resolved, this.baseRef);
    }
    const decision = await filterFlake({
      first: result,
      rerunInIsolation: () => this.gate(isolationCmd, result.slot ?? "test", workDir),
      ledger: flakeLedger,
    });

    if (decision.kind === "quarantine") {
      const fresh = readTicket(this.root, ticket.id);
      const quarantineId = `${ticket.id}-flake-${fresh.links.filter((l) => l.rel === "quarantines").length + 1}`;
      quarantineTicket(this.root, ticket.id, decision, { id: quarantineId });
      appendNote(this.root, ticket.id, {
        author: "kernel",
        text: `flaky gate quarantined as ${quarantineId}; nothing charged (X-5)`,
      });
      return this.commit(readTicket(this.root, ticket.id), gateGreen(decision.result, "flake-filtered"));
    }

    this.recordFailure(ticket.id, decision.result);
    if (escalateReason !== undefined) {
      appendNote(this.root, ticket.id, { author: "kernel", text: escalateReason });
    }
    return this.commit(readTicket(this.root, ticket.id), gateRed(decision.result));
  }

  private async runScopedGates(
    bindings: ReturnType<typeof readBindings>["bindings"],
    slots: readonly GateSlot[],
    workDir: string,
  ): Promise<GateResult | null> {
    let last: GateResult | null = null;
    for (const slot of slots) {
      const binding = bindings.find((b) => b.slot === slot);
      if (binding === undefined) continue;
      last = await this.gate(binding.resolved, slot, workDir);
      if (!last.green) return last;
    }
    return last;
  }

  private async gate(command: string, slot: GateSlot, workDir: string): Promise<GateResult> {
    const result = await runGate({
      command,
      cwd: workDir,
      slot,
      timeoutMs: this.budgets.gate_timeout_ms,
      env: CI_ENV,
    });
    if (result.outcome === "not-found" || !runnable(result)) {
      throw new Breach(`gate ${slot} is not runnable: \`${command}\` (exit ${result.normalizedExit})`);
    }
    return result;
  }

  private recordFailure(ticketId: string, result: GateResult): void {
    const verdict = classify(result.output, result.exitCode);
    const record = {
      cmd: result.command,
      exit: result.exitCode,
      signature: verdict.signature,
      classification: verdict.patternClass,
      // SEC-4: scrubbed BEFORE write — a secret echoed by a failing gate
      // must never land in an artifact.
      output_tail: scrub(result.output.slice(-4000)),
    };
    const dir = runsDir(this.root, ticketId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "last_failure.json"), `${JSON.stringify(record, null, 2)}\n`);
  }

  // ------------------------------------------------------------ sessions

  private async session(
    ticket: Ticket,
    state: SessionState,
    inputs: Record<string, unknown>,
    workDir: string,
  ): Promise<void> {
    const role = roleForState(state);
    const id = ticket.id;
    if (this.journal.unfinished(id, role)) {
      this.journal.appendTicketEvent(id, { stage: role, event: "skipped_after_crash", at: this.iso() });
      return;
    }

    // D-25: the spend ceiling is a launch gate, evaluated here and never
    // mid-flight — overshoot is bounded by the one session in flight.
    this.spend.assertLaunchAllowed();

    let current = readTicket(this.root, id);
    const counters = currentCounters(current);
    if (counters.sessions >= this.budgets.sessions) {
      throw new Breach("net session ceiling (X-1) — backstop against a kernel accounting defect");
    }
    const generation = currentGeneration(current);
    current = {
      ...current,
      generations: withCurrentCounters(current.generations, generation.index, {
        ...counters,
        sessions: counters.sessions + 1,
      }),
    };
    writeTicket(this.root, current);

    const artifactOut = path.join(runsDir(this.root, id), artifactNameFor(role));
    mkdirSync(path.dirname(artifactOut), { recursive: true });
    const spec: SessionSpec = {
      role,
      ticketId: id,
      promptPrefix: this.prefixFor(role),
      promptVariable: JSON.stringify(
        {
          inputs,
          artifact_out: artifactOut,
          falsified_out: path.join(runsDir(this.root, id), "falsified.json"),
          surface_request_out: path.join(runsDir(this.root, id), "surface_request.json"),
        },
        null,
        2,
      ),
      cwd: workDir,
      artifactOut,
      allowedTools: this.toolsFor(role),
      permissionMode: READ_ONLY_ROLES.has(role) ? "plan" : "",
      model: this.loaded.config.model_routing[role] ?? "",
      maxTurns: this.budgets.turns_per_stage,
    };

    this.journal.appendTicketEvent(id, { stage: role, event: "start", at: this.iso() });
    const result = await this.opts.backend.run(spec);
    const generationNow = currentGeneration(readTicket(this.root, id));
    this.spend.record(id, generationNow.index, role, result, this.iso());
    this.journal.appendTicketEvent(id, {
      stage: role,
      event: "end",
      at: this.iso(),
      ok: result.ok,
      cost: result.costEstimateUsd,
    });
    this.rememberPrefix(role, spec);

    // P7: a session is Detent's act, and Detent never writes the base branch.
    // The S-2 hook prevents; this is the kernel's independent line (P2) — any
    // moved non-run ref is restored and the ticket escalates.
    const violations = enforceBaseGuard(this.root, this.refs, this.runBranch.branch);
    if (violations.length > 0) {
      const detail = violations.map((v) => `${v.ref}: ${v.was} -> ${v.became ?? "(deleted)"}`).join("; ");
      appendNote(this.root, id, { author: "kernel", text: `base-branch write detected and reverted (B-3/P7): ${detail}` });
      throw new Breach(`base-branch write detected and reverted (B-3/P7): ${detail}`);
    }

    if (!READ_ONLY_ROLES.has(role)) this.handleSurfaceRequest(id);
    if (!result.telemetryParsed) throw new Breach("telemetry unparsable (S-4 circuit breaker)");
  }

  /**
   * SEC-3's lever: the hook denies and points here; the KERNEL decides.
   * Granting appends to the ticket surface (logged); protected paths and a
   * grant budget of three are hard limits.
   */
  private handleSurfaceRequest(ticketId: string): void {
    const file = path.join(runsDir(this.root, ticketId), "surface_request.json");
    if (!existsSync(file)) return;
    let request: { path?: string; justification?: string };
    try {
      request = JSON.parse(readFileSync(file, "utf8")) as typeof request;
    } catch {
      request = {};
    }
    rmSync(file, { force: true });
    const target = (request.path ?? "").trim();
    const why = (request.justification ?? "").slice(0, 200);
    const ticket = readTicket(this.root, ticketId);
    const grants = ticket.notes.filter((n) => n.text.startsWith("surface granted:")).length;

    const isProtected = target !== "" && picomatch.isMatch(target, [...this.loaded.config.protected], { dot: true });
    if (target === "" || isProtected || grants >= 3) {
      appendNote(this.root, ticketId, { author: "kernel", text: `surface DENIED: ${target} (${why}) (SEC-3)` });
      return;
    }
    writeTicket(this.root, { ...ticket, surface: [...ticket.surface, target] });
    appendNote(this.root, ticketId, { author: "kernel", text: `surface granted: ${target} — ${why} (SEC-3)` });
  }

  private consumeFalsifiedSignal(ticketId: string): string | null {
    const file = path.join(runsDir(this.root, ticketId), "falsified.json");
    if (!existsSync(file)) return null;
    let note = "premise falsified";
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { note?: string };
      if (typeof parsed.note === "string" && parsed.note !== "") note = parsed.note;
    } catch {
      /* the signal's existence is the event; the note is best-effort */
    }
    rmSync(file, { force: true });
    appendNote(this.root, ticketId, { author: "kernel", text: `falsified mid-implementation: ${note}` });
    return note;
  }

  private readonly prefixSeen = new Map<string, string>();

  private rememberPrefix(role: string, spec: SessionSpec): void {
    const seen = this.prefixSeen.get(role);
    const hash = prefixHash(spec);
    if (seen !== undefined && seen !== hash) {
      throw new KernelBoundaryError(`S-6 violated: role ${role} prefix hash moved within a run`);
    }
    this.prefixSeen.set(role, hash);
  }

  private prefixFor(role: RoleId): string {
    return stablePrefix(this.prompts.prompts[role], this.rulesText, this.bindingsPreamble);
  }

  private toolsFor(role: RoleId): readonly string[] {
    // The kernel's advisory copy; the SDK backend composes the enforced set
    // (sessions/guard.ts), including domain-scoped WebFetch once PRDR-062
    // gives docs domains a config home.
    if (READ_ONLY_ROLES.has(role)) {
      return role === "research" ? ["Read", "Grep", "Glob", "WebSearch"] : ["Read", "Grep", "Glob"];
    }
    return ["Read", "Grep", "Glob", "Edit", "Write", "Bash(git add:*)", "Bash(git commit:*)"];
  }

  // ------------------------------------------------------------- commits

  private commit(ticket: Ticket, kernelEvent: KernelEvent): Ticket {
    const counters = currentCounters(ticket);
    const ctx: GuardContext = { ticket: { type: ticket.type }, budgets: this.budgets };
    const result = apply(ticket.state, kernelEvent.event, counters, ctx);
    const generation = currentGeneration(ticket);
    this.journal.appendTransition({
      at: this.iso(),
      ticket: ticket.id,
      generation: generation.index,
      from: result.from,
      event: kernelEvent.event,
      to: result.to,
      evidence: kernelEvent.evidence,
      counters: result.counters,
    });
    const updated: Ticket = {
      ...ticket,
      state: result.to,
      generations: withCurrentCounters(ticket.generations, generation.index, result.counters),
    };
    return writeTicket(this.root, updated);
  }

  private breach(ticket: Ticket, reason: string): Ticket {
    appendNote(this.root, ticket.id, { author: "kernel", text: reason });
    return this.commit(readTicket(this.root, ticket.id), budgetBreach(reason));
  }

  private closeGeneration(ticket: Ticket, outcome: "done" | "blocked" | "needs_human"): void {
    const fresh = readTicket(this.root, ticket.id);
    const generation = currentGeneration(fresh);
    if (generation.ended_at !== undefined) return;
    writeTicket(this.root, {
      ...fresh,
      generations: [...fresh.generations.slice(0, -1), { ...generation, outcome, ended_at: this.iso() }],
    });
  }

  private finalize(ticket: Ticket, workDir: string): void {
    // C-4: bootstrap #1's gates just passed, so greenfield's provisional
    // bindings become the baseline. A no-op for every other ticket.
    finalizeBootstrap(this.root, ticket.id, {
      readBindings: () => readBindings(this.root),
      writeBindings: (file) => writeBindings(this.root, file as { bindings: Binding[]; skips: never[] }),
      rediscover: () => discover(this.root).candidates,
      note: (text) => appendNote(this.root, ticket.id, { author: "kernel", text }),
    });
    git(workDir, "add", "-A");
    const dirty = git(workDir, "status", "--porcelain").trim();
    if (dirty !== "") git(workDir, "commit", "-q", "-m", `${ticket.id}: finalize`);
    // B-2: worktree mode merges --no-ff into the RUN branch — never the base.
    if (this.opts.worktree === true) mergeWorktree(this.root, ticket.id);
  }

  // -------------------------------------------------------------- helpers

  private fixInputs(ticket: Ticket, workDir: string): Record<string, unknown> {
    return {
      ticket: publicTicket(ticket),
      failure: this.maybeArtifact(ticket.id, "last_failure.json"),
      hypothesis: this.maybeArtifact(ticket.id, "hypothesis.json"),
      diff: this.diff(workDir),
    };
  }

  private diff(workDir: string): string {
    try {
      return git(workDir, "diff", "HEAD").slice(-8000);
    } catch {
      return "";
    }
  }

  private maybeArtifact(ticketId: string, name: string): unknown {
    const file = path.join(runsDir(this.root, ticketId), name);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  private readRules(): string {
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const file = path.join(this.root, name);
      if (existsSync(file)) return readFileSync(file, "utf8");
    }
    return "(no rules file)";
  }
}

function publicTicket(ticket: Ticket): Record<string, unknown> {
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

function artifactNameFor(role: string): string {
  if (role === "diagnose") return "hypothesis.json";
  if (role === "research") return "research.json";
  if (role === "review") return "review.json";
  return `${role}.json`;
}

function lastNote(ticket: Ticket): string {
  return ticket.notes.at(-1)?.text ?? "";
}
