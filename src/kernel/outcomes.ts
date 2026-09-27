import type { LedgerRow, TransitionLine } from "../schemas/records.js";
import type { Event, State } from "../schemas/states.js";

/**
 * N-5″ (PRDR-297) — how a ticket ran, counted from what `run` recorded.
 *
 * D-33: a planning mechanism stays for the run-time outcome it moves, and a
 * reviewer's finding count is not one. Every figure is counted from
 * `transitions.jsonl` and the ledger, which `run` already writes (N-5), so
 * nothing new is measured, and nothing is gated on a figure.
 *
 * A ticket's figures are all its lines and rows, whichever plan it was in: a
 * re-plan keeps a ticket's id and its history, and no line or row carries a
 * mark of the plan it ran under.
 */

export interface TicketOutcome {
  readonly ticket: string;
  readonly done: boolean;
  /**
   * DONE in the generation it was first claimed in: nothing but an outage sent
   * it back to the pool first (X-8). An outage's requeue opens a generation,
   * and is no finding against the ticket (PRDR-112).
   */
  readonly first_generation: boolean;
  /** Stops for a human, less each the pool returned after an outage, which was no human's to clear (PRDR-112). */
  readonly escalations: number;
  /** By cause: a false premise (X-4, X-3″), a ticket larger than one session (X-4″), a dependency found (X-4′). */
  readonly falsified: Falsified;
  readonly budget_breaches: number;
  /** Reviews that reached a verdict, approving or asking for changes. */
  readonly review_rounds: number;
  readonly cost_usd: number;
  /**
   * Wall-clock at work: from each line that leaves the ticket working to the
   * line after it, summed. Time in the pool, on a human or blocked is not
   * counted, and neither is anything after its last line.
   */
  readonly work_ms: number;
}

export interface Falsified {
  readonly premise: number;
  readonly oversized: number;
  readonly dependency: number;
}

/** The same figures, summed over tickets. */
export interface Totals {
  readonly tickets: number;
  readonly done: number;
  readonly first_generation: number;
  readonly escalations: number;
  readonly falsified: Falsified;
  readonly budget_breaches: number;
  readonly review_rounds: number;
  readonly cost_usd: number;
  readonly work_ms: number;
}

/** Where a ticket waits rather than works. */
const RESTING: ReadonlySet<State> = new Set<State>(["READY", "DONE", "BLOCKED", "NEEDS_HUMAN"]);

function outcome(ticket: string, lines: readonly TransitionLine[], rows: readonly LedgerRow[]): TicketOutcome {
  const count = (event: Event): number => lines.filter((l) => l.event === event).length;
  const done = lines.find((l) => l.to === "DONE");
  let work = 0;
  for (const [i, line] of lines.entries()) {
    const next = lines[i + 1];
    if (next !== undefined && !RESTING.has(line.to)) work += Math.max(0, Date.parse(next.at) - Date.parse(line.at));
  }
  return {
    ticket,
    done: done !== undefined,
    first_generation: done !== undefined && done.generation === count("OUTAGE_REQUEUE"),
    escalations: Math.max(0, lines.filter((l) => l.to === "NEEDS_HUMAN").length - count("OUTAGE_REQUEUE")),
    falsified: { premise: count("PREMISE_FALSIFIED"), oversized: count("TICKET_OVERSIZED"), dependency: count("DEPENDENCY_DISCOVERED") },
    budget_breaches: count("BUDGET_BREACH"),
    review_rounds: count("REVIEW_APPROVE") + count("REVIEW_CHANGES"),
    cost_usd: rows.reduce((usd, r) => usd + r.cost_estimate_usd, 0),
    work_ms: work,
  };
}

/** Each ticket's figures, in the order given, from its lines in the order they were written. */
export function ticketOutcomes(ids: readonly string[], transitions: readonly TransitionLine[], ledger: readonly LedgerRow[]): TicketOutcome[] {
  const lines = byTicket(transitions);
  const rows = byTicket(ledger);
  return ids.map((id) => outcome(id, lines.get(id) ?? [], rows.get(id) ?? []));
}

function byTicket<T extends { readonly ticket: string }>(records: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const record of records) {
    const mine = out.get(record.ticket);
    if (mine === undefined) out.set(record.ticket, [record]);
    else mine.push(record);
  }
  return out;
}

export function totals(outcomes: readonly TicketOutcome[]): Totals {
  const sum = (of: (o: TicketOutcome) => number): number => outcomes.reduce((n, o) => n + of(o), 0);
  return {
    tickets: outcomes.length,
    done: sum((o) => (o.done ? 1 : 0)),
    first_generation: sum((o) => (o.first_generation ? 1 : 0)),
    escalations: sum((o) => o.escalations),
    falsified: { premise: sum((o) => o.falsified.premise), oversized: sum((o) => o.falsified.oversized), dependency: sum((o) => o.falsified.dependency) },
    budget_breaches: sum((o) => o.budget_breaches),
    review_rounds: sum((o) => o.review_rounds),
    cost_usd: sum((o) => o.cost_usd),
    work_ms: sum((o) => o.work_ms),
  };
}
