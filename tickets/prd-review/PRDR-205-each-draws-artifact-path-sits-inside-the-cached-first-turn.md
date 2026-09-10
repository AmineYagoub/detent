---
id: PRDR-205
title: "Since PRDR-203 each draw's artifact path sits inside the cached first turn, so the second and third draws write the block the first already wrote — about 25k tokens, $0.45, a draw"
state: DONE
severity: minor
category: defect
labels: ["prd-review", "cost", "prompt-cache", "review-sampling", "init"]
surface: ["src/sessions/guard.ts", "src/sessions/sdk.ts", "src/sessions/backend.ts", "src/init/launch-batch.ts", "src/init/session.ts", "src/init/plan-review.ts", "src/init/plan.ts", "src/init/pipeline.ts", "scripts/null-review.ts", "tests/sessions/sdk.test.ts", "tests/init/plan-critic-sampling.test.ts", "tests/init/session-in-flight.test.ts", "detent-prd-v3.md"]
prd_refs: ["S-6", "S-1″", "C-4⁗″", "C-4⁗‴", "D-28′", "V-6", "N-6", "PRDR-203", "PRDR-204"]
acceptance_criteria: ["The k draws of one review hand the backend byte-identical `promptPrefix` AND `promptVariable` — observed FIRST to differ, at `artifact_out` (V-6) — while each still writes its own file and S-1″ still lets the session write exactly one path.", "Measured on a never-cached slice, one at a time: the second and third draws create what they created behind one shared path (run 1 of PRDR-204: 21k and 17k against the first draw's 54k), not what they create behind one path each (run A: 45k and 47k against 44k).", "Then the stagger's own test, deferred here from PRDR-204: launched together on a never-cached slice, the second and third draws create what the sequential ones create, or C-4⁗‴'s wait is corrected and re-measured. The numbers go in this ticket.", "No new prompt content and no knob: the fix is where the path travels, not what the session is told to do."]
non_goals: ["Does not give the draws one shared file again. PRDR-203 found what that does the moment two are in flight.", "Does not change k, the threshold, when the draws launch, or the whole-plan review.", "Does not widen what a session may write. Whatever carries the per-draw path, the containment policy still admits one file."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-203", "PRDR-204"]
depends_on: ["PRDR-204"]
---

# PRDR-205 — the path is in the cache key

**Severity:** minor · **Category:** defect · **Found by:** PRDR-204's measurement, which set out
to price launching the draws together and priced this instead

## Problem

`fullPrompt` is one user message — the S-6 stable prefix, then the variable part — and the
variable part ends with the artifact the session is told to write:

```ts
promptVariable: JSON.stringify({ inputs: request.inputs, artifact_out: request.artifactOut }, null, 2)   // session.ts
```

PRDR-203 gave each draw its own artifact, `state/draws/<n>/plan-review.json`, so the three draws
of one review — same prefix, same tickets, same scope, same instruction — now differ in the last
few dozen bytes of a block some 25k tokens long. Prompt caching matches whole blocks up to a
breakpoint, and the breakpoint is the end of the message. The tail differs; the block misses.

## The receipts

PRDR-204 ran three draws over unchanged tickets in five configurations. The clean pair is runs 1
and A: same form, same freshness, one shared path against one path each.

| | first draw | second | third |
|---|---|---|---|
| one shared path (s04, run 1) | 54k created | **21k** | **17k** |
| one path each (s05, run A) | 44k created | **45k** | **47k** |

Behind a shared path the second and third draws read the first turn the first draw wrote; behind
their own they write it again. About 25k tokens a draw — at Opus rates roughly $0.47 to write
against $0.04 to read — for two draws a slice: about $0.90 a slice, $13 on a fifteen-slice gate.
Present since PRDR-203 landed, in sequence or together alike.

It also hides the thing PRDR-204 wanted to see. The stagger there waits for the first draw's first
answer so the others can read its cache; nothing can read a block whose tail differs, so whether
the wait is long enough is unobservable until this is fixed.

## The shape, roughly

The path has to leave the cached block, and the session still has to end up writing one file
that is its own. Candidates, in the order they should be tried:

- **The hook carries it.** The prompt names one path for every draw — `state/plan-review.json` —
  and S-1″'s PreToolUse hook rewrites the `Write` to the draw's own file, via the documented
  `updatedInput` output, before the guard judges it. Byte-identical turns; containment unchanged in
  substance, since the session still writes exactly one path, the one the policy maps it to.
- **A second message carries it.** The SDK accepts a stream of user messages; the shared content
  is one message and the path another, so the cache breakpoint on the first can hit. Depends on
  where the SDK places its breakpoints, which is not documented — measure before trusting.

Either way the falsification is free and comes first: a test that the k specs a review hands the
backend are byte-identical, observed failing at `artifact_out` before anything moves.

## What implementation changed

**The hook carries it** — the first candidate, and it was enough. `SessionSpec.artifactTold` is
the path the prompt names when it is not `artifactOut`; `carryArtifact` in `guard.ts` rewrites a
mutating call naming the told path to the actual file, BEFORE `guardToolUse` judges it, and the
hook returns the SDK's documented `updatedInput` alongside `allow`. Reads are not rewritten
(S-2‴). Any other path is judged exactly as before, and a write to the told path with no alias
in force is denied as it always was — `.detent/state/**` is the structural floor.

**The launch seam stopped growing positionally.** `launch(inputs, artifactOut, options)`, with
`LaunchOptions { batch?, told? }` beside `LaunchBatch`. `reviewOnce` tells a draw the shared
`planReviewPath(root)` and clears it too, so a stale review from an earlier run cannot be read
back as this draw's.

**V-6, in order.** Two tests written in final form and run against the tree as it was: the
byte-identical test failed at `expected 3 to be 1` (three distinct first turns), the hook test
at `expected 'deny' to be 'allow'` (a write to the told path denied). Then the change; then
green.

## What the measurement found

Both on slices whose first turns had never been cached, through the production `reviewPlan`
and `launchInitSession` seams. `cache_creation` in thousands of tokens.

| run | slice | form | wall-clock | spend | cache_creation |
|---|---|---|---|---|---|
| A (PRDR-204) | s05 | one at a time, one path **each** | 8.0 min | $2.64 | 44 · 45 · 47 |
| C | s02 | one at a time, one path **told** | 11.4 min | $3.36 | 54 · **30.6 · 29.6** |
| D | s03 | together, one path told | 3.7 min | $2.23 | 46.4 cold · **10.6 · 24.1** warm |

**Criterion 2.** Behind one told path the second and third draws create ~24k less than the
first — the first-turn block read rather than rewritten — where behind one path each they
created the same as the first. The residual sits above run 1's 21k/17k because these were longer
sessions (`cache_read` 667k and 648k against 400k and 229k there); creation grows with turns.

**Criterion 3 — the stagger's test, deferred from PRDR-204.** The harness prints ledger rows,
and a row is written when a session RETURNS, so with three in flight the rows are in completion
order; the harness now says so. The cold draw is the 46.4k row — every cold first draw across
seven runs today created 44–54k — and the two that launched three seconds after its first
answer created 10.6k and 24.1k: they read what it wrote. C-4⁗‴'s wait on the first `assistant`
message is long enough.

**Also settled in passing:** the SDK in use (0.3.258) honours `updatedInput` live. Every draw in
both runs came back with a verdict, which it can only do if the write the session aimed at the
told path landed at its own file.

Spend for the two runs: $5.59.
