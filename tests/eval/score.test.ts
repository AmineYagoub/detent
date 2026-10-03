import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ClaimsResults, ReviewsResults } from "../../src/eval/results.js";
import { MAJORS_FLOOR, quotesOverlap, renderClaimsScore, renderReviewsScore, scoreClaims, scoreReviews } from "../../src/eval/score.js";
import type { ClaimsSet, ReviewsSet } from "../../src/eval/sets.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import type { ReviewFinding } from "../../src/schemas/validate.js";
import { definitionText } from "../docs/prd-marks.js";

/**
 * PRDR-326 — N-8's bar (D-35): a setup passes when it finds all 14 claims arm
 * A found wrong, calls none of the 30 it confirmed wrong unless a person
 * settles that arm A was mistaken, and reports each of the 18 blockers at its
 * place as a blocker or a major. The sets here are shaped like tabachir's and
 * hold none of its text.
 */

const hash = (i: number): string => i.toString(16).padStart(64, "0");
const BUILT = { at: "2026-09-30T00:00:00.000Z", build: "test", from: "/nowhere", git_dir: "/nowhere/.git" };
const RAN = {
  schema_version: SCHEMA_VERSION as typeof SCHEMA_VERSION,
  set: { dir: "/sets/x", built_at: BUILT.at },
  route: { model: "claude-opus-5-5", effort: "high" },
  build: "test",
  runtime: "2.1.285",
  copy: "/copies/x",
  started: "2026-09-30T10:00:00.000Z",
  ended: "2026-09-30T11:30:00.000Z",
  wall_ms: 90 * 60_000,
  spend_usd: 88.4,
  sessions: 44,
  budget_usd: 120,
};

function claimsSet(): ClaimsSet {
  const claims = Array.from({ length: 44 }, (_, i) => {
    const expected = i < 14 ? ("wrong" as const) : ("confirmed" as const);
    const text = `Claim number ${String(i)} about a rule.`;
    return {
      claim: { claim: text, subject: "a rule", passage: { file: "docs/prd.md", line: i + 1, quote: text } },
      claim_hash: hash(i),
      expected,
      arm_a: {
        schema_version: SCHEMA_VERSION as typeof SCHEMA_VERSION,
        claim: text,
        claim_hash: hash(i),
        verdict: expected,
        source: "https://example.org/rule",
        ...(expected === "wrong" ? { correction: "what is true instead" } : {}),
        evidence: [{ source: "https://example.org/rule", claim: "what it says" }],
        sources_consulted: [{ tier: 3, ref: "https://example.org/rule" }],
        local_search: { docs_checked: ["docs/prd.md"], code_checked: [] },
        what_would_falsify: "a later rule",
      },
    };
  });
  return { schema_version: SCHEMA_VERSION as typeof SCHEMA_VERSION, kind: "claims", built: BUILT, selection: "test", documents: ["docs/prd.md"], tree: {}, claims };
}

const asArmA = (set: ClaimsSet): ClaimsResults => ({
  ...RAN,
  kind: "claims",
  claims: set.claims.map((c) => ({ claim_hash: c.claim_hash, verdict: c.expected, checked: true, source: "https://example.org/rule" })),
});

/** Lines 0 to 17 hold the blockers' quotes, and 18 to 37 the majors'. */
const TEXT = Array.from({ length: 38 }, (_, i) => `Line ${String(i)}: the record MUST keep every mark for ten years, and the export MUST name its school.`).join("\n");
const QUOTE = (i: number): string => `Line ${String(i)}: the record MUST keep every mark for ten years`;

const finding = (i: number, severity: ReviewFinding["severity"], quote = QUOTE(i), file = `docs/prd/0${String(i % 10)}.md`): ReviewFinding => ({
  severity,
  category: "contradiction",
  places: [{ file, line: i + 1, quote }],
  why: `blocker ${String(i)}`,
  fix: "fix it",
  previous: null,
});

/** A major of the set, at line `i` of its area's file. */
const majorOf = (i: number): ReviewFinding => ({ ...finding(i, "major"), why: `major ${String(i)}` });

function reviewsSet(): ReviewsSet {
  const areas = Array.from({ length: 10 }, (_, a) => ({
    name: `Area ${String(a)}`,
    index: a,
    key: hash(1000 + a),
    task: { foundations: [], documents: [`docs/prd/0${String(a)}.md`], heuristic: [] },
    findings: 20,
    blockers: Array.from({ length: 18 }, (_, i) => i)
      .filter((i) => i % 10 === a)
      .map((i) => finding(i, "blocker")),
    majors: Array.from({ length: 20 }, (_, k) => 18 + k)
      .filter((i) => i % 10 === a)
      .map(majorOf),
  }));
  return { schema_version: SCHEMA_VERSION as typeof SCHEMA_VERSION, kind: "reviews", built: BUILT, selection: "test", greenfield: true, prompt_hash: hash(7), pack: [], tree: {}, areas };
}

type Severity = (i: number) => ReviewFinding["severity"] | null;

/** A setup's results: each blocker of the set reported as `severity` gives it, and each major as `majors` gives it, at `quote`'s place. */
const reviewed = (set: ReviewsSet, severity: Severity, quote = QUOTE, majors: Severity = () => "major"): ReviewsResults => ({
  ...RAN,
  kind: "reviews",
  areas: set.areas.map((a) => ({
    name: a.name,
    findings: [
      ...a.blockers.flatMap((b) => {
        const i = Number(/blocker (\d+)/u.exec(b.why)?.[1]);
        const s = severity(i);
        return s === null ? [] : [finding(i, s, quote(i))];
      }),
      ...(a.majors ?? []).flatMap((m) => {
        const i = Number(/major (\d+)/u.exec(m.why)?.[1]);
        const s = majors(i);
        return s === null ? [] : [finding(i, s, quote(i))];
      }),
    ],
  })),
});

const textOf = (): string => TEXT;

describe("N-8 the bar a lower model or effort passes (PRDR-326)", () => {
  it("passes a setup that finds all 32 items: the 14 wrong claims wrong, the 30 confirmed held, the 18 blockers as blockers or majors", () => {
    const claims = claimsSet();
    const reviews = reviewsSet();
    expect(reviews.areas.reduce((n, a) => n + a.blockers.length, 0)).toBe(18);
    expect(scoreClaims(claims, asArmA(claims), {}).verdict).toBe("pass");
    const score = scoreReviews(reviews, reviewed(reviews, (i) => (i % 2 === 0 ? "blocker" : "major")), textOf);
    expect(score).toMatchObject({ verdict: "pass", found: 18, total: 18, majorsFound: 20, majorsTotal: 20 });
  });

  it("fails a setup that misses one wrong claim, whether it confirmed it or left it unverified", () => {
    const set = claimsSet();
    for (const got of ["confirmed", "unverified"] as const) {
      const results = asArmA(set);
      const missed = { ...results, claims: results.claims.map((c, i) => (i === 3 ? { ...c, verdict: got } : c)) };
      const score = scoreClaims(set, missed, {});
      expect(score.verdict, got).toBe("fail");
      expect(score.wrongFound).toBe(13);
      expect(score.missed).toEqual([{ claim: "Claim number 3 about a rule.", got }]);
    }
  });

  it("fails a setup that reports a blocker as a minor at its place", () => {
    const set = reviewsSet();
    const score = scoreReviews(set, reviewed(set, (i) => (i === 5 ? "minor" : "blocker")), textOf);
    expect(score.verdict).toBe("fail");
    expect(score.found).toBe(17);
    expect(score.missed).toEqual([{ area: "Area 5", at: "docs/prd/05.md:6", why: "blocker 5", got: "a minor" }]);
  });

  it("misses a blocker reported in another file, or at a quote that does not overlap its own", () => {
    const set = reviewsSet();
    const elsewhere: ReviewsResults = {
      ...reviewed(set, () => "blocker"),
      areas: reviewed(set, () => "blocker").areas.map((a) => ({ ...a, findings: (a.findings ?? []).map((f) => (f.why === "blocker 0" ? { ...f, places: [{ ...f.places[0]!, file: "docs/other.md" }] } : f)) })),
    };
    expect(scoreReviews(set, elsewhere, textOf).missed.map((m) => [m.at, m.got])).toEqual([["docs/prd/00.md:1", "nothing"]]);
    const apart = scoreReviews(set, reviewed(set, () => "major", (i) => (i === 7 ? "the export MUST name its school." : QUOTE(i))), textOf);
    expect(apart.missed.map((m) => m.at)).toEqual(["docs/prd/07.md:8"]);
  });

  it("lists a confirmed claim called wrong for a person to settle: pending until settled, then held or failed by the settlement", () => {
    const set = claimsSet();
    const results = asArmA(set);
    const called = { ...results, claims: results.claims.map((c, i) => (i === 20 ? { ...c, verdict: "wrong" as const, correction: "the rule changed in 2026" } : c)) };
    const pending = scoreClaims(set, called, {});
    expect(pending.verdict).toBe("pending");
    expect(pending.toSettle).toEqual([{ claim: "Claim number 20 about a rule.", hash: hash(20), source: "https://example.org/rule", correction: "the rule changed in 2026" }]);
    expect(scoreClaims(set, called, { [hash(20)]: "arm_a_mistaken" }).verdict).toBe("pass");
    expect(scoreClaims(set, called, { [hash(20)]: "arm_mistaken" })).toMatchObject({ verdict: "fail", settledAgainst: ["Claim number 20 about a rule."] });
  });

  it("never passes an evaluation a unit of which did not finish", () => {
    const claims = claimsSet();
    const results = asArmA(claims);
    const cut = { ...results, claims: results.claims.map((c, i) => (i === 40 ? { claim_hash: c.claim_hash, checked: false, unfinished: "the budget" } : c)) };
    expect(scoreClaims(claims, cut, {})).toMatchObject({ verdict: "incomplete", unfinished: [{ claim: "Claim number 40 about a rule.", why: "the budget" }] });
    const reviews = reviewsSet();
    const all = reviewed(reviews, () => "blocker");
    const unrun = { ...all, areas: all.areas.slice(1) };
    expect(scoreReviews(reviews, unrun, textOf)).toMatchObject({ verdict: "incomplete", unfinished: [{ area: "Area 0", why: "it was not run" }] });
  });

  it("scores an evaluation of the wrong claims alone on those, and one that left out the confirmed without saying so as incomplete", () => {
    const set = claimsSet();
    const results = asArmA(set);
    const wrong = { ...results, claims: results.claims.slice(0, 14) };
    expect(scoreClaims(set, { ...wrong, only: "wrong" }, {})).toMatchObject({ verdict: "pass", wrongFound: 14, wrongTotal: 14, unfinished: [] });
    expect(scoreClaims(set, wrong, {})).toMatchObject({ verdict: "incomplete" });
    const missed = { ...wrong, only: "wrong" as const, claims: wrong.claims.map((c, i) => (i === 3 ? { ...c, verdict: "confirmed" as const } : c)) };
    expect(scoreClaims(set, missed, {})).toMatchObject({ verdict: "fail", wrongFound: 13, missed: [{ claim: "Claim number 3 about a rule.", got: "confirmed" }] });
  });

  it("reads two quotes as overlapping where their places in the file's text meet, whitespace aside", () => {
    const text = "The export MUST name its school,\nand the record MUST keep every mark for ten years.";
    expect(quotesOverlap(text, "name its school, and the record", "the record MUST keep every mark")).toBe(true);
    expect(quotesOverlap(text, "The export MUST name its school", "the record MUST keep every mark")).toBe(false);
    expect(quotesOverlap(null, "the record MUST keep every mark for ten years", "keep every mark for ten years, in full")).toBe(true);
    expect(quotesOverlap(null, "the record MUST keep", "the export MUST name")).toBe(false);
  });

  it("prints pass or fail, each miss, what to settle, the spend and the wall clock", () => {
    const set = claimsSet();
    const results = asArmA(set);
    const mixed = { ...results, claims: results.claims.map((c, i) => (i === 3 ? { ...c, verdict: "confirmed" as const } : i === 20 ? { ...c, verdict: "wrong" as const, correction: "changed" } : c)) };
    const text = renderClaimsScore(mixed, scoreClaims(set, mixed, {}));
    expect(text).toContain("N-8: the claims set on claude-opus-5-5 at high: FAIL");
    expect(text).toContain("wrong claims found wrong: 13 of 14");
    expect(text).toContain('missed: "Claim number 3 about a rule.", which it found confirmed');
    expect(text).toContain(`${hash(20)}: "Claim number 20 about a rule." — https://example.org/rule — changed`);
    expect(text).toContain("spent $88.40 of a $120.00 budget over 44 sessions, in 1 h 30 min");
    const reviews = reviewsSet();
    const minor = reviewed(reviews, (i) => (i === 5 ? "minor" : "major"));
    expect(renderReviewsScore(minor, scoreReviews(reviews, minor, textOf))).toContain("missed, reported as a minor: docs/prd/05.md:6 (Area 5): blocker 5");
  });
});

describe("N-8′ the reviews bar asks for 90% of the set's majors too (PRDR-334)", () => {
  it("fails a setup that finds every blocker and fewer than 90% of the majors, and lists each major it missed", () => {
    const set = reviewsSet();
    const short = scoreReviews(set, reviewed(set, () => "blocker", QUOTE, (i) => ([20, 25, 31].includes(i) ? null : "major")), textOf);
    expect(short).toMatchObject({ verdict: "fail", found: 18, total: 18, majorsFound: 17, majorsTotal: 20, majorsNeeded: 18 });
    expect(short.missed, "every blocker was found").toEqual([]);
    expect(short.majorsMissed.map((m) => [m.at, m.area, m.why, m.got])).toEqual([
      ["docs/prd/00.md:21", "Area 0", "major 20", "nothing"],
      ["docs/prd/01.md:32", "Area 1", "major 31", "nothing"],
      ["docs/prd/05.md:26", "Area 5", "major 25", "nothing"],
    ]);
    const enough = scoreReviews(set, reviewed(set, () => "blocker", QUOTE, (i) => ([20, 25].includes(i) ? null : "major")), textOf);
    expect(enough).toMatchObject({ verdict: "pass", majorsFound: 18 });
  });

  it("misses a major reported as a minor at its place, and takes one reported as a blocker", () => {
    const set = reviewsSet();
    const score = scoreReviews(set, reviewed(set, () => "blocker", QUOTE, (i) => (i === 22 ? "minor" : i === 23 ? "blocker" : "major")), textOf);
    expect(score.majorsMissed).toEqual([{ area: "Area 2", at: "docs/prd/02.md:23", why: "major 22", got: "a minor" }]);
    expect(score).toMatchObject({ verdict: "pass", majorsFound: 19 });
  });

  it("asks 119 of tabachir's 132 majors: today's max, re-run, passes with 126 and high with 124, and 113 and 106 fail", () => {
    expect(MAJORS_FLOOR).toBe(0.9);
    const needed = Math.ceil(MAJORS_FLOOR * 132);
    expect(needed).toBe(119);
    expect([126, 124, 113, 106].map((found) => found >= needed)).toEqual([true, true, false, false]);
  });

  it("is incomplete while a unit left out could still lift the majors to the floor, and fails once the misses put it out of reach", () => {
    const set = reviewsSet();
    const all = reviewed(set, () => "blocker");
    const unrun = { ...all, areas: all.areas.slice(2) };
    expect(scoreReviews(set, unrun, textOf), "areas 0 and 1 hold 4 majors, and 16 of 20 are found").toMatchObject({ verdict: "incomplete", majorsFound: 16, majorsMissed: [] });
    const short = reviewed(set, () => "blocker", QUOTE, (i) => ([22, 23, 24].includes(i) ? null : "major"));
    expect(scoreReviews(set, { ...short, areas: short.areas.slice(1) }, textOf), "3 missed where 2 may be").toMatchObject({ verdict: "fail" });
  });

  it("refuses a reviews set that holds no majors, naming the command that adds them", () => {
    const set = reviewsSet();
    const older = structuredClone(set);
    for (const area of older.areas) delete area.majors;
    expect(() => scoreReviews(older, reviewed(set, () => "blocker"), textOf)).toThrow(
      /holds no majors for 10 of its 10 areas, so N-8′'s bar cannot be judged on it; add them with npx tsx scripts\/eval-build\.ts --majors <the reviews set>/u,
    );
  });

  it("prints the majors found, the number the bar asks and each one missed", () => {
    const set = reviewsSet();
    const results = reviewed(set, () => "blocker", QUOTE, (i) => ([20, 25, 31].includes(i) ? null : "major"));
    const text = renderReviewsScore(results, scoreReviews(set, results, textOf));
    expect(text).toContain("N-8: the reviews set on claude-opus-5-5 at high: FAIL");
    expect(text).toContain("majors reported at their place as a blocker or a major: 17 of 20, where the bar asks 18 (N-8′)");
    expect(text).toContain("major missed, reported as nothing: docs/prd/00.md:21 (Area 0): major 20");
  });

  it("N-8′ states the majors' part of the bar and the four runs, and N-8, S-5⁷ and the evaluation guide carry it", () => {
    const repo = path.resolve(import.meta.dirname, "..", "..");
    const prd = readFileSync(path.join(repo, "detent-prd-v3.md"), "utf8");
    const mark = (id: string): string => (definitionText(prd, id)[0] ?? "").replace(/\s+/gu, " ");
    for (const said of [
      "at least 90% of the majors",
      "today's `max`, re-run, reported 126, Opus 5.5 at `high` 124, `high` with the foundations given 113, and `medium` 106",
      "90% asks 119 of the 132",
      "`review_foundations` is `read` by default again",
      "`scripts/eval-build.ts --majors`",
    ]) {
      expect(mark("N-8′"), said).toContain(said);
    }
    expect(mark("N-8")).toContain("*Amended by N-8′ (PRDR-334)");
    expect(mark("S-5⁷")).toContain("*Amended by N-8′ (PRDR-334): scored against the set's 132 majors too, today's `max` reported 126 and `high` 124");
    const guide = readFileSync(path.join(repo, "docs", "evaluation.md"), "utf8").replace(/\s+/gu, " ");
    expect(guide).toContain("it reports at least 90% of the majors at their place, the same way (N-8′)");
  });
});
