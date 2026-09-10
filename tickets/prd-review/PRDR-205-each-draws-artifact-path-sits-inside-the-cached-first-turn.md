---
id: PRDR-205
title: "Since PRDR-203 each draw's artifact path sits inside the cached first turn, so the second and third draws write the block the first already wrote — about 25k tokens, $0.45, a draw"
state: OPEN
severity: minor
category: defect
labels: ["prd-review", "cost", "prompt-cache", "review-sampling", "init"]
surface: ["src/init/session.ts", "src/init/plan-review.ts", "src/sessions/backend.ts", "src/sessions/sdk.ts", "src/sessions/guard.ts", "tests/init/plan-critic-sampling.test.ts", "scripts/null-review.ts"]
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
