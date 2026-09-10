---
id: PRDR-202
title: "Two DONE tickets rest on measurements no one else can reproduce: the harnesses that produced them live outside the repository and outside every gate"
state: DONE
severity: minor
category: gap
labels: ["prd-review", "measurement", "tooling", "reproducibility"]
surface: ["scripts/null-review.ts", "scripts/coverage-report.ts", "scripts/plan-corpus.ts", "tests/scripts/plan-corpus.test.ts", ".git/info/exclude"]
prd_refs: ["N-6", "V-6", "PRDR-192", "PRDR-200", "PRDR-201"]
acceptance_criteria: ["The harnesses live where the repository already puts non-product code that must not drift — `scripts/`, linted by the existing `files` glob — and each is reachable from a test, which is the mechanism that actually typechecks `scripts/` today.", "The test asserts real behaviour of the shared reader, not that an import succeeds. The drift-prone part is reading a planned root off disk into tickets and slice specs, and the additive-field case is pinned: a slice cached before `churn` or `requirement_ids` existed reads back with defaults rather than throwing.", "The falsification lands first: the guard is observed to FAIL against the exact break that happened — a symbol moved out of `plan-slices.ts` — before the move is made permanent (V-6).", "`experiments/` leaves `.git/info/exclude`, because the reason it was there no longer holds: a working note is local, and a control two DONE tickets cite as evidence is repository content."]
non_goals: ["Does not make the harnesses part of `detent`. They are measurement tools that call production seams; no CLI verb gains them and no gate runs them, exactly as `parity.ts` and `check-rules.ts` are run by npm scripts rather than by the product.", "Does not add a gate that RUNS them. Both launch live sessions and cost money; `tickets:check` and `parity:check` are deterministic and these are not. What is gated is that they still COMPILE against the seams they measure.", "Does not claim `scripts/` had a coverage gap. It does not — all six existing scripts are imported by a test and all six are typechecked, verified by injecting a type error into `hash-prompts.ts` and watching `tsc` catch it. The convention works; the harnesses were simply outside it.", "Does not keep `docs/research/` or `docs/plan-audit-remediation.md` out of the exclude file. Those are working notes and stay local; this is about code that produced cited evidence."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-200", "PRDR-201"]
depends_on: []
---

# PRDR-202 — the evidence has no home

**Severity:** minor · **Category:** gap · **Found by:** moving a function in `src/` and silently
breaking the harness that two DONE tickets cite

## Problem

PRDR-200 and PRDR-201 are both closed on measurements produced by `experiments/null-review.ts`
and `experiments/coverage-report.ts`. PRDR-200's own scope note left their home open:

> Whether a control of this kind belongs in the tree, gated, is a real question and deliberately
> left open here; the fix for this ticket does not wait on it.

It should not stay open, for a reason the work itself demonstrated. `revisionOutcome` moved from
`plan-slices.ts` to `plan-signal.ts` when the former crossed its line ceiling. `experiments/` is
outside `tsconfig.json`'s `include`, so `typecheck` did not see the broken import, and the six
gates stayed green. The break surfaced only when the harness was next run — as a crash, mid-sweep.

That is the same failure class the repository has already paid for twice at the product level:
PRDR-141's *implemented, tested, documented, unreachable*, and PRDR-176's `rulesText` declared and
consumed with no caller supplying it. A seam nothing compiles against is a seam that has already
drifted; it just has not been observed yet.

## What the repository already does about this

`scripts/` is the answer, and it is not the answer this ticket first assumed. The initial guess
was that `scripts/` had the same hole, since `tsconfig.json` includes only `src/**/*.ts`,
`tests/**/*.ts` and `*.config.ts`. It does not:

```
build-plugin  imported by a test — typechecked
check-rules   imported by a test — typechecked
check-tickets imported by a test — typechecked
hash-prompts  imported by a test — typechecked
parity        imported by a test — typechecked
self-build    imported by a test — typechecked
```

All six, verified by appending `const DRIFT: number = "not a number"` to `hash-prompts.ts` and
watching `tsc` report it. Every script is pulled into the program by a test that imports its pure
half, and eslint covers `scripts/**/*.ts` by an explicit glob. The convention is complete and it
works. The harnesses were simply not in it.

So the fix is to join the convention rather than to widen `tsconfig`: a wider `include` would
compile a file nothing exercises, which is a weaker guarantee than a test that imports the part
worth keeping honest.

## What is actually worth testing

Not that the file parses. The drift-prone half both harnesses share is reading a planned root off
disk — `state/plan/*.json` into tickets, `state/slices.json` into specs — and that is exactly the
shape two tickets have now changed underneath it: `churn` (PRDR-200) and `requirement_ids` /
`baseline_ids` (PRDR-201). Both were added as defaulted fields precisely so an older cache still
reads; a hand-rolled reader in a harness gets no schema and no default, and both harnesses
currently patch that by hand.

One reader, imported by one test, pinned against the additive-field case.

## What implementation changed

Both harnesses moved to `scripts/`, joining the convention all six existing scripts already
follow: linted by the explicit glob, and typechecked because `tests/scripts/plan-corpus.test.ts`
imports them. `experiments/` is gone from the tree and from `.git/info/exclude`.

**The shared reader is the drift-prone half**, so it is the tested one. `readPlannedRoot` fills
the additive defaults a raw file read does not get — `requirement_ids`, `baseline_ids` — and the
suite pins that a cache written before those fields reads back as `[]` rather than `undefined`.

**The gate paid for itself on its first run.** `CorpusTicket` re-declared the two fields as
`readonly string[]`, narrowing away from the `string[]` `applyContracts` accepts. That is a real
type error in harness code, of exactly the class this ticket exists to catch, and it was caught
within a minute of the coverage existing.

**Falsified against the original break**, not a proxy: `sampleChurn` re-imported under a name
`plan-signal.ts` does not export, and USED, so `no-unused-vars` cannot be the rule that catches
it. Before: `typecheck` green. After: `typecheck` red.

**One safety change that was not in the acceptance criteria.** Both harnesses now guard their CLI
behind `runDirectly(import.meta.url)`. This is not hypothetical tidiness. While demonstrating the
gap, an injected import error did NOT crash `null-review.ts` — esbuild stripped the unused symbol
— and the harness went on to start a live sweep against a planned root before it was stopped.
Nothing reached the ledger, but a file that launches paid sessions on import is a file no test can
safely import, which would have made this ticket unimplementable.
