---
id: PRDR-143
title: "Green tests that asserted something other than what they were named for — including the tripwire for the largest paid session in the product"
state: DONE
severity: major
category: bug
labels: ["prd-review", "found-by-audit", "test-quality", "recovered"]
surface: ["src/kernel/stages/review.ts", "tests/oracle/parity.test.ts", "tests/kernel/skeletons.test.ts", "tests/cli/doctor.test.ts", "tests/init/slicing-scale.test.ts", "tests/sec/pack.test.ts", "tests/sessions/guard.test.ts"]
prd_refs: ["V-1‴", "V-6"]
acceptance_criteria: ["The reflog metric test drives a REAL hostile commit through `enforceBaseGuard`'s restore and asserts both that the base came back and that the metric counts it.", "The review contract-drift lock reads `expected_output_note` — the instruction a reviewer actually receives — and derives it from `reviewTags`, so adding a tag without updating the note fails.", "The parity map counts PER FILE, closing the deletion hole.", "`doctor`'s entry point has a test that injects nothing."]
non_goals: ["Making the whole-plan review incremental is the real answer to the context-window bound and belongs with PRDR-144."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-144", "PRDR-150", "PRDR-192"]
depends_on: []
---

# PRDR-143 — tests that asserted their own assumptions

**Severity:** major · **Category:** bug · **Found by:** the phase-5 audit (`7d9526c`)

> **Recovered 2026-09-09 (PRDR-192).** Filed as an empty file — the filename carried the
> title and nothing else was ever written. Its reasoning survived in the commit that created
> it, and this body is that account. Fields the original never recorded are derived from
> evidence, not invented.

## The premise

The audit's verdict rested on one observation: **822 green tests were not evidence.** Three of
its critical blockers had a passing test asserting the property they violated.

## What was wrong

- **The reflog metric test** was named "counts a reverted tamper honestly" and its fixture did
  `git init`, commit, commit. No tamper, no revert. `baseReflogWrites` is entries−1, so an
  ordinary second commit yields 1 and it passed. Its comment claimed the T-042 red-team
  fixture exercised the same path; that fixture never reads the metric.
- **The context-window tripwire** — which this file itself calls the tripwire for the largest
  paid session in the product — was calibrated on tickets carrying `description: ""` and one
  criterion. Given realistic content the 500-ticket whole-plan review measures **484 KB against
  its 400 KB bound: it fired immediately.** The number is recorded rather than merely raised,
  because it is a product limit and not a test parameter — roughly 120k tokens in one prompt
  variable.
- **The review contract-drift lock** existed to prove the contract a live session sees cannot
  drift from the validator that judges it, and its changes half hand-retyped the shape instead
  of reading `expected_output_note`.
- **The oracle parity map** was green iff someone typed a path into it, with a many-to-one
  mapping and one ticket-id mention per file, so **deleting four of five ported cases still
  reported 52/52.**
- **`doctor`'s own entry point had no test at all** — every case injected deps, which is
  exactly the critique phase 4 made of its predecessor and exactly why its wiring defect
  shipped.

Two tests whose names contradicted their bodies were renamed: the guard case titled "is
allowed" asserts abstain four times, and the evasion row labelled "symlinky nested traversal"
contains no symlink.
