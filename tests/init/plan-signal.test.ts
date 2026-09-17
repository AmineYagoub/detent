import { describe, expect, it } from "vitest";
import { presentStage } from "../../src/init/present.js";
import { labelHeld, revisionOutcome } from "../../src/init/plan-signal.js";

/**
 * PRDR-196 — the plan's quality signal: what code PROVED, and what the revision
 * round did.
 *
 * Split from `stages.test.ts` and `slicing.test.ts` by responsibility. Those
 * files ask whether a stage runs and whether slices are planned and reused;
 * this one asks a different question — is the reliable half of the evidence
 * reaching the person who decides, and is the loop that produces the other half
 * measured at all. The pipeline-integration cases stay where the pipeline
 * fixtures are; what lives here is the pure measurement and its presentation.
 */

describe("PRDR-196 the revision round is measured, not assumed", () => {
  it("separates what was resolved, what survived and what the round introduced", () => {
    const before = [
      { tag: "sizing" as const, ticket: "t-a", finding: "too big" },
      { tag: "dependency" as const, ticket: "t-b", finding: "missing edge" },
    ];
    const after = [
      { tag: "sizing" as const, ticket: "t-a", finding: "still too big, differently worded" },
      { tag: "coherence" as const, ticket: "t-c", finding: "brand new complaint" },
    ];
    expect(revisionOutcome(before, after)).toEqual({ resolved: 1, survived: 1, introduced: 1 });
  });

  it("reads a clean revision as all resolved and nothing introduced", () => {
    const before = [{ tag: "sizing" as const, ticket: "t-a", finding: "too big" }];
    expect(revisionOutcome(before, [])).toEqual({ resolved: 1, survived: 0, introduced: 0 });
  });

  it("counts a round that fixed nothing and added nothing as pure survival", () => {
    const same = [{ tag: "sizing" as const, ticket: "t-a", finding: "too big" }];
    expect(revisionOutcome(same, [{ ...same[0]!, finding: "reworded" }])).toEqual({ resolved: 0, survived: 1, introduced: 0 });
  });

});

/**
 * PRDR-196 — the reliable signal reaches the operator.
 *
 * `applyContracts` is deterministic and free; the whole-plan review is a paid
 * session whose findings the literature calls the unreliable half. Detent
 * surfaced 74 of the paid ones at PRESENT and zero of the mechanical ones —
 * `plan.ts` noted them to the log and never carried them into the outputs.
 *
 * Run against the finished gate-312 plan, the checker produces 7, including the
 * one certain failure in it: two tickets both creating
 * `plugin/skills/init/SKILL.md`. That was proved, for nothing, and shown to
 * nobody.
 */
describe("PRDR-196 what code proved reaches PRESENT, labelled as proved", () => {
  const contractFindings = [
    { tag: "coherence" as const, ticket: "t-s12-012", finding: "two tickets both create `plugin/skills/init/SKILL.md`" },
  ];
  const base = {
    root: "/tmp/x",
    tickets: [],
    bindings: [],
    skips: [],
    bootstrap: null,
    assignments: {},
    slices: [],
    questions: [],
    findings: [],
    derivedEdges: [],
    gateNotices: [],
  };

  it("renders the contract findings, and says code proved them", async () => {
    const outcome = await presentStage({ ...base, contractFindings });
    const message = outcome.kind === "interrupt" ? outcome.message : "";
    expect(message).toContain("plugin/skills/init/SKILL.md");
    expect(message).toMatch(/proved by code|checked by code|no session/i);
  });

  it("keeps them separate from the review's, because one kind is reliable and the other is judgement", async () => {
    const outcome = await presentStage({
      ...base,
      contractFindings,
      findings: [{ tag: "sizing" as const, ticket: "t-s01-012", finding: "larger than one implement session" }],
    });
    const message = outcome.kind === "interrupt" ? outcome.message : "";
    expect(message).toContain("larger than one implement session");
    expect(message).toContain("plugin/skills/init/SKILL.md");
    /* Two headings, not one merged list — the operator must be able to tell them apart. */
    expect(message).toMatch(/Contract checks/i);
    expect(message).toMatch(/Review findings/i);
  });

  it("says nothing extra when code found nothing", async () => {
    const outcome = await presentStage({ ...base });
    const message = outcome.kind === "interrupt" ? outcome.message : "";
    expect(message).not.toMatch(/Contract checks/i);
  });

  /**
   * The audit of this ticket found `revision` written to every slice cache and
   * read by nothing — a measurement stored where no one looks, which is one hop
   * from the defect the ticket is about. PRESENT is where an operator decides,
   * so it is where the number belongs.
   */
  it("reports what the revision rounds did, so the measurement has a reader", async () => {
    const outcome = await presentStage({ ...base, revisions: { resolved: 4, survived: 11, introduced: 9 } });
    const message = outcome.kind === "interrupt" ? outcome.message : "";
    expect(message).toMatch(/revision/i);
    expect(message).toContain("4");
    expect(message).toContain("11");
    expect(message).toContain("9");
  });

  it("says nothing about revisions when none ran", async () => {
    const outcome = await presentStage({ ...base });
    expect((outcome.kind === "interrupt" ? outcome.message : "")).not.toMatch(/resolved/i);
  });
});

/**
 * PRDR-269 (D-25) — the marking a held finding carries is read off the same
 * arithmetic that counts it.
 *
 * `plan-slices.ts` marked every finding of the post-revision review
 * `after-revision`, a label whose doc-block says it "survived a revision that
 * was paid to remove it". Live, `revisionOutcome` reported survived 0 against
 * introduced 7, 7 and 8 over three arms of one slice: the population the human
 * met was the `introduced` bucket under a name claiming the opposite.
 */
describe("PRDR-269 a held finding is marked with the evidence behind it", () => {
  const HANDED = { tag: "sizing" as const, ticket: "t-a", finding: "too big" };
  const kindOf = (fs: readonly { readonly tag: string; readonly held?: string }[], tag: string): string | undefined =>
    fs.find((f) => f.tag === tag)?.held;

  it("a finding the revision was handed and did not remove is `after-revision`", () => {
    const held = labelHeld([HANDED], [{ ...HANDED, finding: "still too big, differently worded" }], []);
    expect(kindOf(held, "sizing"), "same (ticket, tag) before and after").toBe("after-revision");
  });

  it("a finding that did not exist when the revision was paid is `introduced`", () => {
    const held = labelHeld([HANDED], [{ tag: "coherence" as const, ticket: "t-c", finding: "brand new" }], []);
    expect(kindOf(held, "coherence")).toBe("introduced");
  });

  it("the two populations agree with `revisionOutcome` over the same pair of reads", () => {
    const before = [HANDED, { tag: "dependency" as const, ticket: "t-b", finding: "missing edge" }];
    const after = [{ ...HANDED, finding: "reworded" }, { tag: "coherence" as const, ticket: "t-c", finding: "new" }];
    const counts = revisionOutcome(before, after);
    const held = labelHeld(before, after, []);
    expect(held.filter((f) => f.held === "after-revision")).toHaveLength(counts.survived);
    expect(held.filter((f) => f.held === "introduced")).toHaveLength(counts.introduced);
  });

  it("a finding naming no ticket is never called a survivor, because it cannot be matched", () => {
    const plainTag = { tag: "sizing" as const, finding: "the plan as a whole is too big" };
    const held = labelHeld([HANDED], [plainTag], []);
    expect(kindOf(held, "sizing"), "unmatched is honestly unknown, not silently survived").toBe("introduced");
  });

  it("what fell below the sample threshold travels as `seen-once`", () => {
    const held = labelHeld([], [], [{ tag: "coverage" as const, ticket: "t-d", finding: "one read saw this" }]);
    expect(kindOf(held, "coverage")).toBe("seen-once");
  });
});
