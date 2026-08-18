import {
  CEILINGS,
  CEILING_KEYS,
  type BreachTarget,
  type CeilingKey,
} from "../schemas/budgets.js";
import type { Counters } from "../schemas/ticket.js";

/**
 * T-012 — unit budgets and counters (X-1, D-12).
 *
 * Fix capacity is three independent unit budgets, each consumed exactly on
 * entry to its namesake state. The safety property is "each slot at most
 * once", which is testable per slot rather than as a property of a shared
 * pool — that is the whole point of D-12's split.
 */

/** The three ladder slots of D-12, plus research. Consumed on state entry. */
export const UNIT_SLOTS = [
  "blind_fix_attempts",
  "informed_fix_attempts",
  "review_fix_attempts",
  "research_sessions",
] as const;
export type UnitSlot = (typeof UNIT_SLOTS)[number];

/**
 * Which module enforces each ceiling. Every X-1 key must appear: a ceiling with
 * no enforcer is a budget that routes nowhere, which P6 forbids. T-012's
 * coverage test asserts this map is total over CEILING_KEYS.
 */
export const ENFORCEMENT_SITES = {
  blind_fix_attempts: "kernel/resolver",
  informed_fix_attempts: "kernel/resolver",
  review_fix_attempts: "kernel/machine",
  research_sessions: "kernel/resolver",
  hypotheses: "kernel/machine",
  sessions: "kernel/run",
  ticket_wall_clock_ms: "kernel/run",
  turns_per_stage: "sessions/sdk",
  failure_research_tool_calls: "kernel/stages/research",
  planning_research_tool_calls: "init/plan-research",
  flake_reruns: "kernel/flake",
  gate_timeout_ms: "adapter/run",
  binding_probe_timeout_ms: "adapter/bind",
  run_spend_usd: "kernel/ledger",
} as const satisfies Record<CeilingKey, string>;

export function breachTargetFor(key: CeilingKey): BreachTarget {
  return CEILINGS[key].breachTarget;
}

/** A slot is available only while its counter is zero (D-12: at most once). */
export function slotAvailable(counters: Counters, slot: UnitSlot): boolean {
  return counters[slot] === 0;
}

export class SlotExhaustedError extends Error {
  constructor(readonly slot: UnitSlot) {
    super(`unit slot already consumed: ${slot}`);
    this.name = "SlotExhaustedError";
  }
}

/**
 * Consume a unit slot. Returns fresh counters; never mutates its input, so a
 * caller cannot half-apply a transition.
 */
export function consumeSlot(counters: Counters, slot: UnitSlot): Counters {
  if (!slotAvailable(counters, slot)) throw new SlotExhaustedError(slot);
  return { ...counters, [slot]: counters[slot] + 1 };
}

/** A launched session, counted against the per-generation net ceiling. */
export function countSession(counters: Counters): Counters {
  return { ...counters, sessions: counters.sessions + 1 };
}

export function countHypothesis(counters: Counters): Counters {
  return { ...counters, hypotheses: counters.hypotheses + 1 };
}

export const ALL_CEILING_KEYS = CEILING_KEYS;
