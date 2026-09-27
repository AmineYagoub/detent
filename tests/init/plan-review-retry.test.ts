import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runInit } from "../../src/init/machine.js";
import { normaliseVerdict } from "../../src/init/plan-review.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { CLEAN_AUDIT, planningPipeline, BUDGETS, DRAFT, LONE_CANDIDATE, PROMPTS, APPROVE_PLAN, planner, repo, planning } from "./plan-fixture.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";

/**
 * C-4⁗ (PRDR-116) — on ksar-cloud the reviewer wrote `revise`, the validator
 * refused the artifact, six real findings were discarded and the plan was
 * written unreviewed with a note that said "no artifact". Since C-4⁸
 * (PRDR-294) a slice's review is read once, so each case here is one read and
 * its one relaunch.
 */

const FINDING = { severity: "major", tag: "sizing", finding: "t-100 is three tickets", ticket: "t-100", fix: "split t-100 in three" };

/** A planner whose review artifacts come from a script, one per REVIEW_PLAN launch. */
function scriptedPlanner(reviews: readonly (object | null)[]): { stage: StageFn; reviewInputs: Record<string, unknown>[] } {
  let n = 0;
  const reviewInputs: Record<string, unknown>[] = [];
  const base = planner(DRAFT(["t-100"]));
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
  const backend = new MockBackend({ audit: CLEAN_AUDIT,  ...planning(stage) });
  const notes: string[] = [];
  await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS, note: (t) => notes.push(t) }));
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
    const revise = { schema_version: SCHEMA_VERSION, verdict: "revise", findings: [FINDING] };
    const { stage, reviewInputs } = scriptedPlanner([revise]);
    const { backend, notes } = await init(stage);
    expect(drafts(backend)).toBe(2);
    expect(reviews(backend), "nothing reads the revision").toBe(1);
    expect(reviewInputs[0]?.["previous_attempt"]).toBeUndefined();
    expect(notes.some((n) => n.includes("`revise` read as `changes`"))).toBe(true);
  });

  it("an unusable artifact is relaunched once, carrying the validator's words; the second one counts", async () => {
    const bad = { schema_version: SCHEMA_VERSION, verdict: "changes", findings: [{ ...FINDING, tag: "reach" }] };
    const good = { schema_version: SCHEMA_VERSION, verdict: "changes", findings: [FINDING] };
    const { stage, reviewInputs } = scriptedPlanner([bad, good]);
    const { backend, notes } = await init(stage);
    /* The read (bad), its one relaunch (good), and the revision the good one's major bought. */
    expect(reviews(backend)).toBe(2);
    expect(drafts(backend)).toBe(2);
    expect(reviewInputs[0]?.["previous_attempt"]).toBeUndefined();
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
