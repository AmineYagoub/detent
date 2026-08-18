---
id: PRDR-053
title: "Define crash telemetry: zeroed is not absent, so S-4's breaker misses it and B-5 mis-accounts"
state: DONE
severity: major
category: gap
labels: ["prd-review"]
surface: ["detent-prd-v2.md"]
prd_refs: ["S-4", "B-5", "X-1", "X-8", "N-5", "C-9"]
acceptance_criteria: ["S-4 distinguishes absent telemetry from zeroed telemetry and states the outcome for each, so a crashed session cannot be recorded as free work.", "B-5's \"budget was consumed\" is reconcilable with what the ledger actually records for a crashed session.", "The PRD names a recovery path for a crashed session's spend, or states explicitly that the spend is unrecoverable and how the ledger marks it.", "The budget-exceeded result is covered: the PRD says which field the ledger reads when the two disagree about the response that crossed the ceiling.", "N-5's reconstruction guarantee holds for a run containing a crashed session — the ledger row is present and marked, not missing or silently zero."]
non_goals: ["Does not change B-5's rule that a crashed session may not relaunch, nor its tree-reset semantics.", "Does not require exact spend recovery where the backend cannot provide it; an explicit lower-bound marking is acceptable.", "Does not add a retry or resume path for the crashed session itself."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-053 — Define crash telemetry: zeroed is not absent, so S-4's breaker misses it and B-5 mis-accounts

**Severity:** major · **Category:** gap · **Amends:** S-4, B-5

## Problem

S-4 makes one telemetry outcome a circuit breaker: "a session whose telemetry fields are **absent** is budget-breaching." The real backend has a third state the PRD does not model, and it is the common one.

The Agent SDK's cost-tracking documentation states that when the backend process crashes it emits a final error result and exits, and that this result "may carry **zeroed** `usage`, `total_cost_usd`, and `modelUsage`." Zero is not absent. The fields are present, well-typed, and parse cleanly — so S-4's breaker does not fire, the session is recorded as having cost nothing, and the run continues with a ledger that understates spend by the whole crashed session.

That collides with B-5, which is explicit that the budget **was** consumed: "the journal decides whether a crashed session may relaunch (it may not — budget was consumed; the gate judges the tree as-is)." B-5's reasoning for refusing a relaunch is that the money is already spent. The ledger, following S-4, would record approximately zero for that same session. The two requirements describe the same event and disagree about it, and the disagreement runs in the unsafe direction: the cross-generation ceiling of X-8 counts a crash as free, so a ticket that crashes repeatedly consumes real budget while advancing the run-level counter barely at all.

The documentation also gives a recovery procedure the PRD does not mention: use the result of the turn preceding the crash where one exists, otherwise sum the per-step assistant-message usage, counting each API response once. That recovers the main loop's input and cache tokens but not output tokens or cost, so recovery is partial by construction — which is worth stating rather than discovering.

A second, narrower case sits alongside it: on a budget-exceeded result the documentation says the cumulative usage field omits the response that crossed the ceiling while the cost total and per-model breakdown include it. The PRD does not say which the ledger trusts, so the two would disagree about the final session in any run that ends at its ceiling.

## Evidence (verbatim from foreman-prd-v2.md)

- S-4: "a session whose telemetry fields are absent is budget-breaching (circuit breaker → NEEDS_HUMAN)"
- B-5: "the journal decides whether a crashed session may relaunch (it may not — budget was consumed; the gate judges the tree as-is)"
- X-8: "the run-level spend ceiling remains the cumulative financial backstop regardless of generation count"
- C-9: "resumable pool includes all non-terminal in-flight states, so crash/interrupt/escalation resume by re-running `run`"
- N-5: "`transitions.jsonl` + ledger + journals reconstruct any run without model output."

## Proposed change

**1. Give S-4 three outcomes instead of two.** Replace the breaker clause with:

"Telemetry has three outcomes, and each is distinct:
- **Present and non-zero** — recorded as-is.
- **Absent or unparsable** — the session is budget-breaching; circuit breaker → NEEDS_HUMAN.
- **Present but zeroed on a crash result** — *not* a breaker and *not* free. The backend zeroes these fields when its process crashes, so Foreman reconstructs a lower bound: the preceding turn's cumulative total where one exists, otherwise the sum of per-step input and cache tokens deduplicated by message id. Output tokens and cost are unrecoverable this way, so the ledger row is written with the recovered lower bound and flagged `partial: "crash"`. B-5's premise — that the budget was consumed — is what this row records; a crashed session is never accounted as zero."

**2. Settle the budget-exceeded disagreement.** Append to S-4: "On a budget-exceeded result the cumulative usage field omits the response that crossed the ceiling while the cost total and per-model breakdown include it; the ledger reads the per-model breakdown, consistent with S-4's token source of record."

**3. Cross-reference from B-5.** Append: "The consumed budget is recorded per S-4's crash-telemetry rule, as a flagged lower bound rather than as zero."

## Acceptance criteria

1. S-4 distinguishes absent telemetry from zeroed telemetry and states the outcome for each, so a crashed session cannot be recorded as free work.
2. B-5's "budget was consumed" is reconcilable with what the ledger actually records for a crashed session.
3. The PRD names a recovery path for a crashed session's spend, or states explicitly that the spend is unrecoverable and how the ledger marks it.
4. The budget-exceeded result is covered: the PRD says which field the ledger reads when the two disagree about the response that crossed the ceiling.
5. N-5's reconstruction guarantee holds for a run containing a crashed session — the ledger row is present and marked, not missing or silently zero.

## Non-goals

- Does not change B-5's rule that a crashed session may not relaunch, nor its tree-reset semantics.
- Does not require exact spend recovery where the backend cannot provide it; an explicit lower-bound marking is acceptable.
- Does not add a retry or resume path for the crashed session itself.
