import { findingKey } from "./plan-review.js";
import type { HeldFinding, PlanReview } from "../schemas/init.js";
import type { SampledReview } from "./plan-sample.js";

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

/**
 * PRDR-272 (D-32): the two review panels, kept apart.
 *
 * The pre-revision panel read the draft the revision replaced; the
 * post-revision panel read what is on disk. Their `seen` maps count different
 * populations, so they are carried as two fields rather than merged into one —
 * which is PRDR-270's finding about the revision's own numbers, one layer down.
 */
export interface PanelCounts {
  readonly before?: ReadonlyMap<string, number>;
  readonly after?: ReadonlyMap<string, number>;
}

/** What `labelHeld` attaches to one finding: the label's own count, and both panels'. */
interface Counts {
  readonly seen?: number;
  readonly seen_before?: number;
  readonly seen_after?: number;
}

/**
 * PRDR-269 (D-25): which of the two things a held finding is.
 *
 * `plan-slices.ts` labelled every finding of the post-revision review
 * `after-revision`, whose doc-block claims it "survived a revision that was
 * paid to remove it". Across three live arms on one slice — one round, two
 * resampled rounds, two iterated rounds — `revisionOutcome` reported survived
 * 0, 0, 0 against introduced 7, 7, 8. The population the human met was the
 * `introduced` bucket under a name asserting the opposite, and PRDR-267 sorted
 * it to the top for being the stronger signal.
 *
 * Identity is `revisionOutcome`'s: the `(ticket, tag)` pair, same `findingKey`,
 * so the labels and the counts cannot disagree about one finding. A finding
 * naming no ticket has no identity across reads and is never called a survivor
 * — unmatched is honestly unknown, which is exactly the stance `revisionOutcome`
 * takes when it declines to count it as survival.
 */
export function labelHeld(
  handed: PlanReview["findings"],
  leftover: PlanReview["findings"],
  seenOnce: PlanReview["findings"],
  counts?: PanelCounts,
): HeldFinding[] {
  const keys = new Set(handed.map(findingKey).filter((k): k is string => k !== null));
  const survived = (f: PlanReview["findings"][number]): boolean => {
    const key = findingKey(f);
    return key !== null && keys.has(key);
  };
  /**
   * PRDR-271: the read count travels with the label. PRDR-272 (D-32): from the
   * panel that label describes.
   *
   * `sampleReviewPlan` counts how many of the k reads returned each key and, on
   * HEAD, spent that integer on one `>= threshold` comparison. A finding every
   * read agreed on and one that scraped past ⌈k/2⌉ reached the human — and would
   * reach the run phase — indistinguishable.
   *
   * The panels read DIFFERENT drafts, so `seen` is whichever panel the label
   * came from — the post-revision one where it counted the finding, the
   * pre-revision one otherwise. That single rule covers both populations
   * because `plan-slices` takes `leftover` from the post panel's own
   * at-or-above-threshold partition (`after.findings`), so a `leftover` finding
   * always has a post count and never reaches the fallback; a `seen-once`
   * finding reaches it exactly when only the pre panel saw it, which is the
   * panel it fell below the threshold in. `seen_before` and `seen_after` carry
   * both, so the crossing that made this ambiguous is visible instead of merged
   * away. A finding naming no ticket has no key, so it has no count and every
   * field stays absent rather than guessing 1.
   */
  const counted = (f: PlanReview["findings"][number]): Counts => {
    const key = findingKey(f);
    if (key === null) return {};
    const b = counts?.before?.get(key);
    const a = counts?.after?.get(key);
    const own = a ?? b;
    return {
      ...(own === undefined ? {} : { seen: own }),
      ...(b === undefined ? {} : { seen_before: b }),
      ...(a === undefined ? {} : { seen_after: a }),
    };
  };
  /**
   * PRDR-272 (D-32): a finding the revision's own panel holds is not ALSO
   * reported as having fallen below the filter.
   *
   * `heldFindings` unions the two panels' sub-threshold lists, so a finding
   * seen once before the revision and twice after appeared in `seenOnce` AND in
   * `leftover` — emitted twice, under labels asserting opposite things about
   * the same `(ticket, tag)`. Live in run 6's s08, `t-s08-005 dependency` was
   * both `introduced` and `seen-once`. The draft on disk decides: if the
   * post-revision panel held it, the pre panel's weaker read of a draft that no
   * longer exists is not a second finding.
   */
  const held = new Set(leftover.map(findingKey).filter((k): k is string => k !== null));
  const fresh = (f: PlanReview["findings"][number]): boolean => {
    const key = findingKey(f);
    if (key === null) return true;
    if (held.has(key)) return false;
    held.add(key);
    return true;
  };
  return [
    ...leftover.map((f) => ({ ...f, ...counted(f), held: survived(f) ? ("after-revision" as const) : ("introduced" as const) })),
    ...seenOnce.filter(fresh).map((f) => ({ ...f, ...counted(f), held: "seen-once" as const })),
  ];
}

/**
 * PRDR-271: the held list for one round, from that round's samples.
 *
 * BOTH reviews are sampled, so both contribute the reads that fell below the
 * ⌈k/2⌉ threshold and both counted their keys. Flattening that is this module's
 * business rather than the caller's — `plan-slices` reached into four fields
 * across two sample objects to do it by hand, which is how the count came to be
 * assembled in one place and read in another.
 *
 * PRDR-272 (D-32) took the merge out. The panels stay named: `labelHeld` asks
 * each finding's own panel for its count and reports both, so no finding again
 * takes its label from one draft and its integer from the other. The two
 * sub-threshold lists are still concatenated, because a finding only the pre
 * panel saw is real judgement about a ticket that still exists — but a key the
 * post panel HELD is dropped from them, since the draft on disk settles it.
 */
export function heldFindings(
  handed: PlanReview["findings"],
  leftover: PlanReview["findings"],
  before?: SampledReview | null,
  after?: SampledReview | null,
): HeldFinding[] {
  return labelHeld(handed, leftover, [...(before?.seenOnce ?? []), ...(after?.seenOnce ?? [])], {
    ...(before?.seen === undefined ? {} : { before: before.seen }),
    ...(after?.seen === undefined ? {} : { after: after.seen }),
  });
}
