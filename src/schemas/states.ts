/**
 * Execution vocabulary (PRD §7).
 *
 * States and events live here rather than in the kernel because they are part
 * of the persisted artifact vocabulary: A-1 tickets carry a state, and every
 * `transitions.jsonl` line carries a from/event/to triple. The kernel imports
 * them; the schemas do not import the kernel.
 */

export const STATES = [
  "READY",
  "DIAGNOSED",
  "IN_PROGRESS",
  "BLIND_FIX",
  "RESEARCH",
  "INFORMED_FIX",
  "REVIEW_FIX",
  "IN_REVIEW",
  "APPROVED",
  "DONE",
  "BLOCKED",
  "NEEDS_HUMAN",
] as const;

export type State = (typeof STATES)[number];

export const EVENTS = [
  "CLAIMED",
  "REPRO_AS_PREDICTED",
  "REPRO_WRONG",
  "PREMISE_FALSIFIED",
  "GATE_GREEN",
  "GATE_RED",
  "RESEARCH_VALID",
  "RESEARCH_DRY",
  "UPSTREAM_BUG",
  "REVIEW_APPROVE",
  "REVIEW_CHANGES",
  "RISK_LABEL_REQUIRED",
  "HUMAN_APPROVED",
  "HUMAN_REQUEUE",
  "BUDGET_BREACH",
] as const;

export type Event = (typeof EVENTS)[number];

/** DONE is the only terminal state; BUDGET_BREACH is legal from every other (X-3). */
export const TERMINAL_STATES: ReadonlySet<State> = new Set<State>(["DONE"]);

/**
 * Writing states whose red gate routes through the ladder resolver (X-2/D-13).
 * `INFORMED_FIX` is deliberately absent: its red gate is a direct table edge to
 * NEEDS_HUMAN, so the ladder cannot reopen after the informed attempt.
 */
export const RESOLVER_CALLER_STATES = [
  "IN_PROGRESS",
  "BLIND_FIX",
  "REVIEW_FIX",
  "APPROVED",
] as const satisfies readonly State[];

export type ResolverCallerState = (typeof RESOLVER_CALLER_STATES)[number];
