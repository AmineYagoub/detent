import { discover } from "../adapter/discover/index.js";
import { assertNoDrift, readBindings, writeBindings } from "../adapter/drift.js";
import type { Binding } from "../schemas/records.js";
import type { State } from "../schemas/states.js";
import type { Ticket } from "../schemas/ticket.js";
import { buildDossier, dossierSummary, writeDossier } from "./dossier.js";
import {
  budgetBreach,
  claimed,
  gateDrift,
  humanApproved,
  humanRequeue,
  premiseFalsified,
  type KernelEvent,
} from "./events.js";
import { finalizeBootstrap } from "../init/plan.js";
import { currentCounters, currentGeneration, openGeneration, withCurrentCounters } from "./generations.js";
import { clearCurrentTicket, ensureWorktree, git, markCurrentTicket, mergeWorktree, resetDirtyTracked } from "./git.js";
import type { RunJournal } from "./journal.js";
import { apply, type GuardContext } from "./machine.js";
import type { RunBranch } from "./git.js";
import {
  type ATTEMPT_STATES,
  EscrowError,
  RESUMABLE,
  RefereeContext,
  lastNote,
  type CoreOptions,
} from "./referee-context.js";
import { GateArm } from "./referee-gate.js";
import { SessionArm } from "./referee-session.js";
import { runRefereeStage } from "./referee-stage.js";
import { allTickets, isClaimed, readTicket, ready } from "./tickets/readers.js";
import { appendNote, claim, release, writeTicket } from "./tickets/mutations.js";
import type { LoadedConfig } from "./worstcase.js";

/**
 * T-100…T-105 — the REFEREE core (R-1…R-4, D-27, ARCH-1/ARCH-2).
 *
 * The v2 kernel's primitives, extracted from the run loop so that legality has
 * exactly one home regardless of who drives. The core owns the claims, the
 * evidence escrow, and the ONE `machine.apply` site; the arms prove things —
 * sessions (`referee-session.ts`), gates (`referee-gate.ts`), validator-backed
 * stages (`referee-stage.ts`) — and hand their sealed events back here to be
 * escrowed. A driver cannot name an event; it can only ask for one to be
 * derived, which is D-27's restatement of ARCH-1 made mechanical.
 *
 * Escrow contract: refs are single-use, ticket-bound, AND state-bound; a
 * refused transition does not consume evidence — only a successful apply does.
 */

export { TransitionError } from "./machine.js";
export { SpendExhaustedError } from "./ledger.js";
export {
  ATTEMPT_STATES,
  Breach,
  EscrowError,
  KernelBoundaryError,
  RESUMABLE,
  lastNote,
  type CoreOptions,
} from "./referee-context.js";
export { DriftHaltSignal } from "./referee-gate.js";

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
  private readonly ctx: RefereeContext;
  private readonly sessions: SessionArm;
  private readonly gates: GateArm;
  private readonly escrow = new Map<string, { ticketId: string; state: State; event: KernelEvent }>();
  private escrowSeq = 0;
  private driftSwept = false;

  constructor(opts: CoreOptions, loaded: LoadedConfig, journal: RunJournal, runBranch: RunBranch) {
    this.ctx = new RefereeContext(opts, loaded, journal, runBranch);
    this.sessions = new SessionArm(this.ctx);
    this.gates = new GateArm(this.ctx);
  }

  private get root(): string {
    return this.ctx.root;
  }

  /* -------------------------------------------------------------- escrow */

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
   * close-check without the five-slot run it demands (D-27).
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

  /* ------------------------------------------------------- pool + claims */

  /** The claimable pool; performs the V-3 drift-requeue sweep lazily once. */
  pool(): { id: string; state: State }[] {
    if (!this.driftSwept) {
      this.driftSwept = true;
      this.requeueDriftBlocked();
    }
    const readyPool = ready(this.root);
    /**
     * A claimed in-flight ticket is skipped, exactly as the oracle skipped
     * them: retrying a claim that cannot succeed would spin forever. Breaking
     * a STALE claim (owner dead) is plumbing's job under C-12's discipline.
     */
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
    if (!claim(this.root, id, this.ctx.worker)) {
      return { ok: false, reason: `claimed by another worker` };
    }
    markCurrentTicket(this.root, id);
    const workDir = this.ctx.worktree ? ensureWorktree(this.root, id) : this.root;
    this.ctx.setWorkDir(id, workDir);

    const ticket = readTicket(this.root, id);
    if (ticket.state === "READY") {
      return { ok: true, claimedRef: this.mintFor(id, claimed()) };
    }
    /**
     * B-5: uncommitted tracked changes at resume are reset to the last ticket
     * commit; untracked files stay — the gate judges the tree as-is.
     */
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
    this.ctx.clearWorkDir(id);
    this.gates.clearTicket(id);
  }

  /* -------------------------------------------------- drift (V-3, D-23) */

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
        at: this.ctx.iso(),
        reason: `gate drift re-baselined via verify sync; ${lastNote(ticket)}`,
      });
      writeTicket(this.root, { ...requeued, generations });
      appendNote(this.root, ticket.id, { author: "kernel", text: "requeued after drift re-baseline (V-3/X-8)" });
    }
  }

  /**
   * After a GATE_DRIFT unwind: every non-terminal CLAIMED ticket blocks with
   * the halt as evidence (draft.7's V-3), and the reason line is returned for
   * the driver's summary. Consumes the arm's stored halt.
   */
  driftHaltSweep(): string {
    const halt = this.gates.consumeHalt();
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

  /* ------------------------------------------------------ derived moves */

  /** R-4: the sole billable path — the session arm meters, this core mints. */
  async attempt(id: string, state: (typeof ATTEMPT_STATES)[number]): Promise<{ falsifiedRef?: string }> {
    const ticket = readTicket(this.root, id);
    const workDir = this.ctx.workDirFor(id);
    await this.sessions.launch(ticket, state, this.sessions.attemptInputs(ticket, state, workDir), workDir);
    if (state === "IN_PROGRESS") {
      const falsified = this.sessions.consumeFalsifiedSignal(id);
      if (falsified !== null) return { falsifiedRef: this.mintFor(id, premiseFalsified(falsified)) };
    }
    return {};
  }

  async evaluate(id: string, opts: { closeCheck?: boolean; escalateReason?: string } = {}): Promise<{ ref: string }> {
    return { ref: this.mintFor(id, await this.gates.evaluate(id, opts)) };
  }

  async recordStage(id: string, kind: "diagnose" | "review" | "research"): Promise<{ ref: string }> {
    return { ref: this.mintFor(id, await runRefereeStage(kind, id, this.ctx, this.sessions)) };
  }

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

  /* ------------------------------------------------- lifecycle bookkeeping */

  addNote(id: string, author: string, text: string): void {
    appendNote(this.root, id, { author, text });
  }

  openGen(id: string, reason: string): void {
    const fresh = readTicket(this.root, id);
    const generations = openGeneration(fresh, { at: this.ctx.iso(), reason });
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
      generations: [...fresh.generations.slice(0, -1), { ...generation, outcome, ended_at: this.ctx.iso() }],
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
    const workDir = this.ctx.workDirFor(id);
    /**
     * C-4: bootstrap #1's gates just passed, so greenfield's provisional
     * bindings become the baseline. A no-op for every other ticket.
     */
    finalizeBootstrap(this.root, ticket.id, {
      readBindings: () => readBindings(this.root),
      writeBindings: (file) => writeBindings(this.root, file as { bindings: Binding[]; skips: never[] }),
      rediscover: () => discover(this.root).candidates,
      note: (text) => appendNote(this.root, ticket.id, { author: "kernel", text }),
    });
    git(workDir, "add", "-A");
    const dirty = git(workDir, "status", "--porcelain").trim();
    if (dirty !== "") git(workDir, "commit", "-q", "-m", `${ticket.id}: finalize`);
    /** B-2: worktree mode merges --no-ff into the RUN branch — never the base. */
    if (this.ctx.worktree) mergeWorktree(this.root, ticket.id);
  }

  /* -------------------------------------------------------------- admit */

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
    const ctx: GuardContext = { ticket: { type: ticket.type }, budgets: this.ctx.budgets };
    const result = apply(ticket.state, kernelEvent.event, counters, ctx);
    const generation = currentGeneration(ticket);
    this.ctx.journal.appendTransition({
      at: this.ctx.iso(),
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

  /* ------------------------------------------------------------- reads */

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
    return { by_state: byState, spend_usd: this.ctx.spend.spent() };
  }
}
