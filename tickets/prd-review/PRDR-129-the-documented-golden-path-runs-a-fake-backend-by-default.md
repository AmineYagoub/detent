---
id: PRDR-129
title: "`detent run` defaults to the mock backend, so the documented, test-locked golden path executes a fake and writes a fabricated ledger and journal over real ticket state"
state: DONE
severity: major
category: correctness
labels: ["prd-review", "found-by-audit", "user-raised"]
surface: ["src/cli/run.ts", "src/kernel/run.ts", "src/sessions/backend.ts", "tests/cli/dispatch.test.ts", "detent-prd-v3.md"]
prd_refs: ["C-14″", "C-11", "S-4", "P6"]
acceptance_criteria: ["`detent run` defaults to the live backend, matching `detent referee` and `detent init`.", "The per-run config audit event records which backend ran, so a journal can be told apart from a fixture's afterwards.", "A run against a non-live backend announces itself on stderr before it starts.", "A test asserts the parsed default is the live backend, and a test asserts the audit event carries the backend name."]
non_goals: ["Does not remove `--backend mock`. The fixture path is real and `detent run` is the driver the oracle parity suite exercises.", "Does not change `tests/docs/golden-path.test.ts`. That test is correct; it is the reason this defect matters, not a co-defect.", "Does not add an empty-diff or no-work heuristic. Detecting a session that did nothing is a separate question from knowing which backend ran."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-114"]
depends_on: []
---

# PRDR-129 — the porcelain runs a fake

**Severity:** major · **Category:** correctness · **Found by:** the production-readiness audit
of 7 September 2026

## What happens

`src/cli/run.ts:25`:

```ts
backend: { type: "string", default: "mock" },
```

The README's own framing is *"The golden path — two commands. That is the whole public
workflow"*, `detent init` then `detent run`, and `tests/docs/golden-path.test.ts:31`
**test-locks** it to exactly those two strings with no flag. So the frozen, documented,
test-enforced user path runs `MockBackend`.

The asymmetry is what marks this a leftover rather than a decision: `src/cli/referee.ts:30`
defaults the same option to `"claude"`, and `src/cli/init.ts:78-84` refuses the mock outright
with an explanation. `run` is the only verb that silently accepts it.

## What a mock run produces

`okResult()` (`src/sessions/mock.ts:21-34`) returns `ok: true`, `telemetryParsed: true`,
`costEstimateUsd: 0.001`, 80 input and 20 output tokens, `turns: 1`.

Nothing downstream distinguishes that from a real session. `referee-session.ts:179` records
those figures in the real ledger; `:152` and `:180` journal `start`/`end` events identical in
shape to live ones; the session and generation counters are consumed against the user's real
tickets. The real gate then runs against an untouched tree and goes green on any healthy
repository. The run finally breaks at `referee-stage.ts:131` because `review.json` was never
written — surfacing as a **reviewer** failure rather than "you ran the fixture backend".

The result is a complete, plausible, entirely fabricated run history on real state, ending in
NEEDS_HUMAN for a reason that is not the reason.

## Why nothing catches it afterwards

`SessionBackend.name` exists (`src/sessions/backend.ts:129`) and has **zero readers** —
`grep -rn "backend.name" src/` returns nothing. The per-run config audit event
(`src/kernel/run.ts:130-138`) records budgets, model routing, protected globs and risk labels,
but not the backend. So the journal cannot answer "was this real?" even after the fact.

That is the second half of the fix: flipping the default closes the trap, recording the
backend makes every past and future journal legible.
