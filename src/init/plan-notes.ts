import type { PlanReview } from "../schemas/init.js";
import type { RevisionOutcome } from "./plan-signal.js";

/**
 * PRDR-260 — the operator-facing lines a plan review's measurements produce.
 *
 * Split out of `plan-slices.ts`, which reached its 300-line ceiling with this
 * text inline and has a different job: planning slices. Both emit sites for the
 * revision line live here together for the reason the ticket exists — the two
 * had drifted apart, the slice one printing a count that cannot move and the
 * whole-plan one printing the same count with no null available to it at all.
 * One module means the next change to either has to look at both.
 */

/**
 * PRDR-200's null as a RATE, over the pair count it was summed across.
 *
 * `sampleChurn` accumulates `revisionOutcome` over every ORDERED pair of reads
 * — k*(k-1), six at `PLAN_REVIEW_SAMPLES` = 3 — while a revision figure is ONE
 * before/after pair. The raw churn counts are six pairs' worth and are not on
 * the same scale as the revision beside them, which is why this renders a rate:
 * a rate is scale-free, so the pair count cancels out of it.
 *
 * PRDR-270: the rate still measures a different POPULATION. It is computed over
 * UNFILTERED reads, while the revision figure printed beside it is computed over
 * the sets that survived the ⌈k/2⌉ threshold. Filtering removes precisely the
 * findings that churn, so this number is the higher of the two baselines and is
 * not the one a filtered figure is read against. Measured on PRDR-269's s07:
 * this clause printed 60% where the filtered null for the same slice was 25%,
 * understating the revision it was there to qualify by 35 points. Saying which
 * population it measured is the fix; buying the second one costs a second panel
 * of k reads, which production does not pay for.
 */
export function nullNote(churn: RevisionOutcome | null, pairs: number): string {
  const seen = churn === null ? 0 : churn.resolved + churn.survived;
  if (churn === null || seen === 0 || pairs <= 0) return "no null was sampled";
  return (
    `null ${String(Math.round((churn.resolved / seen) * 100))}% resolution over ${String(pairs)} unrevised read pairs ` +
    `of UNFILTERED reads, so a filtered figure is not read against it (PRDR-270)`
  );
}

/**
 * PRDR-270: the introductions the set sizes forced, whatever the revision wrote.
 *
 * `revisionOutcome` defines `introduced = |after| - survived` with `survived <=
 * |before|`, so `introduced >= |after| - |before|`, and that difference is
 * `introduced - resolved`. A revision handed 4 findings whose review returned 10
 * prints `9 introduced` at best: six of the nine are the set growing, not
 * anything the revision did. PRDR-269's s07 is that case exactly, and the
 * section that read its 9 as the fix underperforming had no way to see the 6.
 */
export function forcedIntroductions(revision: RevisionOutcome): number {
  return Math.max(revision.introduced - revision.resolved, 0);
}

/**
 * The null itself, for the slice that measured it.
 *
 * Emitted for every slice a review judged — including the ones that approve and
 * therefore never revise, where the line's old wording promised "the null the
 * number below is read against" and there was no number below. It names the
 * pair count for the same reason `nullNote` renders a rate.
 */
export function churnLine(sliceId: string, churn: RevisionOutcome, pairs: number): string {
  return (
    `${sliceId} sample churn, nothing revised between the reads: ${String(churn.resolved)} resolved, ` +
    `${String(churn.survived)} survived, ${String(churn.introduced)} introduced over ${String(pairs)} ordered ` +
    `read pairs — the null a revision on this slice is read against (PRDR-200)`
  );
}

/**
 * What a revision round DID, on the line that reports what is left.
 *
 * The count alone is stationary by construction: `revisionOutcome` defines
 * `resolved = |before| - survived` and `introduced = |after| - survived`, so
 * `|after| = |before| - resolved + introduced`. A round that answered
 * everything it was handed and was handed as much again prints the number it
 * started with, and "9 → 9" reads as a round that did nothing. Both numbers
 * that tell the two cases apart were already computed; they were on other lines.
 */
export function remainLine(
  subject: string,
  remaining: number,
  revision: RevisionOutcome,
  nullClause: string,
  tags: string,
): string {
  /**
   * PRDR-270: both sizes, and the floor they force, on the line itself.
   *
   * `|before| = resolved + survived` and `|after| = survived + introduced` were
   * always inside the `RevisionOutcome` this is handed; the identity above says
   * what they mean and the line printed neither, so a forced `introduced` and an
   * earned one looked the same.
   */
  const handed = revision.resolved + revision.survived;
  const left = revision.survived + revision.introduced;
  const forced = forcedIntroductions(revision);
  const forcedClause =
    forced === 0 ? "" : `, ${String(forced)} of the ${String(revision.introduced)} forced by the set growing`;
  return (
    `${subject}: ${String(remaining)} finding(s) remain — ${String(handed)} handed, ${String(left)} left ` +
    `(${String(revision.resolved)} resolved, ${String(revision.introduced)} introduced${forcedClause}; ${nullClause}) — ${tags}`
  );
}

/**
 * C-4⁗″ (PRDR-197): the k and the threshold that produced the findings, so a
 * reader knows the verdict below is what recurred rather than what one draw
 * happened to say.
 */
export function sampleLine(sliceId: string, reads: number, threshold: number, recurring: number, once: number): string {
  return (
    `${sliceId} review: sampled ${String(reads)} launched together, keeping what ${String(threshold)} of ` +
    `${String(reads)} saw — ${String(recurring)} recurring, ${String(once)} seen once (C-4⁗″)`
  );
}

/**
 * PRDR-196: say what the round DID, not how many findings came back.
 *
 * A count answers neither of the two questions worth asking — did the revision
 * fix what it was handed, and did it create work that was not there. Kept
 * beside `remainLine`, which is the line that used to answer neither.
 */
export function revisionLine(sliceId: string, revision: RevisionOutcome): string {
  return (
    `${sliceId} revision: ${String(revision.resolved)} resolved, ${String(revision.survived)} survived, ` +
    `${String(revision.introduced)} introduced (PRDR-196)`
  );
}

/** What the sample agreed on, by tag — the work the revision round is handed. */
export function recurringLine(sliceId: string, findings: PlanReview["findings"]): string {
  return `${sliceId} review: ${String(findings.length)} recurring finding(s) — ${findings.map((f) => f.tag).join(", ")}`;
}
