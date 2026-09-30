---
id: PRDR-320
title: "Every session writes its cache at the one-hour rate, which costs a claim check 17% more than it needs. S-6 (PRDR-054) asks for the extended lifetime on every session, and on a subscription Claude Code picks one hour anyway. All 38.9M tokens tabachir's test run wrote to the cache were written at one hour: $8 a million on Opus 5.5, against $5 at five minutes. A claim check's requests come 12 seconds apart at the median and 137 seconds at the 99th percentile, so a five-minute cache would have cost it 17% less. A review's long thinking turns outlast five minutes, so a five-minute cache would cost it 11% more, and that is what an API key gets today. Each kind of session gets the lifetime its measured gaps call for, whatever the account"
state: DONE
severity: major
category: spend
labels: ["prd-review", "cost-strategy", "S-6″", "S-6", "prompt-cache", "spend"]
surface: ["src/schemas/cache-lifetime.ts", "src/sessions/env.ts", "src/sessions/sdk.ts", "src/sessions/backend.ts", "src/sessions/stream-usage.ts", "src/init/session.ts", "src/kernel/ledger.ts", "src/schemas/records.ts", "scripts/cache-gaps.ts", "tests/init/session-cache.test.ts", "tests/sessions/cache-writes.test.ts", "tests/kernel/ledger-cache.test.ts", "tests/scripts/cache-gaps.test.ts", "detent-prd-v3.md"]
prd_refs: ["S-6", "S-6′", "SEC-4′", "S-4", "D-35"]
acceptance_criteria: ["Each kind of session has a cache lifetime. Five minutes: AUDIT's claim checks, WRITE, and VALIDATE's writer. One hour: AUDIT's survey and triage, DECIDE, VALIDATE's reviewers, SLICE, PLAN, plan_review, and every run role. A kind is the role and its task, since one role runs tasks whose gaps differ.", "The lifetime reaches the session as CLAUDE_CODE_PROMPT_CACHE_TTL, 5m or 1h, set by Detent in the session's environment, so it holds on an API key as on a subscription. A session launched with no kind named gets one hour, as today.", "The ledger row records the lifetime the session ran with, and its cache writes at each lifetime, summed from the usage's ephemeral_5m_input_tokens and ephemeral_1h_input_tokens.", "A live check on the new build: a claim check's transcript shows its cache writes at five minutes, and a review's at one hour. The ticket pastes both.", "The table's lifetimes are measured, not guessed: the ticket keeps the script that reads the gaps between a session's requests from its transcript, and a kind whose 99th-percentile gap passes four minutes is not given five.", "Falsifying tests, against HEAD: a claim check's session environment carries no lifetime of its own, and is the same as a review's; a ledger row does not say at which lifetime its cache was written."]
non_goals: ["Does NOT change what any session is asked, or its model or effort.", "Does NOT measure the run roles' gaps. They keep one hour until their transcripts are measured.", "Does NOT remove S-6's extended-cache header, which one-hour sessions keep and five-minute ones do not need."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-054", "PRDR-133", "PRDR-205", "PRDR-318"]
depends_on: ["PRDR-318"]
---

# PRDR-320 — the cache's lifetime, per kind of session

## Where this came from

The cost plan (`docs/plan-cost-strategy.md` §3) priced tabachir's test run from its ledger and its
231 session transcripts. Cache writes were $283 of the $833, a third of the bill, and every one of
them was written at the one-hour rate.

## Problem

- **Detent asks for one hour on every session.** S-6 (PRDR-054) sets `anthropic-beta:
  extended-cache-ttl-2025-04-11` on every session unless the operator set custom headers
  (`EXTENDED_CACHE_HEADER`, `src/sessions/env.ts`). Claude Code's own rule is one hour on a
  subscription and five minutes on an API key, Bedrock, Vertex or Foundry, unless
  `CLAUDE_CODE_PROMPT_CACHE_TTL` says otherwise; both 2.1.280 and 2.1.284 read that variable.
- **The measurement.** The recorded costs match one-hour prices within 1.5%, and five-minute prices
  would sit 12% to 16% below them. The transcripts' usage splits every write by lifetime: 38.9M
  tokens at one hour and none at five minutes, over 5,965 requests.
- **What each kind of session would pay at five minutes**, estimated from its request times. A
  request more than five minutes after the one before is priced as writing its whole prefix again:

| Kind | Sessions | Gaps: median, 99th percentile | Over 5 min | Five-minute cache |
|---|---|---|---|---|
| AUDIT's claim checks | 153 | 12 s, 137 s | 4 of 4,040 | −17.2% |
| VALIDATE's writer | 1 | 4 s, 223 s | 0 of 36 | −16.6% |
| WRITE | 3 | 9 s, 203 s | 1 of 175 | −6.5% |
| AUDIT's triage | 1 | 4 s, 854 s | 1 of 15 | −2.6% |
| VALIDATE's reviewers | 35 | 6 s, 864 s | 62 of 1,034 | +11.4% |
| AUDIT's survey | 4 | 6 s, 1,066 s | 6 of 53 | +12.7% |
| DECIDE | 1 | 4 s, 1,279 s | 2 of 14 | +12.1% |

  So one lifetime is wrong for someone either way. One hour costs the claim checks and the writer
  about a sixth more than they need. Five minutes, which an API key gets today, would cost the
  reviews, the survey and DECIDE about an eighth more.

## Design

- **A lifetime per kind of session**, where a kind is the role and its task, in one table beside
  the routing. The first table is the one above: five minutes where the gaps are short, one hour
  where they are not, and one hour for every kind not yet measured, the run roles and planning
  included.
- **Detent sets it.** Each session's environment carries `CLAUDE_CODE_PROMPT_CACHE_TTL` with its
  kind's lifetime, so an API key and a subscription behave alike. S-6's header stays on one-hour
  sessions.
- **Measured, and kept measured.** The ledger row records the lifetime and the writes at each. The
  script that computed the table is kept, and a kind whose 99th-percentile gap passes four minutes
  is not given five, since a long thinking turn at a new effort level can move it.
- **The PRD:** S-6″ amends S-6's lifetime.

## Building it

- `src/schemas/roles.ts` or a module beside it: the table, keyed by role and task.
- `src/sessions/env.ts` and `src/sessions/sdk.ts`: the variable, per session.
- `src/init/session.ts` and `src/kernel/referee-session.ts`: each launch names its kind.
- `src/kernel/ledger.ts` and `ledger-rows.ts`: the lifetime and the split writes.
- `scripts/`: the gap measurement, over a project's transcripts.

### Vetoable calls

1. **Per kind of session, not per role.** The `audit` role's survey wants an hour and its checks
   five minutes. So does `spec_write`: DECIDE wants an hour, and the writer five minutes.
2. **The triage keeps one hour,** though five minutes measured 2.6% cheaper. One of its 15 gaps was
   854 seconds, and the four-minute rule is kept even where the margin is thin.
3. **The run roles and planning keep one hour** until their gaps are measured. Tabachir's run has
   no `run` sessions yet, and planning's transcripts predate the redesign.
4. **An operator's own lifetime in their environment is not inherited.** SEC-4's allowlist drops
   it today, and the per-kind table is a measured choice. An operator who wants otherwise can ask
   for a config key.

5. **A kind is the role and the `task` its inputs name, not a planning session's `stage`.** No
   stage has five minutes, so reading one changed nothing, and a mutant that ignored it survived.
   A test reads init's source instead and fails if a five-minute kind names a task init does not
   send. PRDR-306's rename of `verify_claim` to `verify_claims` is the drift it catches.
6. **Five minutes only where it is also cheaper.** The ticket's rule is the ceiling, and the
   script adds that five must cost less than one hour on the same requests. Under the ceiling that
   has always held, so it changes no kind today.
7. **The ceiling is exclusive:** a 99th-percentile gap of exactly 240 seconds keeps one hour.
8. **The writes are counted from the stream, not the result message,** once per response id, with
   the last block's usage winning. The earlier probe found the result's split equal to the sum, and
   the stream also covers a session that broke before any result was sent.
9. **The script lives in `scripts/`, not `src/`.** It is a measurement, not something a session
   runs. It follows the repository's convention: `runDirectly` guards its entry, and its test's
   import typechecks it.
10. **The script's one-hour figure prices the recorded tokens as they are.** On a transcript
    recorded at five minutes, the rewrites after long gaps are already in it, so that figure is
    high by them. The doc-block says so, and the verdict rests on the gaps.
11. **A `<synthetic>` message is not a request.** It is Claude Code's own note of a limit or an
    error, and has no usage. One sat in tabachir's WRITE transcripts.
12. **The live check used a short prompt through init's own launcher, `launchInitSession`,** on
    Opus 5.5 at `low` in `~/tabachir-detent-ab2`, not a real claim check and review. The lifetime
    follows the kind, which the launcher reads from the inputs, and not the prompt. PRDR-327's
    evaluation runs will show it at the scale of real sessions.

## Falsification, as filed

- A claim check's session environment has no `CLAUDE_CODE_PROMPT_CACHE_TTL`, and equals a
  review's.
- A ledger row has no field saying at which lifetime its cache was written.

## What changed

- `src/schemas/cache-lifetime.ts` (new): `CACHE_LIFETIMES`, `FIVE_MINUTE_KINDS` (`audit`'s
  `verify_claims`, `spec_write`'s `write` and `fix`), `FIVE_MINUTE_P99_CEILING_S` (240) and
  `cacheLifetime(role, task)`. The measured table is in its doc-block.
- `src/sessions/backend.ts`: `SessionSpec.cacheTtl`, and `SessionResult.cacheTtl` and
  `cacheWrites`.
- `src/sessions/env.ts`: `buildSessionEnv` takes the lifetime and sets
  `CLAUDE_CODE_PROMPT_CACHE_TTL`. S-6's header goes only on a one-hour session, unless the operator
  set custom headers, which still pass on either lifetime.
- `src/sessions/stream-usage.ts` (new): the cache writes at each lifetime, summed once per response
  from the stream.
- `src/sessions/sdk.ts`: the session gets its lifetime, one hour when the spec names none. Both
  returns, the normal one and a broken stream's, say the lifetime and the writes.
- `src/init/session.ts`: an init session's spec carries its kind's lifetime.
- `src/schemas/records.ts`, `src/kernel/ledger.ts`: the ledger row's optional `cache_ttl`,
  `cache_creation_5m_input_tokens` and `cache_creation_1h_input_tokens`, on the run's rows and the
  out-of-band ones. An older row reads back without them.
- `scripts/cache-gaps.ts` (new): the gap measurement over a project's transcripts, and the rule.
- `detent-prd-v3.md`: S-6″'s built note.
- Tests (new): `tests/init/session-cache.test.ts`, `tests/sessions/cache-writes.test.ts`,
  `tests/kernel/ledger-cache.test.ts`, `tests/scripts/cache-gaps.test.ts`.

## The measurement, kept

`npx tsx scripts/cache-gaps.ts ~/.claude/projects/-Users-workstation-tabachir-detent-test`, over
the 231 transcripts of tabachir's test run. `audit/verify_claim` is the claim check under the name
it had before PRDR-306.

    | Kind | Sessions | Requests | Gaps: p50, p90, p99, max (s) | Over 5 min | Written at 5 min, 1 h | Cost at 1 h | Cost at 5 min | Change | Lifetime |
    | audit/verify_claim | 153 | 4193 | 12, 34, 137, 5746 | 4 of 4040 | 0, 19597130 | $337.90 | $279.65 | -17.2% | 5m |
    | spec_review/review | 35 | 1069 | 6, 196, 864, 1237 | 62 of 1034 | 0, 14221620 | $306.70 | $341.68 | +11.4% | 1h |
    | spec_write/write | 3 | 177 | 9, 49, 203, 1095 | 1 of 174 | 0, 1322048 | $39.16 | $36.62 | -6.5% | 5m |
    | audit/verify_claims | 20 | 400 | 12, 61, 154, 237 | 0 of 380 | 0, 1934974 | $36.13 | $30.32 | -16.1% | 5m |
    | audit/survey | 4 | 57 | 6, 342, 1066, 1066 | 6 of 53 | 0, 1084502 | $24.40 | $27.50 | +12.7% | 1h |
    | spec_write/decide | 1 | 15 | 4, 869, 1279, 1279 | 2 of 14 | 0, 271471 | $7.07 | $7.93 | +12.1% | 1h |
    | spec_write/fix | 1 | 37 | 4, 40, 223, 223 | 0 of 36 | 0, 298498 | $5.39 | $4.49 | -16.6% | 5m |
    | audit/triage | 1 | 16 | 4, 8, 854, 854 | 1 of 15 | 0, 195959 | $3.86 | $3.76 | -2.6% | 1h |

Every write was at one hour, 38.9M tokens, and the rule gives the table `FIVE_MINUTE_KINDS` holds.

## Live check

In `~/tabachir-detent-ab2`, on the new build, through `launchInitSession` and `ClaudeCodeBackend`.
The two sessions were an `audit` session with `task: "verify_claims"` and a `spec_review` session
with `task: "review"`, each on `claude-opus-5-5` at `low`, each asked to read `README.md` once and
write its artifact. The transcripts were read with `parseTranscript` from the kept script:

    audit/verify_claims result: {"ok":true,"cacheTtl":"5m","cacheWrites":{"5m":5698,"1h":0},"costUsd":0.037595199999999995,"turns":3}
    spec_review/review result: {"ok":true,"cacheTtl":"1h","cacheWrites":{"5m":0,"1h":5385},"costUsd":0.050743399999999994,"turns":3}
    transcript 59f025b5-5242-415c-9de2-050ee88d9d45.jsonl: kind spec_review/review; per request, written at 5m / 1h: 0 / 3415, 0 / 1767, 0 / 203
      total written at 5m 0, at 1h 5385
    transcript feb94a1a-5076-4d22-aa3e-18a0e35e567b.jsonl: kind audit/verify_claims; per request, written at 5m / 1h: 3732 / 0, 1767 / 0, 199 / 0
      total written at 5m 5698, at 1h 0
    ledger row: {"role":"audit","cache_ttl":"5m","cache_creation_5m_input_tokens":5698,"cache_creation_1h_input_tokens":0,"cost_estimate_usd":0.037595199999999995}
    ledger row: {"role":"spec_review","cache_ttl":"1h","cache_creation_5m_input_tokens":0,"cache_creation_1h_input_tokens":5385,"cost_estimate_usd":0.0507434}

The claim check's transcript shows its writes at five minutes and the review's at one hour, and the
ledger rows say the same. Cost $0.088. The two artifacts were removed afterwards, and the rows stay
in ab2's ledger.

## Falsification

Against HEAD `55f52af`, first with the tests the acceptance criteria name:

    × S-6″ a session's result says its cache lifetime and its writes at each > sums each response's writes once, by lifetime, and names the lifetime the session was given 4ms
    → expected undefined to be '5m' // Object.is equality
    × S-6″ a session's result says its cache lifetime and its writes at each > a session given no lifetime ran at one hour, and says so 1ms
    → expected undefined to be '1h' // Object.is equality
    × S-6″ a ledger row records its cache lifetime and its writes at each > a run's row 66ms
    → expected undefined to be '5m' // Object.is equality
    × S-6″ a ledger row records its cache lifetime and its writes at each > an out-of-band row 59ms
    → expected [ undefined, undefined, undefined ] to deeply equal [ '5m', 1500, 40 ]
    × S-6″ a cache lifetime per kind of session > gives the kinds measured to want five minutes five, and every other kind one hour 61ms
    → audit {"task":"survey"}: expected undefined to be '1h' // Object.is equality
    × S-6″ a cache lifetime per kind of session > a claim check's session environment carries five minutes, a review's one hour, and only the hour carries S-6's header 102ms
    → expected undefined to be '5m' // Object.is equality
    × S-6″ a cache lifetime per kind of session > a session launched with no kind named gets one hour, as every run role does 1ms
    → expected undefined to be '1h' // Object.is equality
    × S-6″ a cache lifetime per kind of session > an operator's own lifetime is not inherited: the table is a measured choice 53ms
    → expected undefined to be '1h' // Object.is equality
    Tests  8 failed | 3 passed (11)

Then with every test this ticket adds, `tests/init/session-cache.test.ts` by then importing the
table, which HEAD does not have:

    × S-6″ a session's result says its cache lifetime and its writes at each > sums each response's writes once, by lifetime, and names the lifetime the session was given 4ms
    → expected undefined to be '5m' // Object.is equality
    × S-6″ a session's result says its cache lifetime and its writes at each > a session whose stream breaks still says what it wrote before it broke, since those writes were billed 2ms
    → expected [ undefined, undefined ] to deeply equal [ '5m', { '5m': 900, '1h': +0 } ]
    × S-6″ a session's result says its cache lifetime and its writes at each > a session given no lifetime ran at one hour, and says so 0ms
    → expected undefined to be '1h' // Object.is equality
    × S-6″ a ledger row records its cache lifetime and its writes at each > a run's row 63ms
    → expected undefined to be '5m' // Object.is equality
    × S-6″ a ledger row records its cache lifetime and its writes at each > an out-of-band row 56ms
    → expected [ undefined, undefined, undefined ] to deeply equal [ '5m', 1500, 40 ]
    Error: Cannot find module '../../src/schemas/cache-lifetime.js' imported from '/private/tmp/claude-502/-Users-workstation/08f87a21-cef4-46a3-b9ee-12a1a8e7e97c/scratchpad/head320/tests/init/session-cache.test.ts'
    Error: Cannot find module '../../scripts/cache-gaps.js' imported from '/private/tmp/claude-502/-Users-workstation/08f87a21-cef4-46a3-b9ee-12a1a8e7e97c/scratchpad/head320/tests/scripts/cache-gaps.test.ts'
    Test Files  4 failed (4)
    Tests  5 failed | 2 passed (7)

## Mutation battery

Each mutant was applied to snapshot copies of the eight changed source files. Six suites were run,
`tests/sec/pack.test.ts` and `tests/sessions/sdk.test.ts` among them. Every file was restored from
its copy and checked with `cmp`. The first pass left one survivor, "p99 is the max": every fixture
had fewer than a hundred gaps, so its 99th percentile was its maximum. A fixture like the claim
checks, one 5,746-second gap among 149, now kills it. The first pass also found that the stream's
writes on a broken session were untested, and that test was added before the pass.

| Mutant | Result |
|---|---|
| claim checks lose five minutes | killed |
| the table keeps the old task name `verify_claim` | killed: init does not send it |
| reviews given five minutes | killed |
| the writer loses five minutes | killed |
| a session naming no kind gets five minutes | killed |
| the ceiling moved to 300 s | killed |
| S-6's header on five-minute sessions too | killed |
| `CLAUDE_CODE_PROMPT_CACHE_TTL` never set | killed |
| `buildSessionEnv` defaults to five minutes | killed (`tests/sec/pack.test.ts`) |
| the SDK backend ignores the spec's lifetime | killed |
| the result names no lifetime | killed |
| a broken stream's return drops the writes | killed |
| the stream's usage never read | killed |
| each content block counted as a response | killed |
| the two lifetimes swapped | killed |
| the ledger drops `cache_ttl` | killed |
| the ledger swaps the split | killed |
| the row's schema takes any lifetime | killed |
| init names no task | killed |
| init reads the wrong key | killed |
| script: the rule at the ceiling | killed |
| script: cost ignored | killed |
| script: no rewrite after a long gap | killed |
| script: a synthetic note counted | killed |
| script: a response's blocks counted twice | killed |
| script: a request dated from itself | killed |
| script: the old task name unmapped | killed |
| script: p99 is the max | killed, by the fixture added after the first pass |

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: 202 files, 2,253 passed and 2 skipped (2,255).
- `npm run plugin`: wrote nothing that changed.

## Recorded, not fixed

- **`run`'s roles and planning keep one hour, unmeasured.** Tabachir's run has no `run` sessions
  yet, and planning's transcripts predate the redesign. `scripts/cache-gaps.ts` names planning's
  kinds by stage, so their first transcripts can be measured.
- **The lifetime covers the main conversation only.** The runtime's own side requests, such as the
  Haiku calls that page long web results, keep their own caching. They were 11% of tabachir's bill,
  and this ticket does not change them.
- **The table was measured on Opus 5 and 5.5 transcripts at `max` and `xhigh`.** A lower level
  (PRDR-327) thinks for less time per turn, which shortens the gaps. If one is adopted, the table
  should be measured again at that level.

