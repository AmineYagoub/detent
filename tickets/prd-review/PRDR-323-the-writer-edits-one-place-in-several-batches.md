---
id: PRDR-323
title: "VALIDATE's writer can edit one place in several batches, none aware of the others, and runs minors among the blockers. C-2²⁴ cuts a round's findings into batches of at most 20, in the areas' order. On tabachir's first round, 134 of the 379 findings share their first place with another finding, and cut in the areas' order, 22 of those places fall in two or more of the 19 batches. The first batch already holds a minor, and the last batch holding a blocker is the seventeenth. Batches will hold the findings that share a first place together, ordered by their most severe finding, so one edit settles a place, blockers land first, and the batches of minors run last, where the ledger shows what minors cost"
state: DONE
severity: minor
category: quality
labels: ["prd-review", "cost-strategy", "C-2²⁷", "C-2²⁴", "validate", "writer"]
surface: ["src/init/validate-fix.ts", "src/init/validate.ts", "tests/init/validate-writer-order.test.ts", "detent-prd-v3.md"]
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

## Built

### Vetoable calls, added while building

3. **The minors alone are cut apart from the rest.** Cutting all the groups together packs minors
   into a batch with majors wherever there is room, and then no batch's ledger rows are what the
   minors cost, which is the point of running them last. Cut apart, a round can take one batch more
   than cutting them together: tabachir's first round takes 20 batches, not 19.
4. **"Minors alone" is judged by place, across the round.** A batch of minors whose place a blocker
   or a major shares is not counted, even when it holds nothing else. That happens only at a place
   with more findings than a batch holds, which is split, and whose tail can be all minors.
5. **The cost note follows any round's writer that ran a batch of minors alone,** a writer of one
   batch included. C-2²⁴'s note before the writer stays for more than one batch, as it was.
6. **Even means near an even share, not a search for the most even cut.** Each batch aims at an
   even share of what is left and takes the group that crosses its share when that lands nearer
   the share, or when stopping short would leave more than the batches after it can hold. The
   count is always the fewest whole groups allow. On tabachir's first round the batches hold 18 to
   20 findings each.

### What changed

- `src/init/validate-fix.ts`: `writerBatches` groups a round's findings by the file and line of
  their first place, puts each group's most severe finding first, and orders the groups most
  severe first, then by file and line. The groups holding a blocker or a major and the groups of
  minors alone are cut apart, each on group boundaries into the fewest batches of at most
  `VALIDATE_FIX_BATCH`, each batch near an even share of what is left (`cutOnBoundaries`,
  `fewestBatches`). A group larger than a batch is cut by `fixBatches`, as C-2²⁴ cut findings.
  `minorsAlone` names the batches that hold only minors at places no blocker or major of the round
  shares. `fixFindings` says how many there are in C-2²⁴'s note, and after the writer says what
  they cost, summed from the ledger rows their sessions wrote.
- `src/init/validate.ts`: the round passes its findings through `writerBatches`. The checker's
  findings still go to one session.
- `detent-prd-v3.md`: C-2²⁷'s built note.
- `tests/init/validate-writer-order.test.ts`: 13 tests, three of them through `init` to VALIDATE's
  writer.

### What it does on tabachir's first round

`writerBatches` and C-2²⁴'s cut, run on the 379 findings of the 21 areas' kept reviews
(a scratch script, read only, no session):

```
C-2²⁴ areas' order: 19 batches, sizes 20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,19; places split across batches: 20; first batch with a minor: 1; last with a blocker: 17; batches of minors alone: 0 (); findings 379 (blocker 18, major 267, minor 94); distinct first places 303
C-2²⁷: 20 batches, sizes 20,19,18,20,19,19,19,20,20,18,19,18,18,20,18,20,19,19,18,18; places split across batches: 0; first batch with a minor: 4; last with a blocker: 2; batches of minors alone: 4 (17,18,19,20); findings 379 (blocker 18, major 267, minor 94); distinct first places 303
minors in batches alone: 74
```

The 20 places split here, against the plan's 22, come from the order the probe merged the kept
reviews in, which is not quite `mergeFindings`' order. The new cut does not depend on that order.

### Falsification

The test file, run against HEAD's `validate-fix.ts` and `validate.ts` (written from `git show`,
then restored from a snapshot and checked with `cmp`): 13 of 13 failed. The two the ticket names:

```
× … gives one batch two findings from different areas that share a first place, however far apart the areas are
AssertionError: … expected [ 4, 1 ] to deeply equal [ 5 ]
× … runs the batches that hold a blocker before any batch that holds only minors
AssertionError: the blockers go first: expected [ 'minor', 'minor', 'minor', 'minor' ] to deeply equal [ 'blocker', 'blocker', …(2) ]
```

On HEAD the shared place's five findings fell in two batches, four and one, and the first batch was
all minors while the blockers came later. The unit tests failed on `writerBatches is not a
function`, and the note tests found no C-2²⁷ note.

### Mutation battery

Each mutant was applied to snapshot copies of `validate-fix.ts` and `validate.ts`, five suites were
run, and the file was restored from its copy and checked with `cmp`. The first pass, on the cut
first written, left one survivor, a group's findings left unsorted inside: every test gave the
blocker before the minor at its place. The order test now gives the minor first. A probe on
tabachir's round then showed that the first cut was not even (fifteen batches of 20 and one of 7),
and a random search showed the first even cut could leave groups over. So the cut was rewritten,
with tests for both, and the battery was run again on the final code: 23 mutants, 23 killed.

| Mutant | Result |
|---|---|
| group by file only | killed, 2 tests |
| no groups | killed, 5 tests |
| groups not by severity | killed, 2 tests |
| lines descending | killed, 1 test |
| files descending | killed, 8 tests |
| placeless first | killed, 1 test |
| minors cut together | killed, 2 tests |
| groups split | killed, 3 tests |
| big group whole | killed, 2 tests |
| alone ignores places | killed, 1 test |
| alone: any batch | killed, 4 tests |
| minors unpriced | killed, 2 tests |
| every batch priced | killed, 1 test |
| no cost note | killed, 2 tests |
| count says batches | killed, 1 test |
| round uses one batch | killed, 6 tests |
| greedy cut | killed, 5 tests |
| never cross the share | killed, 1 test |
| no feasibility check | killed, 1 test |
| feasibility off by one | killed, 1 test |
| fewest counts exact fits over | killed, 1 test |
| share rounds down | killed, 2 tests |
| group unsorted inside | killed, 1 test |

### Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: 207 files, 2,298 passed and 2 skipped (2,300). A first run passed every test and
  exited 1 on one vitest worker timeout ("Timeout calling onTaskUpdate") at a load average above
  100 from Spotlight indexing; the run again was clean.
- `npm run plugin`: wrote nothing that changed.

### Recorded, not fixed

- **The minors at a blocker's or a major's place are not priced apart.** They are fixed in the same
  batch as the serious finding at their place, by vetoable call 2, and their share of that batch's
  cost cannot be read from the ledger. The note prices only the minors alone: 74 of tabachir's 94.
- **The batches still run one at a time.** The ticket's non-goal stands: all but one of round 1's
  findings are linked through the files they cite.
