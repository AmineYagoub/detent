---
id: PRDR-191
title: "run_spend_usd bounds total spend, which fires on success and fires late on failure — the quantity worth bounding is spend with no progress"
state: DONE
severity: major
category: design
labels: ["prd-review", "found-by-live-run", "budgets", "operator-surface"]
surface: ["detent-prd-v3.md", "src/kernel/ledger.ts", "src/init/pipeline.ts", "src/init/session.ts", "src/schemas/budgets.ts", "src/schemas/states.ts", "tests/oracle/budgets.test.ts"]
prd_refs: ["X-1", "X-1′", "X-1‴", "X-8", "D-25", "C-8"]
acceptance_criteria: ["`run_spend_usd` no longer halts a run. Spend is counted and reported; a total never terminates work.", "A no-progress breaker replaces it: the run halts when a configured amount accrues with NO unit of progress completing — a slice for `init`, a ticket reaching DONE for the loop.", "The breaker's default is derived from the observed cost of one unit of progress, not chosen as a constant.", "Spend is reported as it accrues, against the session estimate `slice.ts` already computes, so an operator sees the trajectory rather than discovering it at a wall.", "If an operator sets a total anyway, reaching it is SAID rather than acted on. AMENDED on implementation: an announcement, not AWAIT_SPEND_CONFIRM — see below.", "The breaker lands in the SAME change that removes the blocker. A release with neither is a regression, not a step."]
non_goals: ["Does not touch the per-ticket ceilings (`blind_fix_attempts`, `informed_fix_attempts`, `research_sessions`, `hypotheses`). Those bound ATTEMPTS, not money, three of them are structural under D-24, and they are the controls that actually work.", "Does not remove the ledger or the accounting. The counting stays; the blocking goes.", "Does not claim the financial exposure is zero. It is accepted deliberately, and the breaker is what makes accepting it reasonable."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-186", "PRDR-190", "PRDR-083", "PRDR-168"]
depends_on: []
---

# PRDR-191 — the wrong quantity

**Severity:** major · **Category:** design · **Found by:** the gate-312 planning run, where the
only thing the ceiling ever threatened was work that was going correctly

## Problem

`run_spend_usd` bounds the total a run may spend. That quantity has two failure modes and they
point in opposite directions:

- **It fires on success.** A large legitimate job reaches the total by doing exactly what it was
  asked. gate-312 is at **$230 for planning alone**, has completed eleven of fifteen slices with
  nothing wrong, and is expected to halt at s15 for no reason but arithmetic.
- **It fires late on failure.** A runaway spends for hours before reaching a total. PRDR-186 is the
  live example: a key-formula bug re-planned every completed slice and burned **$70** before anyone
  noticed. It was a one-shot; had it been a cycle, the ceiling would have been the only thing that
  stopped it, and it would have stopped it after hours rather than minutes.

Raising the number does not resolve this — it trades one failure for the other. At $1000 the
legitimate run survives and the runaway burns $1000 instead of $300, three times more money and
three times longer before anything notices. A constant is too low to avoid interrupting real work
and too high to catch a defect quickly, and there is no value that is both.

## The constant cannot be chosen, because the phases differ by an order of magnitude

$230 buys 230 tickets **written down**. Building them is a separate expense: an implement session
and a review per ticket, plus gates, plus the fix ladder when a gate goes red — and the ladder is
precisely the part that costs more than the happy path. Planning is the cheap quarter of a
self-build. Any single number is wrong for at least one phase of the same run.

## It is not the backstop it is described as

X-8 calls `run_spend_usd` "the cross-generation financial backstop", and today it is softer than
that:

- **D-25 evaluates it at session launch, never mid-flight** — so a run overshoots by up to a whole
  session's cost, whatever that session turns out to be.
- Two runs on one root each enforced the full ceiling and jointly spent past it, reaching **$16
  against a $10 ceiling with neither ever seeing `SpendExhaustedError`** (PRDR-147/168). X-1‴ closed
  that with a lock, but the episode shows what the guarantee was worth.

A control that cannot bound the thing it names is not made correct by keeping it.

## What to build instead

**Count, do not block.** Report spend as it accrues, against the estimate `slice.ts:72` already
computes — it predicts 33–65 planner sessions and never converts that to money, so an operator
learns the trajectory only by hitting a wall. Print the range up front and the running total after
each unit of progress.

**Bound spend WITHOUT PROGRESS.** This is the quantity that actually describes the fear. Legitimate
work completes things — a slice, a ticket reaching DONE. A loop does not. A breaker on
"dollars since the last completed unit" catches PRDR-186's shape in minutes rather than hours, and
can never fire on a run that is working, however long or expensive it is. It also needs no
per-project tuning: the threshold derives from the observed cost of one unit, which the ledger
already records.

**If a total is kept at all, it asks rather than dies.** `AWAIT_SPEND_CONFIRM` with everything
checkpointed: unattended it stops, attended it is one keystroke. That is a decision point instead
of a wall, and it costs the in-flight slice either way — so it should at least be recoverable by
answering rather than by editing config and re-running.

## The exposure, stated rather than argued away

Removing the blocker accepts that an unattended overnight run with a defect can spend without a
total bound. That is a real cost and it is being taken deliberately: the operator is choosing a tool
that finishes its job over one that stops half-built. **The breaker is what makes that choice
reasonable, so it must land in the same change.** Shipping the removal first and the breaker later
leaves a release with no control at all, which is worse than what exists today.

## Resolved (2026-09-09)

`run_spend_usd` no longer throws. `spend_without_progress_floor_usd` (50) and
`spend_without_progress_multiple` (3) join the X-1 table; the threshold is
`max(floor, multiple x the last completed unit's cost)`, and `noteUnitComplete` resets it from
the two places work actually completes — a slice checkpointed in `plan-slices.ts`, and
`finalizeDone` in `referee.ts`, last in the method so a merge conflict does not count as
progress. Cross-driver parity is asserted over the new control, not the deleted one.

**Criterion 5 amended.** It called for `AWAIT_SPEND_CONFIRM`. That needs a new state in the X
machine, which is an F-3 schema event, and — more to the point — an interrupt is a block, which
is the thing this ticket exists to remove. The advisory total is announced once, on the first
launch after it is passed, and the run continues. Announcing on every launch would be a warning
an operator learns to skip, which is V-1‴'s own description of a useless one.

**Two defects in this implementation, found by its own tests staying silent.** Both are worth
recording because both are shapes this repository keeps producing:

- The mark was held on the run lock, then defaulted to the CURRENT total whenever no mark
  existed. `init` builds a fresh `SpendLedger` per session launch, so every session forgave
  everything the last one spent and the breaker could never accumulate anything to fire on. It
  now lives in its own `state/progress.json`, pinned once rather than re-derived — and off the
  lock, because a control that only works when another subsystem happens to be present is not a
  control.
- The breaker's two ceilings were never passed to either `SpendLedger` construction, so
  production read the schema defaults while the project's config said otherwise. Implemented,
  unit-tested and unreachable — PRDR-141's shape exactly, inside the change that cites it.

## Process

X-1, X-1′ and X-8 are PRD requirements. This is a design change, so the PRD amends first and code
follows — no implementation lands against this ticket until the amendment does. Per the
falsification rule, the breaker's test drives a run that spends with no unit completing and is
observed to FAIL before the breaker exists.
