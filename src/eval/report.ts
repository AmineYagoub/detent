import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { EvalResults, Settlements } from "./results.js";
import { renderClaimsScore, renderReviewsScore, scoreClaims, scoreReviews, type Verdict } from "./score.js";
import { EvalRefused, readSet, treeDir } from "./sets.js";

/**
 * N-8 (PRDR-326) — an evaluation's results scored against the set they were
 * run on, and the text the operator reads. Results run on another build of
 * the set are refused: a set rebuilt may hold other claims or areas.
 */
export function report(results: EvalResults, settled: Settlements): { readonly verdict: Verdict; readonly text: string } {
  const set = readSet(results.set.dir);
  if (set.built.at !== results.set.built_at) {
    throw new EvalRefused(`${results.set.dir} was built at ${set.built.at}, and these results ran on the set built at ${results.set.built_at}`);
  }
  if (set.kind === "claims" && results.kind === "claims") {
    const score = scoreClaims(set, results, settled);
    return { verdict: score.verdict, text: renderClaimsScore(results, score) };
  }
  if (set.kind === "reviews" && results.kind === "reviews") {
    const textOf = (file: string): string | null => {
      const at = path.join(treeDir(results.set.dir), ...file.split("/"));
      return existsSync(at) ? readFileSync(at, "utf8") : null;
    };
    const score = scoreReviews(set, results, textOf);
    return { verdict: score.verdict, text: renderReviewsScore(results, score) };
  }
  throw new EvalRefused(`these are ${results.kind} results, and ${results.set.dir} is a ${set.kind} set`);
}

/** The exit a script gives a verdict: a refusal is 2, so a pass, a fail and a verdict still open are each their own. */
export const exitFor = (verdict: Verdict): number => (verdict === "pass" ? 0 : verdict === "fail" ? 1 : 3);
