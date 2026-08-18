import { z } from "zod";
import { budgetsSchema, type Budgets } from "../schemas/budgets.js";
import { SCHEMA_VERSION, glob, nonEmptyString } from "../schemas/common.js";
import type { State } from "../schemas/states.js";
import type { Counters } from "../schemas/ticket.js";
import { apply, legalEvents, TABLE, TransitionError, type Row } from "./machine.js";

/**
 * T-014 — worst-case session count, computed and never quoted (X-1).
 *
 * The figure is derived from the transition table and the budgets, so a table
 * edit that adds a recovery path raises it automatically. The configured net
 * `sessions` must exceed it, and a configuration that violates that is rejected
 * at load — before any run, per R-9 — rather than discovered mid-ticket.
 */

/** States whose entry launches a session. Entering one costs one launch. */
const SESSION_ENTRY_STATES: ReadonlySet<State> = new Set<State>([
  "DIAGNOSED",
  "IN_PROGRESS",
  "BLIND_FIX",
  "RESEARCH",
  "INFORMED_FIX",
  "REVIEW_FIX",
  "IN_REVIEW",
]);

const zeroCounters: Counters = {
  blind_fix_attempts: 0,
  informed_fix_attempts: 0,
  review_fix_attempts: 0,
  research_sessions: 0,
  hypotheses: 0,
  sessions: 0,
};

/**
 * Canonical node key. Every counter is clamped to one past its ceiling, because
 * any value above the ceiling routes identically — that makes the reachable
 * node set finite for *any* table, so termination is a property of this walk
 * rather than of the table happening to be acyclic.
 */
function stateKey(state: State, c: Counters, budgets: Budgets): string {
  const cap = (v: number, ceiling: number) => Math.min(v, ceiling + 1);
  return [
    state,
    cap(c.blind_fix_attempts, budgets.blind_fix_attempts),
    cap(c.informed_fix_attempts, budgets.informed_fix_attempts),
    cap(c.review_fix_attempts, budgets.review_fix_attempts),
    cap(c.research_sessions, budgets.research_sessions),
    cap(c.hypotheses, budgets.hypotheses),
  ].join(":");
}

/**
 * A table whose reachable subgraph contains a cycle through a session-entry
 * state has no finite worst case: the ticket could launch sessions forever.
 * That is a table defect, and X-1's whole point is that it surfaces here rather
 * than as a runaway run — so it is reported, never silently truncated.
 */
export class UnboundedWorstCaseError extends Error {
  constructor(readonly cycle: readonly string[]) {
    super(
      `transition table admits an unbounded session count: the cycle ${cycle.join(" -> ")} ` +
        `re-enters a session-launching state without consuming a budget.`,
    );
    this.name = "UnboundedWorstCaseError";
  }
}

/**
 * Longest launch-count path through the machine, over all reachable
 * (state, counters) configurations. The counter tuple is bounded by the
 * budgets, so the graph is finite and the walk terminates; `seen` guards the
 * cycles the table legitimately contains (e.g. DIAGNOSED recycling).
 */
export function maxPossibleSessions(
  budgets: Budgets,
  opts: { readonly ticketType?: "feature" | "bug"; readonly table?: ReadonlyMap<string, Row> } = {},
): number {
  const ticketType = opts.ticketType ?? "bug";
  const table = opts.table ?? TABLE;
  const memo = new Map<string, number>();

  function walk(state: State, counters: Counters, onPath: ReadonlyMap<string, number>, depth: number): number {
    if (state === "DONE") return 0;
    const k = stateKey(state, counters, budgets);
    const seenAt = onPath.get(k);
    if (seenAt !== undefined) {
      // Revisiting a node with no launch in between is a benign no-op loop;
      // revisiting it *after* launching is an unbounded cycle.
      if (depth > seenAt) throw new UnboundedWorstCaseError([...onPath.keys()].slice(seenAt).concat(k));
      return 0;
    }
    const cached = memo.get(k);
    if (cached !== undefined) return cached;

    const nextOnPath = new Map(onPath).set(k, depth);
    let best = 0;
    for (const event of legalEvents(state, table)) {
      // A human re-entry opens a new generation with zeroed counters (X-8);
      // the per-generation worst case does not traverse it.
      if (event === "HUMAN_REQUEUE" || event === "HUMAN_APPROVED") continue;
      // BUDGET_BREACH and GATE_DRIFT are halts, never the worst path.
      if (event === "BUDGET_BREACH" || event === "GATE_DRIFT") continue;
      let result;
      try {
        result = apply(state, event, counters, { ticket: { type: ticketType }, budgets }, table);
      } catch (err) {
        if (err instanceof TransitionError) continue;
        continue; // slot already consumed: this edge is unreachable here
      }
      const cost = SESSION_ENTRY_STATES.has(result.to) ? 1 : 0;
      best = Math.max(best, cost + walk(result.to, result.counters, nextOnPath, depth + cost));
    }
    memo.set(k, best);
    return best;
  }

  // A run begins by claiming a READY ticket; the claim itself launches nothing.
  return walk("READY", zeroCounters, new Map<string, number>(), 0);
}

export const configSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  budgets: budgetsSchema,
  protected: z.array(glob).default([]),
  risk: z.array(glob).default([]),
  model_routing: z.record(z.string(), nonEmptyString).default({}),
  pinned: z.strictObject({
    agent_sdk: nonEmptyString,
    claude_code: nonEmptyString,
  }),
  /**
   * S-1: sessions are constructed with no external setting sources. Recorded in
   * config so `doctor` can report it and a backend upgrade cannot silently
   * re-enable project-scope policy from the repository under work (PRDR-051).
   */
  setting_sources: z.array(z.never()).default([]),
});
export type Config = z.infer<typeof configSchema>;

export class ConfigRejectedError extends Error {
  constructor(
    readonly net: number,
    readonly computed: number,
  ) {
    super(
      `config rejected: budgets.sessions is ${net}, but the worst path through the transition table needs ${computed}. ` +
        `The net session budget must exceed the computed worst case (X-1); raise sessions above ${computed}.`,
    );
    this.name = "ConfigRejectedError";
  }
}

export interface LoadedConfig {
  readonly config: Config;
  readonly computedWorstCase: number;
}

/**
 * R-9: parse, compute, assert, return. The CLI never sees an invalid config
 * object, so no caller can start a run against budgets that cannot complete.
 */
export function loadConfig(raw: unknown): LoadedConfig {
  const config = configSchema.parse(raw);
  const computed = maxPossibleSessions(config.budgets);
  if (config.budgets.sessions <= computed) {
    throw new ConfigRejectedError(config.budgets.sessions, computed);
  }
  return { config, computedWorstCase: computed };
}
