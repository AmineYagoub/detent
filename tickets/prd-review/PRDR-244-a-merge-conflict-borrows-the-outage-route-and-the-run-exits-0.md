---
id: PRDR-244
title: "A worktree merge conflict is re-thrown as a backend refusal, so it rides the outage backoff into an empty pool and the run exits 0"
state: DONE
severity: critical
category: defect
labels: ["prd-review", "found-by-audit", "worktree", "false-success", "B-2′"]
surface: ["src/kernel/driver.ts", "tests/kernel/driver-worktree.test.ts"]
prd_refs: ["B-2′", "X-3", "C-13", "D-27"]
acceptance_criteria: ["A fresh worktree merge conflict ends the run with a NON-ZERO exit and a summary whose `reason` carries the conflict message, naming the ticket, the conflicted paths and the branch kept for the human.", "The conflict route is its own driver error, distinct from `DriverRefusal`; it never enters `OUTAGE_BACKOFF_MS`, never sleeps, and never consumes an outage slot.", "The ticket stays DONE and its generation stays closed as done — the work was implemented, gated and reviewed, and what failed is integrating it (B-2′); the worktree and `ticket/<id>` branch survive unchanged.", "A test drives a real conflicting merge through the production `run` entry point and asserts the exit code, the reason text and the surviving branch — and it fails on today's tree."]
non_goals: ["Does not route the conflict as NEEDS_HUMAN or any other X-3 state: DONE is terminal by design and the ticket's own work is sound.", "Does not enforce surface disjointness between tickets; two tickets legitimately reaching one file is A-1‴ ground and is why the conflict exists.", "Does not change `mergeWorktree`, which already aborts, preserves the branch and worktree, and throws a typed error with an operator-facing message.", "Does not touch the MCP/plugin driver's own exit handling."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-145a", "PRDR-145b", "PRDR-151", "PRDR-112", "PRDR-217"]
depends_on: []
---

# PRDR-244 — the one exit code that must not be 0

## Problem

`finalizeDone` does the right thing. A conflicting merge aborts, the worktree and
`ticket/<id>` branch survive, a kernel note lands on the ticket, and `git.ts` throws a
`WorktreeConflictError` whose message names the ticket, the conflicted paths, the branch
and what the operator should do. That half is PRDR-145a and it works.

The driver then throws it away.

`processTicket`'s DONE branch catches the resulting `DriverBreach`, closes the generation
as done — correctly — and re-throws it as `DriverRefusal`. That type already means one
specific thing: PRDR-112's backend outage, the route whose whole purpose is to *wait and
retry*. So the conflict takes the outage path at `driver.ts:110`, sleeps for the first
backoff, continues, finds the ticket DONE and the pool empty, and falls into `finish()`.
`finish()` reports `pending` from `NEEDS_HUMAN` and `BLOCKED` only, so a DONE ticket is
invisible to it and the run returns `EXIT_OK`.

Exit 0, ticket DONE, work unmerged, worktree orphaned. The doc-block directly above the
re-throw states the intended behaviour — *"the run stops with a summary naming the
conflict instead of an unclassified throw"* — and that is exactly what does not happen.

This is a false success, which is the worst failure mode a release gate can have: the run
reports the ticket integrated when its work is sitting on a branch nobody merged.

## Why it matters now

PRDR-145a was sequenced deliberately BEFORE PRDR-145b so that the default flip would not
land on an unhardened path. The hardening half landed; the routing half did not, and
PRDR-145b then made per-ticket worktrees the default. Every run now takes this path.

`finalizeStranded` (PRDR-217) cannot recover it either: it only touches DONE tickets whose
generation is still `in_flight`, and the driver closes the generation as `done` before
throwing. `tests/kernel/stranded-finalize.test.ts` encodes that exclusion as intended.

## Design decision this records

PRDR-145a's acceptance criterion said a conflict "routes as a breach". The implementation's
own reasoning is better and this ticket adopts it instead: the ticket stays **DONE**,
because the work was implemented, gated and reviewed, and X-3 offers no edge out of DONE.
What failed is INTEGRATION, which is a property of the run, not of the ticket. So the
conflict is a run-level halt carrying a reason — the shape `DriverDriftHalt` already uses
at `driver.ts:97` — and not an X-3 state change.

That makes the fix a fourth driver route rather than a new state, a new event, or a change
to `mergeWorktree`.

## Verification

The test must drive a genuine conflicting merge through `run` and assert on the exit code
rather than on a helper's return value. It must fail on today's tree, where the observed
result is `exitCode: 0`.

## Falsification (verification protocol, item 1)

`tests/kernel/driver-worktree.test.ts`, written before the fix and run against `225a936`:

```
× B-2′ a worktree merge conflict ends the run > exits non-zero and names the conflict
  → a conflicting merge must not report success: expected +0 not to be +0
```

The first version of the test carried no injected `sleep` and did not fail — it TIMED OUT
at 60s, because the conflict took `OUTAGE_BACKOFF_MS[0]` and slept for a minute before
going on to exit 0. That is worth recording: the defect costs the operator 1 + 5 + 15
minutes of waiting before it reports success. Injecting `sleep` turned the timeout into the
assertion above and let the test also prove the conflict never enters the backoff at all.

After the fix the same test passes in 1.2s with `waits` empty.

## What changed

`DriverIntegrationHalt`, a fourth driver route beside `DriverBreach`, `DriverDriftHalt` and
`DriverRefusal`. `processTicket`'s DONE branch throws it instead of `DriverRefusal`, and
`loop()` returns `EXIT_HUMAN_GATED` carrying the conflict message as `reason` — the shape
`DriverDriftHalt` already used. `mergeWorktree`, `finalizeDone` and the X-3 table are
untouched.
