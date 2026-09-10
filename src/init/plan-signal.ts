import { findingKey } from "./plan-review.js";
import type { PlanReview } from "../schemas/init.js";

/**
 * What a revision round DID, and what the same arithmetic says when nothing
 * was revised at all.
 *
 * Split out of `plan-slices.ts` under AGENTS.md's rule to divide by
 * responsibility at the ceiling rather than mechanically. That file answers
 * "how is a slice planned, reviewed and cached"; this one answers the question
 * PRDR-196 opened and PRDR-200 finished — whether the numbers we print about
 * the revision are about the revision. `tests/init/plan-signal.test.ts` was
 * named for this concern before the module existed.
 */

/**
 * PRDR-196: what one revision round actually did.
 *
 * The counts this run produced — more findings after revision than before, on
 * 11 slices of 19 — cannot distinguish "the revision introduced defects" from
 * "a fresh review of rewritten text found fresh, partly spurious things". The
 * literature names feedback generation as the bottleneck, which makes that
 * distinction the whole question, and no number Detent records today answers
 * it.
 *
 * Identity is `(ticket, tag)`. Finding TEXT is rewritten every round so it can
 * key nothing, and the pair is what a reader means by "the same complaint about
 * the same ticket". A finding naming no ticket belongs to the plan rather than
 * to one of its tickets and cannot be matched, so it is never counted as
 * survival — an unmatched pair is honestly unknown, not silently resolved.
 */
export interface RevisionOutcome {
  /** Complaints that were made and are no longer made. */
  readonly resolved: number;
  /** Complaints the revision was handed and did not remove. */
  readonly survived: number;
  /** Complaints that did not exist before the round. */
  readonly introduced: number;
}

export function revisionOutcome(
  before: PlanReview["findings"],
  after: PlanReview["findings"],
): RevisionOutcome {
  const keysBefore = new Set(before.map(findingKey).filter((k): k is string => k !== null));
  const keysAfter = new Set(after.map(findingKey).filter((k): k is string => k !== null));
  let survived = 0;
  for (const k of keysBefore) if (keysAfter.has(k)) survived += 1;
  return {
    resolved: keysBefore.size - survived,
    survived,
    introduced: keysAfter.size - survived,
  };
}

/**
 * C-4⁗″ (PRDR-200): the null, and it costs nothing.
 *
 * The samples were bought for the filter. Their pairwise disagreement is
 * exactly what `revisionOutcome` returns when NOTHING was revised, so every
 * slice can now record the reading its own revision number has to be read
 * against. Measured over three slices this came back at c 0.583 / γ 0.333
 * against a production 0.714 / 0.533 — most of what the revision appeared to
 * do, the reviewer did to itself.
 */
export function sampleChurn(reads: readonly PlanReview["findings"][]): RevisionOutcome {
  let resolved = 0;
  let survived = 0;
  let introduced = 0;
  for (let i = 0; i < reads.length; i += 1) {
    for (let j = 0; j < reads.length; j += 1) {
      const a = reads[i];
      const b = reads[j];
      if (i === j || a === undefined || b === undefined) continue;
      const o = revisionOutcome(a, b);
      resolved += o.resolved;
      survived += o.survived;
      introduced += o.introduced;
    }
  }
  return { resolved, survived, introduced };
}
