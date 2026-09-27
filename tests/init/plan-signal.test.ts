import { describe, expect, it } from "vitest";
import { presentStage } from "../../src/init/present.js";
import { heldFindings, labelHeld, revisionOutcome } from "../../src/init/plan-signal.js";
import type { PlanReview } from "../../src/schemas/init.js";
import type { Binding } from "../../src/schemas/records.js";
import type { Ticket } from "../../src/schemas/ticket.js";
import { newTicket } from "../../src/kernel/tickets/mutations.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import type { SampledReview } from "../../src/init/plan-sample.js";

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
  /**
   * PRDR-293: PRESENT proves it itself now, from the tickets as they stand, so
   * two tickets that both own one file are the input rather than a finding
   * handed in; and what it proves holds approval.
   */
  const owning = (id: string): Ticket =>
    newTicket({ id, type: "feature", title: `t ${id}`, acceptance_criteria: ["it works"], surface: ["src/**"], provides: [{ kind: "file", id: "plugin/skills/init/SKILL.md", note: "the skill" }] });
  const gate: Binding = {
    schema_version: SCHEMA_VERSION,
    package: ".",
    slot: "test",
    adapter: "make",
    ref: "test",
    resolved: "make test",
    config_hash: "a".repeat(64),
    executed_at: "2026-09-27T00:00:00.000Z",
    approved_by: "auto",
    status: "approved",
  };
  const base = {
    root: "/tmp/x",
    tickets: [] as Ticket[],
    bindings: [gate],
    skips: [],
    bootstrap: null,
    assignments: {},
    slices: [],
    questions: [],
    findings: [],
    derivedEdges: [],
    gateNotices: [],
  };
  const proved = { ...base, tickets: [owning("t-s12-012"), owning("t-s12-013")] };

  it("renders what the checks prove, and says code proved them", async () => {
    const outcome = await presentStage(proved);
    const message = outcome.kind === "interrupt" ? outcome.message : "";
    expect(message).toContain("plugin/skills/init/SKILL.md");
    expect(message).toMatch(/proved by code/i);
  });

  it("keeps them separate from the review's, because one kind is reliable and the other is judgement", async () => {
    const outcome = await presentStage({
      ...proved,
      findings: [{ tag: "sizing" as const, ticket: "t-s01-012", finding: "larger than one implement session" }],
    });
    const message = outcome.kind === "interrupt" ? outcome.message : "";
    expect(message).toContain("larger than one implement session");
    expect(message).toContain("plugin/skills/init/SKILL.md");
    /* Two headings, not one merged list — the operator must be able to tell them apart. */
    expect(message).toMatch(/Checks that still fail/i);
    expect(message).toMatch(/Review findings/i);
  });

  it("says nothing extra when code found nothing", async () => {
    const outcome = await presentStage({ ...base });
    const message = outcome.kind === "interrupt" ? outcome.message : "";
    expect(message).not.toMatch(/Checks that still fail/i);
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

/**
 * PRDR-272 (D-32) — a held finding's count describes the draft its label
 * describes.
 *
 * `heldFindings` took the label from `samples.flatMap(s => s.seenOnce)`, the
 * union of both panels' sub-threshold reads, and the count from
 * `new Map(samples.flatMap(s => s.seen))`, a merge where the post-revision
 * panel overwrites the pre-revision one on a shared key. The two expressions
 * were independent, so a finding that fell below the threshold before the
 * revision and reached it after took its label from one draft and its integer
 * from the other — and, being in both `leftover` and the `seenOnce` union,
 * was emitted TWICE under contradictory labels.
 *
 * The numbers here are `t-s08-005 dependency` from run 6's s08 under `e309de3`,
 * recomputed from the six persisted draws: seen by 1 of 3 reads of the first
 * draft, 2 of 3 of the revision, against a ⌈k/2⌉ threshold of 2.
 */
describe("PRDR-272 a held finding's count and label describe the same draft", () => {
  const DEP = { tag: "dependency" as const, ticket: "t-s08-005", finding: "depends on a contract no ticket provides" };
  const KEY = "t-s08-005 dependency";
  const sample = (findings: PlanReview["findings"], seenOnce: PlanReview["findings"], seen: ReadonlyMap<string, number>): SampledReview =>
    ({ verdict: "changes", findings, seenOnce, reads: [], threshold: 2, seen }) as SampledReview;
  const before = sample([], [DEP], new Map([[KEY, 1]]));
  const after = sample([DEP], [], new Map([[KEY, 2]]));

  it("emits a finding that crossed the threshold between drafts exactly once", () => {
    const held = heldFindings([], [DEP], before, after);
    expect(held.filter((f) => f.ticket === "t-s08-005" && f.tag === "dependency")).toHaveLength(1);
  });

  it("labels it by the draft on disk, not by the draft the revision replaced", () => {
    const held = heldFindings([], [DEP], before, after);
    expect(held[0]?.held, "2 of 3 reads of the revision held it, so it did not fall below the filter").toBe("introduced");
  });

  it("gives it the count from the panel its label came from", () => {
    const held = heldFindings([], [DEP], before, after);
    expect(held[0]?.seen, "labelled by the post-revision panel, so counted by it").toBe(2);
  });

  it("carries both panels' counts, so the crossing is visible rather than merged away", () => {
    const held = heldFindings([], [DEP], before, after);
    expect(held[0]?.seen_before, "1 of 3 reads of the first draft").toBe(1);
    expect(held[0]?.seen_after, "2 of 3 reads of the revision").toBe(2);
  });

  it("omits the panel it never reached rather than recording a zero", () => {
    const onlyPre = heldFindings([], [], sample([], [DEP], new Map([[KEY, 1]])), sample([], [], new Map()));
    expect(onlyPre[0]?.seen_before).toBe(1);
    expect(onlyPre[0]?.seen_after, "absent from the panel is not seen-by-no-read-of-it").toBeUndefined();
    expect(onlyPre[0]?.seen, "labelled `seen-once` by the pre panel, so counted by it").toBe(1);
  });
});
