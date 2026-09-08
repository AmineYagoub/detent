---
id: PRDR-168
title: "detent init takes no run lock, so two concurrent invocations each enforce the full ceiling and jointly spend past it"
state: OPEN
severity: critical
category: defect
labels: ["prd-review", "found-by-audit", "spend"]
surface: ["src/cli/init.ts"]
prd_refs: ["X-1‴", "X-1", "NG4"]
acceptance_criteria: ["A second `detent init` on a root already running one refuses, on the same terms `detent run` already refuses — and the refusal names who holds the root.", "The lock is released on every exit path out of the planning pipeline, including a thrown phase error."]
non_goals: ["Does not make concurrent inits SAFE. NG4 stands: the second one declines, which is the honest answer.", "Does not lock the parsing and validation that precede the pipeline — nothing there spends."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-147"]
depends_on: []
---

# PRDR-168 — the mechanism exists, wired to one of the two commands that need it

**Severity:** critical · **Category:** defect · **Found by:** the full-project audit of `0752fef`

## Problem

`acquireRunLock`/`runLockRefusal` were built for PRDR-147, whose stated shape is "two runs on one
root each enforce the full ceiling and jointly spend past it — silently, because per-ticket claims
correctly keep them off the same ticket, so nothing else looks wrong."

`acquireRunLock` has exactly one call site: `src/kernel/run.ts:186`. `src/cli/init.ts` — the only
caller of the planning pipeline, and the FIRST command an operator runs — never takes it.
`journal.ts`'s `OPEN_ROOTS` is an in-process `Set` whose own comment says cross-process protection
is NG4 ground.

Reproduced with two separate OS processes racing one root through the real `RunJournal` and
`SpendLedger`, ceiling $10, each attempting an $8 session: both saw `launch allowed = true`, both
recorded, final ledger $16 — 60% over, with neither process ever seeing `SpendExhaustedError`.
`assertLaunchAllowed` fires well before a multi-minute live session completes, so the window is
wide rather than contrived.

`init` is also the command whose sessions cannot be run against the fixture backend, so these are
the first genuinely billed sessions in a project's lifetime.
