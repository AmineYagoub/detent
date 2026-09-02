---
id: PRDR-108
title: "review_fix_attempts parses any number and the machine never reads it — review findings buy one round, then a human who relays the same findings"
state: READY
severity: major
category: correctness
labels: ["prd-review", "user-raised", "found-by-execution"]
surface: ["src/kernel/machine.ts", "src/kernel/budgets.ts", "src/schemas/budgets.ts", "src/kernel/worstcase.ts", "detent-prd-v3.md"]
prd_refs: ["X-1", "D-6", "D-12", "X-3"]
acceptance_criteria: ["`reviewChanges` compares the ticket's `review_fix_attempts` counter against the configured ceiling, so a config value of N buys N review-fix rounds before a human.", "The default is 3, and the default net `sessions` ceiling still strictly exceeds the recomputed worst case, so the default config loads.", "`review_fix_attempts` is no longer an at-most-once unit slot: consuming it twice is legal and counted, and the ladder slots stay at-most-once (D-12).", "The worst-case pin moves with the change, deliberately."]
non_goals: ["Does not touch the three ladder slots or D-24's structural literal on them.", "Does not make review rounds unbounded. A ceiling of 3 is the default; a run that wants one round sets 1."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-107", "PRDR-109", "PRDR-110"]
depends_on: []
---

# PRDR-108 — review_fix_attempts is configured and never read

**Severity:** major · **Category:** correctness · **Raised by:** the user · **Found by:**
reading `reviewChanges` after counting six identical human stops

## The defect

`budgetsSchema` accepts any positive `review_fix_attempts` (it is deliberately not
structural — PRDR-058's non-goal, pinned by a test). `reviewChanges` reads none of it:

```ts
c.review_fix_attempts === 0 ? REVIEW_FIX : NEEDS_HUMAN
```

A config saying 3 gets one round. Nothing warned, because the schema was happy and the
guard was happy; they simply never met.

## The measurement

Six `REVIEW_CHANGES → NEEDS_HUMAN` stops on the certification gate. In every one the
operator requeued with the reviewer's findings relayed verbatim — no guidance on approach —
and every one reached DONE in the next generation. That is a review-fix round performed
by a person. Review findings are specific, file-scoped text; a second round is the cheapest
session Detent runs.

## Resolution

The guard compares against `ctx.budgets.review_fix_attempts`; `countReviewFix` increments
without D-12's at-most-once assertion, and the key leaves `UNIT_SLOTS`. Default 3. The
worst-case walk already caps the counter at ceiling+1, so the figure recomputes; `sessions`
moves above it and the pins move with it, as X-1 intended.
