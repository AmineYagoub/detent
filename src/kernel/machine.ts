import type { Budgets } from "../schemas/budgets.js";
import type { Counters, Ticket } from "../schemas/ticket.js";
import { EVENTS, STATES, TERMINAL_STATES, type Event, type State } from "../schemas/states.js";
import { countHypothesis, consumeSlot } from "./budgets.js";
import { resolveRed } from "./resolver.js";

/**
 * T-011 — the execution state machine (X-3).
 *
 * The table is data. Rows are either a literal target state or a reference to a
 * named guard; no row contains inline logic. Every (state, event) pair absent
 * from the table raises — the machine has no default edge, so an event the
 * design did not anticipate cannot silently advance a ticket.
 */

export class TransitionError extends Error {
  constructor(
    readonly from: State,
    readonly event: Event,
  ) {
    super(`illegal transition: ${from} --${event}-->`);
    this.name = "TransitionError";
  }
}

export interface GuardContext {
  readonly ticket: Pick<Ticket, "type">;
  readonly budgets: Budgets;
}

export interface GuardOutcome {
  readonly next: State;
  readonly counters: Counters;
}

export type GuardName =
  | "claimed"
  | "reproWrong"
  | "premiseFalsified"
  | "resolveRed"
  | "reviewChanges"
  | "enterInformed";

/** A table row: a literal destination, or a reference to a named guard. */
export type Row = { readonly to: State } | { readonly guard: GuardName };

const to = (s: State): Row => ({ to: s });
const guard = (g: GuardName): Row => ({ guard: g });

function key(state: State, event: Event): string {
  return `${state}|${event}`;
}

const rows: ReadonlyArray<readonly [State, Event, Row]> = [
  ["READY", "CLAIMED", guard("claimed")],
  ["DIAGNOSED", "REPRO_AS_PREDICTED", to("IN_PROGRESS")],
  ["DIAGNOSED", "REPRO_WRONG", guard("reproWrong")],
  ["IN_PROGRESS", "PREMISE_FALSIFIED", guard("premiseFalsified")],

  ["IN_PROGRESS", "GATE_GREEN", to("IN_REVIEW")],
  ["BLIND_FIX", "GATE_GREEN", to("IN_REVIEW")],
  ["INFORMED_FIX", "GATE_GREEN", to("IN_REVIEW")],
  ["REVIEW_FIX", "GATE_GREEN", to("IN_REVIEW")],

  ["IN_PROGRESS", "GATE_RED", guard("resolveRed")],
  ["BLIND_FIX", "GATE_RED", guard("resolveRed")],
  ["REVIEW_FIX", "GATE_RED", guard("resolveRed")],
  // The ladder cannot reopen after the informed attempt: a direct table edge,
  // not a resolver call (D-13).
  ["INFORMED_FIX", "GATE_RED", to("NEEDS_HUMAN")],

  ["RESEARCH", "RESEARCH_VALID", guard("enterInformed")],
  ["RESEARCH", "RESEARCH_DRY", to("NEEDS_HUMAN")],
  ["RESEARCH", "UPSTREAM_BUG", to("BLOCKED")],

  ["IN_REVIEW", "REVIEW_APPROVE", to("APPROVED")],
  ["IN_REVIEW", "REVIEW_CHANGES", guard("reviewChanges")],

  ["APPROVED", "GATE_GREEN", to("DONE")],
  ["APPROVED", "GATE_RED", guard("resolveRed")],
  ["APPROVED", "RISK_LABEL_REQUIRED", to("NEEDS_HUMAN")],

  ["NEEDS_HUMAN", "HUMAN_APPROVED", to("APPROVED")],
  ["NEEDS_HUMAN", "HUMAN_REQUEUE", to("READY")],
  ["BLOCKED", "HUMAN_REQUEUE", to("READY")],
];

function buildTable(): ReadonlyMap<string, Row> {
  const t = new Map<string, Row>();
  for (const [s, e, row] of rows) {
    const k = key(s, e);
    if (t.has(k)) throw new Error(`duplicate transition row: ${k}`);
    t.set(k, row);
  }
  // BUDGET_BREACH is legal from every non-DONE state (X-3).
  for (const s of STATES) {
    if (!TERMINAL_STATES.has(s)) t.set(key(s, "BUDGET_BREACH"), to("NEEDS_HUMAN"));
  }
  return t;
}

export const TABLE: ReadonlyMap<string, Row> = buildTable();

/**
 * All counter mutation lives in guards. A literal row never changes a counter,
 * so `apply` has no special cases and the table stays readable as pure data.
 */
const GUARDS: Record<GuardName, (c: Counters, ctx: GuardContext) => GuardOutcome> = {
  claimed: (c, ctx) => ({ next: ctx.ticket.type === "bug" ? "DIAGNOSED" : "IN_PROGRESS", counters: c }),

  reproWrong: (c, ctx) => {
    const counters = countHypothesis(c);
    return {
      next: counters.hypotheses > ctx.budgets.hypotheses ? "NEEDS_HUMAN" : "DIAGNOSED",
      counters,
    };
  },

  premiseFalsified: (c, ctx) => {
    const counters = countHypothesis(c);
    if (ctx.ticket.type !== "bug") {
      // A falsified premise on a feature ticket is a plan-level flaw.
      return { next: "NEEDS_HUMAN", counters };
    }
    return {
      next: counters.hypotheses > ctx.budgets.hypotheses ? "NEEDS_HUMAN" : "DIAGNOSED",
      counters,
    };
  },

  resolveRed: (c) => resolveRed(c),

  reviewChanges: (c) =>
    c.review_fix_attempts === 0
      ? { next: "REVIEW_FIX", counters: consumeSlot(c, "review_fix_attempts") }
      : { next: "NEEDS_HUMAN", counters: c },

  // X-1: the informed slot is consumed exactly on entry to its namesake state.
  enterInformed: (c) => ({
    next: "INFORMED_FIX",
    counters: consumeSlot(c, "informed_fix_attempts"),
  }),
};

export interface ApplyResult {
  readonly from: State;
  readonly event: Event;
  readonly to: State;
  readonly counters: Counters;
}

/**
 * Apply an event. Pure: returns the new state and counters rather than mutating
 * the ticket, so a caller cannot observe a half-applied transition. Persisting
 * the result and appending the transition line is the run loop's job (T-041).
 */
export function apply(
  from: State,
  event: Event,
  counters: Counters,
  ctx: GuardContext,
  table: ReadonlyMap<string, Row> = TABLE,
): ApplyResult {
  const row = table.get(key(from, event));
  if (row === undefined) throw new TransitionError(from, event);

  if ("to" in row) return { from, event, to: row.to, counters };

  const outcome = GUARDS[row.guard](counters, ctx);
  return { from, event, to: outcome.next, counters: outcome.counters };
}

/** Every event legal from a state — used by the exhaustive walk of T-014. */
export function legalEvents(state: State, table: ReadonlyMap<string, Row> = TABLE): readonly Event[] {
  return EVENTS.filter((e) => table.has(key(state, e)));
}

/** Build a variant table. T-014 uses this to prove the worst case is sensitive
 *  to the table rather than to a hardcoded figure. */
export function tableWith(extra: ReadonlyArray<readonly [State, Event, Row]>): ReadonlyMap<string, Row> {
  const t = new Map(TABLE);
  for (const [s, e, row] of extra) t.set(key(s, e), row);
  return t;
}

export { key as transitionKey };

export function isLegal(state: State, event: Event): boolean {
  return TABLE.has(key(state, event));
}
