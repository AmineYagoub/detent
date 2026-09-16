import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPipeline } from "../../src/init/pipeline.js";
import { runInit } from "../../src/init/machine.js";
import { PLAN_REVIEW_SAMPLES, planReviewPath } from "../../src/init/plan-review.js";
import { MockBackend, type StageFn } from "../../src/sessions/mock.js";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { APPROVE_PLAN, BUDGETS, PROMPTS, repo } from "./plan-fixture.js";
import { DOCS, scriptedPlanner, sliceOf, twoSliceDraft } from "./slicing-fixture.js";

/**
 * PRDR-260 — what a plan review leaves behind, and what it says it measured.
 *
 * Two halves of one question, which is why they share a file. The ARITHMETIC
 * half (D-7): the operator-facing "N finding(s) remain" line is stationary by
 * construction — `revisionOutcome` (src/init/plan-signal.ts:41-54) defines
 * `resolved = |before| - survived` and `introduced = |after| - survived`, so
 * `|after| = |before| - resolved + introduced` and a round that resolved
 * everything it was handed while raising as much again prints the number it
 * started with. The EVIDENCE half (D-8): the draws behind that number were
 * written to a path keyed by draw index alone, so slice 02's first draw deleted
 * slice 01's before it launched and nothing the count refers to survived to be
 * re-read.
 *
 * Both are measured through the real pipeline rather than by calling the
 * arithmetic directly: `revisionOutcome` computing correctly and never being
 * printed is the shape PRDR-196 already had to close once.
 */

const drawn = (slice: string): object => ({
  schema_version: 1,
  verdict: "changes",
  findings: [
    { tag: "sizing", ticket: `t-${slice}-001`, finding: `${slice} first read: too big` },
    { tag: "dependency", ticket: `t-${slice}-002`, finding: `${slice} first read: leans on nothing` },
  ],
});

/** Disjoint on `(ticket, tag)` from `drawn`, so the round resolves two and raises two. */
const afterRevision = (slice: string): object => ({
  schema_version: 1,
  verdict: "changes",
  findings: [
    { tag: "coverage", ticket: `t-${slice}-001`, finding: `${slice} after revision: a requirement lost its ticket` },
    { tag: "shape", ticket: `t-${slice}-002`, finding: `${slice} after revision: two tickets, one seam` },
  ],
});

/**
 * A slice reviewer whose first `PLAN_REVIEW_SAMPLES` answers per slice are the
 * drawn sample and whose next answer is the post-revision re-review. Counting
 * per slice is the only way to tell the two apart from the inputs: both carry
 * `scope: "slice"` and the same slice id.
 */
function stationaryReviewer(): (inputs: Record<string, unknown>) => object {
  const seen = new Map<string, number>();
  return (inputs) => {
    if (inputs["scope"] === "whole") return APPROVE_PLAN;
    const id = sliceOf(inputs);
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    return n <= PLAN_REVIEW_SAMPLES ? drawn(id) : afterRevision(id);
  };
}

/** `scriptedPlanner` sees inputs only; the artifact paths live on the spec. */
function recording(inner: StageFn, specs: SessionSpec[]): StageFn {
  return (spec) => {
    specs.push(spec);
    return inner(spec);
  };
}

describe("PRDR-260 the remain line says what the round did, not only how many are left", () => {
  it("decomposes the slice count and prints the null it is read against, as a rate", async () => {
    const root = repo(DOCS);
    const notes: string[] = [];
    const backend = new MockBackend({
      planner: scriptedPlanner({ draft: twoSliceDraft, review: stationaryReviewer() }, []),
    });
    await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS, note: (t) => notes.push(t) }));
    const said = notes.join("\n");

    /** The round did real work: two complaints answered, two new ones raised. */
    expect(said).toMatch(/s01 revision: 2 resolved, 0 survived, 2 introduced/);
    /**
     * And the operator-facing line must say so. On HEAD it reads
     * "s01 review after revision: 2 finding(s) remain — coverage, shape" —
     * the same 2 it started with, with nothing to distinguish a round that did
     * everything from one that did nothing.
     */
    expect(said).toMatch(/s01 review after revision: 2 finding\(s\) remain \(2 resolved, 2 introduced;/);
    /**
     * PRDR-200's null belongs on the same line, and as a RATE: `sampleChurn`
     * sums `revisionOutcome` over every ORDERED pair of reads — k*(k-1) = 6 at
     * `PLAN_REVIEW_SAMPLES` = 3 — while the revision figure is one before/after
     * pair. The raw counts are six pairs' worth and are not comparable.
     */
    expect(said).toMatch(/null 0% resolution over 6 unrevised read pairs/);
    /** And the churn line itself names the scale it was summed over, at its own site. */
    expect(said).toMatch(
      /s01 sample churn, nothing revised between the reads: 0 resolved, 12 survived, 0 introduced over 6 ordered read pairs/,
    );
  });

  it("decomposes the whole-plan count and says outright that it has no null", async () => {
    const root = repo(DOCS);
    const notes: string[] = [];
    let whole = 0;
    const backend = new MockBackend({
      planner: scriptedPlanner(
        {
          draft: twoSliceDraft,
          review: (inputs) => {
            if (inputs["scope"] !== "whole") return APPROVE_PLAN;
            whole += 1;
            return whole === 1
              ? { schema_version: 1, verdict: "changes", findings: [{ tag: "coherence", ticket: "t-s02-002", finding: "duplicates t-s01-002" }] }
              : { schema_version: 1, verdict: "changes", findings: [{ tag: "boundaries", ticket: "t-s02-002", finding: "now reaches across the seam" }] };
          },
        },
        [],
      ),
    });
    await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS, note: (t) => notes.push(t) }));

    expect(whole).toBe(2);
    /**
     * Both slices APPROVED here, so no revision followed either of them — and
     * the churn line is still emitted for both. Its old wording promised "the
     * null the number below is read against" on exactly this path, where there
     * is no number below.
     */
    expect(notes.join("\n")).toContain("s01 sample churn");
    expect(notes.join("\n")).not.toContain("the null the number below is read against");
    /**
     * The whole-plan review is a single draw — `plan-whole.ts` never calls
     * `sampleReviewPlan` — so there is no null here at all. Saying so is what
     * keeps the fix from becoming the drift it removes.
     */
    expect(notes.join("\n")).toMatch(
      /whole-plan review after revision: 1 finding\(s\) remain \(1 resolved, 1 introduced; no null — the whole-plan review is a single draw/,
    );
  });
});

describe("PRDR-260 a slice's review evidence survives the next slice", () => {
  it("keys every draw by the slice it judged, and keeps the told path shared", async () => {
    const root = repo(DOCS);
    const specs: SessionSpec[] = [];
    const backend = new MockBackend({
      planner: recording(scriptedPlanner({ draft: twoSliceDraft, review: stationaryReviewer() }, []), specs),
    });
    await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    const draw = (slice: string, n: number): string =>
      path.join(root, ".detent", "state", "slices", slice, "draws", String(n), "plan-review.json");
    const draws = Array.from({ length: PLAN_REVIEW_SAMPLES }, (_, i) => i + 1);

    for (const slice of ["s01", "s02"]) {
      for (const n of draws) {
        expect(existsSync(draw(slice, n)), `${slice} draw ${String(n)} survived the run`).toBe(true);
        /**
         * Existence alone is satisfiable by a fix that only makes directories.
         * The content is the evidence: on HEAD the single shared file holds
         * s02's verdict by the time the run ends, whichever slice wrote it.
         */
        expect(readFileSync(draw(slice, n), "utf8"), `${slice} draw ${String(n)} is ${slice}'s own verdict`).toContain(
          `${slice} first read`,
        );
      }
      /** The post-revision re-review is un-drawn and was clobbered the same way. */
      const second = path.join(root, ".detent", "state", "slices", slice, "plan-review.json");
      expect(existsSync(second), `${slice} kept its post-revision verdict`).toBe(true);
      expect(readFileSync(second, "utf8")).toContain(`${slice} after revision`);
    }

    /**
     * PRDR-205: every draw is TOLD one shared path so the three first turns are
     * the same bytes and the prompt cache serves all but the first (~25k tokens
     * and $0.45 a draw). Keying the ACTUAL file by slice must not reach `told`.
     */
    const told = new Set(specs.filter((s) => s.artifactTold !== undefined).map((s) => s.artifactTold));
    expect(told).toEqual(new Set([planReviewPath(root)]));
  });
});
