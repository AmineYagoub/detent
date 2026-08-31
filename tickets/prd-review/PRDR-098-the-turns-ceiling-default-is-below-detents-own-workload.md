---
id: PRDR-098
title: "The turns_per_stage default is below Detent's own reference workload, and PRDR-097 turned that from silent into fatal"
state: DONE
severity: major
category: correctness
labels: ["prd-review", "found-by-execution"]
surface: ["src/schemas/budgets.ts", "agents/"]
prd_refs: ["X-1", "D-16", "N-7"]
acceptance_criteria: ["The default `turns_per_stage` clears the turn counts Detent's own N-7 workload actually requires, with headroom, so a default-configured run does not halt on its own reference case.", "The ceiling still bounds a runaway session — this raises a too-low default, it does not remove the bound.", "The vendored agent frontmatter, which embeds the default as `maxTurns`, is regenerated so the SDK allowlist and the schema stay one truth."]
non_goals: ["Does not change how a breach is handled — PRDR-097 settled that, and halting by name is correct.", "Does not tune the ceiling per model; an operator running a slower model still raises it themselves, which is what the breach message now tells them to do."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-097"]
depends_on: []
---

# PRDR-098 — the turns ceiling default is below Detent's own workload

**Severity:** major · **Category:** correctness · **Found by:** execution, immediately
after PRDR-097

## Problem

`turns_per_stage` defaulted to 30. Implement sessions on the N-7 gate, across two
different models, took:

```
20, 25, 25, 27, 32, 32, 34, 39, 43
```

Five of nine at or above the default. This was survivable only because a breach was
silently mis-recorded as a crash and the fix ladder quietly absorbed it — the very defect
PRDR-097 just closed. Now that a breach **halts the run by name**, a default below the
workload halts most runs on their own reference case.

PRDR-097 was the right fix and this is its immediate consequence: making a failure loud
exposes how often it was firing. The N-7 gate is the workload Detent certifies itself
against, so a default that cannot clear it is not a defensible default.

## Resolution

Default raised to 80 — nearly double the observed maximum of 43, with the bound still in
place, since the ceiling exists to stop a runaway session rather than to pace a healthy
one. `agents/*.md` embed the default as `maxTurns` in frontmatter and were regenerated;
the staleness test caught that drift before it could ship, which is what it is for.

An operator on a slower model still raises the ceiling themselves — Haiku 4.5 needed
61–68 turns on the same tickets — and PRDR-097's breach message now tells them exactly
that instead of billing them silently.
