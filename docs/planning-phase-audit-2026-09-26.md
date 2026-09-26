# The planning phase, audited — 2026-09-26

**Scope:** `init`'s planning phase at `fc4360a`: `src/init/`, `prompts/planner.md`, their tests, the
79 tickets that changed them since v3.1.0, and every live planning run on disk.
**Method:** four independent auditors, each with one lens: the code and its wiring, the ticket history,
the live runs and experiments, and the contract with the model. I re-checked each report's
load-bearing claims against the code, the logs and the ksar-cloud state before relying on them.
Anything marked INFERENCE was not verified.
**Outcome:** the operator's decisions of the same day, recorded in `docs/plan-planning-redesign.md`.

---

## 1. The headline

Since v3.1.0, `src/init` and the planner prompt grew from 2,306 lines to 6,812, from 14 files to 30,
and `tests/init` grew from 1,744 lines to 7,912. That is 79 tickets and, by the history auditor's count,
124 commits. About 19 of the 79 have live evidence of a result, and nearly all of those are plumbing
that lets a long plan finish. None has evidence of producing a better plan. Nothing measured plan
quality, so none could have.

## 2. The approved ksar-cloud plan

| Fact | Source |
|---|---|
| 547 tickets in 24 slices; $903.27 of planning is in the approved plan; $1,346.97 across every ksar `init` attempt in September | `~/ksar-cloud/.detent/ledger.jsonl`, grouped by run window |
| The whole-plan review never ran: both attempts were refused at ~1,551,211 tokens against a 1,000,000 limit, and the log says "the plan was never reviewed as one thing" | `resume-20260918-072057.log:144-146` |
| 34 defects proved by code stayed in the plan: 28 names consumed that no ticket provides, 6 names with two owners | the same log, the contract-check line; `state/PLAN.json` |
| Slice s07 is the unrevised draft of the "no revision" experiment arm, marked `reviewed: true` | `state/plan/s07.json` revision `{1,3,3}`, churn `{30,12,30}` = `expN-20260917-183648.log:12,15` |
| At least four code versions built the plan; s01–s06 came from an older binary | `ksar-run-issues.md` (D-items), the run logs |
| 457 review findings held at PRESENT: dependency 182, sizing 137, coherence 100, coverage 18, testability 18, traceability 2 | the same log, the held-findings heading |
| The PRESENT headline "89 resolved, 9 survived, 82 introduced" sums slices s09–s24 only | the history and live-run auditors, independently |
| One ticket of 547 has run: t-001-bootstrap, falsified because Go is not installed | `ksar-run7.log`, `transitions.jsonl` |

## 3. Where the money went (the 186 sessions in the approved plan)

| Stage | Sessions | $ | Share |
|---|---|---|---|
| ANALYZE | 1 | 3.60 | 0.4% |
| Research | 2 | 0.86 | 0.1% |
| SLICE | 1 | 6.51 | 0.7% |
| PLAN drafts | 25 | 187.16 | 20.7% |
| Review before revision (3 reads a slice) | 72 | 229.52 | 25.4% |
| Revision | 23 | 259.73 | 28.8% |
| Review after revision (3 reads, PRDR-269) | 60 | 215.90 | 23.9% |
| Whole-plan review | 2 | 0 | refused |

Review and revision: $705 of $903, 78%. Outside the plan, the patch-and-relaunch cycle of September
cost $443.70 and at least ten unrecorded sessions.

## 4. The review loop, and what the experiments showed

- The reviewer never approved. In the runs that built the plan, review sessions wrote 151 verdicts
  with the Write tool, and all 151 are `changes` (my count over the persisted transcripts; sessions
  that never wrote one are excluded).
- Revision resolved 121 findings and introduced 119 across the plan. Every run from 09-04 to 09-18
  shows the same balance.
- The operator's own experiments:

| Test | Result | Cost |
|---|---|---|
| Null sweeps (no revision between reads) | churn 0.583 / 0.545 against 0.714 with a revision | $16.37 |
| Two rounds, same inputs | findings left 7 vs 7 | $32.93 |
| Two rounds, each seeing the last | 8 vs 7 | $53.18 |
| Sample the review after revision (PRDR-269) | held findings rose 15 → 21; the predicted 2–3 was falsified; kept | $35.81 |
| No revision at all | two sampled reviews of the same text agreed on 43% | $26.73 |
| D-29 and D-30 replays | finding counts track how much the reviewer says and how specific the text is | $8.60 |

Finding counts measure the reviewer, not the plan.

## 5. The code (verified against `fc4360a`)

1. **Proved defects are reported, never fixed.** The whole-plan reviewer is handed them as
   `already_found` and told to "treat it as handled" (`src/init/plan-review.ts:246`); they are kept
   out of `review_findings` (`src/init/plan.ts:333-345`), which is the only list the run phase reads
   (`src/kernel/plan-findings.ts:44-47`). Only PRESENT prints them.
2. **Coverage is claimed, never checked.** `src/schemas/init.ts:508` says every requirement id lands
   in exactly one slice; `groundSlices` (`src/init/slice.ts:134-151`) checks documents and baseline
   ids only.
3. **Research answers are discarded.** Nothing in SLICE, PLAN, the whole-plan review or PRESENT reads
   them; SLICE and PLAN are handed every ANALYZE question with its original assumption, and an
   answered question simply leaves PRESENT's list (`src/init/analyze.ts:157-158`) — which can hide a
   blocking question.
4. **Re-planning only what changed probably fails.** `sliceKey` hashes the whole slice object, the
   model's prose included (`src/init/plan-slices.ts:156-162`), and any document edit re-runs SLICE
   (`src/init/pipeline.ts:271-282`). INFERENCE: every slice then misses the cache.
5. **The planner cannot see what earlier tickets provide.** `plan_index` carries id, slice, title and
   surface only (`src/init/plan.ts:229`). 56 of 60 drafting sessions read `.detent/state/plan/*.json`
   to recover it, in 892 tool calls; 90 of 151 review sessions did the same, in 702.
6. **The announced size is wrong.** SLICE announces `2N+3`–`4N+5` planner sessions
   (`src/init/slice.ts:73`); the design's minimum is `4N+3`. ksar-cloud was told "51-101" and ran 180.
7. **About 290 lines of revision measurement change nothing.** PRDR-268's own commit says the
   sequence is "identical to HEAD" at one revision round.
8. **Dead and stale.** `consent.ts` and `allowlist.ts` are imported only by a test; the spend "gate"
   wording in `session.ts`, `launch-batch.ts` and `plan-slices.ts` predates PRDR-265's advisory cap;
   `retry.ts:2`, `questions.ts:9`, `symbol-reminder.ts:55`, `contracts.ts:19` and `present.ts:49`
   describe more than the code does.

What works, and stays: normalising drafts, breaking cycles, derived edges (PRDR-120), bootstrap and
capstone blockers, `writePlan`, the checkpoint machine, and the declarations tickets make of what they
provide and consume.

## 6. The contract with the model

- One 1,826-word prompt serves four stages; between a quarter and two thirds of it concerns the stage a
  given session is running. The code
  adds a stage instruction of 131–350 words that repeats parts of it.
- About 54% of the prompt's words were added to patch one failure seen on one run (INFERENCE, from
  ticket text; the snapshot has no git). No ticket after PRDR-125 touched the prompt; 59 later tickets
  changed planning code, and newer rules live only in TypeScript strings.
- The prompt contradicts the code in four places: question ids (code renumbers), `baseline:PB-###`
  (code checks `baseline_ids`), "leave `depends_on` empty" (every ticket gets bootstrap and capstone
  blockers), and "an unknown key fails the phase outright" (one relaunch; defaults).
- The reviewer runs with the drafter's role, prompt, model and effort.
- Of 6,117 tool calls, 1,104 errored or were denied, among them 527 "requires approval" and 97 attempts
  to spawn subagents; read-only Bash ran 2,846 times.
- What did work: questions stayed rare (2 at ANALYZE, 9 at PLAN), all 135 ids SLICE was given — 92 of
  them requirement ids — were placed exactly once, and the documented gate commands were copied exactly. These are the concrete, checkable
  rules.

## 7. The patches

The history auditor classified all 79 tickets against the runs.
- **Clear wins**, each a live defect with a live re-check: PRDR-184 (checkpoints), 262/264 (research
  output), 119 (questions), 189/190 (session-limit waits and exit records), 117/118 (whole-product
  planning), 211 (Node bootstrap), 081 (sizing — the only effect measured on execution: 67/67 DONE),
  101's non-goal pass-through, 204/205/210 (review latency), 275 (runtime pin).
- **No real result**: 102, 101's `boundaries` tag (used 0 times), 165, 201, 207, 208, 271, 272, 268,
  269, 125's band, 083, 086, 155/156/163 (a notice that never fired, repaired three times), 273/274.
- The wins came from observed defects; the losses came from hypotheses, and many of them measured
  other patches. Experiments ran against the live ksar-cloud tree, which is how s07 reached the plan.

## 8. What a validated pack changes

| Item | With a validated pack |
|---|---|
| Planning research | moves to AUDIT |
| Questions and their deduplication | move to DECIDE |
| Coverage, traceability and testability review | become mechanical once tickets carry criterion ids |
| SLICE | can be seeded mechanically by milestone and module, and keyed by requirement ids |
| Review and revision cost | remains unless redesigned |
| The whole-plan review's size | remains, and grows with the pack |
| Contract defects | remain: they are ownership inside the plan |
| Sizing and slicing variance | remain |
| The `dashboard/` gate blind spot | remains: 69 tickets wrote `dashboard/`, 41 only there, and gates bind at the root only |

ksar-cloud's documents were already half a pack — 46 decisions, 92 requirement ids (60 functional, 32
non-functional), 9 ADRs — and every
mechanism problem above still appeared. The specification phase alone does not fix planning.

## 9. Sources

- Run logs: `~/.detent-run-logs/` (`ksar-run-issues.md`, `resume-20260918-072057.log`,
  `ksar-init-20260917-104419.log`, `exp*`, `null-review*`, `gate312-init.log`, `smoke1-*.log`).
- State: `~/ksar-cloud/.detent/` (`ledger.jsonl`, `runs/init/journal.jsonl`, `state/`).
- Session transcripts: `~/.claude/projects/-Users-workstation-ksar-cloud/`.
- Code and tickets: `fc4360a`; history by read-only `git log` from v3.1.0 (`21965f6`).
