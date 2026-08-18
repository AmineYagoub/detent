import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { discover } from "../adapter/discover/index.js";
import { DriftHaltError, assertNoDrift, readBindings, writeBindings } from "../adapter/drift.js";
import { needsBaseRef, substituteBase, CI_ENV } from "../adapter/normalize.js";
import { runGate, runnable, type GateResult } from "../adapter/run.js";
import { parseArtifact } from "../schemas/common.js";
import { hypothesisSchema, type Binding, type Hypothesis, type ResearchBrief } from "../schemas/records.js";
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
import { buildDossier, dossierSummary, writeDossier } from "./dossier.js";
import { RerunLedger, filterFlake, ledgerFor, quarantineTicket } from "./flake.js";
import { classify } from "./classify.js";
import { currentCounters, currentGeneration, openGeneration, withCurrentCounters } from "./generations.js";
import {
  changedFiles,
  clearCurrentTicket,
  ensureWorktree,
  enforceBaseGuard,
  git,
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
import { SpendLedger } from "./ledger.js";
import { apply, type GuardContext } from "./machine.js";
import { scrub } from "./scrub.js";
import { diagnoseStage } from "./stages/diagnose.js";
import { reviewStage } from "./stages/review.js";
import { researchStage } from "./stages/research.js";
import { allTickets, isClaimed, readTicket, ready } from "./tickets/readers.js";
import { claim, release, writeTicket, appendNote, linkDiscovered } from "./tickets/mutations.js";
import type { LoadedConfig } from "./worstcase.js";

/**
 * T-100…T-105 — the REFEREE core (R-1…R-4, D-27, ARCH-1/ARCH-2).
 *
 * The v2 kernel's primitives, extracted from the run loop so that legality has
 * exactly one home regardless of who drives. Everything here either validates,
 * measures, or persists; nothing here sequences — "which legal move runs next"
 * belongs to a driver (`run.ts` headless today, the model driver at MP2), and
 * every driver reaches these primitives only through the R-1 tool registry.
 *
 * The evidence escrow is the boundary's key mechanism: sealed `KernelEvent`s
 * never cross out of this module. A move that produces evidence (a gate run, a
 * validated artifact, a recorded human act) mints an opaque single-use ref;
 * `admit` — the ONLY `machine.apply` call site on the run path — redeems refs.
 * A driver therefore cannot name an event; it can only ask for one to be
 * derived, which is D-27's restatement of ARCH-1 made mechanical.
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

/** Re-exported so the registry catches these WITHOUT importing the machine or
 * the ledger itself — machine.js stays importable only inside the kernel. */
export { TransitionError } from "./machine.js";
export { SpendExhaustedError } from "./ledger.js";

export class Breach extends Error {}

export class KernelBoundaryError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "KernelBoundaryError";
  }
}

/** Thrown to unwind to the driver when V-3 halts the run (SEC-5, D-23). */
export class DriftHaltSignal extends Error {
  constructor(readonly halt: DriftHaltError) {
    super(halt.message);
    this.name = "DriftHaltSignal";
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

export interface AcquireResult {
  readonly ok: boolean;
  readonly reason?: string;
  /** Minted when the ticket was READY: the claim-lock is the evidence (C-9). */
  readonly claimedRef?: string;
  /** Present when resuming an in-flight state (C-13/B-5). */
  readonly resume?: { readonly state: State; readonly reset: readonly string[] };
}

export interface PendingEntry {
  readonly id: string;
  readonly state: State;
  readonly reason: string;
}

export interface AdmitResult {
  readonly from: State;
  readonly event: string;
  readonly to: State;
}

export class RefereeCore {
  private readonly worker: string;
  private readonly now: () => number;
  private readonly prompts: PromptSet;
  private readonly rulesText: string;
  private readonly bindingsPreamble: string;
  private readonly spend: SpendLedger;
  private readonly refs: RefSnapshot;
  private readonly baseRef: string | null;
  private readonly escrow = new Map<string, { ticketId: string; state: State; event: KernelEvent }>();
  private readonly workDirs = new Map<string, string>();
  private readonly flakeLedgers = new Map<string, RerunLedger>();
  private readonly prefixSeen = new Map<string, string>();
  private escrowSeq = 0;
  private driftSwept = false;
  private lastHalt: DriftHaltError | null = null;

  constructor(
    private readonly opts: CoreOptions,
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

  // -------------------------------------------------------------- escrow

  private mintFor(ticketId: string, event: KernelEvent): string {
    const ref = `ev-${++this.escrowSeq}`;
    this.escrow.set(ref, { ticketId, state: readTicket(this.root, ticketId).state, event });
    return ref;
  }

  /**
   * Redeem for exactly the ticket AND state the evidence was minted in. The
   * entry is removed only after a successful apply (admit deletes) — a
   * REFUSED transition must not burn real evidence, but a ref can never
   * apply twice, never to a different ticket, and never after the ticket has
   * moved on. Without the state binding, a driver could hoard a GATE_GREEN
   * minted at IN_PROGRESS and redeem it at APPROVED, satisfying the
   * close-check without the five-slot run it demands — the deterministic
   * driver never would, but the boundary must not depend on that (D-27).
   */
  private peek(ref: string, ticketId: string): KernelEvent {
    const entry = this.escrow.get(ref);
    if (entry === undefined) throw new EscrowError(`unknown or already-redeemed evidence ref: ${ref}`);
    if (entry.ticketId !== ticketId) {
      throw new EscrowError(`evidence ref ${ref} certifies ${entry.ticketId}, not ${ticketId}`);
    }
    const current = readTicket(this.root, ticketId).state;
    if (entry.state !== current) {
      throw new EscrowError(`evidence ref ${ref} is stale: minted in ${entry.state}, ticket is now in ${current}`);
    }
    return entry.event;
  }

  // ------------------------------------------------------- pool + claims

  /** The claimable pool; performs the V-3 drift-requeue sweep lazily once. */
  pool(): { id: string; state: State }[] {
    if (!this.driftSwept) {
      this.driftSwept = true;
      this.requeueDriftBlocked();
    }
    const readyPool = ready(this.root);
    // A claimed in-flight ticket is skipped, exactly as the oracle skipped
    // them: retrying a claim that cannot succeed would spin forever. Breaking
    // a STALE claim (owner dead) is plumbing's job under C-12's discipline.
    const resumable = allTickets(this.root).filter(
      (t) => RESUMABLE.includes(t.state) && !isClaimed(this.root, t.id) && !readyPool.some((r) => r.id === t.id),
    );
    return [...readyPool, ...resumable].map((t) => ({ id: t.id, state: t.state }));
  }

  /** R-2: an atomic claim the machine admits — a refused claim names why. */
  acquire(id: string): AcquireResult {
    const pool = this.pool();
    if (!pool.some((p) => p.id === id)) {
      return { ok: false, reason: this.claimRefusal(id) };
    }
    if (!claim(this.root, id, this.worker)) {
      return { ok: false, reason: `claimed by another worker` };
    }
    markCurrentTicket(this.root, id);
    const workDir = this.opts.worktree === true ? ensureWorktree(this.root, id) : this.root;
    this.workDirs.set(id, workDir);

    const ticket = readTicket(this.root, id);
    if (ticket.state === "READY") {
      return { ok: true, claimedRef: this.mintFor(id, claimed()) };
    }
    // B-5: uncommitted tracked changes at resume are reset to the last ticket
    // commit; untracked files stay — the gate judges the tree as-is.
    const reset = resetDirtyTracked(workDir);
    if (reset.length > 0) {
      appendNote(this.root, id, { author: "kernel", text: `B-5 resume reset: ${reset.join(", ")}` });
    }
    return { ok: true, resume: { state: ticket.state, reset } };
  }

  private claimRefusal(id: string): string {
    const tickets = allTickets(this.root);
    const ticket = tickets.find((t) => t.id === id);
    if (ticket === undefined) return `no such ticket: ${id}`;
    if (isClaimed(this.root, id)) return `claimed by another worker`;
    const unmet = ticket.blockers.filter((dep) => tickets.find((t) => t.id === dep)?.state !== "DONE");
    if (unmet.length > 0) return `blocked on ${unmet.join(", ")} (state ${ticket.state})`;
    return `not claimable from state ${ticket.state}`;
  }

  releaseTicket(id: string): void {
    clearCurrentTicket(this.root);
    release(this.root, id);
    this.workDirs.delete(id);
    this.flakeLedgers.delete(id);
  }

  private workDirFor(id: string): string {
    return this.workDirs.get(id) ?? this.root;
  }

  private flakeLedgerFor(id: string): RerunLedger {
    let ledger = this.flakeLedgers.get(id);
    if (ledger === undefined) {
      ledger = ledgerFor(this.budgets);
      this.flakeLedgers.set(id, ledger);
    }
    return ledger;
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

  /**
   * After a GATE_DRIFT unwind: every non-terminal CLAIMED ticket blocks with
   * the halt as evidence (draft.7's V-3), and the reason line is returned for
   * the driver's summary. Consumes the stored halt.
   */
  driftHaltSweep(): string {
    const halt = this.lastHalt;
    this.lastHalt = null;
    if (halt === null) throw new KernelBoundaryError("driftHaltSweep without a recorded halt");
    for (const ticket of allTickets(this.root)) {
      if (ticket.state === "DONE" || ticket.state === "BLOCKED") continue;
      if (!isClaimed(this.root, ticket.id)) continue;
      const blocked = this.commit(ticket, gateDrift(halt));
      this.closeGen(blocked.id, "blocked");
      appendNote(this.root, ticket.id, {
        author: "kernel",
        text: `drift-blocked: ${halt.halting.map((h) => h.message).join(" | ")}`,
      });
      release(this.root, ticket.id);
    }
    return `verification changed — re-baseline (V-3): ${halt.halting.map((h) => h.message).join(" | ")}`;
  }

  // ------------------------------------------------------------ attempts

  /**
   * R-4: the sole billable path. The spend ceiling is a launch gate (D-25),
   * the net-session ceiling is the X-1 backstop, and the ledger records every
   * session that ran — a driver cannot reach the backend around this method.
   */
  async attempt(id: string, state: (typeof ATTEMPT_STATES)[number]): Promise<{ falsifiedRef?: string }> {
    const ticket = readTicket(this.root, id);
    const workDir = this.workDirFor(id);
    await this.session(ticket, state, this.attemptInputs(ticket, state, workDir), workDir);
    if (state === "IN_PROGRESS") {
      const falsified = this.consumeFalsifiedSignal(id);
      if (falsified !== null) return { falsifiedRef: this.mintFor(id, premiseFalsified(falsified)) };
    }
    return {};
  }

  private attemptInputs(ticket: Ticket, state: SessionState, workDir: string): Record<string, unknown> {
    switch (state) {
      case "IN_PROGRESS":
        return { ticket: publicTicket(ticket) };
      case "INFORMED_FIX":
        return { ...this.fixInputs(ticket, workDir), research: this.maybeArtifact(ticket.id, "research.json") };
      case "REVIEW_FIX":
        return { ...this.fixInputs(ticket, workDir), review: this.maybeArtifact(ticket.id, "review.json") };
      default:
        return this.fixInputs(ticket, workDir);
    }
  }

  // --------------------------------------------------------------- gates

  /**
   * The full gate evaluation: drift assertion, scoped gates, the X-5 flake
   * filter, close-check risk routing (B-4) — returning an evidence ref for
   * whichever event the outcome justified.
   */
  async evaluate(id: string, opts: { closeCheck?: boolean; escalateReason?: string } = {}): Promise<{ ref: string }> {
    const ticket = readTicket(this.root, id);
    const workDir = this.workDirFor(id);

    if (opts.closeCheck === true) {
      const risk = this.closeCheckRisk(ticket, workDir);
      if (risk !== null) return { ref: risk };
      return await this.evaluateGate(ticket, workDir, undefined, ["lint", "typecheck", "test", "build", "e2e"]);
    }
    return await this.evaluateGate(ticket, workDir, opts.escalateReason);
  }

  /** B-4: the ticket's own label, or the diff touching risk globs — both
   * require a human before finalize. A recorded human approval covers the
   * risk once; the gates below still re-verify (X-3). */
  private closeCheckRisk(ticket: Ticket, workDir: string): string | null {
    const approved = ticket.notes.some((n) => n.text.startsWith("human-approved:"));
    if (approved) return null;
    if (ticket.risk_label) {
      appendNote(this.root, ticket.id, { author: "kernel", text: "risk-labelled change requires human approval (B-4)" });
      return this.mintFor(ticket.id, riskRequired("label"));
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
        return this.mintFor(ticket.id, riskRequired({ globs, files: touched }));
      }
    }
    return null;
  }

  private async evaluateGate(
    ticket: Ticket,
    workDir: string,
    escalateReason?: string,
    slots: readonly GateSlot[] = ["lint", "typecheck", "test"],
  ): Promise<{ ref: string }> {
    const bindings = readBindings(this.root).bindings;
    try {
      assertNoDrift(bindings, discover(workDir));
    } catch (err) {
      if (err instanceof DriftHaltError) {
        this.lastHalt = err;
        throw new DriftHaltSignal(err);
      }
      throw err;
    }

    const result = await this.runScopedGates(bindings, slots, workDir);
    if (result === null || result.green) {
      return { ref: this.mintFor(ticket.id, gateGreen(result)) };
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
      ledger: this.flakeLedgerFor(ticket.id),
    });

    if (decision.kind === "quarantine") {
      const fresh = readTicket(this.root, ticket.id);
      const quarantineId = `${ticket.id}-flake-${fresh.links.filter((l) => l.rel === "quarantines").length + 1}`;
      quarantineTicket(this.root, ticket.id, decision, { id: quarantineId });
      appendNote(this.root, ticket.id, {
        author: "kernel",
        text: `flaky gate quarantined as ${quarantineId}; nothing charged (X-5)`,
      });
      return { ref: this.mintFor(ticket.id, gateGreen(decision.result, "flake-filtered")) };
    }

    this.recordFailure(ticket.id, decision.result);
    if (escalateReason !== undefined) {
      appendNote(this.root, ticket.id, { author: "kernel", text: escalateReason });
    }
    return { ref: this.mintFor(ticket.id, gateRed(decision.result)) };
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

  // ---------------------------------------------- validator-backed stages

  /** The diagnose/review/research stages: their sessions launch here, beside
   * the validator that justifies their event (T-043/T-044/T-045). A review
   * breaker surfaces as a `Breach` for the driver's breach path. */
  async recordStage(id: string, kind: "diagnose" | "review" | "research"): Promise<{ ref: string }> {
    const ticket = readTicket(this.root, id);
    const workDir = this.workDirFor(id);
    if (kind === "diagnose") {
      const artifactPath = path.join(runsDir(this.root, id), "hypothesis.json");
      const outcome = await diagnoseStage({
        launch: async () => {
          await this.session(ticket, "DIAGNOSED", { ticket: publicTicket(ticket) }, workDir);
        },
        readArtifact: () => this.maybeArtifact(id, "hypothesis.json"),
        writeArtifact: (h: Hypothesis) => {
          mkdirSync(path.dirname(artifactPath), { recursive: true });
          writeFileSync(artifactPath, `${JSON.stringify(h, null, 2)}\n`);
        },
        executeRepro: (command) =>
          runGate({ command, cwd: workDir, slot: "test", timeoutMs: this.budgets.gate_timeout_ms, env: CI_ENV }),
        note: (text) => appendNote(this.root, id, { author: "kernel", text }),
      });
      return { ref: this.mintFor(id, outcome.event) };
    }
    if (kind === "review") {
      const hypothesisRaw = this.maybeArtifact(id, "hypothesis.json");
      const hypothesisParsed = hypothesisRaw === null ? null : parseArtifact(hypothesisSchema, hypothesisRaw);
      const hypothesis = hypothesisParsed !== null && hypothesisParsed.ok ? hypothesisParsed.value : null;
      const outcome = await reviewStage(ticket, this.diff(workDir), hypothesis, {
        launch: async (inputs) => {
          await this.session(ticket, "IN_REVIEW", inputs, workDir);
        },
        readArtifact: () => this.maybeArtifact(id, "review.json"),
        note: (text) => appendNote(this.root, id, { author: "kernel", text }),
      });
      if (outcome.kind === "breaker") throw new Breach(outcome.reason);
      return { ref: this.mintFor(id, outcome.event) };
    }
    const outcome = await researchStage({
      root: this.root,
      launch: async (inputs) => {
        await this.session(ticket, "RESEARCH", inputs, workDir);
      },
      readArtifact: () => this.maybeArtifact(id, "research.json"),
      readFailureSignature: () => {
        const failure = this.maybeArtifact(id, "last_failure.json") as { signature?: string } | null;
        return failure?.signature ?? null;
      },
      toolCallCeiling: this.budgets.failure_research_tool_calls,
      note: (text) => appendNote(this.root, id, { author: "kernel", text }),
      ticketInputs: {
        ticket: publicTicket(ticket),
        failure: this.maybeArtifact(id, "last_failure.json"),
      },
    });
    if (outcome.upstream !== undefined) {
      this.linkUpstream(ticket, outcome.upstream);
    }
    return { ref: this.mintFor(id, outcome.event) };
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

  // -------------------------------------- ceiling, human, and lifecycle

  /** X-1/S-4/B-3: a measured ceiling or an enforced invariant, noted + minted. */
  recordBreach(id: string, reason: string): { ref: string } {
    appendNote(this.root, id, { author: "kernel", text: reason });
    return { ref: this.mintFor(id, budgetBreach(reason)) };
  }

  /** C-10/X-8: a human act is its own evidence; who and how are recorded. */
  recordHuman(
    id: string,
    action: { kind: "approve"; by: string } | { kind: "requeue"; by: string; guidance: string },
  ): { ref: string } {
    if (action.kind === "approve") {
      appendNote(this.root, id, { author: action.by, text: `human-approved: by ${action.by} at escalation (C-10)` });
      return { ref: this.mintFor(id, humanApproved(`approved in-run by ${action.by} (C-10)`)) };
    }
    appendNote(this.root, id, { author: action.by, text: `requeued with guidance (C-10): ${action.guidance}` });
    return { ref: this.mintFor(id, humanRequeue(`requeue by ${action.by}: ${action.guidance}`)) };
  }

  addNote(id: string, author: string, text: string): void {
    appendNote(this.root, id, { author, text });
  }

  openGen(id: string, reason: string): void {
    const fresh = readTicket(this.root, id);
    const generations = openGeneration(fresh, { at: this.iso(), reason });
    writeTicket(this.root, { ...fresh, generations });
  }

  /** After an in-run approval the closed generation reopens for the re-verify. */
  reopenGen(id: string): void {
    const fresh = readTicket(this.root, id);
    const generation = currentGeneration(fresh);
    if (generation.ended_at === undefined) return;
    const reopened = { ...generation, outcome: "in_flight" as const };
    delete (reopened as { ended_at?: string }).ended_at;
    writeTicket(this.root, {
      ...fresh,
      generations: [...fresh.generations.slice(0, -1), reopened],
    });
  }

  closeGen(id: string, outcome: "done" | "blocked" | "needs_human"): void {
    const fresh = readTicket(this.root, id);
    const generation = currentGeneration(fresh);
    if (generation.ended_at !== undefined) return;
    writeTicket(this.root, {
      ...fresh,
      generations: [...fresh.generations.slice(0, -1), { ...generation, outcome, ended_at: this.iso() }],
    });
  }

  /** X-7: the dossier is written for every NEEDS_HUMAN; its summary feeds C-10. */
  writeDossierFor(id: string, reason: string): { summary: string } {
    const fresh = readTicket(this.root, id);
    writeDossier(this.root, fresh, reason);
    return { summary: dossierSummary(fresh, buildDossier(this.root, fresh, reason)) };
  }

  finalizeDone(id: string): void {
    const ticket = readTicket(this.root, id);
    const workDir = this.workDirFor(id);
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

  // -------------------------------------------------------------- admit

  /**
   * THE apply site (ARCH-1). Redeems a single-use evidence ref minted by a
   * gate, a validator, or a recorded human/kernel act; journals BEFORE the
   * ticket write so `transitions.jsonl` is the run's ground truth (R-3).
   * An inadmissible event throws before anything persists, and the evidence
   * survives the refusal — only a successful apply consumes the ref.
   */
  admit(id: string, ref: string): AdmitResult {
    const kernelEvent = this.peek(ref, id);
    const ticket = readTicket(this.root, id);
    const updated = this.commit(ticket, kernelEvent);
    this.escrow.delete(ref);
    return { from: ticket.state, event: kernelEvent.event, to: updated.state };
  }

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
    // The S-2 hook prevents; this is the referee's independent line (P2) — any
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
   * SEC-3's lever: the hook denies and points here; the REFEREE decides.
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
    // The referee's advisory copy; the SDK backend composes the enforced set
    // (sessions/guard.ts), including domain-scoped WebFetch once PRDR-062
    // gives docs domains a config home.
    if (READ_ONLY_ROLES.has(role)) {
      return role === "research" ? ["Read", "Grep", "Glob", "WebSearch"] : ["Read", "Grep", "Glob"];
    }
    return ["Read", "Grep", "Glob", "Edit", "Write", "Bash(git add:*)", "Bash(git commit:*)"];
  }

  // ------------------------------------------------------------- reads

  statusData(): { pending: PendingEntry[]; states: { id: string; state: State }[] } {
    const tickets = allTickets(this.root);
    return {
      pending: tickets
        .filter((t) => t.state === "NEEDS_HUMAN" || t.state === "BLOCKED")
        .map((t) => ({ id: t.id, state: t.state, reason: lastNote(t) })),
      states: tickets.map((t) => ({ id: t.id, state: t.state })),
    };
  }

  reportData(): { by_state: Record<string, number>; spend_usd: number } {
    const byState: Record<string, number> = {};
    for (const t of allTickets(this.root)) byState[t.state] = (byState[t.state] ?? 0) + 1;
    return { by_state: byState, spend_usd: this.spend.spent() };
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

export function lastNote(ticket: Ticket): string {
  return ticket.notes.at(-1)?.text ?? "";
}

