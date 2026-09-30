---
id: PRDR-326
title: "Nothing can show that a cheaper model or effort keeps quality. Output is 40% of tabachir's spend and mostly thinking, so the effort level is the largest lever left, and D-35 lets a level or a model move only past a bar measured on a project's own evidence. That evidence exists. Arm A of PRDR-317's A/B test checked 145 claims one per session on Opus 5.5 at max and found 14 wrong, and the 21 kept reviews of tabachir's first VALIDATE round hold 18 blockers in 10 areas. Two evaluation sets will be built from them and kept outside this public repository, with a runner that checks them under a named model and effort on a disposable copy and scores the result against the bar"
state: DONE
severity: major
category: capability
labels: ["prd-review", "cost-strategy", "N-8", "D-35", "evaluation", "effort"]
surface: ["src/eval/sets.ts", "src/eval/claims-set.ts", "src/eval/reviews-set.ts", "src/eval/copy.ts", "src/eval/budget.ts", "src/eval/run-units.ts", "src/eval/run.ts", "src/eval/results.ts", "src/eval/score.ts", "src/eval/report.ts", "src/init/audit-claims.ts", "src/init/audit.ts", "src/init/validate.ts", "src/init/validate-kept.ts", "src/cli/init.ts", "scripts/eval-build.ts", "scripts/eval-run.ts", "scripts/eval-score.ts", "tests/eval/score.test.ts", "tests/eval/sets.test.ts", "tests/eval/reviews-set.test.ts", "tests/eval/run.test.ts", "tests/eval/eval-fixture.ts", "tests/eval/review-fixture.ts", "docs/evaluation.md", "package.json", "detent-prd-v3.md"]
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

## Built

### Vetoable calls, added while building

5. **Arm A's briefs are the one-claim artifacts of its checks.** Arm A ran on a build before
   PRDR-306, and each of its check sessions wrote its one brief at the top of its artifact. The
   grouped checks that ran later on the same copy wrote envelopes of briefs, which the brief schema
   refuses, so none of them is read as arm A's. The set keeps the brief AUDIT committed for the
   claim. A committed verdict that differs from the artifact's refuses the set.
6. **The 30 confirmed claims are the first 30 in the order of their hashes.** Nobody chose that
   order, so the sample favours no kind of claim. A `confirmed` brief names its source, as the
   schema requires (C-2⁶), so all 30 were confirmed from a source.
7. **The claims set's tree is the copy's last commit.** WRITE rewrote the documents after AUDIT
   and commits nothing, so the working files are not what the checks read, and the commit is. Each
   claim's passage must be found in that tree, or the set is refused.
8. **A kept review is proven by its key, not by its round or its area's name.** The builder works
   out each area's round-1 task from the tree with VALIDATE's `roundTasks`. It takes a kept review
   only where that task and the tree's files give the key the review was kept under. On tabachir,
   21 of the 24 kept reviews were proven; the other three reviewed an earlier pack. The set keeps
   each area's blockers, and counts the reviewers' other findings without keeping them.
9. **Staging commits to a branch of the copy**, `detent-eval/claims` or `detent-eval/reviews`,
   under a fixed evaluation identity with `--no-verify`. It never stages over uncommitted work
   outside `.detent/`.
10. **A route nothing has measured is estimated at the dearest measured figure of its kind**: $2.86
    and 7.8 minutes a claim check, $9.64 and 31.5 minutes a review, both measured on Opus 5.5 at
    `max`. A dearer estimate makes the budget refuse a session sooner, never later.
11. **A budget refusal stops every later unit; a failed session stops only its own.** The budget is
    what the user approved. A failed session is one unit's missing evidence, and the others still
    measure.
12. **When two quotes overlap.** Two quotes of one file overlap where their places in the file's
    text meet, whitespace aside. Where either quote is not in the text, one holding the other, or a
    run of 24 characters they share, stands for it.
13. **Four verdicts and their exits.** PASS exits 0, FAIL 1, PENDING or INCOMPLETE 3, and a
    refusal 2. An evaluation with a unit that did not finish is INCOMPLETE, and never passes.
14. **The sets are at `~/detent-evals/tabachir`**, built from `~/tabachir-detent-test`, which the
    builder only reads.
15. **Earlier answers are removed from the copy before any session starts.** AUDIT checks only a
    claim with no committed brief, and a first-round reviewer never finds a kept review of its own
    area. The copies held both: `~/tabachir-detent-ab` held arm B's 107 committed briefs and its
    grouped artifacts, and a second evaluation on a copy would find the first one's. The runner
    removes each such record and names them in a note:
    - claims: briefs, check artifacts, AUDIT's checkpoint, and the init journal;
    - reviews: the kept reviews and the round's state, review artifacts, VALIDATE's checkpoint, and
      the journal.

    The journal goes because it ends each session's entry with its last words. Other claims'
    briefs stay, since AUDIT's sessions could read the briefs of claims checked before theirs.
16. **`--only wrong` checks only the claims arm A found wrong.** A re-run of today's setup asks
    whether a second run finds the 14 again. The 30 confirmed claims would add about $86 at `max`
    without bearing on that. A cheaper setup is still run on all 44.
17. **Each check's brief is kept in the results**, since the next evaluation on the copy removes
    the committed one.

### What changed

- `src/eval/`, new:
  - `sets.ts`: the two sets' schemas. A set is `set.json` and `tree/`, each file with its sha256.
    It also holds the tree helpers (working files, committed files, diff) and the guards that keep
    a set out of this repository and out of the copy it was read from.
  - `claims-set.ts`: the claims set, from the copy's survey, arm A's one-claim artifacts and the
    briefs AUDIT committed.
  - `reviews-set.ts`: the reviews set. Each kept review is proven by `reviewKey` against the round-1
    task `roundTasks` gives.
  - `copy.ts`: the copy guards, staging, and `clearAnswers`.
  - `budget.ts`: the figure, the spend since the start from the copy's ledger, and `EvalBudget`.
  - `run-units.ts`: each claim through `checkOneClaim` on `verifyClaimsInputs`, and each area
    through `reviewArea` on the task its kept review was given, proven again by its key on the
    copy.
  - `run.ts`: `runEvaluation`. It holds the lock, says the estimate, routes the role, uses one
    journal for the phase, and reads the results from ledger rows.
  - `results.ts`: the results files.
  - `score.ts`: the bar.
  - `report.ts`: scores results against the set they ran on.
- `src/init/audit-claims.ts`: `checkOneClaim`, AUDIT's check of one claim, exported for N-8.
  `briefFrom`, `readBriefs` and `checkClaim` take the narrower `OneCheckDeps`.
- `src/init/audit.ts`: `verifyClaimsInputs`, the check session's inputs, used by AUDIT and N-8.
- `src/init/validate.ts`: `roundTasks`, a round's documents, areas and tasks, used by the round
  loop and N-8.
- `src/init/validate-kept.ts`: `reviewKey` exported.
- `src/cli/init.ts`: `defaultBackend` exported.
- `scripts/eval-build.ts`, `scripts/eval-run.ts`, `scripts/eval-score.ts`, with `eval:build`,
  `eval:run` and `eval:score` in `package.json`.
- `tests/eval/`, new: `score.test.ts` (9 tests), `sets.test.ts` (6), `reviews-set.test.ts` (4),
  `run.test.ts` (20), and two fixtures: a copy arm A ran on, and a copy whose round 1 stopped with
  reviews kept. None holds tabachir's text.
- `docs/evaluation.md`, new: the sets, building, running and its guards, the bar, settling, exits,
  and why runs differ.
- `detent-prd-v3.md`: N-8's built note.

The sets built from tabachir's test copy:
- **The claims set**: 14 wrong and 30 confirmed, from arm A's 145 briefs (80 confirmed, 14 wrong,
  51 unverified), with a tree of 29 files.
- **The reviews set**: 18 blockers in 10 areas, whose reviews hold 200 findings, with a tree of 79
  files and a pack of 49 documents.

Both trees check out:
- The claims set's tree is the tree of `~/tabachir-detent-ab`'s and `~/tabachir-detent-ab2`'s HEAD
  (`fef67a7`).
- Every one of the 21 proven keys was computed again by the current code.

### Falsification

Against HEAD (`f1fd932`), the four test files were run in a worktree of HEAD with only `tests/eval/`
copied in. All four failed at their first import, since nothing at HEAD builds a set, runs an
evaluation or scores one:

```
FAIL  tests/eval/reviews-set.test.ts: Cannot find module '../../src/eval/reviews-set.js'
FAIL  tests/eval/run.test.ts: Cannot find module '../../src/eval/claims-set.js'
FAIL  tests/eval/score.test.ts: Cannot find module '../../src/eval/score.js'
FAIL  tests/eval/sets.test.ts: Cannot find module '../../src/eval/claims-set.js'
Test Files  4 failed (4)
```

The ticket's three scorer cases are in `score.test.ts`: an arm that misses one wrong claim fails, one
that reports a blocker as a minor fails, and one that finds all 32 items passes.

The answer clearing, `--only wrong` and the kept briefs came after the first battery. Their six
tests were run against the sources as they stood before them (the battery's snapshot, restored after
and checked with `cmp`), and all six failed:

```
× scores an evaluation of the wrong claims alone on those, and one that left out the confirmed ...
  → expected { verdict: 'incomplete', …(6) } to match object { verdict: 'pass', …(3) }
× removes every earlier verdict on a claim of the set from the copy before a session starts, ...
  → expected [ …(8) ] to deeply equal [ Array(1) ]
× keeps in its results the brief each check committed, since the next evaluation on the copy removes it
  → expected [ …(5) ] to deeply equal [ …(5) ]
× checks only the claims arm A found wrong where asked, and is scored on those alone
  → expected [ { role: 'audit', …(11) }, …(4) ] to have a length of 3 but got 5
× removes the copy's kept reviews, review artifacts and VALIDATE's checkpoint before a reviewer starts
  → expected [ …(3) ] to deeply equal []
× runs only a claims set on the claims arm A found wrong alone
  → promise resolved "{ schema_version: 2, …(13) }" instead of rejecting
```

### Mutation battery

Each mutant was applied to snapshot copies of the 15 source files, and `tests/eval/` was run. The
file was then restored from its copy and checked with `cmp`, and all 15 were checked again after
each pass.

**The first pass, of 45, was void.** The mutant that lets a set be written inside this repository
wrote one at `evals/`. Every later run then failed the test that asserts no such directory exists,
whatever its own mutant did. The set was removed. The battery was changed to remove it after each
mutant and to report any other file a mutant leaves (none did).

**The second pass: 64 mutants, 62 killed.** It re-ran the 45 and added 19 for what came after them.
The two survivors:
- **units: a refusal does not stop** is equivalent. `inBatches` hands a worker the next unit as soon
  as its last one ends. A refusal ends a unit at once, in `admit`, before any await could let a
  session in flight finish. So after the budget refuses one unit, the pool hands out every unit
  left before anything changes, and each is refused in turn, in the same words. `stopped` keeps
  "starts no later one" true by construction rather than by that ordering, so it stays.
- **report: another build of the set** survived because nothing tested the refusal. `run.test.ts`
  now does, for results from another build of the set and for results of the other kind. With that
  test both that mutant and a new one, **report: another kind scored**, are killed.

| Mutant | Result |
|---|---|
| score: unverified counts as wrong | killed, 1 test |
| score: a minor counts | killed, 3 tests |
| score: a major does not count | killed, 3 tests |
| score: any file | killed, 1 test |
| score: quotes always overlap | killed, 4 tests |
| score: spans not read | killed, 4 tests |
| score: shared run of five | killed, 1 test |
| score: settlement against ignored | killed, 1 test |
| score: unsettled passes | killed, 2 tests |
| score: unfinished claims pass | killed, 3 tests |
| score: unrun areas ignored | killed, 1 test |
| score: unjudged counted missed | killed, 1 test |
| sets: tree digest unread | killed, 1 test |
| sets: inside the repository allowed | killed, 1 test |
| sets: inside the copy allowed | killed, 1 test |
| sets: an existing directory reused | killed, 1 test |
| sets: .detent in the tree | killed, 4 tests |
| claims: committed verdict unchecked | killed, 1 test |
| claims: artifact kept over committed | killed, 1 test |
| claims: hash order reversed | killed, 1 test |
| claims: passages unchecked | killed, 1 test |
| sets: committed bytes read from the working files | killed, 18 tests |
| reviews: kept by area name | killed, 2 tests |
| reviews: areas without blockers kept | killed, 3 tests |
| budget: in flight not counted | killed, 1 test |
| budget: spend unread | killed, 1 test |
| budget: never released | killed, 1 test |
| budget: earlier rows counted | killed, 1 test |
| copy: the source copy allowed | killed, 1 test |
| copy: a worktree allowed | killed, 1 test |
| copy: a held copy allowed | killed, 1 test |
| copy: differing files allowed | killed, 7 tests |
| copy: staged over uncommitted work | killed, 1 test |
| copy: staged on the current branch | killed, 1 test |
| units: a refusal does not stop | survived: equivalent, see below |
| units: a failure stops all | killed, 1 test |
| units: review key not proven | killed, 1 test |
| run: route model not applied | killed, 1 test |
| run: route effort not applied | killed, 1 test |
| run: claims under VALIDATE | killed, 1 test |
| run: no lock | killed, 7 tests |
| run: estimate at four | killed, 1 test |
| run: spend of every row | killed, 1 test |
| run: no budget needed | killed, 1 test |
| report: another build of the set | survived; killed, 1 test, once the test below was added |
| clear: never called | killed, 2 tests |
| clear: set claims' briefs kept | killed, 1 test |
| clear: every brief removed | killed, 1 test |
| clear: check artifacts kept | killed, 1 test |
| clear: AUDIT checkpoint kept | killed, 1 test |
| clear: kept reviews kept | killed, 1 test |
| clear: review artifacts kept | killed, 1 test |
| clear: VALIDATE checkpoint kept | killed, 1 test |
| clear: journal kept | killed, 2 tests |
| clear: unnoted | killed, 2 tests |
| results: brief not kept | killed, 1 test |
| only: ignored by the check | killed, 1 test |
| only: the confirmed checked instead | killed, 1 test |
| only: not passed to the check | killed, 1 test |
| only: not recorded | killed, 1 test |
| only: estimate counts every claim | killed, 1 test |
| only: scored on every claim | killed, 2 tests |
| only: header unmarked | killed, 1 test |
| only: a reviews set allowed | killed, 1 test |
| report: another kind scored | killed, 1 test (run with the test below) |

### Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: 215 files, 2,377 passed and 2 skipped (2,379).
- `npm run plugin`: wrote nothing that changed.

### Recorded, not fixed

- **No resume.** An evaluation writes its results when it ends. One stopped part-way leaves its
  spend on the copy's ledger and its briefs in the copy, and the next evaluation there starts over
  and removes those briefs.
- **No set for the writer or the planner.** N-8's sets measure a claim check and a first-round
  review. Nothing measures `spec_write`, the planner or `plan_review`, so S-5⁷ can move none of them.
- **The reviews set measures the first round only.** A later round's reviewer is given the round
  before's findings and the diff of its fixes. No set holds such a round.
