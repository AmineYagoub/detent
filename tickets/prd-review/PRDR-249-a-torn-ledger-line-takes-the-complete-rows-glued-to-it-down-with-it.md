---
id: PRDR-249
title: "A torn ledger line takes the complete rows glued onto it down with it, so one crash can hide two fully-billed sessions from the no-progress breaker"
state: DONE
severity: major
category: defect
labels: ["prd-review", "found-by-audit", "ledger", "spend", "crash-recovery", "X-1"]
surface: ["src/kernel/jsonl-recover.ts", "src/kernel/ledger.ts", "tests/kernel/jsonl-recover.test.ts", "tests/kernel/ledger.test.ts"]
prd_refs: ["X-1", "X-1⁵", "N-5", "S-4"]
acceptance_criteria: ["A line holding a torn fragment followed by one or more COMPLETE ledger rows contributes every complete row to the total; only the fragment is lost.", "A line holding two complete rows glued at the record separator contributes both, rather than neither.", "A torn last line with nothing after it still contributes nothing and still does not throw — PRDR-151's rule that unparseable text is a crash artifact at any position is unchanged.", "A recovered object that is well-formed JSON but not a ledger row is SKIPPED rather than fatal, because it came out of a damaged line; a non-row on an INTACT line still throws, which is what X-1‴ was about.", "The recovery is a pure function with its own tests over the glue shapes, and the existing ledger tests that encode the lossy totals are updated to the recovered ones."]
non_goals: ["Does not make a torn line fatal in any position; PRDR-151 recorded that bricking a root is worse than an under-count and that stands.", "Does not attempt to recover the torn fragment itself — its bytes were never fully written and its cost is genuinely unknown.", "Does not change how the ledger is WRITTEN; making appends crash-atomic is a separate and much larger question.", "Does not touch `journal.ts`, which guards an identical parse for a different artifact."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-151", "PRDR-191", "PRDR-219"]
depends_on: []
---

# PRDR-249 — the glue costs more than the tear

## Problem

`appendLedger` writes `JSON.stringify(row) + "\n"`. A line torn mid-append has no
trailing newline, so the NEXT append concatenates onto it. `readRecordedSpend` then
fails to parse the glued line and skips the whole thing — losing not only the torn
fragment but every complete row stuck to it.

PRDR-151 established the skip deliberately, and it was right: refusing a torn line that
was not last bricked a root, forever, with no repair instruction. The under-count is the
safe direction. What was wrong is the size of it, which that ticket recorded as "an
under-count of at most the row glued to the torn one". Two shapes exceed it:

- **fragment + complete row(s).** The fixture already in `tests/kernel/ledger.test.ts`
  writes `10`, tears, then appends `7` and `3`, and asserts `13`. The `7` is a
  syntactically complete row sitting on that line and is recoverable.
- **two complete rows.** If the tear lands exactly at the record separator — the row
  fully written, its `\n` not — the line is `<row A><row B>` and `JSON.parse` rejects the
  pair for trailing content. Both are lost. Probed with `10`, `100`, `1` and a tear after
  the first row's closing brace: read back `1`, i.e. `$110` dropped by one crash.

## Why it matters, precisely

`run_spend_usd` is advisory since PRDR-191, so this is not a ceiling bypass. The
consequence is on the other side: `spend_without_progress_*` reads this file, and the
no-progress breaker is one of the two ceilings that actually stop a run. An under-count
makes it fire LATE — by up to two fully-billed sessions per torn line — which is spend
the operator has already paid and the breaker cannot see.

Crashes are not hypothetical here: a machine restart during gate-313's take 15 stranded
two tickets mid-flight, which is exactly the event that leaves a torn append behind.

## Design

A pure `recoverObjects(line)` in its own module, used only from the `catch` branch that
already exists:

1. A balanced scan tracking brace depth, string state and escapes emits every top-level
   object that opens and closes on the line. This recovers `<row A><row B>`.
2. If the scan yields nothing, a fallback tries `JSON.parse` from each `{` right to left
   and takes the first that consumes the remainder. This recovers `<fragment><row B>`,
   where the fragment's unterminated string makes the balanced scan useless.

A recovered object that parses but is not a ledger row is **skipped, not fatal**. On an
intact line a non-row still throws — that is the X-1‴ property, that the ceiling cannot
trust a shape its writer could not produce. But an object dug out of a damaged line is
itself a crash artifact, and PRDR-151's lesson is that a crash artifact must never brick
a root.

## Falsification (verification protocol, item 1)

`tests/kernel/ledger.test.ts`, run against `1c1bcd5`:

```
× recovers the real rows a later append glued onto a torn line
  → expected 13 to be 20
× recovers both rows when the tear landed exactly at the record separator
  → expected 1 to be 111
✓ skips a recovered object that is not a ledger row rather than refusing the file
✓ still tolerates a torn LAST line — the one shape a crash produces
```

The first failure is the fixture PRDR-151 already shipped, with its total corrected from
the lossy `13` to the recovered `20`: that test encoded the under-count as intended
behaviour, and the doc-block above it repeated the "at most the row glued to the torn
one" bound. The second reproduces the $110 loss through the real `readRecordedSpend`.

The last two passed before the fix as well as after, and are the constraints rather than
the defect: a crash artifact must never brick a root, and a torn fragment with nothing
glued to it must still contribute nothing.

## What changed

`recoverObjects` in `src/kernel/jsonl-recover.ts`, called only from the `catch` branch
`readRecordedSpend` already had. Two passes: a balanced scan tracking brace depth, string
state and escapes recovers `<row A><row B>`; when that yields nothing, parsing from each
`{` right to left recovers `<fragment><row B>`, where the fragment's unterminated string
makes brace depth useless. The fallback is capped at 64 candidate starts, beyond which a
line is pathological rather than a crash artifact.

Eight unit tests cover the shapes directly, including a brace inside a string value and
an escaped quote — both of which would fool a naive scanner into splitting in the wrong
place.

Nothing about how the ledger is WRITTEN changed, and a torn line is still never fatal.
