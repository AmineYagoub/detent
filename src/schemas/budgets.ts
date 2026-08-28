import { z } from "zod";

/**
 * X-1 budgets. Every ceiling is a named key so that the set a config-load
 * validator must accept is enumerable from the schema alone (PRDR-043).
 *
 * Scope is normative and differs per counter: most are per ticket per
 * generation, `turns_per_stage` is per session, and `run_spend_usd` is the
 * only run-scoped ceiling — the cross-generation financial backstop of X-8.
 */
type BudgetScope =
  | "ticket/generation"
  | "session"
  | "research-session"
  | "init"
  | "red-gate"
  | "gate-execution"
  | "binding-probe"
  | "run";

/**
 * The breach target a ceiling declares. Most emit BUDGET_BREACH, but three do
 * not, and encoding that here keeps T-012's coverage test honest (PRDR-043).
 */
export type BreachTarget =
  | "BUDGET_BREACH"
  | "RESEARCH_DRY"
  | "AWAIT_INFO_BATCH"
  | "LADDER_ENTRY"
  | "RED_GATE_NO_EXIT"
  | "REJECTED_CANDIDATE";

export interface CeilingSpec {
  readonly scope: BudgetScope;
  readonly breachTarget: BreachTarget;
  /** Every ceiling carries one (X-1′, PRDR-083). */
  readonly default: number;
}

/** The complete X-1 table, as data. */
export const CEILINGS = {
  blind_fix_attempts: { scope: "ticket/generation", breachTarget: "BUDGET_BREACH", default: 1 },
  informed_fix_attempts: { scope: "ticket/generation", breachTarget: "BUDGET_BREACH", default: 1 },
  review_fix_attempts: { scope: "ticket/generation", breachTarget: "BUDGET_BREACH", default: 1 },
  research_sessions: { scope: "ticket/generation", breachTarget: "BUDGET_BREACH", default: 1 },
  hypotheses: { scope: "ticket/generation", breachTarget: "BUDGET_BREACH", default: 2 },
  sessions: { scope: "ticket/generation", breachTarget: "BUDGET_BREACH", default: 18 },
  ticket_wall_clock_ms: { scope: "ticket/generation", breachTarget: "BUDGET_BREACH", default: 3_600_000 },
  turns_per_stage: { scope: "session", breachTarget: "BUDGET_BREACH", default: 30 },
  failure_research_tool_calls: { scope: "research-session", breachTarget: "RESEARCH_DRY", default: 8 },
  planning_research_tool_calls: { scope: "init", breachTarget: "AWAIT_INFO_BATCH", default: 16 },
  flake_reruns: { scope: "red-gate", breachTarget: "LADDER_ENTRY", default: 1 },
  gate_timeout_ms: { scope: "gate-execution", breachTarget: "RED_GATE_NO_EXIT", default: 900_000 },
  binding_probe_timeout_ms: { scope: "binding-probe", breachTarget: "REJECTED_CANDIDATE", default: 120_000 },
  run_spend_usd: { scope: "run", breachTarget: "BUDGET_BREACH", default: 100 },
} as const satisfies Record<string, CeilingSpec>;

export type CeilingKey = keyof typeof CEILINGS;

export const CEILING_KEYS = Object.keys(CEILINGS) as readonly CeilingKey[];

/**
 * D-24: the three ladder ceilings are structural, not tunable. X-2 compares
 * each slot against zero, so a configured value other than 1 would be accepted,
 * displayed, and ignored — the failure mode P6 exists to prevent. Config load
 * refuses any value but 1, naming the key.
 */
export const LADDER_CEILING_KEYS = ["blind_fix_attempts", "informed_fix_attempts", "research_sessions"] as const;

const structural = (key: (typeof LADDER_CEILING_KEYS)[number]) =>
  z
    .literal(1, { error: `D-24: ${key} is structural, fixed at 1 — the ladder's shape is not configurable` })
    .default(1);

/**
 * X-1′ (PRDR-083): `run_spend_usd` now carries a default like every other
 * ceiling. The old "no defensible universal figure" rule made the FIRST init
 * of every project a required spend decision — and on subscription auth the
 * figure is a client-side ESTIMATE against quota (PRDR-052), not a bill, so
 * the decision bought friction rather than protection. The ceiling itself is
 * unchanged and still routes to a human (P6); only the upfront demand is gone,
 * and `init` announces the figure it wrote.
 */
const withDefault = (key: CeilingKey) => z.number().positive().default(CEILINGS[key].default);

export const budgetsSchema = z
  .strictObject({
    blind_fix_attempts: structural("blind_fix_attempts"),
    informed_fix_attempts: structural("informed_fix_attempts"),
    review_fix_attempts: withDefault("review_fix_attempts"),
    research_sessions: structural("research_sessions"),
    hypotheses: withDefault("hypotheses"),
    sessions: withDefault("sessions"),
    ticket_wall_clock_ms: withDefault("ticket_wall_clock_ms"),
    turns_per_stage: withDefault("turns_per_stage"),
    failure_research_tool_calls: withDefault("failure_research_tool_calls"),
    planning_research_tool_calls: withDefault("planning_research_tool_calls"),
    flake_reruns: withDefault("flake_reruns"),
    gate_timeout_ms: withDefault("gate_timeout_ms"),
    binding_probe_timeout_ms: withDefault("binding_probe_timeout_ms"),
    run_spend_usd: withDefault("run_spend_usd"),
  })
  .describe("X-1 ceilings");

export type Budgets = Record<CeilingKey, number>;
