---
id: PRDR-077
title: "pnpm forwards the arg separator into the script — run-once normalization corrupts"
state: DONE
severity: minor
category: consistency
labels: ["prd-review", "found-by-execution", "field-test"]
surface: ["src/adapter/normalize.ts"]
prd_refs: ["V-1", "V-4"]
acceptance_criteria:
  - "pnpm script invocations append flags without a `--` separator (`pnpm run test --run`)."
  - "npm keeps `--` (it requires the separator); yarn and bun stay pass-through."
non_goals:
  - "No probe of the package manager's version: pnpm ≤6 wanted npm's form, but V-4 resolves the pm from the lockfile, and every pnpm lockfile a live repo carries today is v7+ territory."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-076"]
depends_on: []
---

# PRDR-077 — pnpm forwards the arg separator into the script

**Severity:** minor · **Category:** consistency · **Found by:** field test 3
(changesets pnpm monorepo) — the watch-mode probe's first live firing.

## Problem

The run-once normalization for watchful runners appended flags with npm's
forwarding idiom for pnpm too: `pnpm run test -- --run`. Modern pnpm forwards
script args directly and passes a literal `--` INTO the script's argv, so the
probe actually executed `vitest -- --run` — vitest read `--run` as a filter
after the argument terminator, failed, and left its tree alive until the
watch-mode kill. The rejection the operator saw was honest ("did not exit,
looks like watch mode") but the diagnosis was the normalizer's own corruption:
the same candidate normalized correctly runs the suite in seconds.

## Resolution

`ARG_SEPARATOR.pnpm` is a plain space. npm keeps ` -- ` (it requires the
separator); yarn classic and bun were already pass-through. The pinned
normalization test updated to the corrected pnpm form.
