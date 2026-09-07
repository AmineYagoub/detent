---
id: PRDR-164
title: "presentInputsFromOutputs validates the elements of two of its four return fields; the renderer still throws on the other two"
state: OPEN
severity: major
category: defect
labels: ["prd-review", "found-by-audit"]
surface: ["src/init/present.ts", "tests/init/slicing.test.ts"]
prd_refs: ["C-8", "F-4"]
acceptance_criteria: ["Every field the builder returns is renderable, element by element, not merely an array — which is what its own comment already claims.", "The test's foreign-shape list covers element-level shapes for all four fields, and each new case is observed to throw before the fix."]
non_goals: []
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-157", "PRDR-144"]
depends_on: []
---

# PRDR-164 — "returns something renderable or nothing", for half its fields

**Severity:** major · **Category:** defect · **Found by:** the audit of `bdafdb5`

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
