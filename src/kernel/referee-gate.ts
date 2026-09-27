import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { DriftHaltError, assertNoDrift, readBindings } from "../adapter/drift.js";
import { ROOT_PACKAGE, discoverPackages, gateLabel, packageDir, touchedPackages } from "../adapter/packages.js";
import { bindingsForTree } from "./drift-base.js";
import { needsBaseRef, substituteBase, CI_ENV } from "../adapter/normalize.js";
import { ensureDependencies, readMark } from "../adapter/install.js";
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
import { assertTicketWallClock } from "./ticket-clock.js";
import { appendNote } from "./tickets/mutations.js";

/** V-1″ (PRDR-135), per package (V-5′): the packages a ticket touches that no gate asked of them can fail for, named. */
function unverifiable(slots: readonly GateSlot[], bare: readonly string[]): Breach {
  const where =
    bare.length === 1 && bare[0] === ROOT_PACKAGE
      ? ""
      : ` in ${bare.map((pkg) => (pkg === ROOT_PACKAGE ? "the root package" : pkg)).join(", ")}, the ${bare.length === 1 ? "package" : "packages"} its surface touches (V-5′)`;
  return new Breach(
    `no gate is bound for ${slots.join(", ")}${where} — nothing would be verified. Run \`detent init\` to bind the project's ` +
      "verification commands (V-1); a run cannot judge a diff it never tested.",
  );
}

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
  /** V-1⁗ audit: the install mark last put on each ticket's record, so an install made during a session is journaled once. */
  private readonly marks = new Map<string, string>();

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
    /**
     * X-1 (PRDR-246): before the bound commands run, on both paths. Running a
     * gate is starting work, and the headless loop already refuses to start a
     * stage past the ceiling — this is where the model-driven driver, which has
     * no loop of its own, inherits the same answer (ARCH-2).
     */
    assertTicketWallClock(this.ctx, id);
    const ticket = readTicket(this.ctx.root, id);
    const workDir = this.ctx.workDirFor(id);

    if (opts.closeCheck === true) {
      const risk = this.closeCheckRisk(ticket, workDir);
      if (risk !== null) return risk;
      return await this.evaluateGate(ticket, workDir, undefined, ["lint", "typecheck", "test", "build", "e2e"]);
    }
    return await this.evaluateGate(ticket, workDir, opts.escalateReason);
  }

  /** B-4′ (PRDR-107): the diff touching the operator's risk globs requires a
   * human before finalize; the plan's own label is advisory — noted once,
   * never a stop. A recorded human approval covers the risk once; the gates
   * still re-verify (X-3). */
  private closeCheckRisk(ticket: Ticket, workDir: string): KernelEvent | null {
    const ctx = this.ctx;
    const approved = ticket.notes.some((n) => n.text.startsWith("human-approved:"));
    if (approved) return null;
    /*
     * Eleven label stops across every gate and field test: approved eleven
     * times, declined never. The label stays visible; the stop is gone.
     */
    if (ticket.risk_label && !ticket.notes.some((n) => n.text.startsWith("risk-labelled by the plan"))) {
      appendNote(ctx.root, ticket.id, {
        author: "kernel",
        text: "risk-labelled by the plan (B-4′): advisory, no stop — configure `risk` globs to gate paths",
      });
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
    /*
     * V-3‴ (PRDR-226): the tree is judged against the baseline it STARTED FROM,
     * with any hashes an operator accepted for this ticket over it — see
     * drift-base.ts. Judged against the root's current baseline, a worktree
     * that legitimately changed a gate's config halted a run that `verify sync`
     * on the root could never clear. The halt names the verb that can.
     */
    const inWorktree = workDir !== ctx.root;
    const file = readBindings(ctx.root);
    const bindings = inWorktree ? bindingsForTree(ctx.root, ticket.id, workDir, ctx.runBranch.branch) : file.bindings;
    /** V-5′ (PRDR-295): each package's configuration, read in its own directory of this tree. */
    const here = discoverPackages(workDir, file.packages);
    try {
      assertNoDrift(bindings, here);
    } catch (err) {
      if (err instanceof DriftHaltError) {
        const verb = inWorktree ? `\`detent verify sync ${ctx.root} --ticket ${ticket.id}\`` : `\`detent verify sync ${ctx.root}\``;
        const named = new DriftHaltError(err.halting.map((h) => ({ ...h, message: h.message.replace("`detent verify sync`", verb) })));
        this.lastHalt = named;
        throw new DriftHaltSignal(named);
      }
      throw err;
    }

    /**
     * V-1⁗ (PRDR-211): what the manifest declares is installed before any gate
     * runs — through the gate runner, in the work directory, recorded as its
     * own journal record. A session cannot do this (its Bash is two git verbs),
     * and a gate that cannot execute for want of its dependencies is not red
     * because of the ticket. An install that FAILS is a red gate carrying the
     * install's own tail, so the ladder sees it as it sees any red.
     */
    /**
     * V-5′ (PRDR-295): a ticket's gates are those of the packages its surface
     * touches, and each package installs and runs in its own directory. A
     * touched package that binds none of the slots asked is a path no gate can
     * fail, the rule PRESENT holds a plan to; a gated package beside it does
     * not stand in for it.
     */
    const touched = touchedPackages(ticket.surface, file.packages);
    const bare = touched.filter((pkg) => !bindings.some((b) => b.package === pkg && slots.includes(b.slot)));
    if (bare.length > 0) throw unverifiable(slots, bare);
    const installedHere = new Set<string>();
    for (const pkg of touched) {
      const dir = packageDir(workDir, pkg);
      const install = await ensureDependencies(
        dir,
        (command) => runGate({ command, cwd: dir, timeoutMs: ctx.budgets.gate_timeout_ms, env: CI_ENV }),
        ctx.ecosystems,
        /* PRDR-232: the project's own package manager decides which row may install, so the referee cannot flip it. */
        here.get(pkg)?.stack.pm ?? null,
      );
      if (install.kind === "none") continue;
      if (install.kind === "installed") installedHere.add(`${pkg}\0${install.ecosystem}`);
      ctx.journal.appendTicketEvent(ticket.id, {
        event: "install",
        ok: install.kind === "installed",
        at: ctx.iso(),
        ...(pkg === ROOT_PACKAGE ? {} : { package: pkg }),
        ecosystem: install.ecosystem,
        cmd: install.result.command,
        exit: install.result.exitCode,
        ms: install.result.durationMs,
        reason: install.reason,
        ...(install.kind === "failed" ? { tail: scrub(install.result.output.slice(-1500)) } : {}),
      });
      if (install.kind === "failed") {
        this.recordFailure(ticket.id, install.result, pkg);
        return gateRed(install.result);
      }
    }
    /**
     * Second audit of PRDR-211, from the gate: the install that mattered was
     * not on the record. A session's Stop hook installs in the work directory
     * so the scoped gate can run, and cannot journal — the run holds the
     * journal. The referee then finds the mark fresh and, before this, wrote
     * nothing: a green gate with a failed install as the only install record.
     * A mark the referee did not write is journaled once, as the session's.
     */
    for (const pkg of touched) {
      for (const eco of ctx.ecosystems) {
        const mark = readMark(packageDir(workDir, pkg), eco);
        const seen = pkg === ROOT_PACKAGE ? `${ticket.id}:${eco.name}` : `${ticket.id}:${pkg}:${eco.name}`;
        if (mark === null || this.marks.get(seen) === mark) continue;
        this.marks.set(seen, mark);
        if (installedHere.has(`${pkg}\0${eco.name}`)) continue;
        ctx.journal.appendTicketEvent(ticket.id, { event: "install", ok: true, by: "session", at: ctx.iso(), ...(pkg === ROOT_PACKAGE ? {} : { package: pkg }), ecosystem: eco.name, mark, reason: `installed during the session — the mark was written at ${mark}` });
      }
    }

    const scoped = await this.runScopedGates(bindings, slots, workDir, touched);
    const result = scoped?.result ?? null;
    /**
     * V-1″ (PRDR-135): no bound gate is UNVERIFIABLE, not green. `null` here
     * means no binding matched any requested slot, and this read it as a pass —
     * minting a real GATE_GREEN carrying "no bound gates". A `bindings.json`
     * deleted, gitignored or never committed therefore sent every ticket to
     * DONE with zero verification commands executed. P2's "only exit codes
     * count" is vacuous when nothing runs.
     */
    if (result === null) throw unverifiable(slots, [ROOT_PACKAGE]);
    if (result.green) {
      return gateGreen(result);
    }

    /**
     * X-5: one isolated rerun for a suspected flake, through T-022's filter.
     * Isolation prefers the test_single binding; a `BASE` template resolves
     * against the run's merge-base, or falls back to the failing command when
     * the baseline is unresolvable (V-5).
     */
    /* V-5′: the failing package's own `test_single`, run where its gates run. */
    const failed = scoped?.package ?? ROOT_PACKAGE;
    const single = bindings.find((b) => b.package === failed && b.slot === "test_single");
    let isolationCmd = result.command;
    if (single !== undefined) {
      if (!needsBaseRef(single.resolved)) isolationCmd = single.resolved;
      else if (ctx.baseRef !== null) isolationCmd = substituteBase(single.resolved, ctx.baseRef);
    }
    const decision = await filterFlake({
      first: result,
      rerunInIsolation: () => this.gate(isolationCmd, result.slot ?? "test", packageDir(workDir, failed), failed),
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

    this.recordFailure(ticket.id, decision.result, failed);
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

  /** V-5′ (PRDR-295): each touched package's gates in turn, in its own directory; the first red stops, and names its package. */
  private async runScopedGates(
    bindings: ReturnType<typeof readBindings>["bindings"],
    slots: readonly GateSlot[],
    workDir: string,
    packages: readonly string[],
  ): Promise<{ readonly result: GateResult; readonly package: string } | null> {
    let last: { readonly result: GateResult; readonly package: string } | null = null;
    for (const pkg of packages) {
      for (const slot of slots) {
        const binding = bindings.find((b) => b.package === pkg && b.slot === slot);
        if (binding === undefined) continue;
        last = { result: await this.gate(binding.resolved, slot, packageDir(workDir, pkg), pkg), package: pkg };
        if (!last.result.green) return last;
      }
    }
    return last;
  }

  private async gate(command: string, slot: GateSlot, cwd: string, pkg: string = ROOT_PACKAGE): Promise<GateResult> {
    const result = await runGate({
      command,
      cwd,
      slot,
      timeoutMs: this.ctx.budgets.gate_timeout_ms,
      env: CI_ENV,
    });
    if (result.outcome === "not-found" || !runnable(result)) {
      throw new Breach(`gate ${gateLabel({ package: pkg, slot })} is not runnable: \`${command}\` (exit ${result.normalizedExit})`);
    }
    return result;
  }

  private recordFailure(ticketId: string, result: GateResult, pkg: string = ROOT_PACKAGE): void {
    const verdict = classify(result.output, result.exitCode);
    const record = {
      /* V-5′: where the red gate ran, when it was not the root. */
      ...(pkg === ROOT_PACKAGE ? {} : { package: pkg }),
      cmd: result.command,
      exit: result.exitCode,
      signature: verdict.signature,
      classification: verdict.patternClass,
      /*
       * SEC-4: scrubbed BEFORE write — a secret echoed by a failing gate
       * must never land in an artifact.
       */
      output_tail: scrub(result.output.slice(-4000)),
    };
    const dir = runsDir(this.ctx.root, ticketId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "last_failure.json"), `${JSON.stringify(record, null, 2)}\n`);
  }
}
