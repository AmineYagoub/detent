import { describe, expect, it } from "vitest";
import { reviewInputsNote } from "../../src/kernel/stages/review.js";
import { reviewTags } from "../../src/schemas/ticket.js";
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

  /**
   * PRDR-143: read what the SESSION is taught, not a hand-retyped copy of it.
   *
   * This file's stated purpose is that "the contract a live session sees cannot
   * drift from the validator that judges it". The `approve` half honoured that
   * by parsing `reviewSkeleton()` from source. The `changes` half retyped the
   * shape by hand — so `expected_output_note`, which is the actual instruction
   * a reviewer receives, was compared to nothing.
   *
   * PRDR-160: what this DOES guard, stated correctly. The note is derived from
   * `reviewTags`, so "adding a tag without updating the note" is unreachable —
   * mutating `reviewTags` leaves all four tests here green, and the commit
   * message that claimed otherwise was wrong. The derivation is the fix; these
   * assertions guard the derivation's survival, catching a future hand-retyped
   * list (drop `rules` and the first expectation fires) and a format change
   * that would make the note unreadable to this check.
   */
  it("the note the reviewer is given names exactly the tags the validator accepts", () => {
    const note = reviewInputsNote();
    for (const tag of reviewTags) {
      expect(note, `the note omits the tag \`${tag}\`, which the validator accepts`).toContain(tag);
    }
    /* And it teaches no tag the validator would reject. */
    /* PRDR-160: `[a-z|]+` truncated at `_`, so a tag like `cross_slice` failed with a message accusing the note of omitting it. */
    const taught = (/\{tag: ([a-z_|-]+)/.exec(note)?.[1] ?? "").split("|").filter((t) => t !== "");
    expect(taught.length, "the note's tag list could not be read — the format drifted").toBeGreaterThan(0);
    expect([...taught].sort()).toEqual([...reviewTags].sort());
  });

  it("research brief (A-4) — including the X-6a local-search rule", () => {
    expect(researchBriefSchema.parse(researchBriefSkeleton()).root_cause.confidence).toBe("medium");
  });
});
