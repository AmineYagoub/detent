---
id: PRDR-325
title: "init spends before it says what it will cost or how long it will take. Tabachir's test init spent $534 and 9.6 hours in AUDIT before DECIDE asked the user anything, and nothing said beforehand how many claims would be checked, what that would cost, or when it would end. Before each costly step, init will state what it will run and an estimate, from this project's ledger or from Detent's measured figures, named as such. detent status will show the phase's progress, the spend so far and an estimated finish. An estimate informs and never stops, asks or waits"
state: DONE
severity: minor
category: usability
labels: ["prd-review", "cost-strategy", "N-5⁗", "status", "estimate", "spend"]
surface: ["src/init/estimate.ts", "src/init/progress.ts", "src/schemas/records.ts", "src/kernel/ledger.ts", "src/kernel/run-lock.ts", "src/init/session.ts", "src/init/audit-claims.ts", "src/init/audit.ts", "src/init/validate-round.ts", "src/init/validate-kept.ts", "src/init/validate-fix.ts", "src/init/validate.ts", "src/init/plan.ts", "src/init/plan-slices.ts", "src/init/pipeline.ts", "src/cli/status.ts", "src/cli/init.ts", "tests/init/estimate.test.ts", "tests/init/estimate-notes.test.ts", "tests/kernel/ledger-cache.test.ts", "README.md", "detent-prd-v3.md"]
prd_refs: ["N-5‴", "X-1⁷", "C-7‴", "D-35"]
acceptance_criteria: ["Before AUDIT's checks, init notes how many claims it will check, with an estimate of their cost and wall clock. It does the same before each VALIDATE round (the areas), before each round's writer (the batches), and before PLAN (the slices).", "An estimate is units times a unit's figure. The figure is the median of this project's ledger rows for the same kind of session, model and effort when there are at least five of them. Otherwise it is Detent's measured figure, which the note names with the build and project that measured it.", "The wall clock divides by the sessions run at once (PRDR-324, four until then).", "During init, detent status shows the phase, the units done and left, the spend so far, and an estimated finish from the same figures.", "No estimate stops, asks or waits (PRDR-191, PRDR-265).", "Falsifying tests, against HEAD: init notes nothing about how many claims it will check before AUDIT's first check, and detent status during init shows no estimate."]
non_goals: ["Does NOT add a spend ceiling, or a question before spending.", "Does NOT estimate run, whose tickets have no measured unit yet.", "Does NOT change what any phase runs."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-191", "PRDR-265", "PRDR-296", "PRDR-297", "PRDR-318", "PRDR-324"]
depends_on: ["PRDR-318"]
---

# PRDR-325 — cost and time shown before they are spent

## Where this came from

The user's complaint on 2026-09-30 was about time as well as tokens. The cost plan
(`docs/plan-cost-strategy.md` §4.7) found that `init` says nothing of either until it is spent.

## Problem

- **AUDIT is silent about its size.** The survey finds the claims and the triage sorts them. Then
  the checks run, 117 of them on tabachir at about $3.13 and 7.8 minutes each, with no note of how
  many or what they will cost. Tabachir's test run spent $534 and 9.6 hours in AUDIT before DECIDE
  asked the user anything.
- **VALIDATE is the same.** A round's areas and its writer's batches are known before either
  starts, and neither is announced with a cost.
- **`detent status` reports spend, not progress.** It shows the phases' spend (C-7‴, PRDR-296) and
  the plan's outcomes (N-5″), and nothing about how far the phase has come or when it will end.

## Design

- **Before each costly step,** `init` notes what it will run and an estimate of cost and wall
  clock: the claims before AUDIT's checks, the areas before each round, the batches before each
  writer, the slices before PLAN.
- **The figure per unit** is the median of this project's own ledger rows for the same kind of
  session, model and effort, when there are at least five. Otherwise it is Detent's measured
  figure, shipped in a table that names the build and the project that measured it. The first
  table comes from tabachir's run: a claim check at $3.13 and 7.8 minutes, a review at $9.64 and
  31.5 minutes.
- **Progress in `detent status`:** the phase, the units done and left, the spend so far, and an
  estimated finish.
- **Never a stop** (decision 1 of the plan).
- **The PRD:** N-5⁗.

## Building it

- `src/init/estimate.ts`: the figures, the table and the arithmetic.
- The phases' notes, before each step.
- `src/cli/status.ts`: progress and the estimated finish.

### Vetoable calls

1. **Medians, not means.** One session that ran 1,000 turns should not move every later estimate.
2. **Five rows before a project's own figure is used.** Fewer is noise.
3. **No estimate for `run`.** Its units, tickets, have no measured figure under the redesign yet.

## Falsification (to run against HEAD when this is built)

- `init` notes nothing about the number of claims before AUDIT's first check.
- `detent status` during `init` shows no estimate.

## Built

### Vetoable calls, added while building

4. **The claim check's measured figure is $2.86, not $3.13.** The plan and N-5⁗ quoted $3.13,
   which no source reproduces. The median of tabachir's 171 claim-check ledger rows is $2.86, and
   the mean $3.07; the review's median over 26 rows is $9.64, as quoted. The lengths, 7.8 and 31.5
   minutes, are the medians of the transcripts the plan measured, since those ledger rows have no
   length. N-5⁗ now says $2.86.
5. **A slice's figure is measured per slice.** A slice is a draft, its checks, a read and any
   redraft or revision, not one session, so a session's median would not price it. Each planned
   slice keeps what `init`'s ledger rows grew by while it was planned, and how long it took, in
   `state/slice-figures.json`, with the routes of the planner and the plan review. The median of
   five on the same routes is the next slice's figure. Detent has measured none yet.
6. **The row names the routed effort,** `default` where none is routed, not the effort the runtime
   reported. An estimate is looked up by the route before the session runs.
7. **Only the routed model is matched,** among the row's models, since a claim check's row also
   names the Haiku that paged its web results.
8. **The checker's writer is not estimated.** It is one session, run before any round.
9. **The estimated finish is from the note's figures,** the units left times a unit's length, a
   batch at a time. It does not re-estimate from the step's own pace so far.
10. **`detent status` names a stopped step.** The progress file stays where a step did not finish,
    and `status` shows it as the step a stopped `init` left, with how far it got, when the process
    that began it no longer holds the run lock. `detent init` clears it as it takes the lock.

### What changed

- `src/schemas/records.ts`, `src/kernel/ledger.ts`, `src/init/session.ts`: an `init` session's
  ledger row names its `task`, the `effort` its role was routed to, and its `duration_ms`, timed by
  the init session's clock around the backend's run.
- `src/init/estimate.ts`: `MEASURED`, the figures (`sessionFigure`, `sliceFigure`, medians from
  five), `estimateStep` (units times figures, and the wall clock a batch at a time), and the note's
  text, which names whose figure it is and says which units have none.
- `src/init/progress.ts`: `estimator(deps).begin(step)` notes the step with its estimate and writes
  `state/init-progress.json`; each unit's `start().done()` counts it, a slice's also keeping its
  figure; `end()` removes the file. `progressLines` is what `detent status` shows.
- The steps: AUDIT's claim checks (`audit-claims.ts`), each VALIDATE round's reviews
  (`validate-kept.ts`), each round's writer (`validate-fix.ts`), and PLAN's slices
  (`plan-slices.ts`), which counts the slices no checkpoint answers for before the first is
  planned. The pipeline gives each phase an estimator (`audit.ts`, `validate.ts`, `pipeline.ts`).
- `src/cli/status.ts`: the step `init` is in, with an estimated finish while it runs, or the step a
  stopped `init` left; `src/kernel/run-lock.ts`: `liveRunLock`, the lock's holder while it holds
  it; `src/cli/init.ts`: clears a stopped step's progress as it takes the lock.
- `README.md` and N-5⁗'s built note in `detent-prd-v3.md`.

What `init` now says, from the tests (the AUDIT and round notes on Detent's measured figures, the
others on none):

```
AUDIT: 7 claims to check, a session each, 4 at once — about $20.02 and 15.6 min, by Detent's measured figure for a claim check, $2.86 and 7.8 min on claude-opus-5-5 at max, the medians of tabachir's test run at build 34585b8, 171 ledger rows and 153 transcripts. An estimate, which nothing stops for (N-5⁗)
VALIDATE round 1: 7 areas to review, a session each, 4 at once — about $67.48 and 1 h 3 min, by Detent's measured figure for a review, $9.64 and 31.5 min on claude-opus-5-5 at max, the medians of tabachir's test run at build 34585b8, 26 ledger rows and 35 transcripts. An estimate, which nothing stops for (N-5⁗)
VALIDATE's writer, round 1: 2 batches to run — no estimate: neither this project's ledger nor Detent's measurements has a figure yet for the 2 writer batches on the routes they run on (N-5⁗)
PLAN: 1 of 2 slices to plan, one at a time, the other 1 reused as they stand — no estimate: …
```

And `detent status` while the checks run:

```
`init` is running (N-5⁗) — an estimate, which nothing stops for:
  AUDIT's claim checks: 40 of 117 done, 77 left, 4 at once; $3.50 spent on them so far
  estimated to finish in about 2 h 36 min, around 13:36, by Detent's measured figure …
```

At tabachir's scale, 117 claims to check would have been announced at about $334.62 and 3 h 54 min
before the first one ran.

### Falsification

`tests/init/estimate-notes.test.ts` imports only what HEAD has. Run against HEAD's sources
(written from `git show`, then restored from a snapshot and checked with `cmp`), 6 of its 6 tests
failed. The two the ticket names:

```
× N-5⁗ AUDIT says what its checks will cost before the first one starts > notes how many claims it will check, …
  → check Stripe fact 0.
× N-5⁗ AUDIT says what its checks will cost before the first one starts > detent status, during the checks, shows the step, …
  → expected 'no tickets\n\nWhat `init` has spent o…' to contain '`init` is running (N-5⁗)'
```

On HEAD the first check started with no note before it, and `detent status` during the checks
showed only the spend by phase. The rest: no note before AUDIT's checks without a figure, no
`task` or `effort` on a ledger row, no note before VALIDATE's round or writer, and none before
PLAN. `tests/init/estimate.test.ts` tests the new modules, which HEAD does not have.

### Mutation battery

Each mutant was applied to snapshot copies of the 17 changed source files, four suites were run
(`estimate.test.ts`, `estimate-notes.test.ts`, `ledger-cache.test.ts`, `validate-writer-order.test.ts`),
and the file was restored from its copy and checked with `cmp`; all 17 were checked again after each
pass. 43 mutants: 41 killed on the first pass. Two survived. Estimating the checker's writer
survived because no suite ran a red checker, and `status` reading any pid as running survived
because every test passed its own `running` or held the lock itself. A test was added for each, and
both were killed on the second pass.

| Mutant | Result |
|---|---|
| median is the lowest | killed, 4 tests |
| even median not averaged | killed, 1 test |
| own figure from four | killed, 4 tests |
| own rows of any task | killed, 1 test |
| own rows of any effort | killed, 1 test |
| own rows of any model | killed, 1 test |
| crashed rows counted | killed, 1 test |
| run rows counted | killed, 1 test |
| rows with no length counted | killed, 1 test |
| measured on any route | killed, 2 tests |
| slices of any route | killed, 1 test |
| wall clock ignores at once | killed, 4 tests |
| wall clock rounds batches down | killed, 4 tests |
| unfigured units unsaid | killed, 1 test |
| span rounds to minutes | killed, 5 tests |
| no-unit step noted | killed, 1 test |
| done not counted | killed, 2 tests |
| end keeps progress | killed, 3 tests |
| slice figure not kept | killed, 1 test |
| slice spend not a delta | killed, 1 test |
| unreadable figures throw | killed, 1 test |
| spend from before the step | killed, 1 test |
| spend of any phase | killed, 1 test |
| stopped read as running | killed, 1 test |
| finish ignores at once | killed, 1 test |
| audit: wrong kind | killed, 3 tests |
| audit: one at a time | killed, 2 tests |
| audit: unit not done | killed, 1 test |
| audit: step not ended | killed, 1 test |
| audit: no estimator | killed, 3 tests |
| validate: all reviews | killed, 1 test |
| validate: no estimator | killed, 1 test |
| writer: checker's estimated too | survived the first pass; killed by the test added for it, 1 test |
| writer: no writer estimate | killed, 1 test |
| plan: counts reused slices | killed, 1 test |
| plan: no estimator | killed, 2 tests |
| ledger: no task | killed, 1 test |
| ledger: no effort | killed, 1 test |
| ledger: no length | killed, 1 test |
| session: no length | killed, 1 test |
| session: effort unrouted | killed, 1 test |
| status: no init lines | killed, 2 tests |
| status: lock ignored | survived the first pass; killed by the test added for it, 1 test |

### Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: 210 files, 2,333 passed and 2 skipped (2,335).
- `npm run plugin`: wrote nothing that changed.

### Recorded, not fixed

- **A resumed session is two rows.** A usage limit's stop is a crash row, left out of every figure,
  and the resumed half is a row of its own (X-8″), so a limit makes a figure a little low.
- **PLAN counts the slices with no checkpoint or a changed key.** A slice re-planned because a
  ticket it depends on left the plan, or because the pack was amended where its spec defect quotes
  it, is planned but not counted, so `done` can pass the units and `status` then shows none left.
- **Nothing has measured the writer's batch, the verifying review, or a slice.** The next tabachir
  run on this build would; until then those steps say they have no estimate.
- **A claim check's figure is a session's.** A claim whose check was relaunched once (C-2¹¹) costs
  two sessions, so the estimate for many claims runs a little low.
- **`run` is not estimated,** as the ticket said.
