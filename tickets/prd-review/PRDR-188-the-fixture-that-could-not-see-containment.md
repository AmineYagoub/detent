---
id: PRDR-188
title: "MockBackend ignored the containment policy it was handed, so every session-driving test in the suite was blind to the guard — and failure fixtures were hand-built rather than derived from the producer"
state: DONE
severity: critical
category: weak-test
labels: ["prd-review", "systemic", "vacuous-test"]
surface: ["src/sessions/mock.ts", "tests/init/stages.test.ts"]
prd_refs: ["D-21", "SEC-3", "S-4", "V-6"]
acceptance_criteria: ["A fixture session that would be DENIED its artifact does not get one, so a containment defect fails a test rather than a live run.", "Reverting either containment fix that was fatal in production now fails the ordinary suite.", "A failure fixture is derived from the SDK shape through the real parser, so a test cannot assert on a shape production does not produce."]
non_goals: ["Does not make the mock run tools. It reproduces the one thing that mattered — a denied artifact is an absent artifact — not the whole hook.", "Does not add a lint rule for 'assert on the production entry point'. That is not decidable, and a checker that fires on everything is one nobody reads (V-1‴)."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-180", "PRDR-184", "PRDR-187", "PRDR-182"]
depends_on: []
---

# PRDR-188 — the suite could not see the boundary it was built to protect

**Severity:** critical · **Category:** weak-test · **Found by:** asking why five fixes in a row shipped broken

## The blindness

`MockBackend.run` receives `spec.policy` and `spec.artifactOut` and used neither. Stage functions
write artifacts with `fs`, so no test that drives a session ever ran the PreToolUse hook. Two
defects lived behind that:

- **PRDR-184** — the SEC-3 floor denied `analysis.json`, so `detent init` was dead at ANALYZE for
  two days. 969 tests green throughout.
- **PRDR-180** — no read-only role could write its artifact in the default worktree mode.

Both were fatal in production. Both were found by live runs, at $1.69 and $3.32. Neither failed a
single test.

The mock now asks the REAL guard about the REAL policy the session arm published, and removes an
artifact the guard would not have permitted — which is precisely what production does to a session
denied its write. Measured, by reverting each fix with the change in place:

| reverted | tests failing before | after |
|---|---|---|
| PRDR-184 | 0 | **55, across 10 files** |
| PRDR-180 | 0 | 3 |
| PRDR-178 | 0 | 1 |

Nothing in the existing suite depended on the blindness: all 969 still pass.

## The hand-built fixture

`okResult({ ok: false, rawTail })` is a shape a test author invents. Production derives both fields
from the SDK's own message through `parseResultMessage`, and PRDR-187's defect sat exactly in that
gap — the invented shape was right for four hops and wrong at the fifth, so a fix verified four
ways was blind to the only case it existed for.

`outageResult()` and `resultFromSdk()` derive the shape from the producer. Reverting PRDR-187 now
fails the tests that use them; with the hand-built shape it failed nothing.
