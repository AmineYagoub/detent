---
id: PRDR-195
title: "X-1⁵'s advisory total announces once per SESSION, not once per run — the flag meant to bound it is instance state on an object `init` rebuilds for every launch"
state: OPEN
severity: minor
category: bug
labels: ["prd-review", "found-by-live-run", "observability"]
surface: ["src/kernel/ledger.ts", "tests/kernel/ledger.test.ts"]
prd_refs: ["X-1⁵", "PRDR-191"]
acceptance_criteria: ["The advisory total is announced once for the run, however many sessions it launches.", "The test constructs a SECOND `SpendLedger` on the same root and asserts silence — the shape production actually has, and the shape the original test did not use.", "Nothing new is invented to hold it: the run-scoped ledger state already has a home."]
non_goals: ["Does not change what the announcement says or when it first fires.", "Does not make the total block anything. X-1⁵ stands."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-191", "PRDR-194"]
depends_on: []
---

# PRDR-195 — the flag that reset itself

**Severity:** minor · **Category:** bug · **Found by:** reading the gate-312 log, 2026-09-09

## Problem

X-1⁵ announces the advisory total once, on the first launch past it, deliberately: a warning
that fires constantly is V-1‴'s own description of a useless one. In the live log it has fired
three times in thirteen minutes:

```
spend has passed the advisory run_spend_usd of $300.00 (now $301.86). …
spend has passed the advisory run_spend_usd of $300.00 (now $310.73). …
```

`announcedTotal` is a plain instance field on `SpendLedger`, and **`init` constructs a fresh
`SpendLedger` for every session launch**, so the flag resets each time and the announcement is
once per session.

## This is the third instance of one pattern, in the same file

PRDR-191's own audit found exactly this for the breaker's progress mark: run-scoped state held
in a per-session object, so every session forgave what the last one spent. The fix moved it to
`state/progress.json` and left the announcement flag in memory — **same file, same function,
one line apart**, with the comment explaining why the mark had to persist sitting directly
above the field that ignores it.

The test asserted "said once" against a SINGLE ledger instance, which is the wrong scope and is
exactly why it passed. Production never has one instance.

## Resolution

The flag joins the mark in the run-scoped ledger state, which already exists for precisely this
reason and is already cleared per invocation. The test constructs a second ledger on the same
root, because that is the shape `init` actually has.
