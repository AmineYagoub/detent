---
id: PRDR-293
title: "Code proves defects in the plan and nothing fixes them: ksar-cloud's plan was approved with 34 of them (28 names consumed that no ticket provides, 6 names with two owners), because proved findings are only reported and the reviewer is told to treat them as handled; and requirement coverage is claimed but never checked. Mechanical checks now drive one targeted redraft, run across the whole plan in place of the review that overflowed, and block approval when they still fail"
state: OPEN
severity: major
category: capability
labels: ["prd-review", "planning-redesign", "operator-decision", "A-1‴", "coverage", "contracts"]
surface: ["src/init/contracts.ts", "src/init/plan.ts", "src/init/plan-slices.ts", "src/init/plan-whole.ts", "src/init/plan-review.ts", "src/init/present.ts", "src/cli/approve.ts", "src/kernel/plan-findings.ts", "src/schemas/init.ts", "tests/init/plan-checks.test.ts"]
prd_refs: ["A-1‴", "C-2⁗", "C-3′", "C-4″", "C-5", "C-7", "PRDR-117", "PRDR-120", "PRDR-193", "PRDR-201", "PRDR-278"]
acceptance_criteria: ["After each slice's draft, and after its revision, code checks five things. Coverage: every requirement id and baseline item of the slice is in some ticket's `requirement_ids` or `baseline_items` (A-1⁷, PRDR-278), every criterion id of those requirements is in some ticket's `criterion_ids`, and no ticket names an id from outside its slice. Contracts: every consumed name is provided in this slice or an earlier one, no name has two providers, and derived edges are added as today. Milestone order. Gate coverage (PRDR-295). And no cycle after derived edges.", "A failing slice gets one targeted redraft with the failures as its inputs, and the checks run again. A test seeds each kind of failure and asserts that the redraft receives it.", "After every slice, the same checks run across the whole plan. A name nobody provides sends one redraft to the earliest slice that consumes it; a name with two providers sends one to each owner's slice.", "What still fails blocks approval. PRESENT raises AWAIT_INFO naming each failure, and `detent approve` refuses the plan. A test drives a residual failure to that refusal.", "The whole-plan model review is gone, and with it the `already_found` hand-off and its instruction to treat proved findings as handled. Contract findings reach redrafts, and any left reach the run phase with their tickets.", "The claim in `src/schemas/init.ts` that every requirement id lands in exactly one slice is now what code checks, and the doc-block says where."]
non_goals: ["Does NOT judge what only a model can judge: sizing, shape and coherence stay the reviewer's (PRDR-294).", "Does NOT add a second redraft: one targeted attempt, then the operator.", "Does NOT add a model read of the cross-slice contracts. One is added only if run-time outcomes show tickets failing on contracts the checks passed (the redesign's decision 10)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-120", "PRDR-193", "PRDR-201"]
depends_on: ["PRDR-292", "PRDR-295"]
---

# PRDR-293 — mechanical checks that fix, and block approval

## Where this came from

The planning audit of 2026-09-26, §2 and §5.
- `resume-20260918-072057.log:144-146`: the whole-plan review was refused twice, at about 1.55M
  tokens against a 1M limit, and "the plan was never reviewed as one thing".
- The same log lists 34 contract findings proved by code. The plan was approved with all of them.

## Problem

Proved defects never reach a fix:
- The whole-plan reviewer is handed them as `already_found` and told to treat them as handled
  (`src/init/plan-review.ts:246`).
- They are kept out of `review_findings` (`src/init/plan.ts:333-345`), the only list the run phase
  reads (`src/kernel/plan-findings.ts:44-47`).
- Only PRESENT prints them.

Coverage is worse. `src/schemas/init.ts:508` states that every requirement id lands in exactly one
slice, and no code checks it.

## Design

The redesign plan's §6. A proved defect needs no reviewer to confirm it, so it drives a redraft
directly. The checks grow with the plan's size where the review grew with its text, and a failure
that survives its one redraft is the operator's before approval, not a line in a report.

## From PRDR-291

On a pack, code checks SLICE's cut (`cutIssue` in `src/init/slice-seed.ts`):
- every live requirement id in exactly one slice;
- no id the seed does not hold;
- milestone order.

The doc-block on `sliceSchema` in `src/schemas/init.ts` says where. Two things stay with this
ticket's sixth criterion. The first is the plan's coverage: whether each slice's tickets carry its
ids (A-1⁷). The second is the same claim where there is no parse, and for the baseline items at
all. There the slicer is told it, and no code checks it.

SLICE announces the session formula of planning as built (`planningSessions` in
`src/init/slice.ts`):
- at least `4N + 1`: a draft and three review reads per slice, and one whole-plan review;
- 4 more for each revision round;
- `C + 1` more when the whole-plan review faults C slices.

Deleting the whole-plan review changes that sentence, and the formula case in
`tests/init/slice-seed.test.ts` pins it.

The whole-plan review's cache key (`wholeKey` in `src/init/plan-whole.ts`) hashes the slices whole,
titles and goals included, since the review reads them. A re-cut in new words re-runs it. On a pack
that happens only when the band, the baseline or the prompt moves, since a cut on record keeps its
slices' words otherwise.

## From PRDR-292

- A ticket carries `criterion_ids` (A-1). Code refuses a draft whose ticket names a criterion the
  pack does not define, or names one without carrying its words among its acceptance criteria
  (`draftIssues` in `src/init/plan-draft-checks.ts`). Nothing counts whether every criterion of a
  slice's requirements is carried: that is this ticket's first criterion.
- A name of a catalogued kind that its catalogue lacks is a `traceability` finding among the
  contract checks (`catalogueFindings` in `src/init/contracts.ts`). PRDR-292's third criterion
  calls it a contract failure of this ticket's. It is reported and refuses nothing. Turning it into
  a redraft's input, and holding approval on it, is this ticket's.
- `already_found` hands the whole-plan review the contract checks' findings, and two coverage
  findings in `src/init/contracts.ts` cite PRD marks (`A-1⁵`, `C-8`). A drafter's inputs cite none
  (C-4⁷). Once this ticket hands proved findings to a redraft, their words reach a drafter, so they
  should cite none either.
- A redraft reports spec defects as a first draft does, and PLAN keeps each draft's once per slice
  and set of passages: the revision's in `src/init/plan-slices.ts`, the whole-plan redraft's in
  `src/init/plan-whole.ts`. A targeted redraft can keep them the same way.
- Without a pack, `prompts/slice.md` now states that placing every requirement id the documents
  define is the slicer's own judgement, since no parse lists those ids. This ticket's sixth
  criterion still covers the claim there.
