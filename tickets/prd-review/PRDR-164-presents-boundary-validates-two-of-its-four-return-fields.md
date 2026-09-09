---
id: PRDR-164
title: "presentInputsFromOutputs validates the elements of two of its four return fields; the renderer still throws on the other two"
state: DONE
severity: major
category: defect
labels: ["prd-review", "found-by-audit"]
surface: ["src/init/present.ts", "tests/init/slicing.test.ts"]
prd_refs: ["C-8", "F-4"]
acceptance_criteria: ["Every field the builder returns is renderable, element by element, not merely an array — which is what its own comment already claims. That is FIVE fields, not four: `gateNotices` was added by PRDR-163 in the same commit.", "The foreign-shape list covers element-level shapes for every field. Two of the four cases added for this ticket (`review_findings: [{}, \"a string\"]` and `derived_edges: [{consumer}]`) pass against the unfixed code and are over-correction guards, not reproductions — labelled as such rather than counted as evidence (V-6)."]
non_goals: []
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-157", "PRDR-144"]
depends_on: []
---

# PRDR-164 — "returns something renderable or nothing", for half its fields

**Severity:** major · **Category:** defect · **Found by:** the audit of `bdafdb5`

> **PRDR-165 correction.** This ticket's second acceptance criterion claimed every new case was
> observed to throw before the fix. Two of the four were not — they pass against the unfixed
> builder and guard against over-correction instead. The criterion above now says so. The field
> count was also wrong: the builder returns five fields, and the fifth was added by the sibling
> ticket in the same commit.

## Problem

PRDR-157 added `isQuestion` and `isSlice` element filters and a comment reading "The builder is the
boundary; it returns something renderable or nothing." `findings` and `derivedEdges` get only an
`Array.isArray` check on the container; their elements are unvalidated and the renderer
dereferences them:

```
review_findings: [null] -> renderPresentation THREW: Cannot read properties of null (reading 'tag')
derived_edges:   [null] -> renderPresentation THREW: Cannot read properties of null (reading 'consumer')
```

`src/init/symbol-reminder.ts` iterates the same array and would throw too. The threat model is
PRDR-157's own — a checkpoint an older build wrote, where every value is `unknown` — and the
foreign-shape list shows the author had element shapes in mind for questions
(`open_questions: [null]`, `[{}]`) and stopped at container type for the other two.
