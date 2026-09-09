---
id: PRDR-194
title: "PRDR-190's phase marker is fed by the `note` seam, which carries warnings and verdicts as well as progress — so a spend announcement was recorded as what the run was doing"
state: OPEN
severity: minor
category: bug
labels: ["prd-review", "found-by-live-run", "observability"]
surface: ["src/init/machine.ts", "src/init/plan-slices.ts", "src/init/plan-whole.ts", "src/cli/init.ts", "tests/cli/exit-record.test.ts"]
prd_refs: ["PRDR-190", "X-1⁵"]
acceptance_criteria: ["The phase comes from an explicit progress seam, not from `note`. A warning, a verdict or a status line never becomes \"what was in flight\".", "The seam is called where work actually starts: each `init` phase boundary, each slice planned OR reused, each whole-plan redraft.", "The marker keeps its granularity — `PLAN s09`, not `PLAN` — because the slice is the useful half of the answer.", "`note` goes back to printing. A seam that does two jobs because it was there is how this defect happened."]
non_goals: ["Does not change what the exit record says or when it fires. PRDR-190's record works; it is being told the wrong thing.", "Does not touch the run loop's phase, which comes from the driver's claim and is already accurate."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-190", "PRDR-191"]
depends_on: []
---

# PRDR-194 — the marker believed everything it was told

**Severity:** minor · **Category:** bug · **Found by:** stopping the gate-312 run, 2026-09-09

## Problem

PRDR-190 landed a phase marker so a killed run can say what it was doing. It works. Stopping
gate-312 with SIGTERM produced a real record on the first signal since the fix:

```
detent init: killed by SIGTERM at 2026-09-09T16:19:15.106Z while: spend has passed the
advisory run_spend_usd of $300.00 (now $301.86). X-1⁵: this is a figure, not a gate — the
run continues, and what would stop it is spend with nothing completing. — every finished
slice is checkpointed; re-run to resume
```

The signal is named, the resume instruction is there, and the `while:` clause is **wrong**. The
run was re-running the whole-plan review. What it reports is X-1⁵'s advisory spend
announcement, which is not an activity at all.

## Why

[`cli/init.ts`](../../src/cli/init.ts) wires the marker to the `note` seam:

```ts
note: (text) => {
  setInFlight(text);
  noteRunPhase(root, text);
  process.stdout.write(`  ${text}\n`);
},
```

PRDR-190's own reasoning was that "`note` is what the operator is last told, so it is by
definition what was in flight". That is false, and the counter-examples were already in the log
when it was written: `note` also carries review verdicts (`s09 review: 3 finding(s)`), reuse
status (`reused — nothing it read has changed`), drift explanations, and now a budget warning.
Only some of its traffic is progress, and the marker takes whichever came last.

## The shape

A seam used for a second purpose because it happened to be in scope. It is the same error as
PRDR-149's `status: "provisional"` — **one answer serving two questions** — and it produced the
same result: a value that is right for its original reader and wrong for the new one.

## Resolution

An explicit `progress` seam, called where work actually begins: each phase boundary in
`runInit`'s loop, each slice in `planSlices` (planned or reused), each redraft in
`wholePlanReview`. `note` returns to printing. The marker keeps slice granularity, because
`PLAN s09` is the useful answer and `PLAN` is not.
