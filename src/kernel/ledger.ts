import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { CEILINGS, type Budgets } from "../schemas/budgets.js";
import { ledgerRowSchema, type LedgerRow } from "../schemas/records.js";
import type { SessionResult } from "../sessions/backend.js";
import type { RunJournal } from "./journal.js";

/**
 * T-048 — the ledger and the cross-generation spend backstop (S-4, X-8, D-25).
 *
 * `run_spend_usd` is a LAUNCH GATE: the kernel refuses to launch any session
 * once cumulative recorded spend has reached the ceiling. Because telemetry
 * arrives only when a session ends, the guarantee is a bounded overshoot —
 * at most the one session in flight when the ceiling was crossed — and that
 * bound is deliberate: a never-overshoot policy is unachievable against a
 * backend that prices work after doing it.
 *
 * Spend is summed from `ledger.jsonl` itself at open, so the backstop is
 * cumulative across generations AND across resumed invocations (X-8) — a
 * requeue never resets the money.
 */

/**
 * X-1⁵ (PRDR-191): money went out and nothing was completed.
 *
 * The quantity a total was a bad proxy for. Legitimate work completes things —
 * a slice for `init`, a ticket reaching DONE for the loop — and a runaway does
 * not, so this fires in minutes on the shape PRDR-186 took (re-planning
 * finished slices) and never on a run that is working, however long or costly.
 */
/**
 * X-1⁵: where the breaker's mark lives.
 *
 * Its own file under `state/`, and NOT the run lock, which was the first
 * attempt. `init` builds a fresh `SpendLedger` for every session launch, so the
 * mark has to persist — but hanging it on the lock made the breaker inert
 * wherever no lock had been taken, which is every direct caller and every test.
 * A control that only works when another subsystem happens to be present is not
 * a control; this file is written on demand and always available.
 */
function progressPath(root: string): string {
  return path.join(stateDir(root), "state", "progress.json");
}

interface ProgressMark {
  readonly spent: number | null;
  readonly unitCost: number | null;
}

export function readProgressMark(root: string): ProgressMark {
  try {
    const raw = JSON.parse(readFileSync(progressPath(root), "utf8")) as Partial<ProgressMark>;
    return {
      spent: typeof raw.spent === "number" ? raw.spent : null,
      unitCost: typeof raw.unitCost === "number" ? raw.unitCost : null,
    };
  } catch {
    /* Absent or unreadable: nothing has completed that we can prove, so the floor governs. */
    return { spent: null, unitCost: null };
  }
}

function writeProgressMark(root: string, mark: ProgressMark): void {
  try {
    mkdirSync(path.dirname(progressPath(root)), { recursive: true });
    writeFileSync(progressPath(root), `${JSON.stringify(mark, null, 2)}\n`);
  } catch {
    /* A marker must never be able to fail a run; the floor simply keeps governing. */
  }
}

export class NoProgressError extends Error {
  constructor(
    readonly sinceProgress: number,
    readonly threshold: number,
  ) {
    super(
      `no-progress breaker (X-1⁵): $${sinceProgress.toFixed(2)} spent without completing a unit of work, ` +
        `past the $${threshold.toFixed(2)} this run allows. Nothing has finished in that time, which is what a ` +
        "runaway looks like and what working never does. Everything completed so far is checkpointed.",
    );
    this.name = "NoProgressError";
  }
}

/** @deprecated X-1⁵ (PRDR-191): the total no longer halts a run. Retained so older rows and callers still type-check. */
export class SpendExhaustedError extends Error {
  constructor(
    readonly spent: number,
    readonly ceiling: number,
  ) {
    super(
      `run-spend exhaustion (D-25): recorded spend $${spent.toFixed(4)} has reached the ceiling $${ceiling.toFixed(4)} — ` +
        `no further session launches; the ceiling is enforced against the backend's cost estimate (S-4)`,
    );
    this.name = "SpendExhaustedError";
  }
}

/**
 * X-1 (PRDR-173): record a billed session outside a run.
 *
 * `SpendLedger.record` needs a `RunJournal`, which `doctor --smoke` has no
 * business opening — it is a diagnostic, not a run. But its smoke session is a
 * real, consented, billed `maxTurns: 1` call, and it was the only one of the
 * repo's three `backend.run` sites with no ledger wrapping at all: the file was
 * not even created. PRDR-154's ticket names "no consent, no cap and no ledger
 * row" as the problem and closed the first two.
 *
 * The row is written through the same schema and to the same file, so
 * `readRecordedSpend` and `detent report` count it like any other.
 */
export function recordOutOfBandSpend(root: string, role: string, result: SessionResult, at: string): LedgerRow {
  const perModel = Object.values(result.perModel ?? {});
  const sum = (pick: (u: (typeof perModel)[number]) => number): number => perModel.reduce((a, u) => a + pick(u), 0);
  const row = ledgerRowSchema.parse({
    at,
    ticket: "(out-of-band)",
    generation: 0,
    role,
    /**
     * PRDR-179: the per-model breakdown where there is one, which
     * `SpendLedger.record` calls "the token source of record when present".
     * This read the flat estimate and sorted nothing, so an out-of-band row was
     * a different shape from every other row in the same file.
     */
    cost_estimate_usd: perModel.length > 0 ? sum((u) => u.costUSD) : result.costEstimateUsd,
    input_tokens: perModel.length > 0 ? sum((u) => u.inputTokens) : result.inputTokens,
    output_tokens: perModel.length > 0 ? sum((u) => u.outputTokens) : result.outputTokens,
    cache_read_input_tokens: perModel.length > 0 ? sum((u) => u.cacheReadInputTokens) : result.cacheReadInputTokens,
    cache_creation_input_tokens: perModel.length > 0 ? sum((u) => u.cacheCreationInputTokens) : result.cacheCreationInputTokens,
    turns: result.turns,
    models: result.perModel === undefined ? [] : Object.keys(result.perModel).sort(),
  });
  /**
   * PRDR-179: the caller must already have a state directory.
   *
   * This created one, so `detent doctor --smoke` in a bare directory left a
   * `.detent/` behind on a root Detent had never been initialised on. A
   * diagnostic does not initialise anything.
   */
  if (!existsSync(stateDir(root))) {
    throw new Error(`no .detent/ at ${root} — a session's cost cannot be recorded on a root that was never initialised (X-1)`);
  }
  appendFileSync(path.join(stateDir(root), "ledger.jsonl"), `${JSON.stringify(row)}\n`);
  return row;
}

/**
 * X-1⁵: the two ceilings the breaker reads. Named as `Budgets` keys rather than
 * an ad-hoc shape so this module is genuinely the enforcement site T-012 names
 * it as — the parity test requires the ceiling to be READ here, not merely
 * mentioned in a comment (PRDR-172's rule).
 */
export type ProgressBreaker = Pick<Budgets, "spend_without_progress_floor_usd" | "spend_without_progress_multiple">;

const DEFAULT_BREAKER: ProgressBreaker = {
  spend_without_progress_floor_usd: CEILINGS.spend_without_progress_floor_usd.default,
  spend_without_progress_multiple: CEILINGS.spend_without_progress_multiple.default,
};

export class SpendLedger {
  private accumulated: number;
  /** Spend at the moment the last unit of work completed. */
  private progressMark: number;
  /** What the last completed unit cost — the observation the threshold derives from. */
  private lastUnitCost: number;
  private announcedTotal = false;

  constructor(
    private readonly root: string,
    private readonly journal: RunJournal,
    private readonly ceiling: number,
    private readonly breaker: ProgressBreaker = DEFAULT_BREAKER,
    /** X-1⁵: how the advisory total reaches the operator. Counted and said, never fatal. */
    private readonly announce?: (text: string) => void,
  ) {
    this.accumulated = readRecordedSpend(root);
    /**
     * Resumed from the lock, not from memory. `init` builds one of these for
     * every session launch, so a mark held only in this object would reset on
     * each and the breaker would never fire.
     */
    const mark = readProgressMark(root);
    /**
     * Pinned once, on the first ledger to find no mark — not re-derived per
     * construction. `init` builds one of these per session launch, and
     * defaulting the mark to the CURRENT total each time forgave every dollar
     * the previous session had spent, so the breaker could never accumulate
     * anything to fire on. Found by the breaker staying silent in three tests
     * that should have tripped it.
     */
    if (mark.spent === null) writeProgressMark(root, { spent: this.accumulated, unitCost: 0 });
    this.progressMark = mark.spent ?? this.accumulated;
    this.lastUnitCost = mark.unitCost ?? 0;
  }

  /**
   * A unit of work finished: a slice planned, or a ticket reaching DONE.
   *
   * This is the only thing that resets the breaker, and that is the whole
   * design — the run buys its next budget by finishing something.
   */
  noteProgress(): void {
    const spent = Math.max(this.accumulated, readRecordedSpend(this.root));
    this.lastUnitCost = Math.max(0, spent - this.progressMark);
    this.progressMark = spent;
    this.accumulated = spent;
    writeProgressMark(this.root, { spent, unitCost: this.lastUnitCost });
  }

  /** X-1⁵: `run_spend_usd` is advisory now — counted and reported, never fatal. */
  overAdvisoryTotal(): boolean {
    return this.ceiling > 0 && this.accumulated >= this.ceiling;
  }

  /**
   * Say it once, the first launch after the advisory total is passed.
   *
   * Counting without reporting is not counting. Announcing on every launch
   * would be noise an operator learns to skip, which is how V-1‴ describes a
   * warning that fires constantly.
   */
  private announceAdvisoryTotal(): void {
    if (this.announcedTotal || !this.overAdvisoryTotal()) return;
    this.announcedTotal = true;
    this.announce?.(
      `spend has passed the advisory run_spend_usd of $${this.ceiling.toFixed(2)} ` +
        `(now $${this.accumulated.toFixed(2)}). X-1⁵: this is a figure, not a gate — the run continues, ` +
        "and what would stop it is spend with nothing completing.",
    );
  }

  /**
   * What may be spent before something has to finish.
   *
   * The floor is not a fallback, it is a MINIMUM. A resumed run reuses finished
   * slices for $0 (C-8), so the observed cost per unit collapses toward zero
   * and a purely derived threshold would halt on the first dollar spent —
   * punishing precisely the checkpoint reuse that makes a restart cheap.
   */
  progressThreshold(): number {
    const observed = this.lastUnitCost * this.breaker.spend_without_progress_multiple;
    return Math.max(this.breaker.spend_without_progress_floor_usd, observed);
  }

  spent(): number {
    return this.accumulated;
  }

  /**
   * D-25: evaluated at session launch, never mid-flight.
   *
   * X-1‴ (PRDR-136): re-reads the FILE, because `accumulated` seeded once at
   * construction let two runs on one root each enforce the full ceiling and
   * jointly spend past it. The file is the shared truth and reading it is not
   * the expensive part of a session.
   *
   * X-1⁵ (PRDR-191): the TOTAL no longer refuses. It fired on success — a large
   * legitimate job reaches it by doing what it was asked — and late on failure,
   * since a runaway burns for hours before any total is reached. What refuses
   * is spend with nothing completing.
   */
  assertLaunchAllowed(): void {
    const spent = Math.max(this.accumulated, readRecordedSpend(this.root));
    this.accumulated = spent;
    this.announceAdvisoryTotal();
    const sinceProgress = spent - this.progressMark;
    const threshold = this.progressThreshold();
    if (sinceProgress > threshold) throw new NoProgressError(sinceProgress, threshold);
  }

  /**
   * Record one session. Field discipline per S-4 (PRDR-052/053): the
   * per-model breakdown is the token source of record when present; a crashed
   * result's zeroed figures are recorded as a flagged lower bound, never
   * dropped and never treated as the absent-telemetry breaker.
   */
  record(ticketId: string, generation: number, role: string, result: SessionResult, at: string): LedgerRow {
    const perModel = Object.values(result.perModel ?? {});
    const fromBreakdown = perModel.length > 0;
    const sum = (pick: (u: (typeof perModel)[number]) => number): number => perModel.reduce((a, u) => a + pick(u), 0);

    const row = ledgerRowSchema.parse({
      at,
      ticket: ticketId,
      generation,
      role,
      cost_estimate_usd: fromBreakdown ? sum((u) => u.costUSD) : result.costEstimateUsd,
      input_tokens: fromBreakdown ? sum((u) => u.inputTokens) : result.inputTokens,
      output_tokens: fromBreakdown ? sum((u) => u.outputTokens) : result.outputTokens,
      cache_read_input_tokens: fromBreakdown ? sum((u) => u.cacheReadInputTokens) : result.cacheReadInputTokens,
      cache_creation_input_tokens: fromBreakdown ? sum((u) => u.cacheCreationInputTokens) : result.cacheCreationInputTokens,
      turns: result.turns,
      /* PRDR-095: the breakdown's keys ARE the model names — record them. */
      models: Object.keys(result.perModel ?? {}).sort(),
      ...(result.crashed === true ? { partial: "crash" as const } : {}),
    });
    this.journal.appendLedger(row);
    this.accumulated += row.cost_estimate_usd;
    return row;
  }
}

/**
 * X-1⁵ (PRDR-191): a unit of work finished, recorded without a ledger instance.
 *
 * The progress sites — a slice checkpointed, a ticket reaching DONE — do not
 * hold a `SpendLedger` and should not have to construct one to say "something
 * finished". The mark lives on the run lock precisely so it can be written from
 * wherever the work actually completes.
 */
export function noteUnitComplete(root: string): void {
  const spent = readRecordedSpend(root);
  const mark = readProgressMark(root);
  writeProgressMark(root, { spent, unitCost: Math.max(0, spent - (mark.spent ?? spent)) });
}

/**
 * The whole file: cumulative across generations and resumed runs (X-8).
 *
 * X-1‴ (PRDR-136): every row is VALIDATED with the schema that wrote it. This
 * was `JSON.parse(line) as { cost_estimate_usd?: number }` followed by
 * `?? 0` — so a string cost concatenated (`5, "5", 3` gives `"553"`, not 13),
 * a negative subtracted, and `1e999` became `Infinity` and refused every
 * launch. The write side is strict (`journal.ts`) and its test covers only the
 * write; this is the cross-generation financial backstop and was the looser
 * half. A row that does not validate is a halt, not a zero.
 *
 * The torn-LAST-line tolerance stays: that is the one shape a crash actually
 * produces, and the justification for it was always sound.
 */
export function readRecordedSpend(root: string): number {
  const file = path.join(stateDir(root), "ledger.jsonl");
  if (!existsSync(file)) return 0;
  const lines = readFileSync(file, "utf8").split("\n");
  let total = 0;
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      /**
       * PRDR-151: unparseable TEXT is a crash artifact, at any position, and is
       * skipped. The first version of this refused any torn line that was not
       * last — which sounds right and bricks a root: `appendLedger` writes
       * `JSON.stringify(row) + "\n"`, so a line torn mid-append has no trailing
       * newline and the NEXT append concatenates onto it. One `kill -9` then
       * cost a run its next session's spend silently, and the run after that
       * refused at startup forever, with no repair instruction. Reproduced.
       *
       * The distinction that matters is not WHERE the damage is but WHAT it is:
       * text that is not JSON is a torn write; a well-formed object that is not
       * a ledger row is a shape the writer cannot produce. Only the second is
       * worth halting for, and it is the one X-1‴ was actually about.
       *
       * The cost is an under-count of at most the row glued to the torn one —
       * a lower bound, the safe direction, and bounded further by the `Math.max`
       * against this process's own total.
       */
      continue;
    }
    const parsed = ledgerRowSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `.detent/ledger.jsonl line ${index + 1} is well-formed JSON but not a ledger row (${parsed.error.issues[0]?.message ?? "invalid"}) — ` +
          "the spend ceiling is enforced against this file and cannot trust a shape it did not write (X-1).",
      );
    }
    total += parsed.data.cost_estimate_usd;
  }
  return total;
}
