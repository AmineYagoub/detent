import { describe, expect, it } from "vitest";
import { PLAN_FINDING_TAGS, planReviewSchema } from "../../src/schemas/init.js";

/**
 * PRDR-103 — t-112's criterion needed a status display t-154 builds, the plan
 * declared no edge and no surface, and the run spent a generation learning
 * what REVIEW_PLAN could have said for free. The tag is its own: `shape` is
 * skeleton ordering, `sizing` is too much work; this is "cannot be met when
 * the ticket runs".
 */
describe("PRDR-103 the plan review can name a criterion that reaches a later sibling", () => {
  it("`dependency` is in the closed tag set, distinct from shape and sizing", () => {
    expect(PLAN_FINDING_TAGS).toContain("dependency");
    expect(PLAN_FINDING_TAGS).toContain("shape");
    expect(PLAN_FINDING_TAGS).toContain("sizing");
  });

  it("a finding tagged dependency parses, naming both tickets", () => {
    const parsed = planReviewSchema.safeParse({
      schema_version: 1,
      verdict: "changes",
      findings: [
        {
          tag: "dependency",
          finding: "t-112 AC2 needs the status display t-154 builds; t-112 neither depends on t-154 nor carries src/cli/** in its surface",
          ticket: "t-112",
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("an unknown tag is still refused — the set stays closed", () => {
    const parsed = planReviewSchema.safeParse({
      schema_version: 1,
      verdict: "changes",
      findings: [{ tag: "reach", finding: "x", ticket: "t-1" }],
    });
    expect(parsed.success).toBe(false);
  });
});
