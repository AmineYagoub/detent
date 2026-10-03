import { span } from "../init/estimate.js";
import type { FindingPlace, ReviewFinding } from "../schemas/validate.js";
import type { ClaimsResults, EvalResults, ReviewsResults, Settlements } from "./results.js";
import { ADD_MAJORS, EvalRefused, type ClaimsSet, type ReviewsSet } from "./sets.js";

/**
 * N-8 (PRDR-326) — D-35's bar, applied to one evaluation of a set.
 *
 * Claims: every claim arm A found wrong is found wrong. A claim arm A
 * confirmed that the evaluation calls wrong may mean arm A was the one
 * mistaken, and only a person reading the evaluation's source can say, so it
 * is listed for one to settle: settled against arm A it stands, settled
 * against the evaluation it fails the bar, and unsettled it leaves the verdict
 * pending. Reviews: every blocker is reported at its place, the same file and
 * a quote that overlaps its own, as a blocker or a major. A report of it as a
 * minor misses it, since a round with no blocker and no major ends VALIDATE
 * (C-2¹⁴). N-8′ (PRDR-334): so is at least `MAJORS_FLOOR` of the set's majors,
 * matched the same way. Counted on blockers alone, a setup whose reviewers lost
 * a tenth of the majors passed, and became the default. A unit that did not
 * finish is judged by nothing, so an evaluation with one is incomplete, and
 * never passes.
 */

export type Verdict = "pass" | "fail" | "pending" | "incomplete";

export interface ClaimsScore {
  readonly verdict: Verdict;
  readonly wrongFound: number;
  readonly wrongTotal: number;
  readonly missed: readonly { readonly claim: string; readonly got: string }[];
  readonly toSettle: readonly { readonly claim: string; readonly hash: string; readonly source: string; readonly correction: string }[];
  readonly settledAgainst: readonly string[];
  readonly unfinished: readonly { readonly claim: string; readonly why: string }[];
}

/** A blocker or a major of the set that a setup did not report at its place as a blocker or a major. */
export interface ReviewsMiss {
  readonly area: string;
  readonly at: string;
  readonly why: string;
  readonly got: "a minor" | "nothing";
}

export interface ReviewsScore {
  readonly verdict: Verdict;
  readonly found: number;
  readonly total: number;
  readonly missed: readonly ReviewsMiss[];
  /** N-8′: the set's majors reported at their place as a blocker or a major, of how many, and the least that passes. */
  readonly majorsFound: number;
  readonly majorsTotal: number;
  readonly majorsNeeded: number;
  readonly majorsMissed: readonly ReviewsMiss[];
  readonly unfinished: readonly { readonly area: string; readonly why: string }[];
}

/**
 * N-8′: the share of the set's majors a setup must report at their place. On
 * tabachir's set, today's `max`, re-run, reported 126 of 132 and Opus 5.5 at
 * `high` 124; with the foundations given, `high` reported 113 and `medium` 106.
 */
export const MAJORS_FLOOR = 0.9;

const verdictOf = (failed: boolean, unfinished: boolean, pending: boolean): Verdict => (failed ? "fail" : unfinished ? "incomplete" : pending ? "pending" : "pass");

export function scoreClaims(set: ClaimsSet, results: ClaimsResults, settled: Settlements): ClaimsScore {
  const byHash = new Map(results.claims.map((r) => [r.claim_hash, r]));
  const missed: { claim: string; got: string }[] = [];
  const toSettle: { claim: string; hash: string; source: string; correction: string }[] = [];
  const settledAgainst: string[] = [];
  const unfinished: { claim: string; why: string }[] = [];
  let wrongFound = 0;
  for (const c of set.claims) {
    if (results.only === "wrong" && c.expected !== "wrong") continue;
    const r = byHash.get(c.claim_hash);
    if (r?.verdict === undefined) {
      unfinished.push({ claim: c.claim.claim, why: r?.unfinished ?? "it was not run" });
      continue;
    }
    if (c.expected === "wrong") {
      if (r.verdict === "wrong") wrongFound += 1;
      else missed.push({ claim: c.claim.claim, got: r.checked ? r.verdict : "unverified, since no brief was usable" });
    } else if (r.verdict === "wrong") {
      const word = settled[c.claim_hash];
      if (word === "arm_mistaken") settledAgainst.push(c.claim.claim);
      else if (word === undefined) toSettle.push({ claim: c.claim.claim, hash: c.claim_hash, source: r.source ?? "", correction: r.correction ?? "" });
    }
  }
  const wrongTotal = set.claims.filter((c) => c.expected === "wrong").length;
  const verdict = verdictOf(missed.length > 0 || settledAgainst.length > 0, unfinished.length > 0, toSettle.length > 0);
  return { verdict, wrongFound, wrongTotal, missed, toSettle, settledAgainst, unfinished };
}

const squash = (text: string): string => text.replace(/\s+/gu, " ").trim();

function spansOf(text: string, quote: string): (readonly [number, number])[] {
  const out: (readonly [number, number])[] = [];
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) out.push([at, at + quote.length]);
  return out;
}

/** The longest run of characters two texts share. */
function sharedRun(a: string, b: string): number {
  let best = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        row[j] = (prev[j - 1] ?? 0) + 1;
        best = Math.max(best, row[j] ?? 0);
      }
    }
    prev = row;
  }
  return best;
}

/**
 * Whether two quotes of one file overlap, whitespace aside: their places in
 * the file's text intersect. Where either is not in the text, one holding the
 * other, or a run of 24 characters they share, stands for it.
 */
export function quotesOverlap(text: string | null, a: string, b: string): boolean {
  const qa = squash(a);
  const qb = squash(b);
  if (qa === "" || qb === "") return false;
  if (qa.includes(qb) || qb.includes(qa)) return true;
  const body = text === null ? "" : squash(text);
  const sa = spansOf(body, qa);
  const sb = spansOf(body, qb);
  if (sa.length > 0 && sb.length > 0) return sa.some(([s1, e1]) => sb.some(([s2, e2]) => s1 < e2 && s2 < e1));
  return sharedRun(qa, qb) >= Math.min(24, qa.length, qb.length);
}

const atPlace = (blocker: ReviewFinding, finding: ReviewFinding, textOf: (file: string) => string | null): boolean =>
  blocker.places.some((b: FindingPlace) => finding.places.some((f) => f.file === b.file && quotesOverlap(textOf(b.file), b.quote, f.quote)));

/** Refuses a reviews set that holds no majors: N-8′'s bar cannot be judged on it. */
export function refuseWithoutMajors(set: ReviewsSet): void {
  const without = set.areas.filter((a) => a.majors === undefined);
  if (without.length > 0) {
    throw new EvalRefused(`the reviews set holds no majors for ${String(without.length)} of its ${String(set.areas.length)} areas, so N-8′'s bar cannot be judged on it; add them with ${ADD_MAJORS}`);
  }
}

export function scoreReviews(set: ReviewsSet, results: ReviewsResults, textOf: (file: string) => string | null): ReviewsScore {
  refuseWithoutMajors(set);
  const reported = results.areas.flatMap((a) => a.findings ?? []);
  const unfinished = results.areas.flatMap((a) => (a.findings === undefined ? [{ area: a.name, why: a.unfinished ?? "no usable review" }] : []));
  for (const area of set.areas) if (!results.areas.some((a) => a.name === area.name)) unfinished.push({ area: area.name, why: "it was not run" });
  /** Each of `items` reported at its place as a blocker or a major, and each one missed where its area was judged or a minor stands at its place. */
  const tally = (items: (area: ReviewsSet["areas"][number]) => readonly ReviewFinding[]): { found: number; missed: ReviewsMiss[] } => {
    const missed: ReviewsMiss[] = [];
    let found = 0;
    for (const area of set.areas) {
      const judged = !unfinished.some((u) => u.area === area.name);
      for (const item of items(area)) {
        const there = reported.filter((f) => atPlace(item, f, textOf));
        if (there.some((f) => f.severity === "blocker" || f.severity === "major")) found += 1;
        else if (judged || there.length > 0) {
          const place = item.places[0];
          missed.push({ area: area.name, at: place === undefined ? "" : `${place.file}:${String(place.line)}`, why: item.why, got: there.length > 0 ? "a minor" : "nothing" });
        }
      }
    }
    return { found, missed };
  };
  const blockers = tally((a) => a.blockers);
  const majors = tally((a) => a.majors ?? []);
  const total = set.areas.reduce((n, a) => n + a.blockers.length, 0);
  const majorsTotal = set.areas.reduce((n, a) => n + (a.majors?.length ?? 0), 0);
  const majorsNeeded = Math.ceil(MAJORS_FLOOR * majorsTotal);
  /* A unit that did not finish could still lift the majors to the floor, unless those already missed put it out of reach. */
  const failed = blockers.missed.length > 0 || majors.missed.length > majorsTotal - majorsNeeded;
  return {
    verdict: verdictOf(failed, unfinished.length > 0, false),
    found: blockers.found,
    total,
    missed: blockers.missed,
    majorsFound: majors.found,
    majorsTotal,
    majorsNeeded,
    majorsMissed: majors.missed,
    unfinished,
  };
}

const clip = (text: string, n = 110): string => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

function cost(results: EvalResults): string {
  return `spent $${results.spend_usd.toFixed(2)} of a $${results.budget_usd.toFixed(2)} budget over ${String(results.sessions)} sessions, in ${span(results.wall_ms)}`;
}

export function renderClaimsScore(results: ClaimsResults, score: ClaimsScore): string {
  const lines = [
    `N-8: the claims set${results.only === "wrong" ? "'s wrong claims" : ""} on ${results.route.model} at ${results.route.effort}: ${score.verdict.toUpperCase()}`,
    `  wrong claims found wrong: ${String(score.wrongFound)} of ${String(score.wrongTotal)}`,
    ...score.missed.map((m) => `  missed: "${clip(m.claim)}", which it found ${m.got}`),
    ...score.settledAgainst.map((c) => `  settled against it: "${clip(c)}", a confirmed claim it called wrong`),
    ...(score.toSettle.length === 0 ? [] : [`  confirmed claims it called wrong, for a person to settle (${String(score.toSettle.length)}):`]),
    ...score.toSettle.map((s) => `    ${s.hash}: "${clip(s.claim)}" — ${s.source} — ${clip(s.correction, 200)}`),
    ...score.unfinished.map((u) => `  not finished: "${clip(u.claim)}", by ${u.why}`),
    `  ${cost(results)}`,
  ];
  return `${lines.join("\n")}\n`;
}

export function renderReviewsScore(results: ReviewsResults, score: ReviewsScore): string {
  const lines = [
    `N-8: the reviews set on ${results.route.model} at ${results.route.effort}${results.foundations === "given" ? ", the foundations given" : ""}: ${score.verdict.toUpperCase()}`,
    `  blockers reported at their place as a blocker or a major: ${String(score.found)} of ${String(score.total)}`,
    ...score.missed.map((m) => `  missed, reported as ${m.got}: ${m.at} (${m.area}): ${clip(m.why)}`),
    `  majors reported at their place as a blocker or a major: ${String(score.majorsFound)} of ${String(score.majorsTotal)}, where the bar asks ${String(score.majorsNeeded)} (N-8′)`,
    ...score.majorsMissed.map((m) => `  major missed, reported as ${m.got}: ${m.at} (${m.area}): ${clip(m.why)}`),
    ...score.unfinished.map((u) => `  not finished: ${u.area}, by ${u.why}`),
    `  ${cost(results)}`,
  ];
  return `${lines.join("\n")}\n`;
}
