---
id: PRDR-076
title: "Interpreter-wrapped tooling absence binds as a red gate"
state: DONE
severity: minor
category: consistency
labels: ["prd-review", "found-by-execution", "field-test"]
surface: ["src/adapter/bind.ts"]
prd_refs: ["V-1", "C-3b", "SEC-1"]
acceptance_criteria:
  - "A probe whose command executes but reports interpreter-level tooling absence (python's `No module named`, node's `Cannot find module`) rejects as unrunnable and routes to AWAIT_SETUP_CONSENT like a 127."
  - "A command that exits 0 while merely printing such a phrase still binds (green guard)."
  - "Live gate classification is untouched — the pattern check runs at PROBE time only; a mid-run module absence stays a red the ladder can research."
non_goals:
  - "No general environment doctoring: two conservative interpreter patterns, not a taxonomy of every ecosystem's absence text."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-075"]
depends_on: []
---

# PRDR-076 — interpreter-wrapped tooling absence binds as a red gate

**Severity:** minor · **Category:** consistency · **Found by:** field test 2
(more-itertools) — the first Python-ecosystem binding pass.

## Problem

V-1's probe accepts any command that *executes*, by design: red tests are the
normal state of a repository mid-work, and the oracle's contract flagged only
`rc == 127 or rc is None`. But `python -m build` with no `build` package
executes — the interpreter runs, prints `No module named build`, exits 1 — so a
missing tool bound as an "approved" gate. The same environment's missing `ruff`
was caught (bare command, honest 127) while the missing `build` slipped through
the interpreter's wrapper. The false binding would have surfaced only as an
unexplained red at the first close-check.

## Resolution

A probe-time check beside the runnable predicate: a non-zero result whose
output matches an interpreter's own absence message (`No module named`,
`Cannot find module`) rejects as unrunnable with an explanation naming what
happened, routing to the same AWAIT_SETUP_CONSENT a 127 takes. Zero-exit
results are exempt, so a green command that merely prints the phrase still
binds. The oracle-ported `runnable` predicate and live-gate classification are
untouched — mid-run absence remains a red for the ladder to diagnose.
