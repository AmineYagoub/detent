---
id: PRDR-321
title: "A usage limit throws away the work a session has done, and ends detent run outright. When a session reaches the account's limit, init waits for the stated reset (PRDR-189) and then starts the session again from its first turn. The headless run driver waits 1, 5 and 15 minutes, whatever reset the limit names, and then exits (X-8′), so a person must restart it. The run logs record 30 such waits. In PRDR-317's A/B test, four sessions stopped at the limit after 129 turns in total, and the ledger recorded them at $0. A stopped session will resume its own conversation after the reset, run will wait for the stated reset as init does, and what a stopped attempt spent will be recorded"
state: DONE
severity: major
category: resumability
labels: ["prd-review", "cost-strategy", "X-8″", "X-8′", "usage-limit", "ARCH-2", "resume", "ledger"]
surface: ["src/schemas/backend-limit.ts", "src/sessions/backend.ts", "src/sessions/sdk.ts", "src/sessions/stream-usage.ts", "src/sessions/prices.ts", "src/init/session.ts", "src/kernel/driver.ts", "src/kernel/journal.ts", "src/kernel/referee-session.ts", "src/kernel/session-resume.ts", "scripts/cache-gaps.ts", "tests/sessions/resume.test.ts", "tests/sessions/backend-limit.test.ts", "tests/init/session-resume.test.ts", "tests/kernel/limit-resume.test.ts", "tests/kernel/outage-backoff.test.ts", "tests/init/reset-hour.test.ts", "tests/init/stages.test.ts", "tests/sessions/sdk.test.ts", "detent-prd-v3.md"]
prd_refs: ["X-8′", "ARCH-2", "S-4", "D-35"]
acceptance_criteria: ["The headless run driver reads the reset time a usage limit names, as init does (PRDR-189), and waits until it, within init's six-hour ceiling. A limit that names no time keeps the 1, 5 and 15 minute ladder.", "A session that a usage limit stopped is resumed after the wait, with the SDK's resume option and its own session id, and told to carry on where it stopped. It is not launched afresh. A resume the SDK refuses, or a session whose id never arrived, is launched afresh as today, and the note says so.", "A resumed session is the same attempt for every count and budget. Its artifact is read and checked as any other's, and one refused is relaunched with the validator's words as today.", "What a stopped attempt spent is recorded: the usage each of its assistant messages carried, counted once per message id and priced per model, and marked as a lower bound. A limit that arrives before any token is spent still records $0.", "Both drivers note each wait with the reset time and the session it will resume.", "The ticket records what a resume does when the reset crosses midnight, since the runtime's system prompt carries the date.", "Falsifying tests, against HEAD: the run driver, told of a limit that resets in three hours, retries after one minute; init relaunches a limit-stopped session with no resume; and a stopped session whose messages carried usage is recorded at $0."]
non_goals: ["Does NOT raise or add any spend cap, which stays advisory (PRDR-191, PRDR-265).", "Does NOT change how an outage that names no reset time is waited out.", "Does NOT resume a session that ended for any other reason."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-112", "PRDR-185", "PRDR-187", "PRDR-189", "PRDR-261", "PRDR-317", "PRDR-318", "PRDR-324"]
depends_on: ["PRDR-318"]
---

# PRDR-321 — a usage limit costs no finished work

## Where this came from

The cost plan (`docs/plan-cost-strategy.md` §3) counted what limits cost. Most people who would
run Detent do so on a subscription, whose limits are reached in ordinary use.

## Problem

- **`init` starts a stopped session over.** PRDR-185 and PRDR-189 wait for a limit's stated reset
  and then call `launchOnce` again (`src/init/session.ts`). The conversation the session had built
  is dropped, its thinking and tool calls are paid for twice, and so is writing its cache.
- **`run` gives up.** The headless driver waits 1, 5 and 15 minutes (`OUTAGE_BACKOFF_MS`,
  `src/kernel/driver.ts`) and then throws. It never reads the reset, so a limit that resets hours
  later ends the run. That is the defect PRDR-189 fixed for `init`, and ARCH-2 says a control on
  one driver belongs on both.
- **The spend disappears.** A limit arrives as an error result with no usage, and the ledger
  records the session at $0 (PRDR-053's lower-bound flag). The usage is not lost: every assistant
  message the session received carried its own.
- **How often.** The run logs record 30 waits for a backend limit or outage, not counting their
  `latest` links: 17 in one ksar planning run, 4 in one of the A/B test's copies, and 9 across
  gate runs and tabachir. In the A/B test, four sessions stopped after 129 turns in total and were
  recorded at $0 (PRDR-317).

## Design

- **`run` waits for the stated reset,** with `msUntilReset` and its six-hour ceiling, moved where
  both drivers can reach it.
- **Resume, not restart.** The SDK names the session in every message it streams. A session a
  limit stops is resumed after the wait with `resume` and that id, and a short prompt to carry on
  where it stopped. Its cache expired during the wait, so the resume writes the conversation to it
  once. The work already done is not repeated. If the SDK refuses the resume, or no id arrived,
  the session is launched afresh, as today, and the note says which.
- **The same attempt.** Budgets, relaunch counts and artifact checks see one attempt. Its ledger
  row sums both halves.
- **Spend from the stream.** Usage is summed as messages arrive, once per message id, so a result
  with no telemetry still leaves a lower bound, marked as one.
- **The PRD:** X-8″ amends X-8′.

## Building it

- `src/sessions/sdk.ts`: keep the session id and the running usage; resume on request.
- `src/init/session.ts`: resume instead of relaunch, after the wait.
- `src/kernel/driver.ts`: the stated reset, and resume through the referee's session path.
- `src/kernel/ledger.ts`: a row for a stopped attempt, marked as a lower bound.

### Vetoable calls

1. **Resume only after a usage limit.** A crash or a transport death can leave a conversation in a
   state no one has seen, and relaunching it fresh is the known path.
2. **The prompt on resume** says only to carry on and write the artifact the task asked for. It
   restates nothing, since the conversation holds the task.
3. **One attempt, not two.** A limit is not the session's failure, so it costs no relaunch.

4. **The runtime's own error result is kept where one arrived, and the stream is priced only where
   none did.** The acceptance criterion names the stream. A live probe showed the SDK streams the
   runtime's error result before it throws, and that result carries the session's cost with its
   side requests: a session stopped at its turn limit reported $0.0037, a Haiku call among it,
   where its streamed messages priced at $0.0015. Detent's crash path discarded that result, and
   that is why the A/B test's stopped sessions were recorded at $0.
5. **The stream is priced for every crash with no result, not only a limit's.** The crash path is
   one path, and a lower bound is truer than $0 whatever stopped the session.
6. **List prices, and the lower bound kept a lower bound.** A write the usage does not split by
   lifetime is priced at five minutes, the cheaper. A model the table does not know is priced at
   Haiku 4.5's, the cheapest it knows. The table is `src/sessions/prices.ts`, which
   `scripts/cache-gaps.ts` now shares.
7. **Two ledger rows for a resumed session, not one that sums both halves.** The Design said one.
   The stopped half's row is written when it stops, so a process killed during a wait of up to six
   hours loses nothing. Each row is its own half's, and the stopped one is marked `partial:
   "crash"`, PRDR-053's lower-bound mark. PRDR-325's estimates read the two as one session.
8. **`run` keeps the stopped conversation in the ticket's journal, and `init` in the launch.** In
   `run` it is `stopped_by_limit` on the session's `end`, so a run restarted after the limit
   resumes it. In `init` it lives within the launch, so an init killed during the wait launches the
   session afresh when it is run again.
9. **What counts as a refused resume.** "No conversation found with session ID", which is 2.1.285's
   own text, or any failure before the first turn that is no outage. A resume stopped before its
   first turn by an outage or a limit changed nothing, so it is returned for its driver to wait out
   and is resumed again.
10. **A limit that stops a session before its first turn is waited out to its reset in `run` too.**
    Its refusal carries the runtime's message, which names the reset. The next launch is fresh,
    since that conversation holds nothing.
11. **Every account limit is an outage.** `isOutage` now counts the runtime's "You've hit your …
    limit" for any limit, a weekly or a monthly spend limit as well as a session limit. `init`
    waits one out instead of failing, and a limit that names no time keeps the ladder.
12. **A limit is not a crash.** It is not counted in PRDR-090's crash streak, and PRDR-053's
    judgement of a half-done tree does not apply to it.
13. **The shared module is `src/schemas/backend-limit.ts`.** `schemas/` is the one layer the
    kernel, `init` and the SDK backend may all import (ARCH-1). `OUTAGE_BACKOFF_MS` moved there from
    `kernel/driver.ts`, and `isOutage` and `msUntilReset` moved there from `init/session.ts`.
14. **The model-driven driver is unchanged.** The `run` skill meets a limit as a refusal like any
    other, and the stopped conversation waits in the journal for the next launch by either driver.
    A skill session on the same account would itself be stopped by the limit, so it could not wait.
15. **The resume prompt says only that a usage limit stopped the session and has reset, and to
    carry on and write the artifact the task asked for.**
16. **A resumed session's artifact and signals stay.** They are its own, written before the limit
    stopped it, which is why T-140's and PRDR-225's clearing is for a fresh launch only.

## Falsification, as filed

- The run driver, given a limit that resets in three hours, sleeps one minute and retries.
- `init` relaunches a limit-stopped session with no `resume`.
- A stopped session whose streamed messages carried usage is recorded at $0.

## What changed

- `src/schemas/backend-limit.ts` (new): the ladder (from `kernel/driver.ts`), `isOutage`,
  `msUntilReset` and `MAX_RESET_WAIT_MS` (from `init/session.ts`), and new: `isUsageLimit`,
  `resetPhrase`, `outageWait` (the wait both drivers take) and `conversationToResume`.
- `src/sessions/backend.ts`: `SessionSpec.resume`, and `SessionResult.sessionId` and `resume`.
- `src/sessions/sdk.ts`: the session id from the stream, the `resume` option with
  `RESUME_PROMPT`, a refused resume launched afresh, and the crash path keeping the runtime's error
  result or pricing the stream.
- `src/sessions/stream-usage.ts`: each response's usage and model, and `spent()`.
- `src/sessions/prices.ts` (new): list prices per model.
- `src/init/session.ts`: `InitSessionFailed` carries the failed result, and the retry loop waits
  with `outageWait`, resumes the conversation `conversationToResume` names, and says which.
- `src/kernel/driver.ts`: the stated reset, within six hours, or the decision handed back.
- `src/kernel/journal.ts`: `stoppedConversation`.
- `src/kernel/referee-session.ts`, `src/kernel/session-resume.ts` (new): the resume, the stop
  recorded on `end`, the refusal, the note, the counters and the turns.
- `scripts/cache-gaps.ts`: the shared price table.
- `detent-prd-v3.md`: X-8″'s built note.
- Tests: `tests/sessions/resume.test.ts`, `tests/sessions/backend-limit.test.ts`,
  `tests/init/session-resume.test.ts` and `tests/kernel/limit-resume.test.ts` are new. Four tests
  import the moved names from their new module.

## Probes

Live, in `~/tabachir-detent-ab2`, on Sonnet 5.5 at `low` through the SDK 0.3.285 (runtime
2.1.285), for $0.03 in all:

    first result {"subtype":"success","is_error":false,"num_turns":2,"cost":0.0089949,"input":4,"output":194,"cache_read":2192,"cache_write":2251}
    first session ids ["3768ba77-c936-4df0-a6d9-f47886f264eb"] requests 2
    first text: Today's date is 2026-10-01. …
    resumed result {"subtype":"success","is_error":false,"num_turns":1,"cost":0.014384899999999999,"input":2,"output":415,"cache_read":3105,"cache_write":246}
    resumed session ids ["3768ba77-c936-4df0-a6d9-f47886f264eb"] requests 1
    resumed text: I read `/Users/workstation/tabachir-detent-ab2/README.md` earlier. My context now gives the date as: "The date has changed. Today's date is now 2026-09-30." …
    bogus result {"subtype":"error_during_execution","is_error":true,"num_turns":0,"cost":0,"input":0,"output":0,"cache_read":0,"cache_write":0}
    bogus THREW Claude Code returned an error result: No conversation found with session ID: 00000000-0000-4000-8000-000000000000
    result message {"subtype":"error_max_turns","is_error":true,"num_turns":2,"total_cost_usd":0.0037163000000000005,… "modelUsage":{"claude-haiku-4-5-20251001":{… "costUSD":0.000989 …
    THREW Claude Code returned an error result: Reached maximum number of turns (1)
    stream-priced 0.001517 responses 1

- A resumed session keeps its id and its conversation, and its result counts its own half:
  `num_turns` 1, and its own cost.
- The runtime's binary names its limits "You've hit your ${…}" and a missing conversation "No
  conversation found with session ID: ${…}". The run logs hold 58 limits, every one "You've hit
  your session limit · resets … (Africa/Algiers)".
- A live limit was not reached for this ticket. Its shape is the run logs' own, and the error
  result's arrival before the throw was seen for a turn limit and a missing conversation.

## Across midnight

The runtime's system prompt carries the date, so the ticket asked what a resume does when the
reset crosses midnight. The probe ran the first half under `TZ=Pacific/Kiritimati`, where it was
2026-10-01, and resumed under `TZ=Pacific/Pago_Pago`, where it was 2026-09-30. The conversation is
kept with its first date in it, and the runtime adds a line to it, "The date has changed. Today's
date is now 2026-09-30." The model saw both dates and took the newer. The resumed request read
3,105 tokens from the cache and wrote 246, so the date does not sit in the cached prefix. After a
limit's wait that cache has expired anyway, and the resume writes the conversation once. Nothing
is needed from Detent, and `RESUME_PROMPT` says nothing of the date.

## Falsification

Against HEAD `bde9cbc`, with HEAD-compatible copies of the new tests (the new modules' imports
replaced by the old ones, and the pure helpers' own tests left out):

    × X-8″ the backend resumes a stopped conversation > resumes with the session's id and a prompt to carry on, not the task's prompt 4ms
    → expected undefined to be 'sess-1' // Object.is equality
    × X-8″ the backend resumes a stopped conversation > launches afresh, with the task's own prompt, when the runtime has no such conversation, and says why 2ms
    → expected [ undefined ] to deeply equal [ 'sess-1', undefined ]
    × X-8″ the backend resumes a stopped conversation > returns a resume the limit stopped again before its first turn as it is, for its driver to wait out 1ms
    → expected [ false, +0, undefined ] to deeply equal [ false, +0, { sessionId: 'sess-1' } ]
    × X-8″ a stopped session's spend is kept > prices the usage its streamed messages carried when no result arrived, each response once, as a lower bound 1ms
    → expected +0 to be close to 0.04566, received difference is 0.04566, but expected 5e-13
    × X-8″ a stopped session's spend is kept > keeps the runtime's own error result, its side requests included, when one arrived before the SDK threw 0ms
    → expected +0 to be 0.0037163 // Object.is equality
    × X-8″ a stopped session's spend is kept > still records $0 for a limit that arrives before any token is spent 0ms
    → expected [ +0, +0, true, undefined ] to deeply equal [ +0, +0, true, 'sess-9' ]
    × X-8″ a stopped session's spend is kept > prices a write the usage does not split at five minutes, and a model it does not know at the cheapest price 0ms
    → expected +0 to be close to 0.00725, received difference is 0.00725, but expected 5e-13
    × X-8″ init resumes what a usage limit stopped > waits for the stated reset, then resumes the stopped session's own conversation 69ms
    → expected undefined to deeply equal { sessionId: 'sess-1' }
    × X-8″ init resumes what a usage limit stopped > launches afresh a session the limit stopped before its first turn, since there is nothing to carry on 52ms
    → expected 'backend limit during audit — waiting …' to contain 'it stopped before its first turn, so …'
    × X-8″ init resumes what a usage limit stopped > launches afresh when no session id arrived, and says so 52ms
    → expected 'backend limit during audit — waiting …' to contain 'no session id arrived, so it is launc…'
    ✓ X-8″ init resumes what a usage limit stopped > does not resume a session that ended for any other reason: an overload is waited out and launched afresh 49ms
    × X-8″ init resumes what a usage limit stopped > resumes the same conversation again when the resume itself is stopped before its first turn 51ms
    → expected [ undefined, undefined, undefined ] to deeply equal [ undefined, 'sess-1', 'sess-1' ]
    × X-8″ init resumes what a usage limit stopped > says so when the runtime would not resume the conversation and the session was launched afresh 52ms
    → expected 'backend limit during audit — waiting …' to contain 'the runtime would not resume session …'
    × X-8″ run waits for a limit's reset and resumes the stopped session > waits for the stated reset, not the ladder's minute, and the next launch resumes the conversation as the same attempt 1081ms
    → three hours and the minute's margin, not one minute: expected [] to deeply equal [ 10860000 ]
    × X-8″ run waits for a limit's reset and resumes the stopped session > launches afresh, with a note, when the runtime would not resume the conversation 897ms
    → expected false to be true // Object.is equality
    × X-8″ run waits for a limit's reset and resumes the stopped session > hands the decision back when the reset is further off than it will wait 899ms
    → expected +0 to be 1 // Object.is equality
    × X-8″ run waits for a limit's reset and resumes the stopped session > keeps the ladder for a limit that names no reset 894ms
    → expected [] to deeply equal [ 60000 ]
    Test Files  3 failed (3)
    Tests  16 failed | 1 passed (17)

The overload case passes against HEAD, as it should: HEAD already launched a session afresh after
an overload, and this ticket keeps that. HEAD's run driver never waited for a limit that stopped a
session after its first turn: it judged the half-done tree and went on. For a limit before the
first turn, the acceptance criteria's case:

    × X-8″ run waits for a limit's reset and resumes the stopped session > waits out a limit that stopped a session before its first turn to its reset too, and launches the next one afresh 1093ms
    → the stated reset, not the ladder's first minute: expected [ 60000 ] to deeply equal [ 10860000 ]
    Tests  1 failed | 4 skipped (5)

## Mutation battery

Each mutant was applied to snapshot copies of the nine changed source files, and only the suites
that exercise its file were run, each run in its own process group under a 180-second limit. The
first attempt ran every suite for every mutant: the ladder's mutants make the kernel loop wait out
its 120-second test timeouts, so it hung and was stopped, and every file was restored from its copy.
After each mutant the file was restored from its copy and checked with `cmp`, and after the battery
all nine were checked again.

46 mutants: 45 killed and one equivalent. "init: plain error" put `"" +` in front of the message,
which changes nothing. The two mutants it was meant to be were run after it: a failure that keeps no
result, and a plain `Error` thrown in place of `InitSessionFailed`. Both were killed.

| Mutant | File | Result |
|---|---|---|
| isUsageLimit never | `src/schemas/backend-limit.ts` | killed, 11 tests |
| isUsageLimit any limit | `src/schemas/backend-limit.ts` | killed, 1 test |
| isUsageLimit no older form | `src/schemas/backend-limit.ts` | killed, 1 test |
| isOutage misses account limits | `src/schemas/backend-limit.ts` | killed, 1 test |
| outageWait ignores the reset | `src/schemas/backend-limit.ts` | killed, 8 tests |
| outageWait never too long | `src/schemas/backend-limit.ts` | killed, 2 tests |
| outageWait past the ladder | `src/schemas/backend-limit.ts` | killed, 1 test: the suite hung past 180 s and was stopped |
| resetPhrase none | `src/schemas/backend-limit.ts` | killed, 9 tests |
| resume after any crash | `src/schemas/backend-limit.ts` | killed, 3 tests |
| no resume carried at zero turns | `src/schemas/backend-limit.ts` | killed, 3 tests |
| refused resume carried | `src/schemas/backend-limit.ts` | killed, 1 test |
| sdk: no resume option | `src/sessions/sdk.ts` | killed, 2 tests |
| sdk: task prompt on resume | `src/sessions/sdk.ts` | killed, 1 test |
| sdk: never refused | `src/sessions/sdk.ts` | killed, 1 test |
| sdk: an outage refuses | `src/sessions/sdk.ts` | killed, 1 test |
| sdk: resume unnamed on result | `src/sessions/sdk.ts` | killed, 2 tests |
| sdk: result message ignored | `src/sessions/sdk.ts` | killed, 1 test |
| sdk: stream ignored | `src/sessions/sdk.ts` | killed, 2 tests |
| sdk: stream turns kept | `src/sessions/sdk.ts` | killed, 1 test |
| sdk: no session id | `src/sessions/sdk.ts` | killed, 4 tests |
| usage: 1h priced as 5m | `src/sessions/stream-usage.ts` | killed, 1 test |
| usage: unsplit at 1h | `src/sessions/stream-usage.ts` | killed, 2 tests |
| usage: synthetic counted | `src/sessions/stream-usage.ts` | killed, 1 test |
| prices: dated id unknown | `src/sessions/prices.ts` | killed, 1 test |
| prices: unknown at Opus | `src/sessions/stream-usage.ts` | killed, 1 test |
| init: never resumes | `src/init/session.ts` | killed, 2 tests |
| init: plain error | `src/init/session.ts` | survived: equivalent, see above |
| init: no resume note | `src/init/session.ts` | killed, 1 test |
| init: no refused note | `src/init/session.ts` | killed, 1 test |
| init: no resumes on start | `src/init/session.ts` | killed, 1 test |
| driver: ladder only | `src/kernel/driver.ts` | killed, 3 tests |
| driver: waits past six hours | `src/kernel/driver.ts` | killed, 1 test |
| journal: first stop, not last | `src/kernel/journal.ts` | killed, 1 test |
| journal: any generation | `src/kernel/journal.ts` | killed, 1 test |
| referee: counts a resume | `src/kernel/referee-session.ts` | killed, 1 test |
| referee: clears on resume | `src/kernel/referee-session.ts` | killed, 1 test |
| referee: never resumes | `src/kernel/referee-session.ts` | killed, 2 tests |
| referee: no refusal on a stop | `src/kernel/referee-session.ts` | killed, 5 tests |
| referee: no resumes on start | `src/kernel/referee-session.ts` | killed, 1 test |
| referee: no refused note | `src/kernel/referee-session.ts` | killed, 1 test |
| resume: turns never carried | `src/kernel/session-resume.ts` | killed, 1 test |
| resume: refused turns carried | `src/kernel/session-resume.ts` | killed, 1 test |
| resume: stop not kept on end | `src/kernel/session-resume.ts` | killed, 4 tests |
| resume: refusal at zero turns | `src/kernel/session-resume.ts` | killed, 1 test |
| init: a failure keeps no result | `src/init/session.ts` | killed, 4 tests |
| init: plain error thrown | `src/init/session.ts` | killed, 4 tests |

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: 206 files, 2,285 passed and 2 skipped (2,287).
- `npm run plugin`: wrote nothing that changed.

## Recorded, not fixed

- **`init` keeps a stopped conversation only within the launch.** An `init` killed during the wait
  launches the session afresh when it is run again. `run` keeps it in the ticket's journal.
- **A stream that ends with no result and no throw still records $0.** That is S-4's
  absent-telemetry case, which the circuit breaker treats as a death. Its streamed usage could be
  priced the same way.
- **A crash's turn count is still the count of streamed blocks** (PRDR-072), not of requests, where
  no result arrived.
- **PRDR-325's estimates must read a stopped half and its resumed half as one session.** They are
  two ledger rows, the first marked `partial: "crash"`.

