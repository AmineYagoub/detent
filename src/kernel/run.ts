import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { discover } from "../adapter/discover/index.js";
import { DriftHaltError, assertNoDrift, readBindings } from "../adapter/drift.js";
import { runGate, runnable, type GateResult } from "../adapter/run.js";
import { CI_ENV } from "../adapter/normalize.js";
import { stateDir } from "../fs/layout.js";
import { parseArtifact } from "../schemas/common.js";
import { approvalSchema, hypothesisSchema, researchBriefSchema, reviewSchema, dossierSchema } from "../schemas/records.js";
import type { GateSlot } from "../schemas/gates.js";
import { READ_ONLY_ROLES, roleForState, type SessionState } from "../schemas/roles.js";
import type { Event, State } from "../schemas/states.js";
import type { Ticket } from "../schemas/ticket.js";
import {
  prefixHash,
  stablePrefix,
  type PromptSet,
  type SessionBackend,
  type SessionResult,
  type SessionSpec,
} from "../sessions/backend.js";
import { classify } from "./classify.js";
import { RerunLedger, filterFlake, ledgerFor, quarantineTicket } from "./flake.js";
import { currentCounters, currentGeneration, openGeneration, withCurrentCounters } from "./generations.js";
import { RunJournal, runsDir } from "./journal.js";
import { apply, type GuardContext } from "./machine.js";
import { allTickets, isClaimed, readTicket, ready } from "./tickets/readers.js";
import { claim, release, writeTicket, appendNote } from "./tickets/mutations.js";
import { loadConfig, type LoadedConfig } from "./worstcase.js";

/**
 * T-041 — the kernel run loop (C-9, C-11, B-5, X-1 enforcement, V-3/D-23).
 *
 * The composition point: claim a ticket, drive it stage by stage — one fresh
 * session per stage, gates between — and let the X-3 table decide every
 * move. The loop launches sessions and runs gates; it never decides an
 * outcome a validator or a gate did not establish (P2, ARCH-1).
 *
 * Scope boundaries, stated rather than implied: the diagnosis gate's repro
 * execution is T-043 (a valid hypothesis cannot be admitted here — see the
 * DIAGNOSED handler); the review stage's input-set discipline is T-044; the
 * research cache is T-045 (D-18 superseded the oracle's plain-signature
 * cache); real SDK enforcement is T-046; the full branch contract is T-042.
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
  /** Injectable wall clock (ms) for the X-1 `ticket_wall_clock_ms` fixtures. */
  readonly now?: () => number;
  /**
   * The vendored, hash-verified prompt set. Required, not defaulted: loading
   * lives in the sessions layer (`loadPromptSet`), and ARCH-1 forbids the
   * kernel reaching past the backend seam to fetch it.
   */
  readonly prompts: PromptSet;
}

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
 * is unreachable under any config `loadConfig` accepts (net > computed worst
 * case by construction), so proving the enforcement fires requires handing the
 * loop budgets the load path would refuse. Production callers use `run`.
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
    ensureRunBranch(root, opts.runId ?? `${process.pid}-${Date.now().toString(36)}`);
    const kernel = new Kernel(opts, loaded, journal);
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

/** B-1 minimal: work happens on a `detent/run-<id>` branch, never the base.
 *  Trailers, worktree mode, and the base-write guard land at T-042. */
function ensureRunBranch(root: string, runId: string): void {
  const current = git(root, "rev-parse", "--abbrev-ref", "HEAD").trim();
  if (current.startsWith("detent/run-")) return;
  git(root, "checkout", "-q", "-b", `detent/run-${runId}`);
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
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
  private processed = 0;

  constructor(
    private readonly opts: RunOptions,
    private readonly loaded: LoadedConfig,
    private readonly journal: RunJournal,
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
  }

  private get root(): string {
    return this.opts.root;
  }

  private get budgets() {
    return this.loaded.config.budgets;
  }

  // ------------------------------------------------------------- the loop

  async loop(): Promise<RunOutcome> {
    // A requeue is human-gated by construction (X-8); for drift the human act
    // is the `verify sync` consent, so a clean baseline reopens drift-blocked
    // tickets before the pool is read (V-3, plan 1.7).
    this.requeueDriftBlocked();

    for (;;) {
      const pool = this.claimables();
      if (pool.length === 0) return this.finish();

      const ticket = pool[0] as Ticket;
      if (!claim(this.root, ticket.id, this.worker)) continue;
      try {
        await this.processTicket(ticket.id);
      } catch (err) {
        if (err instanceof DriftHaltSignal) return this.haltForDrift(err.halt);
        throw err;
      } finally {
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
    // Still drifted? Then nothing reopens; the halt below will fire again.
    try {
      assertNoDrift(bindings, discover(this.root));
    } catch {
      return;
    }
    for (const ticket of allTickets(this.root)) {
      if (ticket.state !== "BLOCKED" || !lastNote(ticket).startsWith("drift-blocked:")) continue;
      const requeued = this.commit(ticket, "HUMAN_REQUEUE", "verify-sync-rebaseline");
      const generations = openGeneration(requeued, {
        at: new Date(this.now()).toISOString(),
        reason: `gate drift re-baselined via verify sync; ${lastNote(ticket)}`,
      });
      writeTicket(this.root, { ...requeued, generations });
      appendNote(this.root, ticket.id, { author: "kernel", text: "requeued after drift re-baseline (V-3/X-8)" });
    }
  }

  private haltForDrift(halt: DriftHaltError): RunOutcome {
    // SEC-5: the bindings are under suspicion, so every claimed non-terminal
    // ticket blocks — reconstructable from transitions.jsonl (a crash leaves
    // no such rows), claims released, exit 2.
    for (const ticket of allTickets(this.root)) {
      // Draft.7's V-3: GATE_DRIFT applies to every non-terminal CLAIMED
      // ticket. Unclaimed tickets — READY, or human-gated ones whose claims
      // were released — keep their state; the halt is about work in flight
      // against the suspect bindings.
      if (ticket.state === "DONE" || ticket.state === "BLOCKED") continue;
      if (!isClaimed(this.root, ticket.id)) continue;
      const blocked = this.commit(ticket, "GATE_DRIFT", halt.halting.map((h) => h.slot).join(","));
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

    if (ticket.state === "READY") ticket = this.commit(ticket, "CLAIMED", "claim-lock");

    while (ticket.state !== "DONE" && ticket.state !== "NEEDS_HUMAN" && ticket.state !== "BLOCKED") {
      if (this.now() - startedAt > this.budgets.ticket_wall_clock_ms) {
        ticket = this.breach(ticket, "ticket wall clock ceiling (X-1)");
        break;
      }
      try {
        ticket = await this.stage(ticket, flakeLedger);
      } catch (err) {
        if (err instanceof Breach) {
          ticket = this.breach(ticket, err.message);
          break;
        }
        throw err;
      }
    }

    if (ticket.state === "NEEDS_HUMAN") {
      this.writeDossier(ticket, lastNote(ticket) || "escalated");
      this.closeGeneration(ticket, "needs_human");
    } else if (ticket.state === "BLOCKED") {
      this.closeGeneration(ticket, "blocked");
    } else if (ticket.state === "DONE") {
      this.finalize(ticket);
      this.closeGeneration(ticket, "done");
    }
  }

  private async stage(ticket: Ticket, flakeLedger: RerunLedger): Promise<Ticket> {
    switch (ticket.state) {
      case "IN_PROGRESS":
        await this.session(ticket, "IN_PROGRESS", { ticket: publicTicket(ticket) });
        return await this.evaluateGate(ticket, flakeLedger);
      case "BLIND_FIX":
        await this.session(ticket, "BLIND_FIX", this.fixInputs(ticket));
        return await this.evaluateGate(ticket, flakeLedger);
      case "INFORMED_FIX":
        await this.session(ticket, "INFORMED_FIX", {
          ...this.fixInputs(ticket),
          research: this.maybeArtifact(ticket.id, "research.json"),
        });
        return await this.evaluateGate(ticket, flakeLedger, "informed fix failed — the ladder cannot reopen (D-13)");
      case "REVIEW_FIX":
        await this.session(ticket, "REVIEW_FIX", {
          ...this.fixInputs(ticket),
          review: this.maybeArtifact(ticket.id, "review.json"),
        });
        return await this.evaluateGate(ticket, flakeLedger);
      case "RESEARCH":
        return await this.stageResearch(ticket);
      case "IN_REVIEW":
        return await this.stageReview(ticket);
      case "APPROVED":
        return await this.stageCloseCheck(ticket, flakeLedger);
      case "DIAGNOSED":
        return await this.stageDiagnose(ticket);
      default:
        throw new KernelBoundaryError(`kernel has no handler for state ${ticket.state}`);
    }
  }

  private async stageDiagnose(ticket: Ticket): Promise<Ticket> {
    await this.session(ticket, "DIAGNOSED", { ticket: publicTicket(ticket) });
    const raw = this.maybeArtifact(ticket.id, "hypothesis.json");
    const parsed = raw === null ? null : parseArtifact(hypothesisSchema, raw);
    if (parsed === null || !parsed.ok) {
      const detail = parsed === null ? "no hypothesis artifact" : "hypothesis invalid";
      appendNote(this.root, ticket.id, { author: "kernel", text: `${detail} — counted against hypotheses (X-1)` });
      return this.commit(readTicket(this.root, ticket.id), "REPRO_WRONG", detail);
    }
    // X-4: a verified hypothesis requires the kernel to EXECUTE the repro and
    // observe fail-as-predicted. That gate is T-043; admitting a hypothesis
    // without it would advance a ticket on an unverified model claim (P2).
    throw new KernelBoundaryError(
      "X-4 repro execution lands at T-043; a hypothesis cannot be admitted without the kernel running it (P2)",
    );
  }

  private async stageResearch(ticket: Ticket): Promise<Ticket> {
    // The D-18 env-keyed cache lands at T-045; every entry here is a live session.
    await this.session(ticket, "RESEARCH", {
      ticket: publicTicket(ticket),
      failure: this.maybeArtifact(ticket.id, "last_failure.json"),
      tool_call_ceiling: this.budgets.failure_research_tool_calls,
    });
    const raw = this.maybeArtifact(ticket.id, "research.json");
    const parsed = raw === null ? null : parseArtifact(researchBriefSchema, raw);
    if (parsed === null || !parsed.ok) {
      const detail = parsed === null ? "research produced no brief" : "research brief invalid (X-6a)";
      appendNote(this.root, ticket.id, { author: "kernel", text: detail });
      return this.commit(readTicket(this.root, ticket.id), "RESEARCH_DRY", detail);
    }
    if (parsed.value.upstream_bug !== undefined && parsed.value.upstream_bug !== "") {
      appendNote(this.root, ticket.id, { author: "kernel", text: `upstream bug: ${parsed.value.upstream_bug}` });
      return this.commit(readTicket(this.root, ticket.id), "UPSTREAM_BUG", "research.upstream_bug");
    }
    return this.commit(readTicket(this.root, ticket.id), "RESEARCH_VALID", "research.json valid");
  }

  private async stageReview(ticket: Ticket): Promise<Ticket> {
    // T-044 owns the input-set discipline; the loop already confines the
    // reviewer's inputs to diff + criteria + rules + hypothesis (SEC-3).
    await this.session(ticket, "IN_REVIEW", {
      ticket: {
        id: ticket.id,
        title: ticket.title,
        acceptance_criteria: ticket.acceptance_criteria,
        non_goals: ticket.non_goals,
      },
      diff: this.diff(),
      hypothesis: this.maybeArtifact(ticket.id, "hypothesis.json"),
    });
    const raw = this.maybeArtifact(ticket.id, "review.json");
    const parsed = raw === null ? null : parseArtifact(reviewSchema, raw);
    if (parsed === null || !parsed.ok) {
      // A malformed reviewer is a breaker, never partial acceptance (A-*).
      throw new Breach(parsed === null ? "review produced no artifact" : "review artifact invalid");
    }
    if (parsed.value.verdict === "approve") {
      return this.commit(readTicket(this.root, ticket.id), "REVIEW_APPROVE", "review approve");
    }
    appendNote(this.root, ticket.id, {
      author: "kernel",
      text: `review changes: ${parsed.value.changes.map((c) => c.tag).join(",")}`,
    });
    return this.commit(readTicket(this.root, ticket.id), "REVIEW_CHANGES", `${parsed.value.changes.length} findings`);
  }

  private async stageCloseCheck(ticket: Ticket, flakeLedger: RerunLedger): Promise<Ticket> {
    // B-4's diff-based risk globs land at T-049/T-042; the label half is live.
    if (ticket.risk_label) {
      appendNote(this.root, ticket.id, { author: "kernel", text: "risk-labelled change requires human approval (B-4)" });
      return this.commit(ticket, "RISK_LABEL_REQUIRED", "risk gate");
    }
    return await this.evaluateGate(ticket, flakeLedger, undefined, ["lint", "typecheck", "test", "build", "e2e"]);
  }

  // --------------------------------------------------------------- gates

  private async evaluateGate(
    ticket: Ticket,
    flakeLedger: RerunLedger,
    escalateReason?: string,
    slots: readonly GateSlot[] = ["lint", "typecheck", "test"],
  ): Promise<Ticket> {
    const bindings = readBindings(this.root).bindings;
    try {
      assertNoDrift(bindings, discover(this.root));
    } catch (err) {
      if (err instanceof DriftHaltError) throw new DriftHaltSignal(err);
      throw err;
    }

    const result = await this.runScopedGates(bindings, slots);
    if (result === null || result.green) {
      return this.commit(
        readTicket(this.root, ticket.id),
        "GATE_GREEN",
        result === null ? "no bound gates" : evidenceOf(result),
      );
    }

    // X-5: one isolated rerun for a suspected flake, through T-022's filter.
    // Isolation uses the test_single binding where one exists, else the same
    // command; a green rerun quarantines and charges nothing.
    const single = bindings.find((b) => b.slot === "test_single") ?? bindings.find((b) => b.slot === result.slot);
    const decision = await filterFlake({
      first: result,
      rerunInIsolation: () => this.gate(single?.resolved ?? result.command, result.slot ?? "test"),
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
      return this.commit(readTicket(this.root, ticket.id), "GATE_GREEN", `${evidenceOf(decision.result)}:flake-filtered`);
    }

    this.recordFailure(ticket.id, decision.result);
    if (escalateReason !== undefined) {
      appendNote(this.root, ticket.id, { author: "kernel", text: escalateReason });
    }
    return this.commit(readTicket(this.root, ticket.id), "GATE_RED", evidenceOf(decision.result));
  }

  private async runScopedGates(
    bindings: ReturnType<typeof readBindings>["bindings"],
    slots: readonly GateSlot[],
  ): Promise<GateResult | null> {
    let last: GateResult | null = null;
    for (const slot of slots) {
      const binding = bindings.find((b) => b.slot === slot);
      if (binding === undefined) continue;
      last = await this.gate(binding.resolved, slot);
      if (!last.green) return last;
    }
    return last;
  }

  private async gate(command: string, slot: GateSlot): Promise<GateResult> {
    const result = await runGate({
      command,
      cwd: this.root,
      slot,
      timeoutMs: this.budgets.gate_timeout_ms,
      env: CI_ENV,
    });
    if (result.outcome === "not-found" || !runnable(result)) {
      // An unrunnable binding is a broken baseline, not a red gate the ladder
      // could fix — surface it as a breach rather than burning fix slots.
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
      output_tail: result.output.slice(-4000),
    };
    const dir = runsDir(this.root, ticketId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "last_failure.json"), `${JSON.stringify(record, null, 2)}\n`);
  }

  // ------------------------------------------------------------ sessions

  private async session(ticket: Ticket, state: SessionState, inputs: Record<string, unknown>): Promise<void> {
    const role = roleForState(state);
    const id = ticket.id;
    if (this.journal.unfinished(id, role)) {
      // B-5: the budget was consumed; the gate judges the tree as-is.
      this.journal.appendTicketEvent(id, { stage: role, event: "skipped_after_crash", at: this.iso() });
      return;
    }

    let current = readTicket(this.root, id);
    const counters = currentCounters(current);
    if (counters.sessions >= this.budgets.sessions) {
      throw new Breach("net session ceiling (X-1) — backstop against a kernel accounting defect");
    }
    // Count BEFORE launch, and persist: a crash between launch and result must
    // not refund the session (B-5).
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
      cwd: this.root,
      artifactOut,
      allowedTools: this.toolsFor(role),
      permissionMode: READ_ONLY_ROLES.has(role) ? "plan" : "",
      model: this.loaded.config.model_routing[role] ?? "",
      maxTurns: this.budgets.turns_per_stage,
    };

    this.journal.appendTicketEvent(id, { stage: role, event: "start", at: this.iso() });
    const result = await this.opts.backend.run(spec);
    this.ledgerRow(id, role, result);
    this.journal.appendTicketEvent(id, {
      stage: role,
      event: "end",
      at: this.iso(),
      ok: result.ok,
      cost: result.costEstimateUsd,
    });
    this.rememberPrefix(role, spec);
    if (!result.telemetryParsed) throw new Breach("telemetry unparsable (S-4 circuit breaker)");
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

  private ledgerRow(ticketId: string, role: string, result: SessionResult): void {
    const generation = currentGeneration(readTicket(this.root, ticketId));
    this.journal.appendLedger({
      at: this.iso(),
      ticket: ticketId,
      generation: generation.index,
      role,
      cost_estimate_usd: result.costEstimateUsd,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      cache_read_input_tokens: result.cacheReadInputTokens,
      cache_creation_input_tokens: result.cacheCreationInputTokens,
      turns: result.turns,
    });
  }

  private prefixFor(role: string): string {
    return stablePrefix(this.prompts.prompts[role as keyof PromptSet["prompts"]], this.rulesText, this.bindingsPreamble);
  }

  private toolsFor(role: string): readonly string[] {
    // Advisory until T-046 wires the PreToolUse hook and per-role allowlists
    // against the real SDK (S-2/S-3); domain-scoped WebFetch forms land there.
    if (READ_ONLY_ROLES.has(role as never)) {
      return role === "research" ? ["Read", "Grep", "Glob", "WebSearch"] : ["Read", "Grep", "Glob"];
    }
    return ["Read", "Grep", "Glob", "Edit", "Write", "Bash(git add:*)", "Bash(git commit:*)"];
  }

  // ------------------------------------------------------------- commits

  private commit(ticket: Ticket, event: Event, evidence: string): Ticket {
    const counters = currentCounters(ticket);
    const ctx: GuardContext = { ticket: { type: ticket.type }, budgets: this.budgets };
    const result = apply(ticket.state, event, counters, ctx);
    const generation = currentGeneration(ticket);
    this.journal.appendTransition({
      at: this.iso(),
      ticket: ticket.id,
      generation: generation.index,
      from: result.from,
      event,
      to: result.to,
      evidence,
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
    return this.commit(readTicket(this.root, ticket.id), "BUDGET_BREACH", reason);
  }

  private closeGeneration(ticket: Ticket, outcome: "done" | "blocked" | "needs_human"): void {
    const fresh = readTicket(this.root, ticket.id);
    const generation = currentGeneration(fresh);
    if (generation.ended_at !== undefined) return;
    writeTicket(this.root, {
      ...fresh,
      generations: [
        ...fresh.generations.slice(0, -1),
        { ...generation, outcome, ended_at: this.iso() },
      ],
    });
  }

  private writeDossier(ticket: Ticket, reason: string): void {
    const fresh = readTicket(this.root, ticket.id);
    const failure = this.maybeArtifact(ticket.id, "last_failure.json") as { signature?: string } | null;
    const dossier = dossierSchema.parse({
      schema_version: 1,
      ticket: ticket.id,
      reason,
      generations: fresh.generations.map((g) => ({ index: g.index, counters: g.counters })),
      last_signatures: failure?.signature === undefined ? [] : [failure.signature],
      artifact_index: [],
      suggested_resolutions: [
        "review the dossier and the last failure record",
        "requeue with guidance (`detent requeue <id>`) to open a fresh generation (X-8)",
        "or approve after a manual fix (`detent approve <id>`) — the kernel re-verifies before DONE",
      ],
    });
    const dir = runsDir(this.root, ticket.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "dossier.json"), `${JSON.stringify(dossier, null, 2)}\n`);
  }

  private finalize(ticket: Ticket): void {
    git(this.root, "add", "-A");
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: this.root, encoding: "utf8" }).trim();
    if (dirty !== "") git(this.root, "commit", "-q", "-m", `${ticket.id}: finalize`);
  }

  // -------------------------------------------------------------- helpers

  private fixInputs(ticket: Ticket): Record<string, unknown> {
    return {
      ticket: publicTicket(ticket),
      failure: this.maybeArtifact(ticket.id, "last_failure.json"),
      hypothesis: this.maybeArtifact(ticket.id, "hypothesis.json"),
      diff: this.diff(),
    };
  }

  private diff(): string {
    try {
      return git(this.root, "diff", "HEAD").slice(-8000);
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

function evidenceOf(result: GateResult): string {
  return `${result.slot ?? "gate"}:exit=${result.exitCode ?? "none"}`;
}

function lastNote(ticket: Ticket): string {
  return ticket.notes.at(-1)?.text ?? "";
}
