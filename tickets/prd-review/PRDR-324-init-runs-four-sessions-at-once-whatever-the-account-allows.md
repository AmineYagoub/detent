---
id: PRDR-324
title: "init runs four sessions at once, whatever the account allows. AUDIT's claim checks and VALIDATE's reviewers run four at a time (AUDIT_CLAIM_BATCH and VALIDATE_REVIEW_BATCH, C-2¹⁶ and C-2²³), fixed in code. On tabachir a claim check takes 7.8 minutes at the median and a review 31.5, so 117 checks take about 3.8 hours and a round of 26 reviews about 3.4. An account with room for more could halve both, and one that keeps reaching its limit might want fewer. The number becomes a budget in the config, four by default. With PRDR-321, a limit reached at any number loses no finished work"
state: OPEN
severity: minor
category: throughput
labels: ["prd-review", "cost-strategy", "X-1⁸", "X-1", "C-2¹⁶", "C-2²³", "throughput"]
surface: ["src/schemas/budgets.ts", "src/init/audit-claims.ts", "src/init/validate-kept.ts", "src/init/audit.ts", "src/init/validate.ts", "src/init/pipeline.ts", "tests/init/audit-claims-batch.test.ts", "tests/init/validate-batch.test.ts", "tests/init/config-defaults.test.ts", "README.md", "detent-prd-v3.md"]
prd_refs: ["X-1", "X-1⁷", "C-2¹⁶", "C-2²³", "X-8″", "D-35"]
acceptance_criteria: ["budgets.init_sessions_at_once (X-1) sets how many of AUDIT's claim checks and how many of a VALIDATE round's reviewers run at once. It defaults to four and takes a whole number from one to sixteen; a config outside that range is refused at load, with the range.", "AUDIT's checks and VALIDATE's reviews read it in place of AUDIT_CLAIM_BATCH and VALIDATE_REVIEW_BATCH. Nothing else about either changes: the order, the keeping, and what a failure stops.", "init's note before AUDIT's checks and before each round names the number.", "The README says what the number trades: wall clock against how fast an account's usage window is spent, and that a limit reached loses no finished work once PRDR-321 is in.", "Falsifying tests, against HEAD: a config setting budgets.init_sessions_at_once to eight is refused as an unknown key, and eight claim checks never run more than four at once."]
non_goals: ["Does NOT change the writer, whose batches run one after another because they edit the same files.", "Does NOT change the default of four.", "Does NOT govern run, whose sessions X-1's own budgets govern."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-304", "PRDR-313", "PRDR-318", "PRDR-321"]
depends_on: ["PRDR-318", "PRDR-321"]
---

# PRDR-324 — how many sessions `init` runs at once is a budget

## Where this came from

The cost plan (`docs/plan-cost-strategy.md` §4.6) asked what shortens `init` without changing any
session. The answer the transcripts give is running more of the independent ones at once.

## Problem

- **Four, fixed.** `AUDIT_CLAIM_BATCH` (`src/init/audit-claims.ts`) and `VALIDATE_REVIEW_BATCH`
  (`src/init/validate-kept.ts`) are both 4, and `inBatches` keeps that many in flight.
- **What four costs in time.** A claim check takes 7.8 minutes at the median, and a review 31.5.
  At four at once, tabachir's 117 checks take about 3.8 hours, and a round of 26 reviews about 3.4.
  At eight, each would take about half as long.
- **Why not simply more.** Every session in flight spends the account's usage window at the same
  time, so an account on a small plan reaches its limit sooner. Today that stops every session in
  flight and throws away their work. PRDR-321 makes a stopped session resume, so the number
  becomes a trade of wall clock against how fast the window is spent, and the operator can make it.

## Design

- **A budget:** `budgets.init_sessions_at_once` (X-1), four by default, from one to sixteen.
- **Read by both pools.** AUDIT's checks and a round's reviewers take their width from it.
- **Said aloud.** `init`'s note names it before the checks and before each round.
- **The PRD:** X-1⁸ adds the budget.

## Building it

- `src/schemas/budgets.ts`: the key, its range and its default.
- `src/init/audit-claims.ts` and `src/init/validate-kept.ts`: the width from the budget, passed
  down from `src/init/pipeline.ts`.

### Vetoable calls

1. **One number for both pools.** The checks and the reviews spend one account's window, and two
   numbers would be two things to tune for one limit.
2. **Sixteen at most.** Past that, a round of 26 reviews gains little and the window drains fast.
3. **Four stays the default.** It is what every measurement so far ran at.

## Falsification (to run against HEAD when this is built)

- A config with `budgets.init_sessions_at_once: 8` is refused as an unknown key.
- Eight claim checks never have more than four in flight.
