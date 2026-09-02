import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runInit } from "../../src/init/machine.js";
import { buildPipeline } from "../../src/init/pipeline.js";
import { normaliseVerdict } from "../../src/init/plan-review.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { ANALYSIS, BUDGETS, DRAFT, LONE_CANDIDATE, PROMPTS, APPROVE_PLAN, planner, repo } from "./plan-fixture.js";

/**
 * C-4⁗ (PRDR-116) — on ksar-cloud the reviewer wrote `revise`, the validator
 * refused the artifact, six real findings were discarded and the plan was
 * written unreviewed with a note that said "no artifact".
 */

const FINDING = { tag: "sizing", finding: "t-100 is three tickets", ticket: "t-100" };

/** A planner whose review artifacts come from a script, one per REVIEW_PLAN launch. */
function scriptedPlanner(reviews: readonly (object | null)[]): { stage: StageFn; reviewInputs: Record<string, unknown>[] } {
  let n = 0;
  const reviewInputs: Record<string, unknown>[] = [];
  const base = planner(ANALYSIS(null), DRAFT(["t-100"]));
  const stage: StageFn = (spec) => {
    if (!spec.artifactOut.endsWith("plan-review.json")) return base(spec);
    reviewInputs.push((JSON.parse(spec.promptVariable) as { inputs: Record<string, unknown> }).inputs);
    /** `null` in the script means "write nothing"; past the script, approve. */
    const artifact = n < reviews.length ? reviews[n] : APPROVE_PLAN;
    n += 1;
    if (artifact !== null) writeFileSync(spec.artifactOut, `${JSON.stringify(artifact)}\n`);
    return okResult();
  };
  return { stage, reviewInputs };
}

async function init(stage: StageFn): Promise<{ backend: MockBackend; notes: string[] }> {
  const root = repo(LONE_CANDIDATE);
  const backend = new MockBackend({ planner: stage });
  const notes: string[] = [];
  await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS, note: (t) => notes.push(t) }));
  return { backend, notes };
}

const drafts = (b: MockBackend): number => b.calls.filter((c) => c.spec.artifactOut.endsWith("plan-draft.json")).length;
const reviews = (b: MockBackend): number => b.calls.filter((c) => c.spec.artifactOut.endsWith("plan-review.json")).length;

describe("C-4⁗ the plan review survives a synonym and a bad artifact", () => {
  it("reads plain synonyms as the verdict they mean, and leaves the vocabulary closed", () => {
    expect((normaliseVerdict({ verdict: "revise" }).value as { verdict: string }).verdict).toBe("changes");
    expect(normaliseVerdict({ verdict: "Approved" }).from).toBe("Approved");
    expect(normaliseVerdict({ verdict: "changes" }).from).toBeNull();
    expect((normaliseVerdict({ verdict: "maybe" }).value as { verdict: string }).verdict).toBe("maybe");
  });

  it("ksar's case: `revise` with findings buys the revision it always meant to", async () => {
    const { stage, reviewInputs } = scriptedPlanner([{ schema_version: 1, verdict: "revise", findings: [FINDING] }, APPROVE_PLAN]);
    const { backend, notes } = await init(stage);
    expect(drafts(backend)).toBe(2);
    expect(reviews(backend)).toBe(2);
    expect(reviewInputs[0]?.["previous_attempt"]).toBeUndefined();
    expect(notes.some((n) => n.includes("`revise` read as `changes`"))).toBe(true);
  });

  it("an unusable artifact is relaunched once, carrying the validator's words; the second one counts", async () => {
    const bad = { schema_version: 1, verdict: "changes", findings: [{ tag: "reach", finding: "x", ticket: "t-100" }] };
    const { stage, reviewInputs } = scriptedPlanner([bad, { schema_version: 1, verdict: "changes", findings: [FINDING] }, APPROVE_PLAN]);
    const { backend, notes } = await init(stage);
    /** review (bad) → review (relaunch, good: changes) → revision → review (approve) */
    expect(reviews(backend)).toBe(3);
    expect(drafts(backend)).toBe(2);
    const relaunch = reviewInputs[1]?.["previous_attempt"] as { issue: string } | undefined;
    expect(relaunch?.issue).toContain("tag");
    expect(notes.some((n) => n.startsWith("plan review artifact unusable ("))).toBe(true);
  });

  it("absent twice: the draft stands unreviewed, and the note says why", async () => {
    const { stage } = scriptedPlanner([null, null]);
    const { backend, notes } = await init(stage);
    expect(reviews(backend)).toBe(2);
    expect(drafts(backend)).toBe(1);
    expect(notes.some((n) => n.includes("no artifact written"))).toBe(true);
    expect(notes.some((n) => n.includes("the draft stands unreviewed"))).toBe(true);
  });
});
