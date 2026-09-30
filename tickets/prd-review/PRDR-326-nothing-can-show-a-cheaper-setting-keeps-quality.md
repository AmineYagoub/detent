---
id: PRDR-326
title: "Nothing can show that a cheaper model or effort keeps quality. Output is 40% of tabachir's spend and mostly thinking, so the effort level is the largest lever left, and D-35 lets a level or a model move only past a bar measured on a project's own evidence. That evidence exists. Arm A of PRDR-317's A/B test checked 145 claims one per session on Opus 5.5 at max and found 14 wrong, and the 21 kept reviews of tabachir's first VALIDATE round hold 18 blockers in 10 areas. Two evaluation sets will be built from them and kept outside this public repository, with a runner that checks them under a named model and effort on a disposable copy and scores the result against the bar"
state: OPEN
severity: major
category: capability
labels: ["prd-review", "cost-strategy", "N-8", "D-35", "evaluation", "effort"]
surface: ["scripts/eval-build.ts", "scripts/eval-run.ts", "src/eval/sets.ts", "src/eval/score.ts", "tests/eval/score.test.ts", "tests/eval/sets.test.ts", "docs/evaluation.md", "package.json", "detent-prd-v3.md"]
prd_refs: ["D-35", "D-34′", "C-2¹¹", "C-2¹⁴", "S-5⁵", "N-5′"]
acceptance_criteria: ["A claims set holds the 14 claims arm A found wrong and 30 it confirmed from a primary source, each with its survey wording and arm A's brief, read from the disposable copy where arm A ran.", "A reviews set holds the 10 areas whose kept reviews hold the 18 blockers: each area's documents as the reviewers saw them, its foundations, its round inputs, and its blockers with their places.", "Both sets are written under a directory the operator names, outside this repository. Nothing of a project's text is committed here; the repository holds the builder, the runner, the scorer and their tests, and docs/evaluation.md says how to use them.", "The runner checks a set's claims, or reviews its areas, with a named model and effort, through the launch path and prompts init uses. It runs only on a disposable copy the operator names, never on the project the set came from, four at a time, and records every session in that copy's ledger.", "The scorer applies D-35's bar. All 14 are found wrong and none is confirmed. None of the 30 is called wrong unless the arm's source shows arm A was mistaken, and each such claim is listed for a person to settle. Each blocker is reported at its place, the same file and a quote overlapping the blocker's, as a blocker or a major. It prints pass or fail, each miss, the spend and the wall clock.", "The runner prints its estimated cost before it starts and its spend as it goes. It starts only with an explicit --budget-usd, and launches no session that its estimate says would pass that budget.", "Falsifying tests, against HEAD: the scorer's cases fail, since nothing scores: an arm that misses one wrong claim must fail, one that reports a blocker as a minor must fail, and one that finds all 32 items must pass."]
non_goals: ["Does NOT run any arm. PRDR-327 does, within a budget the user approves.", "Does NOT change a routing, a prompt or a phase.", "Does NOT put a project's documents, claims or findings in this public repository."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-317", "PRDR-313", "PRDR-318", "PRDR-319", "PRDR-322", "PRDR-327"]
depends_on: ["PRDR-318", "PRDR-319"]
---

# PRDR-326 — evaluation sets, their runner, and D-35's bar

## Where this came from

The cost plan (`docs/plan-cost-strategy.md` §5) found that the largest lever left is the effort
level. Output was 40% of tabachir's spend, and thinking was 75% of a claim check's output and 84%
of a review's. D-35 lets a level or a model move only past a bar measured on evidence, and PRDR-317
showed why. Grouped claim checks looked like a pure saving, and on a real set they found three
fewer wrong claims.

## Problem

There is no way to ask whether a cheaper setting keeps quality. Everything needed exists, but
nothing assembles it:
- **Claims.** Arm A checked all 145 of tabachir's claims, each in its own session on Opus 5.5 at
  `max`, and found 14 wrong. Its briefs are in the test run's state, and PRDR-317's report lists
  each wrong claim with its source.
- **Reviews.** The 21 kept reviews hold 379 findings, 18 of them blockers, in 10 areas. The pack
  they reviewed is still as they saw it, since the run stopped before the round's writer ran.

## Design

- **Two sets, built by a script** from the disposable copies, and written where the operator says,
  outside this repository:
  - claims: the 14 wrong, and 30 that arm A confirmed from a primary source, with arm A's briefs;
  - reviews: the 10 areas with blockers, their documents, foundations and inputs, and the blockers
    with their places.
- **A runner** that checks or reviews a set under a named model and effort, through `init`'s own
  launch path and prompts. It runs only on a disposable copy the operator names, four at a time,
  and never without a budget.
- **A scorer** that applies D-35's bar and prints pass or fail with every miss. Where an arm calls
  one of the 30 confirmed claims wrong and its source says why, the claim is listed for a person to
  settle, since arm A can be the one mistaken.
- **Runs differ.** The runner can re-run today's setup on the same set, so that a miss can be told
  apart from run-to-run variation. PRDR-317's two arms disagreed on 15 of the 107 claims both
  checked.
- **The PRD:** N-8.

## Building it

- `src/eval/sets.ts` and `scripts/eval-build.ts`: the sets.
- `scripts/eval-run.ts`: the runner, on `launchInitSession`.
- `src/eval/score.ts`: the bar.
- `docs/evaluation.md`: how to build, run and read an evaluation.

### Vetoable calls

1. **The sets stay out of this repository.** Tabachir's documents are public, but a set built from
   a private project would not be, and the tool should not assume either.
2. **30 confirmed claims, not all 145.** The bar is mostly about the 14 wrong. The 30 are there to
   catch an arm that calls everything wrong, at a third of the cost of all 145.
3. **A blocker reported as a major passes.** Both are fixed. What the bar must catch is a blocker
   nobody reports.
4. **The runner holds to its budget.** Spend caps are advisory for a run, which exists to finish
   the work. An evaluation is spend the user approved in advance, and nothing is lost by stopping
   it.

## Falsification (to run against HEAD when this is built)

The scorer's cases fail against HEAD, since nothing scores an evaluation:
- an arm that misses one of the 14 wrong claims fails;
- an arm that reports a blocker as a minor fails;
- an arm that finds all 32 items passes.
