import { MEASURED, sessionFigure, span, type Figure, type Route } from "../init/estimate.js";
import { INIT_TICKET } from "../init/session.js";
import { readLedgerRows } from "../kernel/ledger-rows.js";
import type { LedgerRow } from "../schemas/records.js";
import { EvalRefused } from "./sets.js";

/**
 * N-8 (PRDR-326) — what an evaluation will spend, and what it may.
 *
 * A run's caps only announce (X-1⁵, PRDR-265): a run exists to finish the
 * work. An evaluation is spend the user approved in advance, and nothing is
 * lost by stopping it, so it holds to its budget (D-35): no session starts
 * that its figure says would take the spend past it. The spend is read from
 * the copy's ledger at each launch, and the sessions still in flight count at
 * their figure until their rows land.
 */

/** A session's figure on a route: N-5⁗'s, or, where nothing has measured the route, the dearest measured one of its kind, which says so. */
export function evalFigure(rows: readonly LedgerRow[], unit: { readonly role: string; readonly task: string }, route: Route): Figure {
  const figure = sessionFigure(rows, unit, route);
  if (figure !== null) return figure;
  const dearest = MEASURED.filter((m) => m.role === unit.role && m.task === unit.task).sort((a, b) => b.usd - a.usd)[0];
  if (dearest === undefined) throw new EvalRefused(`nothing has measured a ${unit.role} ${unit.task} session, so no budget could hold an evaluation of it`);
  const ms = dearest.minutes * 60_000;
  return {
    usd: dearest.usd,
    ms,
    from: `no figure yet for ${route.model} at ${route.effort}, so the dearest measured one of its kind, $${dearest.usd.toFixed(2)} and ${span(ms)} on ${dearest.model} at ${dearest.effort}`,
  };
}

/** What the copy's ledger says `init`'s sessions have spent since `since`. */
export function spentSince(root: string, since: string): number {
  return readLedgerRows(root)
    .filter((r) => r.ticket === INIT_TICKET && r.at >= since)
    .reduce((total, r) => total + r.cost_estimate_usd, 0);
}

/** Thrown by a launch the budget refuses: the unit it belonged to is left unfinished, and no later one starts. */
export class BudgetReached extends Error {
  override readonly name = "BudgetReached";
}

/** The budget a launch asks before it starts, and tells when its session has ended. */
export class EvalBudget {
  private inFlight = 0;

  constructor(
    readonly budgetUsd: number,
    readonly figureUsd: number,
    private readonly spent: () => number,
  ) {}

  /** Whether one more session may start: what is spent, the sessions in flight at their figure, and this one's, within the budget. */
  admit(): boolean {
    if (this.spent() + (this.inFlight + 1) * this.figureUsd > this.budgetUsd) return false;
    this.inFlight += 1;
    return true;
  }

  release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  /** Runs `launch` if the budget admits it, and throws `BudgetReached` if not. */
  async within<T>(launch: () => Promise<T>): Promise<T> {
    if (!this.admit()) throw new BudgetReached(`the budget, $${this.budgetUsd.toFixed(2)}: the next session's figure would take the spend past it`);
    try {
      return await launch();
    } finally {
      this.release();
    }
  }
}
