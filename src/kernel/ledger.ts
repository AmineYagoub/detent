import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { CEILINGS, type Budgets } from "../schemas/budgets.js";
import { ledgerRowSchema, type LedgerRow } from "../schemas/records.js";
import type { SessionResult } from "../sessions/backend.js";
import type { RunJournal } from "./journal.js";
import { recoverObjects } from "./jsonl-recover.js";

/**
 * T-048 — the ledger, and what it counts (S-4, X-8, D-25).
 *
 * PRDR-265: nothing in this file refuses a launch any more. This block said
 * "`run_spend_usd` is a LAUNCH GATE: the kernel refuses to launch any session
 * once cumulative recorded spend has reached the ceiling" — untrue since
 * PRDR-191 (X-1⁵) demoted that total to advisory, and left standing for the
 * whole of the intervening time. It is this repo's defining defect class, and
 * it sat at the top of the module it misdescribes.
 *
 * What this file does is MEASURE: cumulative spend, the mean session cost, the
 * cost of the last completed unit, and the no-progress threshold those imply.
 * Crossing a threshold is announced once, never thrown. Both figures still bound
 * nothing on their own — what bounds a run is the ladder, the wall clock and the
 * load-time worst-case walk (X-1, PRDR-265).
 *
 * Spend is summed from `ledger.jsonl` itself at open, so the count is cumulative
 * across generations AND across resumed invocations (X-8) — a requeue never
 * resets the money.
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
 * X-1⁵: the RUN-SCOPED ledger state — the breaker's mark, and whether the
 * advisory total has been announced.
 *
 * Keeps its filename: renaming it would be a migration for every root, and the
 * mark is still the reason it exists.
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
  /**
   * PRDR-195: said once for the RUN, not once per session.
   *
   * This was an instance field, and `init` builds a `SpendLedger` for every
   * session launch — so it reset each time and the live log announced three
   * times in thirteen minutes. The same defect PRDR-191's audit found for
   * `spent`, one line above, left in place when that one was fixed.
   */
  readonly advisoryAnnounced: boolean;
  /**
   * PRDR-265: the same say-once discipline for the no-progress breaker, which
   * announces now instead of throwing. Persisted for the same reason
   * `advisoryAnnounced` is — `init` builds a `SpendLedger` per launch, so an
   * instance field would reset each time and announce on every session.
   *
   * Unlike the advisory flag this one is CLEARED by progress: finishing a unit
   * ends the episode, and the next one is news again.
   */
  readonly breakerAnnounced: boolean;
}

export function readProgressMark(root: string): ProgressMark {
  try {
    const raw = JSON.parse(readFileSync(progressPath(root), "utf8")) as Partial<ProgressMark>;
    return {
      spent: typeof raw.spent === "number" ? raw.spent : null,
      unitCost: typeof raw.unitCost === "number" ? raw.unitCost : null,
      advisoryAnnounced: raw.advisoryAnnounced === true,
      breakerAnnounced: raw.breakerAnnounced === true,
    };
  } catch {
    /* Absent or unreadable: nothing has completed that we can prove, so the floor governs. */
    return { spent: null, unitCost: null, advisoryAnnounced: false, breakerAnnounced: false };
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

/** D-15 (PRDR-261): which term of `progressThreshold`'s max() governs. A union, not an enum. */
export type BreakerTerm = "floor" | "unit" | "sessions";

/**
 * D-15 (PRDR-261): the evidence the halt is MADE of, as fields.
 *
 * Before any unit completes the threshold is DERIVED FROM the spend it bounds —
 * `sessionCostEvidence` divides that same total by the session count and
 * `spend_without_progress_sessions` multiplies it back — so whenever the
 * sessions term governs, the two sides are one number and the old message
 * printed it twice: "$11.03 spent without completing a unit of work, past the
 * $11.03 this run allows". A halt that contradicts itself tells an operator
 * nothing, and it was not only the float that reached it: $12.001 spent since a
 * $4 unit at a multiple of 3 renders "$12.00 past the $12.00" with no rounding
 * subtlety at all, and on the sub-cent ceilings this repository configures it
 * rendered "$0.00 past the $0.00".
 *
 * So the bound is never a pre-computed dollar total. It is printed as its
 * DEFINITION — the ceiling key, its configured value, and the observation it
 * multiplies — and observed money renders at four decimals, which is the
 * resolution the ledger actually carries. No two figures in the sentence can
 * then be two renderings of the same quantity.
 */
export interface BreakerEvidence {
  readonly sinceProgress: number;
  readonly threshold: number;
  readonly term: BreakerTerm;
  /** D-14 (PRDR-261): the mean's denominator — rows on this root that transacted. */
  readonly transactingSessions: number;
  readonly meanSessionCost: number;
  readonly lastUnitCost: number;
  readonly breaker: ProgressBreaker;
}

function breakerBound(e: BreakerEvidence): string {
  if (e.term === "floor") {
    return `spend_without_progress_floor_usd = ${String(e.breaker.spend_without_progress_floor_usd)}, the minimum this run allows with nothing finishing`;
  }
  if (e.term === "unit") {
    return `spend_without_progress_multiple = ${String(e.breaker.spend_without_progress_multiple)} x the $${e.lastUnitCost.toFixed(4)} the last completed unit cost`;
  }
  return (
    `spend_without_progress_sessions = ${String(e.breaker.spend_without_progress_sessions)} x the ` +
    `$${e.meanSessionCost.toFixed(4)} mean of this root's ${String(e.transactingSessions)} transacting session(s)`
  );
}

/**
 * D-15 (PRDR-261): how close to the threshold counts as AT it.
 *
 * PRDR-265 kept this. The comparison it guards survives the conversion to
 * counting — it decides whether to ANNOUNCE rather than whether to refuse, on
 * the precedent `overAdvisoryTotal` set for `run_spend_usd`. A boundary that
 * decides what an operator is told is still a boundary worth getting right, and
 * deleting the tolerance while keeping the `>` would have restored exactly the
 * coin flip described below, one rung quieter.
 *
 * At rows === spend_without_progress_sessions the two sides of the comparison
 * are one number and the design's own `>` says ALLOWED. IEEE-754 decided it
 * instead: (11.0275965 / 20) * 20 is 11.027596499999997803, one ulp low, and a
 * live init was refused its twentieth session with "$11.03 ... past the $11.03
 * this run allows" while the identical twenty sessions at a thousand times the
 * price were allowed. The boundary was a coin flip on the low bits of the money.
 *
 * RELATIVE, because this repository configures ceilings from $0.0001 to
 * thousands and no absolute epsilon is right at both ends. Rounding both sides
 * to cents was the first proposal and is an absolute epsilon in disguise: at
 * those ceilings it makes the breaker inert while its tests stay green. The
 * nearest REAL decision is one session's share of the mean — 5e-2 relative at
 * the default of 20 sessions, 1e-2 at 100 — so this is seven orders of
 * magnitude below what it must never forgive and seven above the ulp noise it
 * must. The relative-versus-absolute choice is argued, not mutation-covered:
 * inside the range this repository configures the two are indistinguishable.
 */
const TIE_TOLERANCE = 1e-9;

/**
 * PRDR-265: the sentence the breaker used to throw, now the sentence it says.
 *
 * `NoProgressError` and `SpendExhaustedError` are both gone. The first had one
 * throw site and this text was its whole value; the second had ZERO throw sites
 * anywhere in src or tests — PRDR-191 converted `run_spend_usd` and left the
 * class behind, still wired to a BREACH route in `referee/registry`, which read
 * as a live budget path to anyone tracing how a breach happens.
 */
export function noProgressReport(evidence: BreakerEvidence): string {
  return (
    `no-progress breaker (X-1⁵): $${evidence.sinceProgress.toFixed(4)} spent without completing a unit of work, ` +
    `past ${breakerBound(evidence)}. Nothing has finished in that time, which is what a runaway looks like ` +
    "and what working never does. X-1 (PRDR-265): this is a figure, not a gate — the run continues, and what " +
    "bounds it is the escalation ladder, the ticket wall clock and the load-time worst-case walk."
  );
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
export type ProgressBreaker = Pick<
  Budgets,
  "spend_without_progress_floor_usd" | "spend_without_progress_multiple" | "spend_without_progress_sessions"
>;

const DEFAULT_BREAKER: ProgressBreaker = {
  spend_without_progress_floor_usd: CEILINGS.spend_without_progress_floor_usd.default,
  spend_without_progress_multiple: CEILINGS.spend_without_progress_multiple.default,
  spend_without_progress_sessions: CEILINGS.spend_without_progress_sessions.default,
};

export class SpendLedger {
  private accumulated: number;
  /** Spend at the moment the last unit of work completed. */
  private progressMark: number;
  /** What the last completed unit cost — the observation the threshold derives from. */
  private lastUnitCost: number;

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
    if (mark.spent === null) writeProgressMark(root, { spent: this.accumulated, unitCost: 0, advisoryAnnounced: false, breakerAnnounced: false });
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
    /*
     * PRDR-195: carry the advisory flag; progress is not a reason to warn twice
     * about a total that only ever grows. PRDR-265: CLEAR the breaker flag —
     * finishing a unit is exactly the thing that ends a no-progress episode, so
     * the next one is a new fact and not a repeat.
     */
    writeProgressMark(this.root, {
      spent,
      unitCost: this.lastUnitCost,
      advisoryAnnounced: readProgressMark(this.root).advisoryAnnounced,
      breakerAnnounced: false,
    });
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
    if (!this.overAdvisoryTotal()) return;
    const mark = readProgressMark(this.root);
    if (mark.advisoryAnnounced) return;
    writeProgressMark(this.root, { spent: mark.spent, unitCost: mark.unitCost, advisoryAnnounced: true, breakerAnnounced: mark.breakerAnnounced });
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
  /**
   * The three terms, and which one governs.
   *
   * The scale-free term is the only one available before a unit completes. A
   * fixed dollar floor was the first design; this file's own audit found it
   * wrong for the reason X-1⁵ rejects a fixed total — it read ~3x this
   * project's slice cost and would read a fraction of that on a project whose
   * sessions cost ten times as much. The mean session cost is observable after
   * ONE session, which is far sooner than any unit completes.
   *
   * D-15 (PRDR-261): "scale-free" is literally true and it is why, before any
   * unit completes, this is a COUNT. `sinceProgress` is then the same sum
   * `sessionCostEvidence` averages, so `sinceProgress > (sinceProgress/rows)*n`
   * reduces to `rows > n` and the dollars survive only through the floor. That
   * is the intended control and it is not changed here; what is changed is that
   * its boundary was decided by arithmetic (see `TIE_TOLERANCE`) and that the
   * governing term is now NAMED, so a refusal can be read without this file.
   */
  private breakerTerms(): Omit<BreakerEvidence, "sinceProgress"> {
    const { mean, sessions } = sessionCostEvidence(this.root);
    const floor = this.breaker.spend_without_progress_floor_usd;
    const perUnit = this.lastUnitCost * this.breaker.spend_without_progress_multiple;
    const perSession = mean * this.breaker.spend_without_progress_sessions;
    const threshold = Math.max(floor, perUnit, perSession);
    /**
     * Which term to NAME when two tie. The floor is the claim that needs no
     * observation behind it, so it wins, and an operator is never told a mean
     * stopped them when the configured minimum would have on its own.
     */
    let term: BreakerTerm = "floor";
    if (threshold > floor && threshold === perUnit) term = "unit";
    else if (threshold > floor) term = "sessions";
    return { threshold, term, transactingSessions: sessions, meanSessionCost: mean, lastUnitCost: this.lastUnitCost, breaker: this.breaker };
  }

  progressThreshold(): number {
    return this.breakerTerms().threshold;
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
   * X-1⁵ (PRDR-191): the TOTAL stopped refusing. It fired on success — a large
   * legitimate job reaches it by doing what it was asked — and late on failure,
   * since a runaway burns for hours before any total is reached.
   *
   * PRDR-265: and now neither does the breaker. Both are announced once and the
   * run continues. This method is named for what it does: it records the launch
   * and reports what it saw. It was `assertLaunchAllowed`, a name that promised
   * a refusal it no longer performs.
   */
  recordLaunch(): void {
    const spent = Math.max(this.accumulated, readRecordedSpend(this.root));
    this.accumulated = spent;
    this.announceAdvisoryTotal();
    /*
     * X-1⁶ (PRDR-219): the MARK is re-read too. `noteUnitComplete` writes it
     * from wherever work completes, and the run's one ledger — built once in
     * the referee context — read it only in the constructor, so every DONE
     * after that moved a file this instance never saw; gate-313 halted a
     * working run on its second ticket. Adopted only when it has moved, so
     * memory never runs ahead of the file and an unreadable file changes nothing.
     */
    const mark = readProgressMark(this.root);
    if (mark.spent !== null && mark.spent > this.progressMark) {
      this.progressMark = mark.spent;
      this.lastUnitCost = mark.unitCost ?? this.lastUnitCost;
    }
    const sinceProgress = spent - this.progressMark;
    const evidence: BreakerEvidence = { ...this.breakerTerms(), sinceProgress };
    if (sinceProgress - evidence.threshold > evidence.threshold * TIE_TOLERANCE) this.announceBreaker(evidence);
  }

  /**
   * PRDR-265: say it once per no-progress episode.
   *
   * `announceAdvisoryTotal` above is the finished template and this deliberately
   * matches it — one flag in the progress mark, read before speaking, written
   * after. The difference is when the flag clears: the advisory total only ever
   * grows, so it is said once for the run, while a no-progress episode ENDS when
   * something finishes, and the next one is news again (`noteProgress`).
   */
  private announceBreaker(evidence: BreakerEvidence): void {
    const mark = readProgressMark(this.root);
    if (mark.breakerAnnounced) return;
    writeProgressMark(this.root, {
      spent: mark.spent,
      unitCost: mark.unitCost,
      advisoryAnnounced: mark.advisoryAnnounced,
      breakerAnnounced: true,
    });
    this.announce?.(noProgressReport(evidence));
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
  writeProgressMark(root, {
    spent,
    unitCost: Math.max(0, spent - (mark.spent ?? spent)),
    advisoryAnnounced: mark.advisoryAnnounced,
    /**
     * PRDR-265: the breaker's say-once RE-ARMS on progress, where the advisory
     * total's does not. They are announcements about different quantities —
     * the advisory is a one-time-ever statement about cumulative run spend,
     * while the breaker is about spend since the LAST unit finished. A fresh
     * stall after real progress is a new event, and an operator who fixed the
     * first one is owed the second.
     */
    breakerAnnounced: false,
  });
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
/** D-14/D-15 (PRDR-261): the mean, and the denominator it was taken over — one loop, one predicate. */
export interface SessionCostEvidence {
  readonly mean: number;
  readonly sessions: number;
}

/**
 * X-1⁵: what a SESSION has cost on this root so far, on average.
 *
 * The scale signal the no-progress threshold derives from, so the denominator
 * counts sessions that TRANSACTED, not rows.
 *
 * D-14 (PRDR-261): this counted every parseable row. A `partial` row is a
 * crashed session's zeroed telemetry recorded as a flagged lower bound
 * (PRDR-053, `src/schemas/records.ts`) — money of record in `readRecordedSpend`
 * and no evidence at all of what a session costs. Counting it left the
 * numerator alone and grew the denominator, so twenty-one crash rows from one
 * mis-parsed usage limit dragged a live run's threshold from $73.52 to $9.19
 * and halted it three real sessions in. The row is still in the file, still in
 * the total, and still in spend-since-progress; what it stops doing is setting
 * the scale, which it never had standing to do. `src/init/sizing-evidence.ts`
 * already excludes the same rows from turn evidence — this makes the two
 * readers agree rather than inventing a second rule.
 *
 * Keyed on the FLAG, not on a zero cost. `partial` is set from `result.crashed`
 * alone, so a producer that reports a crash with a non-zero cost mints a
 * non-zero partial row this must still exclude — and a genuinely free C-8 reuse
 * session must still count, or the mean reads high on exactly the runs that are
 * cheapest, which is the fail-open direction. It deliberately does NOT catch an
 * UNFLAGGED $0 row: the two drivers do not agree on how a crash is recognised,
 * and that is a write-side question recorded in this ticket's non-goals rather
 * than papered over here.
 *
 * No qualifying row means zero, never NaN. `Math.max(floor, 0, NaN)` is NaN and
 * `x > NaN` is always false, so an unguarded division would make the breaker
 * permanently inert on a root whose every row is `partial` — reachable, which
 * is a total backend outage. Zero lets the floor — a MINIMUM, not a fallback —
 * govern until the first session lands.
 */
export function sessionCostEvidence(root: string): SessionCostEvidence {
  const file = path.join(stateDir(root), "ledger.jsonl");
  if (!existsSync(file)) return { mean: 0, sessions: 0 };
  let total = 0;
  let sessions = 0;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = ledgerRowSchema.safeParse(JSON.parse(line));
      if (!parsed.success) continue;
      if (parsed.data.partial !== undefined) continue;
      total += parsed.data.cost_estimate_usd;
      sessions += 1;
    } catch {
      /**
       * PRDR-151's rule: a torn line is a crash artifact and is skipped. Unlike
       * `readRecordedSpend` this never throws on a well-formed non-row either —
       * a threshold that refuses to be computed would halt the run it exists to
       * keep alive, and that file already refuses such a shape by name.
       */
      continue;
    }
  }
  return { mean: sessions === 0 ? 0 : total / sessions, sessions };
}

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
       * PRDR-249: what is skipped is the FRAGMENT, not the line. This block
       * claimed the loss was "at most the row glued to the torn one" and it was
       * larger — a tear at the record separator leaves two COMPLETE rows on one
       * line and `JSON.parse` rejects the pair for trailing content, so 10/100/1
       * torn after the first row's closing brace read back 1. `recoverObjects`
       * digs out every object that was fully written; only the fragment, whose
       * bytes stopped mid-flight and whose cost is genuinely unknown, is lost.
       *
       * A recovered object that is not a ledger row is SKIPPED rather than
       * throwing, unlike the intact-line case below. X-1‴ is that the ceiling
       * cannot trust a shape its WRITER could not produce; an object dug out of
       * a damaged line is a crash artifact, and PRDR-151's lesson is that a
       * crash artifact must never brick a root.
       */
      for (const recovered of recoverObjects(line)) {
        const recoveredRow = ledgerRowSchema.safeParse(recovered);
        if (recoveredRow.success) total += recoveredRow.data.cost_estimate_usd;
      }
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
