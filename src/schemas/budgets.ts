import { z } from "zod";

/**
 * X-1 budgets. Every ceiling is a named key so that the set a config-load
 * validator must accept is enumerable from the schema alone (PRDR-043).
 *
 * Scope is normative and differs per counter: most are per ticket per
 * generation, `turns_per_stage` is per session, and `run_spend_usd` is the
 * only run-scoped ceiling — the cross-generation financial backstop of X-8.
 */
export const BUDGET_SCOPES = ["ticket/generation", "session", "research-session", "init", "red-gate", "run"] as const;
export type BudgetScope = (typeof BUDGET_SCOPES)[number];

/**
 * The breach target a ceiling declares. Most emit BUDGET_BREACH, but three do
 * not, and encoding that here keeps T-012's coverage test honest (PRDR-043).
 */
export const BREACH_TARGETS = [
  "BUDGET_BREACH",
  "RESEARCH_DRY",
  "AWAIT_INFO_BATCH",
  "LADDER_ENTRY",
] as const;
export type BreachTarget = (typeof BREACH_TARGETS)[number];

export interface CeilingSpec {
  readonly scope: BudgetScope;
  readonly breachTarget: BreachTarget;
  /** Absent where the PRD deliberately declines to set one (`run_spend_usd`). */
  readonly default?: number;
}

/** The complete X-1 table, as data. */
export const CEILINGS = {
  blind_fix_attempts: { scope: "ticket/generation", breachTarget: "BUDGET_BREACH", default: 1 },
  informed_fix_attempts: { scope: "ticket/generation", breachTarget: "BUDGET_BREACH", default: 1 },
  review_fix_attempts: { scope: "ticket/generation", breachTarget: "BUDGET_BREACH", default: 1 },
  research_sessions: { scope: "ticket/generation", breachTarget: "BUDGET_BREACH", default: 1 },
  hypotheses: { scope: "ticket/generation", breachTarget: "BUDGET_BREACH", default: 2 },
  sessions: { scope: "ticket/generation", breachTarget: "BUDGET_BREACH", default: 14 },
  ticket_wall_clock_ms: { scope: "ticket/generation", breachTarget: "BUDGET_BREACH", default: 3_600_000 },
  turns_per_stage: { scope: "session", breachTarget: "BUDGET_BREACH", default: 30 },
  failure_research_tool_calls: { scope: "research-session", breachTarget: "RESEARCH_DRY", default: 8 },
  planning_research_tool_calls: { scope: "init", breachTarget: "AWAIT_INFO_BATCH", default: 16 },
  flake_reruns: { scope: "red-gate", breachTarget: "LADDER_ENTRY", default: 1 },
  run_spend_usd: { scope: "run", breachTarget: "BUDGET_BREACH" },
} as const satisfies Record<string, CeilingSpec>;

export type CeilingKey = keyof typeof CEILINGS;

export const CEILING_KEYS = Object.keys(CEILINGS) as readonly CeilingKey[];

/**
 * `run_spend_usd` has no default: X-1 states there is no defensible universal
 * figure, so `init` must write one explicitly and config load refuses a budgets
 * object that omits it.
 */
const withDefault = (key: Exclude<CeilingKey, "run_spend_usd">) =>
  z.number().positive().default(CEILINGS[key].default);

export const budgetsSchema = z
  .strictObject({
    blind_fix_attempts: withDefault("blind_fix_attempts"),
    informed_fix_attempts: withDefault("informed_fix_attempts"),
    review_fix_attempts: withDefault("review_fix_attempts"),
    research_sessions: withDefault("research_sessions"),
    hypotheses: withDefault("hypotheses"),
    sessions: withDefault("sessions"),
    ticket_wall_clock_ms: withDefault("ticket_wall_clock_ms"),
    turns_per_stage: withDefault("turns_per_stage"),
    failure_research_tool_calls: withDefault("failure_research_tool_calls"),
    planning_research_tool_calls: withDefault("planning_research_tool_calls"),
    flake_reruns: withDefault("flake_reruns"),
    // No default by design (X-1): `init` writes an explicit figure.
    run_spend_usd: z.number().positive(),
  })
  .describe("X-1 ceilings");

export type Budgets = Record<CeilingKey, number>;
