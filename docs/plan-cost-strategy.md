# Cost and time at the same quality — plan

**Status:** written 2026-09-30; no code yet. PRDR-318 will record it in the PRD, and PRDR-319 to
PRDR-328 will build it. Where this plan and the PRD differ, the PRD wins.
**Prerequisite (N-6):** PRDR-318 must land before any code.
**Evidence:** tabachir's stopped test run (its ledger, 231 session transcripts and 21 kept reviews),
PRDR-317's A/B test of claim checks, and ksar-cloud's planning ledger, all measured on 2026-09-30
(§3).
**Decided by:** the user, 2026-09-30 (§2).

---

## 1. The problem

The user, on 2026-09-30: Detent "takes a long time and consumes a vast number of tokens far
exceeding the capacity of 99% of users", and the answer must be "a balanced strategy that does not
compromise our concept of quality".

Tabachir is a small project: 56 documents, 571 KB. Its test `init` was stopped in VALIDATE's first
round, with 21 of 26 areas reviewed. By then it had spent $833, and AUDIT alone had run for 9.6
hours. Finished on the current build, it would cost about $1,500 and run for about 27 hours (§8).
A subscription's usage limits stretch that over two to three days. ksar-cloud's planning alone
cost $1,067.

Every dollar figure here is the SDK's API-equivalent estimate. On a subscription, the same tokens
count against the plan's usage limits instead.

## 2. Decisions

The user's:
1. **Quality comes before cost** ("yes quality comes before cost", PRDR-317). Spend caps stay
   advisory (PRDR-191, PRDR-265), and no estimate in this plan stops anything.
2. **The whole project is checked and planned before anything is built.** Milestone-scoped `init`
   was proposed and refused: "A later milestone could conflict with something already built, I
   can't accept this."
3. **Every role runs on the newest models**, Claude Opus 5.5 and Claude Sonnet 5.5.

**The quality floor.** No lever in this plan may lower any of these:
- code checks every artifact a session writes;
- every claim the triage sends to a check gets a session of its own (D-34′);
- every VALIDATE round reviews every area in its scope, the stop rule and the ceiling stay as they
  are, and a blocker is fixed and verified before anything plans from the pack;
- what is left open is shown to the user, never dropped;
- every ticket passes its gates and a review, and the user approves the plan.

**Two kinds of lever.**
- **Layer 1** changes neither what a session is asked nor the model or effort it runs at, only what
  asking costs. It is built directly and measured by the ledger (§4).
- **Layer 3** lowers a model or an effort level. It is adopted only after it passes the bar of §5
  on this project's own evidence, and the result is recorded either way (§6).

Layer 2 was milestone scoping, refused under decision 2.

## 3. Where the money and the time go

**By phase**, as the test run spent it:

| Phase | Sessions | Cost | Per session | Wall clock |
|---|---|---|---|---|
| AUDIT, a session per claim and no triage (C-2¹¹) | 172 | $533.76 | $3.10 | 9.6 h |
| DECIDE | 1 | $7.12 | | |
| WRITE | 3 | $36.21 | $12.07 | |
| VALIDATE round 1, as far as it got | 27 | $255.96 | $9.64 a review | |
| **Total** | 203 | $833.06 | | |

**By what is paid for**, over the whole run:
- output: $337 (40%). Most of it is thinking: 75% of a claim check's output, and 84% of a review's;
- cache writes: $283 (34%). All 38.9M tokens were written at the 1-hour rate, none at 5 minutes;
- cache reads: $120 (14%);
- uncached input: $92 (11%). Nearly all of it is web pages that Haiku 4.5 reads for AUDIT's checks.

**Per session**, from the transcripts:

| | Claim check | Review |
|---|---|---|
| Sessions | 153 | 35 |
| Requests to the model | 27 | 30 |
| Median length | 7.8 min | 31.5 min |
| Tool calls | 34.5 web searches | 48.9 reads (48.1 distinct files) and 27 greps |
| Output tokens | 41K | 207K |
| Cache writes | 128K | 406K |
| Gap between requests: median, 90th and 99th percentile | 12 s, 34 s, 137 s | 6 s, 196 s, 864 s |
| Gaps over 5 minutes | 4 of 4,040 | 62 of 1,034 |
| Main-model cost with a 5-minute cache, estimated from the request times | −17.2% | +11.4% |

What the measurements say:
- **Thinking and cache writes are three quarters of the bill.** A review writes to the cache what
  it reads and what it thinks, and every later request reads all of it back.
- **Every cache write is at the 1-hour rate, and Detent asks for it.** S-6 (PRDR-054) requests the
  extended lifetime on every session, and Claude Code picks one hour on a subscription. For a claim
  check, whose requests come seconds apart, a 5-minute cache would cost 17% less. For a review,
  whose long thinking turns outlast five minutes, it would cost 11% more.
- **Reading is not what makes a review long.** A reviewer reads its 48 files in parallel calls, so
  its 30 requests are not spent finding documents. Preloading the reading list would not remove
  most of a review's requests, as the earlier discussion assumed. §4.4 keeps only the part that
  holds.
- **A usage limit throws finished work away.** The run logs record 30 waits for a backend limit
  or outage. After each wait, the session starts again from its first turn. In PRDR-317's A/B
  test, four sessions stopped at the account's limit after 129 turns in total, and the ledger
  recorded them at $0. The headless driver of `detent run` waits 1, 5 and 15 minutes, then exits,
  whatever reset time the limit names (X-8′). Only `init` waits for the stated reset (PRDR-189).
- **The Opus 5 roles pay the older prices.** ksar-cloud's planning tokens would have cost 34%
  less at Opus 5.5's prices than at Opus 5's, mostly because its cache reads cost 60% less. At
  the same effort level, Opus 5.5 also thinks more per turn than Opus 5, so the first run on it
  measures the net.

## 4. Layer 1: cheaper and faster, at the same quality

Nothing in §4 to §6 is built yet. Each part says what its ticket will do.

### 4.1 The newest models (PRDR-319)

| Role | Now | After |
|---|---|---|
| `planner`, `plan_review` | `claude-opus-5`, `max` | `claude-opus-5-5`, `max` |
| `review`, `diagnose`, `informed_fix` | `claude-opus-5`, `xhigh` | `claude-opus-5-5`, `xhigh` |
| `implement`, `blind_fix`, `review_fix`, `research` | `claude-sonnet-5`, `xhigh` | `claude-sonnet-5-5`, `xhigh` |
| `audit`, `spec_write`, `spec_review` | `claude-opus-5-5`, `max` | unchanged |

- **Prices, per million tokens:**
  - Opus 5.5: $4 input, $20 output, $0.20 cache read, $8 cache write at one hour;
  - Opus 5: $5, $25, $0.50 and $10;
  - Sonnet 5.5 costs what Sonnet 5 does: $2, $10, $0.20 and $4.
- **The SDK pin must move.** The SDK's bundled runtime is what serves a session (S-5‴). The pinned
  0.3.280 bundles Claude Code 2.1.280, which knows `claude-opus-5-5` but not `claude-sonnet-5-5`.
  Neither does 2.1.281; 2.1.284 does. The pin will move to 0.3.285, the latest, which bundles
  2.1.285 and was published on 2026-09-29. `doctor` will name any routed model that the bundled
  runtime does not serve.
- **The effort levels stay.** Both models recalibrated their levels, and Opus 5.5 thinks more per
  turn than Opus 5 at the same level. Keeping `max` and `xhigh` keeps at least today's thinking.
  Lowering them is Layer 3 (§6.1).
- **Existing configs.** S-5′ leaves a routing that a config already holds untouched, and a config
  cannot tell a chosen `claude-opus-5` from a defaulted one. So an existing config will be told
  which roles still name a superseded model, and the line that moves each, by `doctor` and at the
  start of `init` and `run`. This is vetoable: the alternative moves them automatically.

### 4.2 The cache's lifetime, per kind of session (PRDR-320)

- Each kind of session will get the lifetime its measured gaps call for, set per session through
  `CLAUDE_CODE_PROMPT_CACHE_TTL`. A kind is a role's task, not the role: the `audit` role's survey
  wants an hour, and its checks five minutes. The setting will hold on an API key as on a
  subscription. On an API key, Claude Code otherwise picks 5 minutes, which would cost reviews 11%
  more.
- Five minutes: AUDIT's checks, WRITE, and VALIDATE's writer.
- One hour: AUDIT's survey and triage, DECIDE, the reviews, the planner and its reviewer, and every
  `run` role until its gaps are measured.
- The ledger row will record the lifetime a session ran with, so the effect can be measured. A
  kind whose gaps change, at a new effort level for example, will be measured again from its
  transcripts.
- Expected: about $0.38 less per claim check, which is $44 on tabachir's 117, and 17% less per
  writer batch.

### 4.3 A usage limit costs no finished work (PRDR-321)

- `run` will wait for the stated reset, as `init` does (ARCH-2).
- A session stopped by a limit will resume its own conversation after the reset, through the SDK's
  `resume`, instead of starting over. Its cache will have expired by then, so the resume writes it
  again once. The thinking and tool calls already done will not be repeated.
- What the stopped attempt spent will be recorded from the usage its messages carried, instead of
  $0.

### 4.4 A round's reviewers share one cached prefix (PRDR-322)

- A round's reviewers all read the same foundations first: on tabachir, 24 documents and 198 KB of
  the 571. Today each reviewer reads them into its own context and writes them to the cache.
- In the design, each reviewer is given the foundations in its first message, in one fixed order
  and byte for byte the same, then its own documents. After the first reviewers of a round, the
  others would read the foundations from the cache at $0.20 a million tokens instead of writing
  them at $8.
- Expected: about $0.45 a review on tabachir, and more on a larger pack. It changes what a
  reviewer is handed, so it will become the default only if the review set of §5 finds every
  blocker with it.

### 4.5 The writer takes a place's findings together, most severe first (PRDR-323)

- Of round 1's 379 findings, 134 share their first place with another finding. The writer's
  batches follow the areas' order, and cut that way into 19 batches, 22 of those places fall in two
  or more of them, each edited by a writer that does not see the others. The first batch already
  holds a minor, and the seventeenth is the last to hold a blocker.
- Batches will hold the findings that share a first place together, and the groups will be ordered
  by their most severe finding. One edit will settle a place, the blockers will land first, and
  the batches of minors will run last, so the ledger shows exactly what minors cost.

### 4.6 More sessions at once, where the account allows (PRDR-324)

- AUDIT's checks and VALIDATE's reviewers run four at a time (C-2¹⁶, C-2²³). The number will
  become a budget in the config, four by default. With §4.3, a higher number will lose no work
  when it reaches a limit.
- At eight, AUDIT's checks and a round's reviews would take about half the wall clock.
- The writer's batches stay one at a time. All but one of round 1's 379 findings are linked to
  each other through the files they cite, so no two batches could safely edit at once.

### 4.7 Cost and time are shown before they are spent (PRDR-325)

- Before each costly step, `init` will state what it will run and an estimate: the claims AUDIT
  will check, the areas a round will review, the writer's batches, the slices to plan. The
  estimate will use this project's own ledger when it has one, and Detent's measured figures
  otherwise, named as such.
- `detent status` will show progress through the phase, the spend so far and an estimated finish.
- An estimate will inform and never stop anything (decision 1).

## 5. The bar for a lower model or effort

**The sets (PRDR-326).** Both will come from tabachir's test run, and will be kept where the
operator says, outside this public repository.
- **Claims:** arm A of PRDR-317's A/B test checked 145 claims, each in a session of its own on Opus
  5.5 at `max`, and found 14 wrong. The set will be those 14, and 30 claims that A confirmed from a
  primary source.
- **Reviews:** the 21 kept reviews hold 379 findings, 18 of them blockers, in 10 areas. The set
  will be those 10 areas, with their documents as the reviewers saw them.

**The bar.** A cheaper setup passes when:
- it finds all 14 claims wrong, and confirms none of them;
- it calls none of the 30 confirmed claims wrong, unless its source shows that A was mistaken;
- it reports each of the 18 blockers at its place, as a blocker or a major.

**Runs differ.** A model finds different things on different runs: PRDR-317's two arms disagreed
on 15 of the 107 claims both checked. So the measurement can also re-run today's setup on the same
sets. If today's setup misses some of them on a second run, no cheaper setup can fairly be held to
all of them, and the user decides the bar then.

**What measuring costs**, estimated from the measured per-session costs. The runner will show the
spend as it goes.
- Opus 5.5 at `high`, on both sets: about $190.
- That, and today's setup re-run on the 14 wrong claims and the 10 areas: about $330.
- That, and Sonnet 5.5 at `max` on the claims set: about $430.

Nothing runs until the user approves a budget.

## 6. Layer 3: measured trade-offs

### 6.1 Effort and model per task (PRDR-327)

- **The arms, in order:**
  - Opus 5.5 at `high`, for claim checks and reviews;
  - Sonnet 5.5 at `max`, for claim checks;
  - Opus 5.5 at `medium`, if `high` passes.
- **What a passing arm would save**, from the measured splits:
  - if a lower level halves the thinking, a review's main-model cost falls about 29%, from $8.76
    to about $6.20, and a claim check's about 21%;
  - on Sonnet 5.5 with the same tokens, a claim check's main-model cost falls about 42%. The web
    pages Haiku reads cost the same as before.
- A task's level will move only where its arm passes, and the routing will record which
  measurement moved it. Where a role runs several tasks, as `audit` runs the survey, the triage and
  the checks, only the task measured will move. The writer and the planner stay at their levels
  until a set exists for them.

### 6.2 Effort by risk and by evidence, in `run` (PRDR-328)

- **Risk will set where effort starts.** A ticket will be high-risk when the plan labels it
  (`risk_label`) or its surface matches the config's `risk` globs. Its implement and review
  sessions will start at `max`, and every other ticket at its role's level.
- **Evidence will move effort, and only up.** Each of these will raise the next attempt's level
  one step, on top of what X-2's ladder already does when it moves a failing ticket to Opus:
  - a failed gate;
  - a falsification;
  - a review that asks for changes.

  A surface whose earlier tickets escalated or were falsified will raise the starting level too.
- **Lower starting levels must be earned.** A low-risk ticket will start below its role's level
  only after measured runs show no loss in D-33's outcomes: first-generation DONE, escalations,
  falsifications and review rounds.
- Each session already records the level it was routed to and the one it ran at (S-4⁵), and the
  ledger records what it cost, so each rule's effect will show in `detent status`.

## 7. Not pursued, and why

- **Milestone-scoped `init`:** refused (decision 2).
- **Grouped claim checks:** measured worse. A session per claim found 11 wrong claims where the
  groups found 8 (PRDR-317).
- **Fewer, larger review areas:** the same trade as grouping. More text would share one context
  and one turn budget.
- **Parallel writer batches:** the findings form one connected group (§4.6).
- **Listing minor findings for the user instead of fixing them.** 94 of the 379 findings are
  minor, and 93 of those 94 are in files that a blocker or major fix edits anyway. Fixing them
  costs an estimated $40 to $80 and 1.5 to 2.5 hours in a first round, about 6 of its 24 writer
  batches. They stay fixed automatically. This is vetoable, and §4.5 makes their cost exact.
- **The Batch API's half price:** a session is a live tool loop, which a batch cannot run.

**To measure next, on a real second round.** Round 1's findings cite 45 of the 56 documents. Round
2's scope is every file a finding cites or a fix changed, and whatever cites those (C-2⁷), so it
will re-review nearly the whole pack. If round 2 finds little in text that no fix touched, a
narrower scope, the entries a fix changed and what cites them, would save most of rounds 2 and 3:
about $250 to $300 on tabachir. That is a Layer 3 question, because the second read is also a
second chance at a missed defect. It needs a round 2 to answer, so it is not filed yet.

## 8. What to expect, on tabachir

Projected for a full `init` on the current build. The assumptions are 117 claims checked (what
PRDR-309's triage sends to a check on tabachir), three VALIDATE rounds, and planning at $150 to
$250, which the redesign has not yet measured.

| | Cost | Running time |
|---|---|---|
| Current build | about $1,500 | about 27 h |
| With Layer 1 | about $1,350 | about 20 h, at eight sessions at once |
| With Layer 3 too, if `high` passes and halves the thinking | about $1,100 | about 16 h |
| With narrower later rounds too, if round 2 shows they are safe | about $900 to $950 | about 13 h |

Each step down needs its evidence first. `medium` would go further, if it passes. What remains is
the quality floor itself: 117 checked claims, about 65 area reviews over three rounds, and every
finding fixed.

## 9. Tickets, in the order to build them

| Ticket | What | Layer | Needs |
|---|---|---|---|
| PRDR-318 | The PRD records this plan, before any code is built | — | — |
| PRDR-319 | Every role on Opus 5.5 or Sonnet 5.5, and the SDK pin at 0.3.285 | 1 | PRDR-318 |
| PRDR-320 | The cache's lifetime, per kind of session | 1 | PRDR-318 |
| PRDR-321 | A usage limit costs no finished work | 1 | PRDR-318 |
| PRDR-323 | The writer by place, most severe first | 1 | PRDR-318 |
| PRDR-325 | Estimates before spending; progress and a finish estimate | 1 | PRDR-318 |
| PRDR-324 | Sessions at once, as a config budget | 1 | PRDR-321 |
| PRDR-326 | The claims and review sets, their runner and the bar | 3 | PRDR-319 |
| PRDR-327 | Effort and model per task, measured, and adopted where they pass | 3 | PRDR-326, and a budget the user approves |
| PRDR-322 | A round's reviewers share one cached prefix | 1 | PRDR-326 |
| PRDR-328 | Effort by risk and by evidence, in `run` | 3 | PRDR-319 |

## 10. Open questions

1. **The measuring budget (§5):** about $190, $330 or $430.
2. **Existing configs (§4.1):** told which roles to move, or moved automatically.
3. **The bar**, if today's setup cannot meet it on a second run (§5).
4. **Minor findings (§7):** they stay fixed automatically, unless the user decides otherwise.
