---
id: PRDR-103
title: "AWAIT_INFO tells the operator to answer in the planning documents without saying what DISCOVER will accept as one"
state: READY
severity: minor
category: usability
labels: ["prd-review", "found-by-execution"]
surface: ["src/init/machine.ts", "src/init/discover.ts"]
prd_refs: ["C-3", "C-3a", "C-8"]
acceptance_criteria: ["An operator who answers an AWAIT_INFO question can tell, from the message alone, where to put the answer so the next init reads it.", "A re-run that discovers no new document does not silently re-ask the same question as though nothing had been tried — it says the document set is unchanged.", "The discovery patterns are already recorded in DISCOVER.json; the message should reuse them rather than restate a second, drifting copy."]
non_goals: ["Does not widen the discovery patterns. Discovering every markdown file in a repository would sweep in changelogs and notes; the pattern set is deliberate.", "Does not change C-3's batching or the question itself, both of which behaved correctly — the planner refused to invent a missing contract and asked once."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-101"]
depends_on: []
---

# PRDR-103 — AWAIT_INFO does not say what counts as a planning document

**Severity:** minor · **Category:** usability · **Found by:** answering an AWAIT_INFO
question during the PRDR-101 replan

## Problem

`init` halted correctly at AWAIT_INFO: the PRD sets acceptance criteria of the form *"the
oracle `<X>` test ports green"* against a Python reference implementation that is not in
the repository, and the planner asked for it rather than inventing it (C-3a working).

The instruction it printed was:

> Answer them in the planning documents and re-run `detent init`.

Following that literally — writing `planning-answers.md` at the repository root — changed
nothing. DISCOVER searches `PRD*.md`, `*prd*.md`, `SRS*.md`, `README*.md`,
`REQUIREMENTS*.md`, `SPEC*.md`, `docs/**/*.md` and three more; `planning-answers.md`
matches none of them. The document was never read, ANALYZE re-derived the same analysis,
and the identical question came back with no indication that the answer had been missed.

The cost is a full ANALYZE round per wrong guess, and the operator has nothing to learn
from: the failure is indistinguishable from an answer the planner judged inadequate.

## What is already there

`DISCOVER.json` records `patterns_searched` verbatim. The information the message needs
exists one phase earlier and is simply not carried into it — so this is a plumbing gap,
not a design question. The same shape as PRDR-101: an instruction issued with no way for
the reader to comply and no signal when they fail to.
