---
id: PRDR-075
title: "The ticket-type closed set is undocumented to the planner"
state: DONE
severity: minor
category: consistency
labels: ["prd-review", "found-by-execution", "field-test"]
surface: ["prompts/planner.md"]
prd_refs: ["A-1", "A-2", "P2", "C-4"]
acceptance_criteria:
  - "The planner prompt names the closed type set (feature|bug) and where non-code work belongs (feature)."
  - "The A-2 schema stays strict — no new types, no leniency in the validator."
non_goals:
  - "No init-session retry-on-invalid-artifact policy in this ticket; recorded as an open consideration (a bounded retry that feeds the validation error back would convert this failure class from exit 1 into one extra session — design it deliberately, not here)."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-073"]
depends_on: []
---

# PRDR-075 — the ticket-type closed set is undocumented to the planner

**Severity:** minor · **Category:** consistency · **Found by:** the first
stranger-repo field test (slugify, 2026-08-22) — the first PLAN session ever run
against a repository Detent did not write.

## Problem

The field PRD asked for an implementation, its documentation, and its tests. The
planner produced exactly that — three well-scoped tickets — labeled `feature`,
`chore`, and `test`. The A-2 schema admits only `feature|bug`, the strict
validator rightly refused, and init died with exit 1. `planner.md` never mentions
the `type` field: the skeleton shows a single `"feature"` example value and
nothing states the set is closed. Same failure class as PRDR-073 — a correct,
strict kernel contract whose session-side callers were never told the contract.

## Resolution

One sentence in the planner prompt: `type` is exactly `feature` or `bug`;
documentation, tests, refactors, and chores are feature tickets; `bug` means a
defect against existing behavior. The schema is untouched. Recorded open
consideration: PLAN's invalid-artifact path is a hard exit today — a single
bounded retry feeding the validator's message back would absorb this class at
the cost of one session; that is a design decision for its own ticket.
