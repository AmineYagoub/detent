---
id: PRDR-186
title: "The slice cache key hashed the whole budgets object, so raising a spend cap mid-run discarded every slice already planned"
state: DONE
severity: major
category: defect
labels: ["prd-review", "found-by-live-run", "cache-invalidation", "spend"]
surface: ["src/init/plan-slices.ts", "tests/init/slicing.test.ts"]
prd_refs: ["C-8", "X-1"]
acceptance_criteria: ["Changing `run_spend_usd` does not invalidate a planned slice — a spend ceiling is an operational limit and cannot change what a plan should say.", "Changing a budget the planner DOES read — the three `sessionBudget` derives — still invalidates, because the draft read it."]
non_goals: ["Does not change what the planner is told. `session_budget` reaches the prompt exactly as before."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-118", "PRDR-102"]
depends_on: []
---

# PRDR-186 — an operational decision that threw away a plan

**Severity:** major · **Category:** defect · **Found by:** raising a cap on the live gate run

## Problem

`sliceKey` hashed `deps.budgets` whole, so `run_spend_usd` was part of every slice's cache key. On
a live planning run five slices deep, raising the cap from $150 to $300 — so the run could finish —
changed the key for every slice and discarded all of them. Roughly $70 of planning, thrown away by
a decision that cannot change what a plan should contain.

The module's own header says the key is *"everything a slice's draft READ that can meaningfully
change it"*. The draft never read the cap. What it reads is `session_budget`, and
`sessionBudget()` derives exactly three values: `turns_per_stage`, `ticket_wall_clock_ms`,
`sessions`. Those are what belong in the key, and they still invalidate — a plan sized for
40-turn sessions is not the plan for 45-turn ones.

## Note on sequencing

The phase digest holds no budgets at all, so a cap change only bites when PLAN re-runs — which is
precisely the live situation: the run had died mid-PLAN, so the phase had no checkpoint, every
slice key was re-derived, and none matched. A cap raised on a cleanly-interrupted run would have
cost nothing, which is why nothing caught this before.
