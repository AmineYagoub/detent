import type { PlanDraftTicket, PlanReview } from "../schemas/init.js";
import { newLaunchBatch } from "./launch-batch.js";
import { findingKey, PLAN_REVIEW_SAMPLES, reviewPlan, type ReviewDeps, type ReviewScope } from "./plan-review.js";

/**
 * C-4⁗″ / C-4⁗‴ — the SAMPLED review: `k` draws of `reviewPlan`, launched
 * together, and the threshold that decides what a revision is paid to chase.
 *
 * Split from `plan-review.ts` at its line ceiling (PRDR-204). That file is one
 * review — launch, parse, the C-4⁗ relaunch; this one is what PLAN does with
 * several of them.
 */

/**
 * C-4⁗‴ (PRDR-204): how long the rest of a batch waits for the first draw to
 * answer its first turn before launching anyway. The wait exists so the first
 * draw writes the cache the others read (S-6); a first answer that takes longer
 * than this has already failed that purpose, and waiting on would only delay.
 */
export const FIRST_RESPONSE_WAIT_MS = 60_000;

export interface SampledReview {
  readonly verdict: "approve" | "changes";
  /** At or above the threshold — the only findings a revision is paid to chase. */
  readonly findings: PlanReview["findings"];
  /** Below it. Real judgement, unreproduced: D-24's advice, carried to PRESENT. */
  readonly seenOnce: PlanReview["findings"];
  /** Every usable read, in LAUNCH order, so the caller can measure what the reads agreed on. */
  readonly reads: readonly PlanReview["findings"][];
  readonly threshold: number;
}

/** Real time, unref'd: a wait the race has already won must not hold the process open. */
const unrefSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref();
  });

/**
 * C-4⁗″: draw the review `k` times and keep what at least ⌈k/2⌉ reads saw.
 *
 * Degenerate by design at one usable read — ⌈1/2⌉ is 1, so a slice whose other
 * reads all died falls back to exactly PRDR-084's behaviour rather than
 * planning unreviewed.
 *
 * C-4⁗‴ (PRDR-204): the draws launch TOGETHER — the same three sessions, in
 * the time of the slowest — as one batch gated once (D-28′). They share one
 * first turn: same prefix (S-6), same tickets, same scope. Launched all at
 * once, each would write the cache the first could have written for the
 * others, so the rest wait for the first to answer, or to return without
 * answering, or for the bounded wait, whichever comes first. Reads come back
 * in launch order whatever order the draws finish in, so the `churn` C-8
 * caches and the findings the reviser is handed are the same across runs.
 */
export async function sampleReviewPlan(
  deps: ReviewDeps,
  tickets: readonly PlanDraftTicket[],
  scope?: ReviewScope,
  k: number = PLAN_REVIEW_SAMPLES,
): Promise<SampledReview | null> {
  const batch = newLaunchBatch();
  const draw = (i: number): Promise<PlanReview | null> => reviewPlan(deps, tickets, scope, { index: i + 1, batch });
  const first = draw(0);
  if (k > 1) {
    const t0 = Date.now();
    const why = await Promise.race([
      batch.firstResponse.then(() => "began its answer"),
      first.then(() => "returned"),
      (deps.sleep ?? unrefSleep)(FIRST_RESPONSE_WAIT_MS).then(() => "did not begin answering in time"),
    ]);
    /* Said, because whether the stagger did its job is a thing the ledger's cache columns are read against. */
    deps.note?.(`review draws: the first ${why} after ${String(Math.round((Date.now() - t0) / 1000))} s — launching ${String(k - 1)} more (C-4⁗‴)`);
  }
  const results = await Promise.all([first, ...Array.from({ length: Math.max(k - 1, 0) }, (_, j) => draw(j + 1))]);
  const reads: PlanReview["findings"][] = [];
  for (const review of results) if (review !== null) reads.push(review.verdict === "changes" ? review.findings : []);
  if (reads.length === 0) return null;
  const threshold = Math.ceil(reads.length / 2);
  const seen = new Map<string, number>();
  for (const read of reads)
    for (const key of new Set(read.map(findingKey)))
      if (key !== null) seen.set(key, (seen.get(key) ?? 0) + 1);

  const findings: PlanReview["findings"][number][] = [];
  const seenOnce: PlanReview["findings"][number][] = [];
  const taken = new Set<string>();
  for (const read of reads) {
    for (const f of read) {
      const key = findingKey(f);
      /**
       * A finding naming no ticket has no identity across reads, so recurrence
       * cannot be established for it in either direction. It is never promoted
       * into the revision and always travels as advice.
       */
      if (key === null) {
        seenOnce.push(f);
        continue;
      }
      if (taken.has(key)) continue;
      taken.add(key);
      ((seen.get(key) ?? 0) >= threshold ? findings : seenOnce).push(f);
    }
  }
  return { verdict: findings.length > 0 ? "changes" : "approve", findings, seenOnce, reads, threshold };
}
