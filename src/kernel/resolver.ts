import type { Counters } from "../schemas/ticket.js";
import type { State } from "../schemas/states.js";
import { consumeSlot } from "./budgets.js";

/**
 * T-013 — the ladder resolver (X-2, D-13).
 *
 * The single routing function for red gates arising from implementation and
 * test failures. Its caller set is closed and property-tested: IN_PROGRESS,
 * BLIND_FIX, REVIEW_FIX, and the APPROVED close-check. It is never invoked for
 * review verdicts (REVIEW_CHANGES is a judgment, not a red gate) and never from
 * INFORMED_FIX, whose red gate is a direct table edge to NEEDS_HUMAN.
 *
 * "No second blind fix" and "no ladder after the informed fix" are properties
 * of this function, not of its callers.
 *
 * Note the signature takes only counters, matching X-2's pseudocode. The
 * ladder slots are compared against zero, not against the configured
 * ceilings — see the audit note on X-1/X-2 divergence.
 */
export interface ResolveOutcome {
  readonly next: State;
  readonly counters: Counters;
}

export function resolveRed(counters: Counters): ResolveOutcome {
  if (counters.blind_fix_attempts === 0) {
    return { next: "BLIND_FIX", counters: consumeSlot(counters, "blind_fix_attempts") };
  }
  if (counters.research_sessions === 0) {
    return { next: "RESEARCH", counters: consumeSlot(counters, "research_sessions") };
  }
  if (counters.informed_fix_attempts === 0) {
    return { next: "INFORMED_FIX", counters: consumeSlot(counters, "informed_fix_attempts") };
  }
  return { next: "NEEDS_HUMAN", counters };
}
