---
id: PRDR-327
title: "AUDIT's claim checks and VALIDATE's reviews run at max with no evidence that a lower level would miss anything. Thinking is 75% of a claim check's output and 84% of a review's. Anthropic reports that Opus 5.5 at medium beats Opus 5 at high on knowledge work, and that at a given level Opus 5.5 thinks more than Opus 5, most of all at xhigh and max. If a lower level halves the thinking, a review costs about 29% less and a claim check about 21% less. On Sonnet 5.5 with the same tokens, a claim check's model cost falls about 42%. The arms will run on PRDR-326's sets, in order, within a budget the user approves, and a task's routing moves only where its arm passes D-35's bar"
state: DONE
severity: major
category: spend
labels: ["prd-review", "cost-strategy", "S-5⁷", "S-5⁵", "D-35", "N-8", "effort", "evaluation", "user-approval"]
surface: ["src/schemas/roles.ts", "src/kernel/worstcase.ts", "src/init/session.ts", "src/init/progress.ts", "src/init/config.ts", "src/init/estimate.ts", "tests/init/effort-by-task.test.ts", "tests/init/config-defaults.test.ts", "tests/init/estimate.test.ts", "docs/plan-cost-strategy.md", "README.md", "detent-prd-v3.md"]
prd_refs: ["S-5⁵", "S-5⁶", "D-35", "N-8", "D-34′", "C-2¹⁴"]
acceptance_criteria: ["Nothing runs before the user approves a budget. The ticket records the budget, the approval and its date.", "The arms run in order on PRDR-326's sets. First, Opus 5.5 at high on both sets. Then Sonnet 5.5 at max on the claims set. Then Opus 5.5 at medium on both, only if high passed. Where the user approves it, today's setup is first re-run on the 14 wrong claims and the 10 areas.", "Each arm's result is recorded in this ticket and in docs/plan-cost-strategy.md, pass or fail, with each miss, its spend and its wall clock.", "A task's default moves only to an arm that passed, the cheapest one that did. Where a role runs more than one task, as audit runs the survey, the triage and the checks, the level moves for the task measured and no other. The routing's doc-block and the PRD name the measurement that moved it.", "A task whose arms all fail keeps its routing, and the PRD records that it was measured and how.", "If today's setup, re-run, misses items of the bar, the ticket says which, and no routing moves until the user decides the bar.", "Falsifying check, against HEAD: the effort routing gives one level per role, so the claim checks cannot move without the survey and the triage, and no doc-block names a measurement behind a level."]
non_goals: ["Does NOT lower the writer's or the planner's level. No set exists for either yet.", "Does NOT touch run's roles. PRDR-328 governs their effort.", "Does NOT raise any level."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-263", "PRDR-299", "PRDR-317", "PRDR-318", "PRDR-319", "PRDR-326"]
depends_on: ["PRDR-326"]
---

# PRDR-327 — effort and model per task, measured, and moved only where they pass

## Where this came from

The cost plan (`docs/plan-cost-strategy.md` §6.1). The user asked on 2026-09-30 whether Detent can
set effort dynamically; it can, per session (`buildOptions` passes `effort`). This ticket measures
whether the specification phase's two heaviest tasks need `max`.

## Problem

- **Every specification session runs at `max`** (S-5⁵, specification decision 14). No measurement
  chose that, since there was nothing to measure against.
- **Thinking dominates.** From tabachir's transcripts: a claim check's output is 41K tokens, 75% of
  it thinking, and a review's is 207K, 84% thinking. Thinking is paid twice: as output at $20 a
  million, then written to the cache at $8 for the next request.
- **The published measurements point down.** Anthropic's migration notes for Opus 5.5 say `medium`
  beats Opus 5 at `high` on coding and knowledge work, and that at a given level Opus 5.5 thinks
  more than Opus 5, most of all at `xhigh` and `max`. They advise reserving `xhigh` and `max` for
  work where a gain was measured. Here, none was.
- **Effort is per role.** `audit` runs the survey, the triage and the checks. The checks cannot move
  without the other two, which no set measures.

## Design

- **The arms, in order:**

| Arm | Sets | Why |
|---|---|---|
| today's setup, re-run | 14 wrong claims, 10 areas | how much runs differ, if the user approves |
| Opus 5.5 at `high` | both | the smallest step down |
| Sonnet 5.5 at `max` | claims | half Opus 5.5's price per token, the web pages Haiku reads aside |
| Opus 5.5 at `medium` | both | only if `high` passed |

- **What a pass would save,** from the measured splits:
  - at half the thinking, a review's main-model cost falls from $8.76 to about $6.20, and a claim
    check's by about 21%;
  - on Sonnet 5.5 with the same tokens, a claim check's main-model cost falls about 42%.
- **Effort per task where a role runs several.** The routing gains a level per task for `audit`'s
  checks, so the survey and the triage keep theirs.
- **Moved only by a pass,** to the cheapest arm that passed, and the doc-block and the PRD name the
  measurement. A task whose arms all fail keeps `max`, and the PRD says it was measured.
- **The PRD:** S-5⁷.

## Measuring

The estimated cost of each arm, from the measured per-session figures:
- Opus 5.5 at `high` on both sets: about $190;
- today's setup re-run on the 14 wrong claims and the 10 areas: about $140 more;
- Sonnet 5.5 at `max` on the claims set: about $100 more.

### Vetoable calls

1. **`high` before `medium`.** One step at a time, and `medium` only once `high` holds.
2. **Sonnet 5.5 for claim checks only.** A claim check is research with a verdict. A review weighs
   a whole area against the foundations, which is where an Opus is most likely to earn its price.
3. **The cheapest passing arm, not the best-scoring.** Every passing arm met the whole bar.

## Progress

### The budget (AC 1)

- The user approved $500 for measuring on 2026-09-30 ("Evaluation budget is $500, go ahead build
  all tickets and don't stop until you finish"). They stopped the first smoke run that day, and on
  2026-10-02 said to continue building.
- About $3.17 of the $500 was spent before the arms: $0.17 on live probes, and up to $3 on the
  stopped smoke run. A driver outside the repository runs the arms one after another from a frozen
  worktree at `048362e`, and caps each arm at its planned cap or what is left of $496.83, whichever
  is less.

### The routing per task (AC 4's mechanism, AC 7)

Built before any arm moves a level:
- A `role/task` key of `effort_routing` routes one task apart from its role. `effortFor` reads the
  task's key, then the role's, then none. Both the session's `effort` and the level its `start`
  event, `effort_settled` and ledger row name come from it.
- `ROLE_TASKS` lists the tasks: `audit`'s `survey`, `triage` and `verify_claims`; `spec_write`'s
  `decide`, `write` and `fix`; `spec_review`'s `review` and `verify`. The config refuses a key that
  names a task its role does not run, by name, as it refuses an unknown role.
- The estimator figures a unit at its task's level, so an estimate matches what the session will
  run at.
- `DEFAULT_TASK_EFFORT_ROUTING` holds each task a passing arm moved. It was empty until the arms
  ran (see "The move" below). A new config is written with it beside the roles' levels, and the
  first `init` names every task key.
- An eval arm routes its unit's role only and reads no project config, so a task key in the copy's
  config cannot override an arm's level.

**Falsified at HEAD (`534bcd9`)** with a probe through APIs that exist there:
- a claim check routed `audit/verify_claims: high` beside `audit: max` ran at `max`, as the survey
  did;
- the config refused the key;
- no doc-block in `src/schemas/roles.ts` named a measurement on N-8's sets.

All three failed at HEAD and pass on the fix.

**Mutation battery (12 mutants):** 11 killed. `C1` (a new config holds the roles' levels alone)
survives, and it is equivalent while `DEFAULT_TASK_EFFORT_ROUTING` is empty. The battery runs again
if a task moves.

### The arms (ACs 2, 3, 6)

**Today's setup re-run on the 14 wrong claims: FAIL.** This was Opus 5.5 at `max`, 2026-10-02
13:17 to 13:44 UTC. It found 11 of the 14 wrong, and spent $31.74 over 14 sessions in 26.7
minutes, against a $60 cap. It missed three claims:
- one on what a data-protection law's article requires of a processor's contract. It found this
  confirmed: the official text it cited says "a contract or legal act", and arm A had judged the
  claim's "written contract" wrong;
- one on what a regulator's deliberation says about publishing personal data on foreign-run
  platforms. It found this unverified;
- one on an official mark-correction window after each term. It found this unverified.

Under AC 6, no claims routing moves until the user decides the bar.

**Today's setup re-run on the 10 areas: PASS.** This was Opus 5.5 at `max`, 2026-10-02 13:44 to
15:26 UTC. It reported 18 of 18 blockers at their place as a blocker or a major, and spent $106.81
over 10 sessions in 1 h 42 min, against a $130 cap. The reviews bar holds on a second run, so a
cheaper reviews arm is held to all of it.

**Opus 5.5 at `high` on the 44 claims: FAIL.** This ran 2026-10-02 15:26 to 15:39 UTC. It found 8
of the 14 wrong claims wrong, and spent $15.17 over 44 sessions in 13.4 minutes, against a $150 cap.
A check cost about $0.34 here, against $2.27 at `max`. It missed six:
- three of them are the same three today's setup missed. The processor-contract article, the
  regulator's deliberation and the mark-correction window all came back unverified;
- one it found confirmed: which payment channels are approved for online sales;
- two it found unverified: how ministry communiqués are published, and the lycée streams announced
  for 2027/28.

It also called one of the 30 confirmed claims wrong. The claim says Android's keystore "releases" a
key after the user unlocks, and the check said the keystore never releases key material, it only
allows the key to be used. A person must settle whether arm A was mistaken. The verdict does not
depend on it: 8 of 14 falls short of the original bar, and of the 11 today's setup found on its own
re-run. So `high` loses claims on any bar at least as strict as today's setup.

**Opus 5.5 at `high` on the 10 areas: PASS.** This ran 2026-10-02 15:39 to 16:13 UTC. It reported
18 of 18 blockers at their place as a blocker or a major, and spent $44.61 over 15 sessions in 34.3
minutes, against a $120 cap: 58% less than today's setup, and three times as fast. Five of its 10
reviewers left `previous` out of every finding, and each was relaunched for a second whole review,
so 15 sessions ran for 10 reviews; at `max` none did. Each relaunch held, but one that had not would
have failed the area. That is PRDR-333.

**Sonnet 5.5 at `max` on the 44 claims: FAIL.** This ran 2026-10-02 16:13 to 17:54 UTC. It found 7
of the 14 wrong claims wrong, and spent $97.71 over 48 sessions in 1 h 40 min, against a $150 cap,
about what a check costs on Opus 5.5 at `max`. It missed seven:
- four it found confirmed: a child-protection article said to penalise publishing children's images,
  the processor-contract article, the mark-correction window, and the lycée streams announced for
  2027/28;
- three it found unverified: the approved payment channels, the regulator's deliberation, and how
  ministry communiqués are published.

It called none of the 30 confirmed claims wrong. Confirming four wrong claims is the failure the
claims bar exists to catch, so Sonnet 5.5 is not a candidate for claim checks on this evidence.

**Opus 5.5 at `medium` on the 10 areas: FAIL.** This ran 2026-10-03 06:07 to 06:20 UTC. It
reported 14 of the 18 blockers at their place, and spent $19.72 over 10 sessions in 13.5 minutes,
against a $60 cap. It reported four blockers as nothing:
- two at the same line of the foundations' design insights: a teacher's yearly token is never
  linked across years, and a token the device makes shows only that submissions differ, not that
  their senders do;
- one in the records area: what a deletion erases on the devices other than the one it was made
  on;
- one in privacy and security: how little a crash report and a problem report strip.

It ran on build `047be16`, where PRDR-333 has made the relaunches the `high` arm paid for
needless. That build's `spec_review` prompt adds PRDR-322's sentences for a reviewer handed the
foundations, and the runner said so. This reviewer was handed none, so the sentences asked
nothing of it. `medium` was not run on the claims set, since `high` failed there (AC 2).

Per review session, the medians were $10.54 and 35.8 min at `max`, $2.92 and 7.8 min at `high`,
and $2.04 and 4.7 min at `medium`. The median output fell from 248K tokens to 52K and 30K, and the
findings reported fell from 235 to 200 and 129.

### The move (ACs 4, 5)

- **A first round's review runs at `high`.** `DEFAULT_TASK_EFFORT_ROUTING` is
  `{ "spec_review/review": "high" }`: `high` passed and `medium` did not, so `high` is the
  cheapest arm that passed. Its doc-block and S-5⁷ name the measurement. A verification,
  `spec_review/verify`, keeps the role's `max`, since the set holds none. `spec_write`'s tasks
  keep `max`, and no role's level moved.
- **The claim checks keep `max`.** Every claims arm failed: `high` found 8 of the 14 wrong claims,
  and Sonnet 5.5 at `max` found 7. Today's setup, re-run, found 11, so no claims routing moves
  until the user decides the bar (AC 6). S-5⁷ records how the checks were measured (AC 5).
- **The estimate.** `MEASURED` gains the review at `high`, $2.92 and 7.8 min, the medians of the
  `high` arm's 15 ledger rows at `048362e`. A new config's first-round reviews are then estimated
  at the level they run at, and N-5⁗ carries the amendment.
- **The documents.** S-5⁷ holds every arm's result, with its misses, spend and wall clock. The
  README says which task moved and why the claim checks did not, and that a config written by an
  earlier Detent keeps `max` until the key is added. The plan, `docs/plan-cost-strategy.md`, has
  the `medium` row in §6.1, the move, the re-projected Layer 3 in §8, and the claims bar in §10.

### Falsification of the move

The three tests the move adds to `tests/init/effort-by-task.test.ts` were run against HEAD's
`src/schemas/roles.ts`, `src/init/estimate.ts` and `detent-prd-v3.md` (`047be16`):

```
× routes a first round's review to high by default, and a verification and every other specification task at max
× estimates a first round's reviews at high by the arm that measured it
× names the measurement that moved it in the routing's doc-block, and S-5⁷ records every arm, the claim checks' among them
```

All three fail there and pass on the move. The move also broke three tests in
`tests/init/config-defaults.test.ts` that took the written routing's keys to be the roles alone.
They now expect each task key a measurement moved, and check its level against its role's model.

### Mutation battery of the move (10 mutants)

All killed, on a baseline of 105 passing tests, each restored from a snapshot and checked with
`cmp`:

| Mutant | Killed by |
|---|---|
| C1 a new config holds the roles' levels alone | the written routing, in both test files |
| N1 init's note names the roles' levels alone | init's note names each moved task's level |
| D1 no task moves | the default and the estimate |
| D2 reviews move to `medium`, the arm that failed | the default, and no figure at `medium` |
| D3 verifications move too | the default |
| D4 claim checks move too | the default, and N-5⁗'s ledger row at `max` |
| D5 the role moves, not the task | the default, and the README's role table |
| E1 the review at `high` has no figure | the estimate, and N-5⁗'s figures |
| E2 the review at `high` is figured at `max`'s cost | the estimate, and N-5⁗'s figures |
| E3 the review at `high` is figured at `max`'s length | the estimate, and N-5⁗'s figures |

`C1`, the one survivor of the first battery, is killed now that a task has moved.

### What changed

- `src/schemas/roles.ts`: `DEFAULT_TASK_EFFORT_ROUTING` moves `spec_review/review` to `high`, and
  its doc-block names the measurement and why the claim checks stay.
- `src/init/estimate.ts`: `MEASURED` holds the review at `high`. Its doc-block says a length comes
  from transcripts or from the rows' own durations.
- `tests/init/effort-by-task.test.ts`: the three tests above.
- `tests/init/config-defaults.test.ts`: the written routing holds each moved task beside the roles.
- `tests/init/estimate.test.ts`: `MEASURED` lists each figure with its level.
- `detent-prd-v3.md`: S-5⁷'s results, and N-5⁗'s amendment.
- `README.md` and `docs/plan-cost-strategy.md`, as above.

### Recorded, not fixed

- **A config written by an earlier Detent keeps `max`** for its first-round reviews, and nothing
  tells it of the move. The plan's open question 2 asks whether such configs should be told, as
  S-5⁶ tells them of a superseded model, or moved. It is the user's to decide.
- **The claims bar** is the user's to decide (AC 6). Today's setup, re-run, found 11 of the 14.
- **One confirmed claim that `high` called wrong** needs a person to settle it: the Android
  keystore claim, above.
- **One run per arm.** Each arm passed or failed on a single run. A second run of `high` on the
  review set is PRDR-322's run, with the foundations handed, so it measures that change too.
