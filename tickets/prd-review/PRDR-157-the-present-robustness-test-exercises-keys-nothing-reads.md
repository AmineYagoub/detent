---
id: PRDR-157
title: "PRESENT's robustness test feeds six foreign shapes to keys the code never reads, and the one shape it passes throws in the renderer"
state: OPEN
severity: major
category: weak-test
labels: ["prd-review", "found-by-audit", "vacuous-test"]
surface: ["tests/init/slicing.test.ts", "src/init/present.ts"]
prd_refs: ["C-8", "V-6"]
acceptance_criteria: ["The foreign shapes the test feeds reach the keys `presentInputsFromOutputs` actually reads, so each case exercises the code path its name claims.", "The end of the pipeline the test's own comment names — rendering — is included, because a builder that returns a value the renderer then dies on has not survived anything.", "Each case is observed to FAIL before the robustness fix and pass after (V-6). A case that was already green before the commit that introduced it is labelled as a guard, not presented as a reproduction."]
non_goals: ["Does not add schema validation of checkpoint outputs. The narrower fix is that the two functions tolerate a shape they can be handed; a validating read is a larger change with its own C-8 reuse consequences."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-144", "PRDR-150"]
depends_on: []
---

# PRDR-157 — six foreign shapes, five of them inert

**Severity:** major · **Category:** weak-test · **Found by:** the audit of `19d68f7`

## Problem

`tests/init/slicing.test.ts` feeds `presentInputsFromOutputs` six malformed checkpoint shapes and
asserts `.not.toThrow()`. The commit says the function "now faces six foreign shapes".

The case carrying the wrong-type payload is `{ ANALYZE: { questions: "not an array" } }`.
`src/init/present.ts` never reads `ANALYZE.questions` — it reads `ANALYZE.open_questions`,
`SLICE.questions` and `PLAN.questions`. The case is structurally equivalent to `{}`.

The real keys do throw:

```
OK    {ANALYZE:{questions:'not an array'}}       -> questions=[]   <- the test's case
THROW {ANALYZE:{open_questions:'not an array'}}  -> Cannot read properties of undefined ('trim')
THROW {SLICE:{questions:'not an array'}}         -> Cannot read properties of undefined ('trim')
THROW {PLAN:{questions:'not an array'}}          -> Cannot read properties of undefined ('trim')
THROW {ANALYZE:{open_questions:[null]}}          -> Cannot read properties of null ('question')
```

`list()` returns the raw value when it is non-nullish, so a string is spread into characters and
`q.question.trim()` dereferences `undefined`. The test is one key away from the family that
actually breaks the function, and lands on the one that cannot.

Second half: `src/init/present.ts` is not in the commit at all — the function is byte-identical
before and after, so all six cases necessarily passed beforehand. That is legitimate as a guard,
but nothing in the test says so, and the commit presents it as coverage newly earned.

Third half, and the sharpest: the test's own doc comment names the hazard as "a checkpoint from an
older build reaches PRESENT unvalidated and throws inside rendering". Case 4,
`{ PLAN: { plan: { slices: "not an array" } } }`, passes the builder — and the value it returns
then throws in the renderer, because `renderPresentation` does `input.slices.length > 1` (true for
a 12-character string) and then iterates its characters. The test stops one call short of the
exact failure its comment describes.
