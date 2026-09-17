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

/**
 * D-12's at-most-once slots: the two fix rungs plus research, each consumed
 * on state entry. `review_fix_attempts` left this set under X-1‴ (PRDR-108):
 * it counts rounds against its configured ceiling instead.
 */
export const UNIT_SLOTS = [
  "blind_fix_attempts",
  "informed_fix_attempts",
  "research_sessions",
] as const;
export type UnitSlot = (typeof UNIT_SLOTS)[number];

/**
 * Which module is ACCOUNTABLE for each ceiling: the one that reads the key and
 * either sequences on it or reports it. Every X-1 key must appear, and T-012's
 * coverage test asserts this map is total over CEILING_KEYS.
 *
 * It used to say "enforces", and that every key must have an enforcer "because
 * a ceiling with no enforcer is a budget that routes nowhere, which P6
 * forbids". Seven keys break that rule deliberately — `turns_per_stage`
 * (PRDR-106), `run_spend_usd` (PRDR-191) and the five PRDR-265 converted —
 * and the P6 oracle names every one of them in an explicit skip list rather
 * than leaving the exemption implied. What P6 is actually worth is unchanged:
 * a key nothing reads is a ceiling an operator can tune with no effect, and
 * the grep still catches that whether the read halts or only counts.
 */
export const ENFORCEMENT_SITES = {
  blind_fix_attempts: "kernel/resolver",
  informed_fix_attempts: "kernel/resolver",
  review_fix_attempts: "kernel/machine",
  research_sessions: "kernel/resolver",
  hypotheses: "kernel/machine",
  sessions: "kernel/referee-session",
  /**
   * X-1 (PRDR-246): `kernel/ticket-clock`, not `kernel/referee-session`. The
   * launch seam was the only caller until `evaluate` needed the same check, and
   * naming the arm rather than the computation is what let the `gate` tool run
   * past this ceiling while the map still read as satisfied.
   */
  ticket_wall_clock_ms: "kernel/ticket-clock",
  /** X-1⁵ (PRDR-191): both are read where the launch gate stands. */
  spend_without_progress_floor_usd: "kernel/ledger",
  spend_without_progress_multiple: "kernel/ledger",
  spend_without_progress_sessions: "kernel/ledger",
  /** X-1″ (PRDR-106): advisory — read by the planner as `session_budget`, enforced nowhere. */
  turns_per_stage: "init/plan-review",
  /**
   * X-1 (PRDR-250): `kernel/stages/research`, which reads the observed turn
   * count back and routes RESEARCH_DRY past the ceiling. It said
   * `kernel/referee-stage`, which only forwarded the number to a prompt — and
   * the oracle behind this map greps the named module for the key with comments
   * stripped, so forwarding a value satisfied it exactly as bounding one would.
   */
  failure_research_tool_calls: "kernel/stages/research",
  /**
   * PRDR-179: `init/pipeline`, not `init/plan-research`.
   *
   * `plan-research.ts` is HANDED a `budget` number and only names the ceiling
   * in a doc comment and a log message — the same posture PRDR-172 declared
   * disqualifying for `kernel/ledger`. `pipeline.ts` is where
   * `budgets.planning_research_tool_calls` is read and passed in, so it is the
   * site whose drift would break enforcement. Found once the parity test
   * stopped letting a log string vouch for code.
   */
  planning_research_tool_calls: "init/pipeline",
  flake_reruns: "kernel/flake",
  gate_timeout_ms: "adapter/run",
  binding_probe_timeout_ms: "adapter/bind",
  /**
   * PRDR-172: `kernel/referee-context`, not `kernel/ledger`.
   *
   * `SpendLedger` performs the check (`spent >= this.ceiling`) but is HANDED a
   * number and never names the ceiling — the only occurrence of
   * `run_spend_usd` in that file is prose. `referee-context` is where
   * `budgets.run_spend_usd` is actually read and passed in, so it is the site
   * whose drift would break enforcement. The parity test only noticed once it
   * stopped letting comments vouch for code.
   */
  run_spend_usd: "kernel/referee-context",
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

/** X-1‴ (PRDR-108): a review-fix round is counted here and compared in the guard. */
export function countReviewFix(counters: Counters): Counters {
  return { ...counters, review_fix_attempts: counters.review_fix_attempts + 1 };
}

export function countHypothesis(counters: Counters): Counters {
  return { ...counters, hypotheses: counters.hypotheses + 1 };
}

export const ALL_CEILING_KEYS = CEILING_KEYS;
