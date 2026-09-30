---
id: PRDR-320
title: "Every session writes its cache at the one-hour rate, which costs a claim check 17% more than it needs. S-6 (PRDR-054) asks for the extended lifetime on every session, and on a subscription Claude Code picks one hour anyway. All 38.9M tokens tabachir's test run wrote to the cache were written at one hour: $8 a million on Opus 5.5, against $5 at five minutes. A claim check's requests come 12 seconds apart at the median and 137 seconds at the 99th percentile, so a five-minute cache would have cost it 17% less. A review's long thinking turns outlast five minutes, so a five-minute cache would cost it 11% more, and that is what an API key gets today. Each kind of session gets the lifetime its measured gaps call for, whatever the account"
state: OPEN
severity: major
category: spend
labels: ["prd-review", "cost-strategy", "S-6″", "S-6", "prompt-cache", "spend"]
surface: ["src/sessions/env.ts", "src/sessions/sdk.ts", "src/sessions/backend.ts", "src/init/session.ts", "src/kernel/referee-session.ts", "src/kernel/ledger.ts", "src/kernel/ledger-rows.ts", "src/schemas/roles.ts", "tests/sessions/sdk.test.ts", "tests/sec/pack.test.ts", "tests/init/session-cache.test.ts", "detent-prd-v3.md"]
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

## Falsification (to run against HEAD when this is built)

- A claim check's session environment has no `CLAUDE_CODE_PROMPT_CACHE_TTL`, and equals a
  review's.
- A ledger row has no field saying at which lifetime its cache was written.
