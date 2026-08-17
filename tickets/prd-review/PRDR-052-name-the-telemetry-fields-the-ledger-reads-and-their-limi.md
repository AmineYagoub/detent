---
id: PRDR-052
title: "Name the telemetry fields the ledger reads, and state that reported cost is an estimate"
state: READY
severity: major
category: gap
labels: ["prd-review"]
surface: ["foreman-prd-v2.md"]
prd_refs: ["S-4", "X-1", "X-8", "N-5", "§14", "P6"]
acceptance_criteria: ["S-4 names the specific result fields the ledger reads for cost and for tokens, rather than \"typed usage/cost/turn fields\".", "The PRD states that backend-reported cost is a client-side estimate, names at least one condition under which it drifts, and says what the authoritative source is.", "X-1's `run_spend_usd` row or note acknowledges that the ceiling is enforced against an estimate, so the guarantee is stated as approximate rather than exact.", "The PRD distinguishes the field that excludes nested-agent tokens from the fields that include them, so an implementation cannot silently undercount.", "The PRD records that per-step output-token counts are not authoritative and names where the real count is read from."]
non_goals: ["Does not change `run_spend_usd`'s role as the cross-generation backstop (X-8) or its scope (PRDR-043).", "Does not require Foreman to call an external billing API at runtime; naming it as the reconciliation source is sufficient.", "Does not add per-model routing or change model selection."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-052 — Name the telemetry fields the ledger reads, and state that reported cost is an estimate

**Severity:** major · **Category:** gap · **Amends:** S-4, X-1

## Problem

S-4 says "typed usage/cost/turn fields from SDK results feed the ledger" without naming the fields. Against the real backend, the choice among them is not interchangeable, and one of the three carries a documented warning that bears directly on X-1.

**Cost is an estimate, and the backend says not to make financial decisions from it.** The Agent SDK's cost-tracking documentation warns that its cost fields "are client-side estimates, not authoritative billing data," computed locally from a price table bundled at build time, and that they drift when pricing changes, when the installed version does not recognize a model, or when billing rules apply that the client cannot model. It closes: *"Do not bill end users or trigger financial decisions from these fields."* X-1's `run_spend_usd` is precisely a financial decision driven by this number — it is the cross-generation backstop X-8 relies on to bound total spend. The design is still workable, but the PRD currently presents the ceiling as exact when the input is approximate, and names no reconciliation path.

**The token fields disagree about nested agents.** The same documentation gives a table: the cumulative `usage` field **excludes** tokens consumed inside nested agents, while the cost total and the per-model breakdown **include** them. An implementation that reads `usage` — the obvious choice given S-4's wording — undercounts as soon as any role delegates. Foreman does not delegate today, but S-4 is the contract a future roster would be built against, and the undercount would be silent.

**Per-step output tokens are a placeholder.** The docs state that each assistant message carries the output count the API had reported at the start of the response, not the real one, and that the authoritative count arrives only on the result message. A ledger summing per-message output tokens produces a number that looks plausible and is wrong.

None of this is visible from S-4's current text, so three reasonable implementations of the same sentence produce three different ledgers — and N-5's "reconstruct any run" and §14's per-ticket session metrics both read from that ledger.

## Evidence (verbatim from foreman-prd-v2.md)

- S-4: "Telemetry: typed usage/cost/turn fields from SDK results feed the ledger; a session whose telemetry fields are absent is budget-breaching (circuit breaker → NEEDS_HUMAN)."
- X-1: "| `run_spend_usd` | config, no default | **run** (cumulative, X-8) | NEEDS_HUMAN |"
- X-8: "the run-level spend ceiling remains the cumulative financial backstop regardless of generation count"
- P6: "**Budgets are hard.** Every loop has a counter; every counter has a ceiling; every ceiling routes to a human."
- N-5: "`transitions.jsonl` + ledger + journals reconstruct any run without model output."

## Proposed change

**1. Name the fields in S-4.** Replace the first clause with: "Telemetry: the ledger reads, per session, the result message's **cumulative cost estimate**, its **per-model usage breakdown**, and its **result-level token counts**. Three rules are normative because the backend's fields are not interchangeable: cost and the per-model breakdown include tokens consumed by any nested agent while the cumulative usage field excludes them, so the per-model breakdown is the token source of record; output tokens are read from the result message, never summed from per-step assistant messages, where the count is a placeholder; and per-step input and cache counts are deduplicated by message id, since parallel tool calls repeat one id."

**2. State the estimate in S-4.** Append: "Backend-reported cost is a **client-side estimate** computed from a price table bundled with the backend, not authoritative billing. It drifts when prices change, when the pinned backend does not recognize a model, and where billing rules the client cannot model apply. Foreman records it as `cost_estimate_usd` and treats it as such."

**3. Qualify the ceiling in X-1.** Append to the `run_spend_usd` note: "The ceiling is enforced against the backend's cost **estimate** (S-4), so it bounds approximate spend, not billed spend. `doctor` reports the backend version its price table came from, and the run report names the provider's usage API as the authoritative reconciliation source. P6 holds — the ceiling is hard against the number Foreman can observe — but the PRD does not claim it is exact against an invoice."

## Acceptance criteria

1. S-4 names the specific result fields the ledger reads for cost and for tokens, rather than "typed usage/cost/turn fields".
2. The PRD states that backend-reported cost is a client-side estimate, names at least one condition under which it drifts, and says what the authoritative source is.
3. X-1's `run_spend_usd` row or note acknowledges that the ceiling is enforced against an estimate, so the guarantee is stated as approximate rather than exact.
4. The PRD distinguishes the field that excludes nested-agent tokens from the fields that include them, so an implementation cannot silently undercount.
5. The PRD records that per-step output-token counts are not authoritative and names where the real count is read from.

## Non-goals

- Does not change `run_spend_usd`'s role as the cross-generation backstop (X-8) or its scope (PRDR-043).
- Does not require Foreman to call an external billing API at runtime; naming it as the reconciliation source is sufficient.
- Does not add per-model routing or change model selection.
