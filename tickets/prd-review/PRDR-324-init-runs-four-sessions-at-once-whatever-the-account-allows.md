---
id: PRDR-324
title: "init runs four sessions at once, whatever the account allows. AUDIT's claim checks and VALIDATE's reviewers run four at a time (AUDIT_CLAIM_BATCH and VALIDATE_REVIEW_BATCH, C-2¹⁶ and C-2²³), fixed in code. On tabachir a claim check takes 7.8 minutes at the median and a review 31.5, so 117 checks take about 3.8 hours and a round of 26 reviews about 3.4. An account with room for more could halve both, and one that keeps reaching its limit might want fewer. The number becomes a budget in the config, four by default. With PRDR-321, a limit reached at any number loses no finished work"
state: DONE
severity: minor
category: throughput
labels: ["prd-review", "cost-strategy", "X-1⁸", "X-1", "C-2¹⁶", "C-2²³", "throughput"]
surface: ["src/schemas/budgets.ts", "src/kernel/budgets.ts", "src/init/audit-claims.ts", "src/init/audit.ts", "src/init/validate-kept.ts", "src/init/validate-round.ts", "src/init/validate.ts", "tests/init/sessions-at-once.test.ts", "tests/init/audit-claims-batch.test.ts", "tests/init/audit.test.ts", "tests/kernel/run.test.ts", "tests/kernel/x1-counting.test.ts", "tests/oracle/budgets.test.ts", "README.md", "detent-prd-v3.md"]
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

## Built

### Vetoable calls, added while building

4. **The width has no breach target.** It is the nineteenth key of X-1's table, since the config's
   `budgets` is where an operator sets such numbers, but nothing breaches a width. Its breach
   target is `NONE`, and the oracle lists it with the keys that route nowhere.
5. **One message for every way out of range**: "X-1⁸: init_sessions_at_once is how many sessions
   init runs at once, a whole number from 1 to 16", for a fraction, a value under one or over
   sixteen, and a value that is not a number.
6. **The config `init` writes does not carry the key.** `ensureConfig` writes `run_spend_usd`
   alone and every other key takes its default at load, as `spec_validation_rounds` does. The
   README says where to add it.
7. **No migration step.** An omitted key takes its default, so a config written before this build
   reads as four. A build older than this one refuses a config that has the key, as it refuses
   every key X-1 has added since it was built.
8. **The enforcement site is `init/audit`.** X-1's table names one module per key, and the oracle
   checks that the module named reads the key. `init/validate` reads it the same way; the
   sessions-at-once tests cover both.

### What changed

- `src/schemas/budgets.ts`: `init_sessions_at_once` in `CEILINGS` (scope `init`, breach target
  `NONE`, default 4) and in `budgetsSchema`, a whole number from 1 to 16, refused otherwise with
  the range named.
- `src/kernel/budgets.ts`: its enforcement site, `init/audit`.
- `src/init/audit-claims.ts`, `src/init/audit.ts`: `AUDIT_CLAIM_BATCH` is gone. `checkClaims`
  takes `atOnce` from `auditStage`, which `auditPhase` gives `budgets.init_sessions_at_once`; the
  note before the checks, the step's estimate and `inBatches` all use it.
- `src/init/validate-kept.ts`, `src/init/validate.ts`: `VALIDATE_REVIEW_BATCH` is gone.
  `reviewRound` takes `atOnce`, which `validatePhase` gives the budget, for the round's note, its
  estimate and its pool. The comments in `validate.ts` and `validate-round.ts` that said four now
  name the budget.
- `tests/init/sessions-at-once.test.ts`, new, five tests: a config takes 1, 8 and 16 and defaults
  to 4; it refuses 0, 17, 2.5 and -4 with the range named; claim checks run eight at eight, two at
  two and four by default, never more; a round's reviews run three at three. Each note names the
  width, and its estimate's wall clock counts batches of that many.
- `tests/init/audit-claims-batch.test.ts`, `tests/init/audit.test.ts`: the width is read from the
  fixture's budgets. `tests/kernel/run.test.ts`: its config literal has the key.
  `tests/kernel/x1-counting.test.ts`, `tests/oracle/budgets.test.ts`: nineteen keys, the new
  default, and the width among the keys that breach nothing. That test's title said "eleven route
  nowhere at all" over a list of eight since PRDR-265; it now says nine, the list's length.
- `README.md`: after the estimate paragraph, what the number trades, where to set it, and that a
  limit reached loses no finished work.
- `detent-prd-v3.md`: X-1⁸'s built note, and a D-28′ amendment: the batch it bounds is the width.

### Falsification

`tests/init/sessions-at-once.test.ts` imports only what HEAD has. Run against HEAD's sources
(written from `git show`, then restored from a snapshot and checked with `cmp`), 5 of its 5 tests
failed:

```
× X-1⁸ budgets.init_sessions_at_once > is a key a config may set, from one to sixteen, and four where it is not set
  → "code": "unrecognized_keys", "keys": ["init_sessions_at_once"], "message": "Unrecognized key: \"init_sessions_at_once\""
× X-1⁸ budgets.init_sessions_at_once > refuses a number outside one to sixteen, or not a whole one, naming the range
× X-1⁸ budgets.init_sessions_at_once > sets how many claim checks run at once: eight at eight, and never more
  → expected 4 to be 8
× X-1⁸ budgets.init_sessions_at_once > holds the checks to two at two, and keeps four where the config does not say
  → expected 4 to be 2
× X-1⁸ budgets.init_sessions_at_once > sets how many of a round's reviewers run at once, and the round's note says how many
  → expected 4 to be 3
```

On HEAD a config setting the key was refused as an unknown key, and eight claim checks never ran
more than four at once, as the ticket said.

### Mutation battery

Each mutant was applied to snapshot copies of the 7 changed source files. Seven suites were run
(`sessions-at-once`, `oracle/budgets`, `x1-counting`, `audit-claims-batch`, `audit`,
`validate-batch`, `estimate-notes`), and the file was restored from its copy and checked with
`cmp`. All 7 were checked again after the pass. 22 mutants, all killed on the first pass:

| Mutant | Result |
|---|---|
| default three | killed, 11 tests |
| a breach target | killed, 1 test |
| no upper bound | killed, 1 test |
| upper bound seventeen | killed, 1 test |
| upper bound fifteen | killed, 1 test |
| lower bound zero | killed, 1 test |
| lower bound two | killed, 1 test |
| fractions allowed | killed, 1 test |
| range unnamed | killed, 1 test |
| no default | killed, 2 tests |
| enforced elsewhere | killed, 1 test |
| audit: four whatever | killed, 2 tests |
| audit: one past the width | killed, 5 tests |
| audit: note says four | killed, 1 test |
| audit: estimate at four | killed, 1 test |
| audit: phase passes four | killed, 3 tests |
| audit: stage passes four | killed, 2 tests |
| validate: four whatever | killed, 1 test |
| validate: one past the width | killed, 4 tests |
| validate: note says four | killed, 1 test |
| validate: estimate at four | killed, 1 test |
| validate: phase passes four | killed, 1 test |

### Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
  Lint first found two things: an unused binding in the new test, and `tests/kernel/run.test.ts`
  one line past its 600, so the new key shares a line with `spec_validation_rounds`.
- `npm test`: 211 files, 2,338 passed and 2 skipped (2,340).
- `npm run plugin`: wrote nothing that changed.

### Recorded, not fixed

- **Nothing has measured what a width does to a session's figure.** More sessions at once can reach
  an account's limit more often, and each resume writes the cache again once (X-8″), so a figure
  taken at eight could run a little above one taken at four. A measured run at another width would
  show it.
- **PLAN's slices stay one at a time.** The width is AUDIT's and VALIDATE's only, as X-1⁸ says, and
  the writer's batches stay one at a time.
- **A running `init` does not re-read the width.** The config is read as `init` starts, so a change
  takes effect at the next `init`.
