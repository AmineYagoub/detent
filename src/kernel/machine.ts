import type { Budgets } from "../schemas/budgets.js";
import type { Counters, Ticket } from "../schemas/ticket.js";
import { EVENTS, STATES, TERMINAL_STATES, type Event, type State } from "../schemas/states.js";
import { countHypothesis, countReviewFix, consumeSlot } from "./budgets.js";
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

interface GuardOutcome {
  readonly next: State;
  readonly counters: Counters;
}

type GuardName =
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

/**
 * X-8/C-12 (PRDR-238): the states a human may restart the current attempt from
 * — ONE definition, read by the table below and by `requeueTicket`'s own check,
 * which used to carry a second copy of the pair and could drift from it.
 *
 * A requeue was admissible only from NEEDS_HUMAN and BLOCKED, which was right
 * when PRDR-078 built these verbs for a HALTED ticket and never revisited once
 * crash-resume existed — a crash does not leave a ticket halted, it leaves it
 * mid-flight. So a session killed mid-implement left its ticket IN_PROGRESS,
 * where B-5's skip then sent an unwritten implementation down the whole ladder —
 * a blind fix, a research session, an informed fix — before NEEDS_HUMAN made the
 * remedy reachable. The documented cure was gated behind the failure it exists
 * to short-circuit; a machine restart during gate-313's take 15 stranded two
 * tickets that way at once.
 *
 * APPROVED is deliberately absent: its diff passed the authoritative gate and a
 * review, finalize is mechanical from there, and a requeue would discard
 * verified work on a keystroke — `approve` is the verb for re-examining it.
 * DONE is merged; READY is already what a requeue produces.
 *
 * Widening this set is safe only because `guardClaim` does not move with it: a
 * claim held by a LIVE process still refuses, naming the pid, so a requeue can
 * never pull a ticket out from under a running session (PRDR-079).
 */
export const REQUEUEABLE: readonly State[] = [
  "DIAGNOSED",
  "IN_PROGRESS",
  "BLIND_FIX",
  "RESEARCH",
  "INFORMED_FIX",
  "REVIEW_FIX",
  "IN_REVIEW",
  "NEEDS_HUMAN",
  "BLOCKED",
];

const rows: ReadonlyArray<readonly [State, Event, Row]> = [
  ["READY", "CLAIMED", guard("claimed")],
  ["DIAGNOSED", "REPRO_AS_PREDICTED", to("IN_PROGRESS")],
  ["DIAGNOSED", "REPRO_WRONG", guard("reproWrong")],
  ["IN_PROGRESS", "PREMISE_FALSIFIED", guard("premiseFalsified")],
  /*
   * X-4′ (PRDR-111): a falsification naming a path another ticket owns is a
   * dependency, not a stop — the ticket returns to the pool and waits for it.
   */
  ["IN_PROGRESS", "DEPENDENCY_DISCOVERED", to("READY")],
  /*
   * X-4″ (PRDR-102): a ticket the session judged larger than one session is a
   * plan-level finding, like a false premise — a human's, with the proposal
   * attached. No rung can make a ticket smaller.
   */
  ["IN_PROGRESS", "TICKET_OVERSIZED", to("NEEDS_HUMAN")],

  ["IN_PROGRESS", "GATE_GREEN", to("IN_REVIEW")],
  ["BLIND_FIX", "GATE_GREEN", to("IN_REVIEW")],
  ["INFORMED_FIX", "GATE_GREEN", to("IN_REVIEW")],
  ["REVIEW_FIX", "GATE_GREEN", to("IN_REVIEW")],

  ["IN_PROGRESS", "GATE_RED", guard("resolveRed")],
  ["BLIND_FIX", "GATE_RED", guard("resolveRed")],
  ["REVIEW_FIX", "GATE_RED", guard("resolveRed")],
  /*
   * The ladder cannot reopen after the informed attempt: a direct table edge,
   * not a resolver call (D-13).
   */
  ["INFORMED_FIX", "GATE_RED", to("NEEDS_HUMAN")],

  ["RESEARCH", "RESEARCH_VALID", guard("enterInformed")],
  /*
   * X-2′ (PRDR-110): dry research is a finding — no external cause — and buys
   * the informed attempt carrying it, not a human. Eight of nine research
   * sessions on the certification gate were dry; each became a stop a person
   * cleared by requeueing with nothing new.
   */
  ["RESEARCH", "RESEARCH_DRY", guard("enterInformed")],
  ["RESEARCH", "UPSTREAM_BUG", to("BLOCKED")],

  ["IN_REVIEW", "REVIEW_APPROVE", to("APPROVED")],
  ["IN_REVIEW", "REVIEW_CHANGES", guard("reviewChanges")],

  ["APPROVED", "GATE_GREEN", to("DONE")],
  ["APPROVED", "GATE_RED", guard("resolveRed")],
  ["APPROVED", "RISK_LABEL_REQUIRED", to("NEEDS_HUMAN")],

  ["NEEDS_HUMAN", "HUMAN_APPROVED", to("APPROVED")],
  /* PRDR-112: a human stop the outage caused is not a human's to clear. */
  ["NEEDS_HUMAN", "OUTAGE_REQUEUE", to("READY")],

  /** PRDR-238: one row per state a human may restart the attempt from. */
  ...REQUEUEABLE.map((state) => [state, "HUMAN_REQUEUE", to("READY")] as readonly [State, Event, Row]),
];

function buildTable(): ReadonlyMap<string, Row> {
  const t = new Map<string, Row>();
  for (const [s, e, row] of rows) {
    const k = key(s, e);
    if (t.has(k)) throw new Error(`duplicate transition row: ${k}`);
    t.set(k, row);
  }
  /**
   * Two events are legal from every non-DONE state (X-3): BUDGET_BREACH, and
   * GATE_DRIFT (D-23) — the binding is under suspicion, so the ticket blocks
   * until `verify sync` re-baselines and a requeue reopens it (V-3).
   */
  for (const s of STATES) {
    if (TERMINAL_STATES.has(s)) continue;
    t.set(key(s, "BUDGET_BREACH"), to("NEEDS_HUMAN"));
    t.set(key(s, "GATE_DRIFT"), to("BLOCKED"));
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
      /* A falsified premise on a feature ticket is a plan-level flaw. */
      return { next: "NEEDS_HUMAN", counters };
    }
    return {
      next: counters.hypotheses > ctx.budgets.hypotheses ? "NEEDS_HUMAN" : "DIAGNOSED",
      counters,
    };
  },

  resolveRed: (c) => resolveRed(c),

  /**
   * X-1‴ (PRDR-108): review findings buy `review_fix_attempts` rounds, read
   * from the budgets rather than hard-wired to one. Six second-round stops on
   * the certification gate were each cleared by a requeue relaying the same
   * findings — a loop the machine can run itself.
   */
  reviewChanges: (c, ctx) =>
    c.review_fix_attempts < ctx.budgets.review_fix_attempts
      ? { next: "REVIEW_FIX", counters: countReviewFix(c) }
      : { next: "NEEDS_HUMAN", counters: c },

  /* X-1: the informed slot is consumed exactly on entry to its namesake state. */
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
