---
id: PRDR-144
title: "presentInputsFromOutputs casts a checkpoint's unknown outputs at six sites and was only ever exercised on outputs it had just written"
state: DONE
severity: minor
category: gap
labels: ["prd-review", "found-by-audit"]
surface: ["src/init/present.ts", "tests/init/slicing.test.ts"]
prd_refs: ["C-8", "F-4"]
acceptance_criteria: ["The builder tolerates a checkpoint written by an older build without throwing, and returns a shape the renderer can render."]
non_goals: ["Does not add schema validation of checkpoint outputs — a validating read is a larger change with its own C-8 reuse consequences."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-118", "PRDR-157"]
depends_on: []
---

# PRDR-144 — a reader that had only ever read its own writing

**Severity:** minor · **Category:** gap · **Found by:** the audit of phase 5

## Problem

`presentInputsFromOutputs` reads a checkpoint's `outputs`, typed
`z.record(z.string(), z.unknown())`, and casts at six sites. Every test reached it through a
pipeline that had just written those outputs itself, so a checkpoint from an older build reaches
PRESENT unvalidated — after the expensive phases have already been skipped as reusable.

## Outcome

The first attempt's six "foreign shapes" turned out to target keys the function never reads.
**PRDR-157** carries the correction: the real keys, carried through to rendering, and the
hardening they then demanded.
