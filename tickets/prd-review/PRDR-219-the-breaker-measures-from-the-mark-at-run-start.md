---
id: PRDR-219
title: "The no-progress breaker measures from the mark it read at run start: a ticket reaching DONE resets the file, not the ledger the launch gate consults, so a working run halts on its second ticket"
state: DONE
severity: critical
category: defect
labels: ["prd-review", "X-1⁵", "budgets", "breaker", "ledger", "gate-313"]
surface: ["src/kernel/ledger.ts", "tests/kernel/ledger.test.ts", "detent-prd-v3.md"]
prd_refs: ["X-1⁵", "X-1‴", "D-25", "P6", "V-6", "N-6", "PRDR-191", "PRDR-195", "PRDR-136"]
acceptance_criteria: ["`assertLaunchAllowed` reads the progress mark from the FILE at every launch, exactly as it re-reads the ledger (X-1‴): a unit completed by `noteUnitComplete` between two launches moves the mark the breaker measures from, and the last unit's cost the threshold derives from. Observed FIRST (V-6): a ledger constructed once, rows recorded past the threshold, `noteUnitComplete(root)` called, then `assertLaunchAllowed()` — today it throws `NoProgressError`; on gate-313 it threw at 08:26:33 with `$52.76 spent without completing a unit` fourteen minutes after t-s01-001 reached DONE, because the run's ledger still held the mark init had left at row 86 ($228.51) and the file said $278.31.", "A run that keeps completing tickets never halts, end to end, when the ledger is constructed ONCE for the run — the shape `RefereeContext` has — not once per launch, the shape the existing test proved.", "The mark in memory never runs ahead of the file and never falls behind it: the file is the shared truth, and a file that cannot be read leaves the memory value in force."]
non_goals: ["Does not change what a unit is (a ticket DONE, a slice planned) or how the threshold is derived.", "Does not make the total fatal again."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-191", "PRDR-195", "PRDR-136"]
depends_on: []
---

# PRDR-219 — a breaker that stopped listening

**Severity:** critical · **Category:** defect · **Found by:** gate-313's walking skeleton, take 4
— exit 10 at 08:26:33 on its second ticket

## Problem

X-1⁵'s breaker fires on spend without a completed unit. Its mark — spend at the last unit —
lives in `progress.json`, written by `noteUnitComplete(root)` from wherever work completes: a
slice checkpoint in `init`, `finalizeDone` in the run. `SpendLedger` reads that file ONCE, in
its constructor, into `progressMark` and `lastUnitCost`; `assertLaunchAllowed` then measures
`spent − progressMark` against a threshold derived from `lastUnitCost`.

`init` constructs a `SpendLedger` per session launch, so it always saw a fresh mark — and
PRDR-191's test proved the breaker on that shape. The run constructs one `SpendLedger` in
`RefereeContext`, once, and every DONE after that updates a file the instance never reads
again.

gate-313, take 4: the run's ledger was built at 08:04:32 with the mark init had left at row
86 of the ledger, $228.51. The bootstrap was finalized at 08:04:34 (mark → $276.76), t-s01-001
reached DONE at 08:12:19 (mark → $278.31, unit cost $1.56). At 08:26:33, launching the review
fix for t-s01-002, the instance measured $281.27 − $228.51 = $52.76 against a threshold of
$52.09 and threw:

> no-progress breaker (X-1⁵): $52.76 spent without completing a unit of work, past the $52.09
> this run allows. Nothing has finished in that time

Something had finished in that time. Three tickets went to NEEDS_HUMAN in the same second —
t-s01-002 at REVIEW_FIX, t-s01-006 and t-s01-017 the moment they were claimed — and the run
exited 10 with $4.50 of real work done since the last unit.

## The shape

The file is the shared truth, which is exactly what X-1‴ said of the ledger itself: re-read
the mark at every launch, adopt it when it has moved, and derive the threshold from the unit
cost it carries.

## What implementation changed

**The mark is re-read at every launch.** `assertLaunchAllowed` already re-read the ledger file
(X-1‴); it now re-reads `progress.json` beside it and, when the file's mark has moved past the
one in memory, adopts both the mark and the unit cost it carries before measuring. A file that
cannot be read, or one that has not moved, changes nothing — memory never runs ahead of the
file. `noteProgress` and `noteUnitComplete` are untouched: the file was always right; the
instance had stopped listening.

**V-6, in order.** Observed on the tree as it was: a ledger built once, three $4 rows past a
$10 threshold, `noteUnitComplete(root)`, and the launch gate threw `NoProgressError` — `$12.00
spent without completing a unit`; end to end, one run ledger and three tickets completing at $5
a session exited 10 on the second ticket. Then the change; then both green: the unit's cost on
disk derives the threshold (36 allowed after a $12 unit, refused at 40), and the run finishes
all three.


## Audit

Cold re-read of the one condition. The file is adopted only when its mark is PAST the one in
memory: a stale or older write on disk — a `--replan` wiping state, a crash mid-write, a
second writer — must not hand the breaker a smaller mark and a false "nothing has finished".
Pinned by a test that plants an older mark after the instance adopted the newer one; observed
failing under the mutation that adopts the file whenever it differs, then green as written.
Also checked: a $0 unit on disk (C-8 reuse) lowers the unit cost to zero exactly as
`noteProgress` always has, and the floor and the per-session term still govern; `init`, which
builds a ledger per launch, reads the same value at construction and at launch, so nothing
there moves.
