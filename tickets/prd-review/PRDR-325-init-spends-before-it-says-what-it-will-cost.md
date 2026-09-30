---
id: PRDR-325
title: "init spends before it says what it will cost or how long it will take. Tabachir's test init spent $534 and 9.6 hours in AUDIT before DECIDE asked the user anything, and nothing said beforehand how many claims would be checked, what that would cost, or when it would end. Before each costly step, init will state what it will run and an estimate, from this project's ledger or from Detent's measured figures, named as such. detent status will show the phase's progress, the spend so far and an estimated finish. An estimate informs and never stops, asks or waits"
state: OPEN
severity: minor
category: usability
labels: ["prd-review", "cost-strategy", "N-5⁗", "status", "estimate", "spend"]
surface: ["src/init/estimate.ts", "src/init/audit-claims.ts", "src/init/validate.ts", "src/init/validate-fix.ts", "src/init/plan.ts", "src/init/phase-spend.ts", "src/cli/status.ts", "tests/init/estimate.test.ts", "tests/cli/report.test.ts", "README.md", "detent-prd-v3.md"]
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
