import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
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
  const row = ledgerRowSchema.parse({
    at,
    ticket: "(out-of-band)",
    generation: 0,
    role,
    cost_estimate_usd: result.costEstimateUsd,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    cache_read_input_tokens: result.cacheReadInputTokens,
    cache_creation_input_tokens: result.cacheCreationInputTokens,
    turns: result.turns,
    models: result.perModel === undefined ? [] : Object.keys(result.perModel),
  });
  mkdirSync(stateDir(root), { recursive: true });
  appendFileSync(path.join(stateDir(root), "ledger.jsonl"), `${JSON.stringify(row)}\n`);
  return row;
}

export class SpendLedger {
  private accumulated: number;

  constructor(
    private readonly root: string,
    private readonly journal: RunJournal,
    private readonly ceiling: number,
  ) {
    this.accumulated = readRecordedSpend(root);
  }

  spent(): number {
    return this.accumulated;
  }

  /**
   * D-25: evaluated at session launch, never mid-flight.
   *
   * X-1‴ (PRDR-136): re-reads the FILE. `accumulated` was seeded once at
   * construction and incremented in memory, so two runs on one root each
   * enforced the full ceiling and jointly spent past it — silently, because
   * per-ticket claims correctly kept them off the same ticket, so nothing else
   * looked wrong. A launch gate fires a few dozen times a run; the file is the
   * shared truth and reading it is not the expensive part of a session.
   */
  assertLaunchAllowed(): void {
    const spent = Math.max(this.accumulated, readRecordedSpend(this.root));
    this.accumulated = spent;
    if (spent >= this.ceiling) throw new SpendExhaustedError(spent, this.ceiling);
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
