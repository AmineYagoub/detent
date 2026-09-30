---
id: PRDR-321
title: "A usage limit throws away the work a session has done, and ends detent run outright. When a session reaches the account's limit, init waits for the stated reset (PRDR-189) and then starts the session again from its first turn. The headless run driver waits 1, 5 and 15 minutes, whatever reset the limit names, and then exits (X-8′), so a person must restart it. The run logs record 30 such waits. In PRDR-317's A/B test, four sessions stopped at the limit after 129 turns in total, and the ledger recorded them at $0. A stopped session will resume its own conversation after the reset, run will wait for the stated reset as init does, and what a stopped attempt spent will be recorded"
state: OPEN
severity: major
category: resumability
labels: ["prd-review", "cost-strategy", "X-8″", "X-8′", "usage-limit", "ARCH-2", "resume", "ledger"]
surface: ["src/sessions/sdk.ts", "src/sessions/backend.ts", "src/init/session.ts", "src/kernel/driver.ts", "src/kernel/referee-session.ts", "src/kernel/ledger.ts", "tests/sessions/sdk.test.ts", "tests/init/session-resume.test.ts", "tests/kernel/outage-backoff.test.ts", "detent-prd-v3.md"]
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

## Falsification (to run against HEAD when this is built)

- The run driver, given a limit that resets in three hours, sleeps one minute and retries.
- `init` relaunches a limit-stopped session with no `resume`.
- A stopped session whose streamed messages carried usage is recorded at $0.
