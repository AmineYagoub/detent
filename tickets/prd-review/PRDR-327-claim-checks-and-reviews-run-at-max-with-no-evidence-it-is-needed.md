---
id: PRDR-327
title: "AUDIT's claim checks and VALIDATE's reviews run at max with no evidence that a lower level would miss anything. Thinking is 75% of a claim check's output and 84% of a review's. Anthropic reports that Opus 5.5 at medium beats Opus 5 at high on knowledge work, and that at a given level Opus 5.5 thinks more than Opus 5, most of all at xhigh and max. If a lower level halves the thinking, a review costs about 29% less and a claim check about 21% less. On Sonnet 5.5 with the same tokens, a claim check's model cost falls about 42%. The arms will run on PRDR-326's sets, in order, within a budget the user approves, and a task's routing moves only where its arm passes D-35's bar"
state: OPEN
severity: major
category: spend
labels: ["prd-review", "cost-strategy", "S-5⁷", "S-5⁵", "D-35", "N-8", "effort", "evaluation", "user-approval"]
surface: ["src/schemas/roles.ts", "src/init/session.ts", "src/init/config.ts", "src/kernel/migrate.ts", "tests/init/config-defaults.test.ts", "docs/plan-cost-strategy.md", "README.md", "detent-prd-v3.md"]
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
