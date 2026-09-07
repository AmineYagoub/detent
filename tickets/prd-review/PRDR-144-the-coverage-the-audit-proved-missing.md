---
id: PRDR-144
title: "The coverage the audit proved missing: a driver-level finalize breach, and a PRESENT input builder that had only ever read its own writing"
state: DONE
severity: minor
category: gap
labels: ["prd-review", "found-by-audit", "coverage"]
surface: ["src/init/present.ts", "tests/init/slicing.test.ts", "src/kernel/run.ts"]
prd_refs: ["C-8", "F-4", "B-2′"]
acceptance_criteria: ["`presentInputsFromOutputs` tolerates a checkpoint written by an older build without throwing, and returns a shape the renderer can render."]
non_goals: ["Does not add schema validation of checkpoint outputs — a validating read is a larger change with its own C-8 reuse consequences.", "Does not close the finalize-breach coverage gap; that still needs a two-worktree fixture and is recorded, not fixed."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-118", "PRDR-145a", "PRDR-157", "PRDR-164"]
depends_on: []
---

# PRDR-144 — one id, two concerns, recorded honestly

**Severity:** minor · **Category:** gap · **Found by:** the audits of phases 2 and 5

This id was used for two different things across two commits, and the audit of `bdafdb5` caught the
result: a second ticket file was created for it rather than this one being filled, leaving PRDR-144
with two files, one empty. Both concerns are recorded here.

## 1. The driver-level finalize breach has no test — STILL OPEN

Forcing a worktree merge conflict through the sequential loop needs two worktrees alive at once, so
the driver-level routing of a finalize breach is untested; `mergeWorktree`'s own half is covered.
Recorded rather than papered over. Not closed by this ticket.

## 2. The PRESENT input builder had only ever read its own writing — CLOSED

`presentInputsFromOutputs` reads a checkpoint's `outputs`, typed
`z.record(z.string(), z.unknown())`, and casts at six sites. Every test reached it through a
pipeline that had just written those outputs itself, so a checkpoint from an older build reaches
PRESENT unvalidated — after the expensive phases have already been skipped as reusable.

The first attempt's six "foreign shapes" targeted keys the function never reads (**PRDR-157**), and
the correction then validated the elements of two of its four return fields (**PRDR-164**). Both
are closed; the builder now validates every field element-wise.
