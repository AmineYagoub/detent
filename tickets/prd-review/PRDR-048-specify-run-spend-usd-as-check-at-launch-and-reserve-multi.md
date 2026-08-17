---
id: PRDR-048
title: "Specify run_spend_usd enforcement as check-at-launch, and reserve the multi-worker protocol"
state: READY
severity: major
category: gap
labels: ["prd-review"]
surface: ["foreman-prd-v2.md"]
prd_refs: ["X-1", "X-8", "S-4", "P6", "NG4", "F-1", "C-11"]
acceptance_criteria: ["X-1 states when `run_spend_usd` is evaluated relative to session launch, so a reader can determine whether a session may start while the ceiling is already reached without consulting an implementation.", "The PRD states the bounded overshoot the chosen policy admits, in units (at most one in-flight session's spend for single-worker), rather than implying the ceiling is never exceeded.", "The breach path names a state outcome for the ticket whose session triggered it, and that outcome is an X-3 row.", "NG4's lifting conditions name a reservation or lease protocol for run-scoped ceilings alongside the append protocol already listed, so the multi-worker generalization is recorded rather than discovered.", "P6's \"every ceiling routes to a human\" holds for `run_spend_usd` under the stated evaluation policy, not only in the limit."]
non_goals: ["Does not set a default value for `run_spend_usd` — X-1's no-default decision and `init`'s refusal to write a config without one stand.", "Does not lift NG4 or design the multi-worker reservation protocol; naming it as a lifting condition is sufficient.", "Does not change how spend is measured or add a per-ticket spend ceiling; the counter stays run-scoped and cumulative per X-8."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-048 — Specify run_spend_usd enforcement as check-at-launch, and reserve the multi-worker protocol

**Severity:** major · **Category:** gap · **Amends:** X-1, NG4

## Problem

`run_spend_usd` is the only run-scoped ceiling and the sole financial backstop against unbounded requeues — X-8 assigns it exactly that job, since generations have no cap and each requeue merely needs a human to type a command. The PRD gives it a breach target but never says **when it is evaluated**, and the answer is not inferable, because spend is only *knowable* after the fact: S-4 has telemetry arriving from the SDK result, i.e. when the session has already ended and the money is already spent.

That leaves two readings of the same requirement. Under check-after-return, a session launched while the counter sits one dollar below the ceiling runs to completion and overshoots by its full cost — the ceiling is advisory, and P6's "every ceiling routes to a human" is satisfied only in the limit. Under check-at-launch, the ceiling holds within one session's worth of headroom, which is defensible but is a different guarantee and should be stated as such. Neither reading is wrong; the document simply does not choose, and the two produce materially different worst-case bills.

There is also no stated outcome for the ticket that triggers the breach. The row's breach target is NEEDS_HUMAN, but a *run*-scoped ceiling tripping mid-ticket raises a question a per-ticket ceiling does not: does the in-flight ticket go NEEDS_HUMAN, do all non-terminal tickets, or does the run exit? C-11 has no exit code that plainly means "spend exhausted" — `10` (human-gated items remain) is the closest and is a stretch.

**Why this is worth recording now rather than at v2.** The gap is present single-worker and merely widens under parallelism: with N workers the overshoot becomes up to N−1 concurrent in-flight sessions past the ceiling, because a shared cumulative counter read-then-launched by N racing workers admits N−1 stale reads. NG4 already enumerates what lifting it requires — an append protocol for run-level artifacts, and a tested concurrent-merge path — but not a reservation protocol for run-scoped ceilings, which is the third item. Recording it in NG4 now costs a sentence and prevents the same discovery being made expensively later.

## Evidence (verbatim from foreman-prd-v2.md)

- X-1: "| `run_spend_usd` | config, no default | **run** (cumulative, X-8) | NEEDS_HUMAN |"
- X-1: "`run_spend_usd` is the only run-scoped ceiling and is the cross-generation backstop of X-8; it has no v1 default because there is no defensible universal figure — `init` requires an explicit value and refuses to write a config without one."
- X-8: "No generation cap is imposed: each requeue is an explicit human act, so the loop is human-gated by construction — but dossiers and `status` display **cumulative** totals across generations, and the run-level spend ceiling remains the cumulative financial backstop regardless of generation count."
- S-4: "Telemetry: typed usage/cost/turn fields from SDK results feed the ledger; a session whose telemetry fields are absent is budget-breaching (circuit breaker → NEEDS_HUMAN)."
- P6: "**Budgets are hard.** Every loop has a counter; every counter has a ceiling; every ceiling routes to a human."
- C-11: "Exit codes are public API: `0` plan complete; `10` human-gated items remain; `2` not ready (no/unapproved plan, binding drift); `1` error."
- NG4: "Lifting NG4 requires a defined append protocol for the run-level artifacts of F-1 — per-worker shard files reconciled at read time, an exclusive append lock, or a single serializing writer — in addition to a tested concurrent-merge path."

## Proposed change

**1. State the evaluation policy.** Add to X-1, after the `run_spend_usd` sentence:

"`run_spend_usd` is evaluated **at session launch**, not on return: the kernel refuses to launch any session once cumulative ledger spend has reached the ceiling, and emits BUDGET_BREACH for the ticket that would have launched it. Because S-4's telemetry arrives only when a session ends, the ceiling is a launch gate and not a hard cap — the guarantee is that spend never exceeds the ceiling by more than the cost of the single session in flight when it was crossed. That bound is stated deliberately; a policy that never overshoots is not achievable against a backend that prices work after doing it."

**2. Name the ticket outcome.** Add: "The ticket whose launch was refused enters NEEDS_HUMAN with a dossier reason of run-spend exhaustion; other non-terminal tickets are left claimed and untouched, and the run exits `10` — human-gated items remain, and the gating item is the budget."

**3. Add the third lifting condition to NG4.** Amend the closing sentence to: "...in addition to a tested concurrent-merge path and a reservation protocol for run-scoped ceilings — with N workers, a read-then-launch against a shared cumulative counter admits up to N−1 stale reads, so `run_spend_usd` must be leased at launch and reconciled on return rather than merely read."

## Acceptance criteria

1. X-1 states when `run_spend_usd` is evaluated relative to session launch, so a reader can determine whether a session may start while the ceiling is already reached without consulting an implementation.
2. The PRD states the bounded overshoot the chosen policy admits, in units (at most one in-flight session's spend for single-worker), rather than implying the ceiling is never exceeded.
3. The breach path names a state outcome for the ticket whose session triggered it, and that outcome is an X-3 row.
4. NG4's lifting conditions name a reservation or lease protocol for run-scoped ceilings alongside the append protocol already listed, so the multi-worker generalization is recorded rather than discovered.
5. P6's "every ceiling routes to a human" holds for `run_spend_usd` under the stated evaluation policy, not only in the limit.

## Non-goals

- Does not set a default value for `run_spend_usd` — X-1's no-default decision and `init`'s refusal to write a config without one stand.
- Does not lift NG4 or design the multi-worker reservation protocol; naming it as a lifting condition is sufficient.
- Does not change how spend is measured or add a per-ticket spend ceiling; the counter stays run-scoped and cumulative per X-8.
