---
id: PRDR-199
title: "The whole-plan redraft loop has no C-8 checkpoint, and PRDR-190's exit record tells the operator it does"
state: OPEN
severity: major
category: gap
labels: ["prd-review", "found-live", "c-8", "cost", "resume"]
surface: ["src/init/plan-whole.ts", "src/init/plan.ts", "src/cli/exit-record.ts", "tests/init/plan-whole.test.ts"]
prd_refs: ["C-8", "C-2‴", "PRDR-117", "PRDR-190", "PRDR-186", "X-1⁵"]
acceptance_criteria: ["A redraft that completes is checkpointed BEFORE the next slice is redrafted, on the same content-addressed terms the per-slice PLAN cache already uses (C-8) — a re-run reuses it and says so, exactly as the slice path prints `reused — nothing it read has changed`.", "The whole-plan review's findings and their slice assignment are checkpointed with the redrafts, so a resumed run CONTINUES the redraft set rather than re-paying for the review that produced it. A resume that re-reviews from scratch has not fixed this ticket.", "Asserted on `wholePlanReview` AS `plan.ts` CALLS IT, not on a cache helper. PRDR-141's shape — implemented, tested, documented, unreachable — is the failure this criterion exists to refuse, and PRDR-191, PRDR-194 and SEC-4′ are the three most recent times this line paid for it.", "The falsification lands first: a test that interrupts the loop after slice k of n and observes the k completed redrafts LOST, seen to fail before any fix (V-6).", "PRDR-190's exit message stops claiming the in-flight redraft is checkpointed, or becomes true. Either is acceptable; continuing to print `every finished slice is checkpointed; re-run to resume` during a redraft is not."]
non_goals: ["Does not change WHAT the redraft asks for, or how findings are assigned to slices — the plan-wide-finding routing at plan-whole.ts:78 is deliberate and stays.", "Does not add a resume flag. C-8 resume is by re-running; this ticket makes that resume honest, it does not invent a second mechanism.", "Does not touch the per-slice PLAN cache. That path works and is the model this one should copy.", "Does not claim the no-progress breaker (X-1⁵) would have caught this. It would not have: each restart COMPLETES units, which is the same blind spot PRDR-186 has and the PRD already records."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-117", "PRDR-186", "PRDR-190", "PRDR-196"]
depends_on: []
---

# PRDR-199 — the redraft that is never written down

**Severity:** major · **Category:** gap · **Found by:** stopping the gate-311 run and asking
why five days and $296.69 had produced no `plan.json`

## Problem

`wholePlanReview` in [`plan-whole.ts`](../../src/init/plan-whole.ts) redrafts each slice the
whole-plan review named, accumulating into a local `updated` array:

```
for (const slice of slices) {
  ...
  const drafted = await draftAndRead(deps, { slice, planIndex: [...], findings, keepIds });
  updated = [...earlier, ...fresh, ...later];
}
```

**Nothing is written inside that loop.** `updated` is returned at the end and only then reaches
disk. The per-slice PLAN path one level down does the opposite: it checkpoints each slice into
`state/plan/sNN.json` and, on a re-run, prints `reused — nothing it read has changed (C-8)`.

So a death at redraft k of n discards all k completed redrafts. It also discards the whole-plan
review that produced the findings, because that review is recomputed from the slice cache —
which is unchanged, precisely because the redrafts never landed in it.

`state/plan-draft.json` is not a checkpoint. It is the single scratch file each drafting session
is granted write access to (`--allowedTools ... Write(.../state/plan-draft.json)`) and every
session overwrites it.

## The live evidence

On `detent-gate-311`, from `gate-init-supervised.log` and the tree itself:

- Sep 9: `whole-plan review: 8 finding(s)` → `redrafting s01` → `s02` → `s03` → death.
- Every file in `state/plan/` is stamped **Sep 9 09:19–20:54**, the original planning pass. The
  three redrafts ran after 20:54 and **changed none of them.**
- Sep 10 07:18 restart: all 14 slices `reused — nothing it read has changed (C-8)`, the
  whole-plan review **re-ran**, and redrafting began again at `s01`.

Twelve planner sessions totalling **$59.96** ran after the last file in `state/plan/` was
written, and not one of them produced a durable artifact.

The run has now spent **$296.69 across 81 sessions and 11 supervisor attempts since Sep 5**
without ever producing a `plan.json`. It is not stuck in a tight loop — the review has run
twice, not fifty times — but it has no mechanism by which a run that dies during the redraft
set can ever get further than the run before it, except by surviving the whole set in one life.

## Why this is worse than a plain cache miss

PRDR-190's exit recorder fired correctly on the SIGTERM that stopped this run:

```
detent init: killed by SIGTERM at 2026-09-10T06:42:09.772Z while: redrafting s01 Walking
skeleton — one ticket from READY to DONE — every finished slice is checkpointed; re-run to
resume
```

The phase is right (PRDR-194 works). The reassurance is **false about the work that was in
flight when it printed**. "Every finished slice is checkpointed" is true of slices and untrue of
redrafts, and the operator reading it is told the expensive thing they just lost is safe.

A missing checkpoint costs money. A missing checkpoint plus a message asserting it exists costs
money and the operator's ability to notice.

## Note on scope

This was found by inspection after stopping the run, not by any check. Nothing in the six gates
asks whether a phase that spends has somewhere to write; `C-8`'s AC is stated per phase and the
redraft is not a phase, it is a loop inside one. Whether that is a second ticket is left open
here deliberately — the fix for this one is concrete and should not wait on the general
question.
