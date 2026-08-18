import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { discover } from "../adapter/discover/index.js";
import { DriftHaltError, assertNoDrift, readBindings } from "../adapter/drift.js";
import { needsBaseRef, substituteBase, CI_ENV } from "../adapter/normalize.js";
import { runGate, runnable, type GateResult } from "../adapter/run.js";
import type { GateSlot } from "../schemas/gates.js";
import type { Ticket } from "../schemas/ticket.js";
import { classify } from "./classify.js";
import { gateGreen, gateRed, riskRequired, type KernelEvent } from "./events.js";
import { type RerunLedger, filterFlake, ledgerFor, quarantineTicket } from "./flake.js";
import { changedFiles } from "./git.js";
import { runsDir } from "./journal.js";
import { Breach, KernelBoundaryError, type RefereeContext } from "./referee-context.js";
import { scrub } from "./scrub.js";
import { readTicket } from "./tickets/readers.js";
import { appendNote } from "./tickets/mutations.js";

/** Thrown to unwind to the driver when V-3 halts the run (SEC-5, D-23). */
export class DriftHaltSignal extends Error {
  constructor(readonly halt: DriftHaltError) {
    super(halt.message);
    this.name = "DriftHaltSignal";
  }
}

/**
 * T-103 — the gate arm (V-3, X-5, B-4, SEC-4).
 *
 * The full evaluation the v2 loop ran: drift assertion, scoped gates, the
 * flake filter with its isolated rerun, close-check risk routing. It RETURNS
 * evidence-carrying events; the core alone escrows and admits them — this arm
 * can prove, never apply.
 */
export class GateArm {
  private readonly flakeLedgers = new Map<string, RerunLedger>();
  private lastHalt: DriftHaltError | null = null;

  constructor(private readonly ctx: RefereeContext) {}

  clearTicket(id: string): void {
    this.flakeLedgers.delete(id);
  }

  /** The stored halt, consumed by the core's drift sweep (draft.7's V-3). */
  consumeHalt(): DriftHaltError {
    const halt = this.lastHalt;
    this.lastHalt = null;
    if (halt === null) throw new KernelBoundaryError("drift sweep without a recorded halt");
    return halt;
  }

  async evaluate(id: string, opts: { closeCheck?: boolean; escalateReason?: string } = {}): Promise<KernelEvent> {
    const ticket = readTicket(this.ctx.root, id);
    const workDir = this.ctx.workDirFor(id);

    if (opts.closeCheck === true) {
      const risk = this.closeCheckRisk(ticket, workDir);
      if (risk !== null) return risk;
      return await this.evaluateGate(ticket, workDir, undefined, ["lint", "typecheck", "test", "build", "e2e"]);
    }
    return await this.evaluateGate(ticket, workDir, opts.escalateReason);
  }

  /** B-4: the ticket's own label, or the diff touching risk globs — both
   * require a human before finalize. A recorded human approval covers the
   * risk once; the gates still re-verify (X-3). */
  private closeCheckRisk(ticket: Ticket, workDir: string): KernelEvent | null {
    const ctx = this.ctx;
    const approved = ticket.notes.some((n) => n.text.startsWith("human-approved:"));
    if (approved) return null;
    if (ticket.risk_label) {
      appendNote(ctx.root, ticket.id, { author: "kernel", text: "risk-labelled change requires human approval (B-4)" });
      return riskRequired("label");
    }
    const globs = ctx.loaded.config.risk;
    if (globs.length > 0) {
      const touched = changedFiles(workDir, ctx.baseRef ?? ctx.runBranch.base).filter((f) =>
        picomatch.isMatch(f, [...globs], { dot: true }),
      );
      if (touched.length > 0) {
        appendNote(ctx.root, ticket.id, {
          author: "kernel",
          text: `risk-path change requires human approval (B-4): ${touched.join(", ")}`,
        });
        return riskRequired({ globs, files: touched });
      }
    }
    return null;
  }

  private async evaluateGate(
    ticket: Ticket,
    workDir: string,
    escalateReason?: string,
    slots: readonly GateSlot[] = ["lint", "typecheck", "test"],
  ): Promise<KernelEvent> {
    const ctx = this.ctx;
    const bindings = readBindings(ctx.root).bindings;
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
      return gateGreen(result);
    }

    // X-5: one isolated rerun for a suspected flake, through T-022's filter.
    // Isolation prefers the test_single binding; a `BASE` template resolves
    // against the run's merge-base, or falls back to the failing command when
    // the baseline is unresolvable (V-5).
    const single = bindings.find((b) => b.slot === "test_single");
    let isolationCmd = result.command;
    if (single !== undefined) {
      if (!needsBaseRef(single.resolved)) isolationCmd = single.resolved;
      else if (ctx.baseRef !== null) isolationCmd = substituteBase(single.resolved, ctx.baseRef);
    }
    const decision = await filterFlake({
      first: result,
      rerunInIsolation: () => this.gate(isolationCmd, result.slot ?? "test", workDir),
      ledger: this.flakeLedgerFor(ticket.id),
    });

    if (decision.kind === "quarantine") {
      const fresh = readTicket(ctx.root, ticket.id);
      const quarantineId = `${ticket.id}-flake-${fresh.links.filter((l) => l.rel === "quarantines").length + 1}`;
      quarantineTicket(ctx.root, ticket.id, decision, { id: quarantineId });
      appendNote(ctx.root, ticket.id, {
        author: "kernel",
        text: `flaky gate quarantined as ${quarantineId}; nothing charged (X-5)`,
      });
      return gateGreen(decision.result, "flake-filtered");
    }

    this.recordFailure(ticket.id, decision.result);
    if (escalateReason !== undefined) {
      appendNote(ctx.root, ticket.id, { author: "kernel", text: escalateReason });
    }
    return gateRed(decision.result);
  }

  private flakeLedgerFor(id: string): RerunLedger {
    let ledger = this.flakeLedgers.get(id);
    if (ledger === undefined) {
      ledger = ledgerFor(this.ctx.budgets);
      this.flakeLedgers.set(id, ledger);
    }
    return ledger;
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
      timeoutMs: this.ctx.budgets.gate_timeout_ms,
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
    const dir = runsDir(this.ctx.root, ticketId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "last_failure.json"), `${JSON.stringify(record, null, 2)}\n`);
  }
}
