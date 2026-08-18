import { existsSync, readFileSync } from "node:fs";
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

  /** D-25: evaluated at session launch, never mid-flight. */
  assertLaunchAllowed(): void {
    if (this.accumulated >= this.ceiling) throw new SpendExhaustedError(this.accumulated, this.ceiling);
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
      ...(result.crashed === true ? { partial: "crash" as const } : {}),
    });
    this.journal.appendLedger(row);
    this.accumulated += row.cost_estimate_usd;
    return row;
  }
}

/** The whole file: cumulative across generations and resumed runs (X-8). */
export function readRecordedSpend(root: string): number {
  const file = path.join(stateDir(root), "ledger.jsonl");
  if (!existsSync(file)) return 0;
  let total = 0;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const row = JSON.parse(line) as { cost_estimate_usd?: number };
      total += row.cost_estimate_usd ?? 0;
    } catch {
      /* a torn line cannot subtract money; N-5 reconstruction reports it */
    }
  }
  return total;
}
