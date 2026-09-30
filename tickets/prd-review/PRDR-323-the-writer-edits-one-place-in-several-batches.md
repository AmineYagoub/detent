---
id: PRDR-323
title: "VALIDATE's writer can edit one place in several batches, none aware of the others, and runs minors among the blockers. C-2²⁴ cuts a round's findings into batches of at most 20, in the areas' order. On tabachir's first round, 134 of the 379 findings share their first place with another finding, and cut in the areas' order, 22 of those places fall in two or more of the 19 batches. The first batch already holds a minor, and the last batch holding a blocker is the seventeenth. Batches will hold the findings that share a first place together, ordered by their most severe finding, so one edit settles a place, blockers land first, and the batches of minors run last, where the ledger shows what minors cost"
state: OPEN
severity: minor
category: quality
labels: ["prd-review", "cost-strategy", "C-2²⁷", "C-2²⁴", "validate", "writer"]
surface: ["src/init/validate-fix.ts", "src/init/validate.ts", "tests/init/validate-fix-batch.test.ts", "tests/init/validate-writer.test.ts", "detent-prd-v3.md"]
prd_refs: ["C-2¹⁴", "C-2²⁴", "D-35"]
acceptance_criteria: ["Findings whose first place is the same file and line form one group, and a group is never split across two batches unless it holds more than VALIDATE_FIX_BATCH findings.", "Groups are ordered by their most severe finding, blocker before major before minor, then by the file and line of their first place. Batches are cut in that order, on group boundaries, as few and as even as C-2²⁴ cuts them.", "The writer's note says how many batches hold only minors, and those batches' ledger rows are what fixing the minors that share no place with a blocker or a major cost.", "The checker's findings keep their one session (C-2²⁴).", "Falsifying tests, against HEAD: two findings from different areas with the same first place land in different batches of one round, and a batch holding only minors runs before a batch holding a blocker."]
non_goals: ["Does NOT change the batch size, the checks on a batch, or what a failed batch undoes.", "Does NOT run batches at once. All but one of round 1's findings are linked through the files they cite, so no two batches could safely edit together.", "Does NOT change whether minors are fixed. They are, as specification decision 3 says."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-284", "PRDR-314", "PRDR-318"]
depends_on: ["PRDR-318"]
---

# PRDR-323 — the writer takes a place's findings together, most severe first

## Where this came from

The cost plan (`docs/plan-cost-strategy.md` §4.5, §7) measured tabachir's 21 kept reviews while the
user weighed listing minor findings instead of fixing them. Minors stay fixed. The measurement also
showed how the writer's batches fall.

## Problem

- **One place, several batches.** `fixBatches` (`src/init/validate-fix.ts`) cuts the round's
  findings in the order `mergeFindings` gives them, the areas' order. Reviewers of different areas
  quote the same text: 134 of the 379 findings share their first place with another, in 303
  distinct first places, at most five to a place. Cut in the areas' order into 19 batches, 22 of
  those places fall in two or more batches. Each batch's writer edits a place without seeing what
  another batch will ask of it. The second may undo the first, fix the same thing again, or
  decline it as already fixed.
- **Minors among the blockers.** The first batch already holds a minor, and the seventeenth is the
  last to hold a blocker. A batch the checks undo takes its blockers down with its minors, and the
  ledger cannot say what the minors cost, which the user asked on 2026-09-30.

## Design

- **Group by first place.** Findings with the same first file and line form one group, split only
  if it holds more than `VALIDATE_FIX_BATCH` findings.
- **Most severe first.** Groups are ordered by their most severe finding, then by file and line.
  A minor that shares a place with a blocker goes with the blocker. The 74 minors that share their
  first place with no blocker or major come last, in batches of their own.
- **Cut on group boundaries,** as few and as even as C-2²⁴ cuts them.
- **The note** says how many batches hold only minors, so their ledger rows price the minors.
- **The PRD:** C-2²⁷ amends C-2²⁴'s order.

## Building it

- `src/init/validate-fix.ts`: grouping and order before `fixBatches`; a batch cut that respects
  groups.
- `src/init/validate.ts`: the round passes its findings through the new order.

### Vetoable calls

1. **The first place, not any shared place.** Linking findings through any place they share joins
   363 of the 379 into one group, which no batch could hold.
2. **A minor at a blocker's place goes early.** One edit then settles the place, which is worth
   more than a clean split of the minors' cost.

## Falsification (to run against HEAD when this is built)

- Two findings from different areas with the same first place land in different batches.
- A batch of minors only runs before a batch holding a blocker.
