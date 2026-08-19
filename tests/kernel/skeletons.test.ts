import { describe, expect, it } from "vitest";
import { hypothesisSkeleton, researchBriefSkeleton, reviewSkeleton } from "../../src/kernel/referee-stage.js";
import { hypothesisSchema, researchBriefSchema, reviewSchema } from "../../src/schemas/records.js";

/**
 * T-140 — the worker expected_output skeletons parse through their own
 * schemas, so the contract a live session sees cannot drift from the
 * validator that judges it. The live bootstrap review wrote a correct
 * verdict minus `schema_version` and the strict validator refused it — the
 * skeleton is the fix, and this lock keeps it fixed.
 */

describe("T-140 worker artifact skeletons cannot drift from their schemas", () => {
  it("hypothesis (A-3)", () => {
    expect(hypothesisSchema.parse(hypothesisSkeleton()).status).toBe("proposed");
  });

  it("review verdict (A-5) — the approve form, plus the changes form the note teaches", () => {
    expect(reviewSchema.parse(reviewSkeleton()).verdict).toBe("approve");
    expect(
      reviewSchema.parse({
        schema_version: 1,
        verdict: "changes",
        changes: [{ tag: "correctness", finding: "off by one" }],
      }).changes,
    ).toHaveLength(1);
  });

  it("research brief (A-4) — including the X-6a local-search rule", () => {
    expect(researchBriefSchema.parse(researchBriefSkeleton()).root_cause.confidence).toBe("medium");
  });
});
