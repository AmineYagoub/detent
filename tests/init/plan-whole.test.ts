import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runInit } from "../../src/init/machine.js";
import { buildPipeline } from "../../src/init/pipeline.js";
import { okResult, type StageFn } from "../../src/sessions/mock.js";
import { ANALYSIS, APPROVE_PLAN, BUDGETS, PROMPTS, repo } from "./plan-fixture.js";
import { DOCS, MockBackend, TWO_SLICES, ticket } from "./slicing-fixture.js";

/**
 * C-8⁗ (PRDR-199) — the redraft that was never written down.
 *
 * `wholePlanReview` redrafts each slice the coherence review named and writes
 * nothing until it returns, so a death at redraft k of n discarded all k — and
 * the review that produced the findings with them, because that review is
 * recomputed from a slice cache the redrafts never reached. On gate-311 twelve
 * planner sessions totalling $59.96 ran after the last durable write.
 *
 * The interrupt here is a drafting session that throws, which is what a killed
 * or refused session looks like from inside the loop.
 */

const finding = (id: string, tag = "coherence"): object => ({ tag, ticket: id, finding: `${id} disagrees with the plan` });

interface Script {
  /** Throw on this REDRAFT (1-based), to stand in for a session that died. */
  readonly dieOnRedraft?: number;
}

/**
 * A planner that plans two slices, faults one ticket in each at the whole-plan
 * review, and can die partway through the redraft set.
 */
function planner(script: Script, log: string[]): StageFn {
  let wholeReviews = 0;
  let redrafts = 0;
  return (spec) => {
    const inputs = (JSON.parse(spec.promptVariable) as { inputs: Record<string, unknown> }).inputs;
    let artifact: object;
    if (spec.artifactOut.endsWith("slices.json")) {
      log.push("SLICE");
      artifact = TWO_SLICES;
    } else if (spec.artifactOut.endsWith("plan-draft.json")) {
      const slice = (inputs["slice"] as { id: string }).id;
      /**
       * A redraft is a draft carrying findings. Safe here because every SLICE
       * review in this fixture approves, so nothing else hands a draft
       * findings. Two sharper-looking discriminators both failed: a first-draft
       * COUNT breaks on resume when the slice caches hit and no first drafts
       * run, and `wholeReviews >= 1` breaks once the review itself is reused
       * and the counter never increments. Both mislabelled and both made the
       * test measure the wrong thing.
       */
      if (inputs["review_findings"] !== undefined) {
        redrafts += 1;
        log.push(`REDRAFT:${slice}`);
        if (script.dieOnRedraft === redrafts) throw new Error(`session died during redraft ${String(redrafts)}`);
      } else {
        log.push(`PLAN:${slice}`);
      }
      artifact = { schema_version: 1, tickets: [ticket(`t-${slice}-001`), ticket(`t-${slice}-002`, [`t-${slice}-001`])], questions: [] };
    } else if (spec.artifactOut.endsWith("plan-review.json")) {
      if (inputs["scope"] === "whole") {
        wholeReviews += 1;
        log.push("REVIEW:whole");
        /* The first whole review faults one ticket per slice; the second approves. */
        artifact =
          wholeReviews === 1
            ? { schema_version: 1, verdict: "changes", findings: [finding("t-s01-002"), finding("t-s02-002")] }
            : APPROVE_PLAN;
      } else {
        log.push("REVIEW:slice");
        artifact = APPROVE_PLAN;
      }
    } else {
      log.push("ANALYZE");
      artifact = ANALYSIS(null);
    }
    writeFileSync(spec.artifactOut, `${JSON.stringify(artifact)}\n`);
    return okResult();
  };
}

async function init(root: string, script: Script, log: string[]): Promise<void> {
  const handlers = buildPipeline({ root, backend: new MockBackend({ planner: planner(script, log) }), prompts: PROMPTS, budgets: BUDGETS });
  try {
    await runInit(root, handlers);
  } catch {
    /* A session that dies fails the phase; the point is what survives it. */
  }
}

describe("C-8⁗ a completed redraft is written down before the next one starts", () => {
  it("a death at redraft 2 of 2 does not discard redraft 1, nor the review that named it", async () => {
    const root = repo(DOCS);
    const first: string[] = [];
    await init(root, { dieOnRedraft: 2 }, first);

    expect(first, "the run got through the first redraft").toContain("REDRAFT:s01");
    expect(first.filter((l) => l === "REVIEW:whole"), "and paid for the whole-plan review").toHaveLength(1);

    const resumed: string[] = [];
    await init(root, {}, resumed);

    /**
     * The whole ticket in two assertions. Before PRDR-199 the resumed run
     * re-ran the whole-plan review and redrafted s01 from scratch, so neither
     * the $59.96 of gate-311's sessions nor anything after it could accumulate.
     */
    expect(resumed, "s01's completed redraft is reused, not re-paid for").not.toContain("REDRAFT:s01");
    expect(
      resumed.filter((l) => l === "REVIEW:whole"),
      "only the SECOND whole review runs — the first is checkpointed with its findings",
    ).toHaveLength(1);
    expect(resumed, "and the redraft that died is the one that runs").toContain("REDRAFT:s02");
  }, 30_000);

  it("an unchanged plan reuses the whole set and re-reviews nothing", async () => {
    const root = repo(DOCS);
    const first: string[] = [];
    await init(root, {}, first);
    expect(first).toContain("REDRAFT:s01");
    expect(first).toContain("REDRAFT:s02");

    const again: string[] = [];
    await init(root, {}, again);
    expect(again.filter((l) => l.startsWith("REDRAFT:")), "nothing to redo").toHaveLength(0);
    expect(again.filter((l) => l === "REVIEW:whole"), "nor to re-review").toHaveLength(0);
  }, 30_000);
});
