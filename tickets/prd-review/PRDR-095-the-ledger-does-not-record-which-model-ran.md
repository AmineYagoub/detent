---
id: PRDR-095
title: "The ledger does not record which model ran, so a green N-7 gate cannot be audited for what produced it"
state: DONE
severity: minor
category: gap
labels: ["prd-review", "found-by-execution"]
surface: ["src/schemas/records.ts", "src/kernel/ledger.ts"]
prd_refs: ["S-4", "D-16", "N-7", "X-1"]
acceptance_criteria: ["Every ledger row names the model(s) that served the session, taken from the SDK's per-model breakdown rather than from configuration — what ran, not what was asked for.", "Rows written before this field read back without error, defaulting to an empty list.", "A session with no per-model telemetry (the mock, a crash) records an empty list rather than guessing."]
non_goals: ["Does not add model routing to the ledger's cost arithmetic — the per-model breakdown already is the token source of record (PRDR-052/053).", "Does not pin or validate which model a role may use; that stays configuration.", "Does not bump a schema_version: the field is additive with a default, following the `cache_*` precedent (F-3)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-052"]
depends_on: []
---

# PRDR-095 — the ledger does not record which model ran

**Severity:** minor · **Category:** gap · **Found by:** preparing to run the N-7 gate on a
cheaper model

## Problem

`SpendLedger.record` consumes `result.perModel` for token and cost arithmetic and then
discards its keys — which are the model names. The row keeps `role`, `turns` and cost, so
the run record answers "what did this cost" but not "what produced it".

That is a hole in a permanent release gate. D-16 makes N-7 green a precondition for every
release, and N-7 is a claim about Detent's machinery, not about a model — so running it on
a cheaper model is legitimate and a green result there is a STRONGER claim, not a weaker
one. But only if the record says which model was used. Without it, a green gate months
old cannot be distinguished from one that quietly ran on something else, and the S-4
record cannot settle the question either way.

## Resolution

`models: z.array(nonEmptyString).default([])` on the ledger row, populated from
`Object.keys(result.perModel ?? {}).sort()`. Additive with a default, so existing ledgers
read back unchanged — the same shape-evolution route `cache_read_input_tokens` took, and
not an F-3 event. A crashed session, or the mock, records `[]` rather than inventing a
name.
