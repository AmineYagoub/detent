---
id: PRDR-291
title: "SLICE asks a model to re-derive the pack's structure from prose, then keys every slice by that model's own words: the same documents drew estimates of 308 and 554 tickets, 1 of 24 slice titles survived between two runs, and a single edit likely re-plans every slice. SLICE is seeded by code from milestones and module codes, a slice is its requirement ids, and an edited requirement re-plans only its own slice"
state: OPEN
severity: major
category: capability
labels: ["prd-review", "planning-redesign", "operator-decision", "C-8‴", "reproducibility"]
surface: ["src/init/slice.ts", "src/init/plan-slices.ts", "src/init/pipeline.ts", "src/schemas/init.ts", "prompts/slice.md", "prompts/manifest.json", "tests/init/slice-seed.test.ts", "tests/init/plan-cache.test.ts"]
prd_refs: ["C-2‴", "C-2⁵", "C-8", "C-8′", "C-8‴", "F-4", "PRDR-117", "PRDR-118", "PRDR-278", "PRDR-280"]
acceptance_criteria: ["Code builds the seed from the checker's parse: requirement ids grouped by milestone, then by module code, with each group's criteria count.", "One slice session orders and groups the seed. Code refuses its artifact unless every requirement id lands in exactly one slice, the slices respect milestone order, and no slice names an id the pack does not define. A refusal gets the one relaunch every strict artifact gets.", "A slice's cache key is its sorted requirement ids, the content hash of each requirement with its criteria and the decisions, facts and catalogue entries it cites, the stack, the bindings, the session budget and the prompt hash (C-2⁸, PRDR-278). The slice's title and goal are not in it. A test edits one requirement's text and asserts that only its slice re-plans, and every other slice's cache is reused.", "SLICE is reused while the pack's set of requirement ids and milestones is unchanged, and its other inputs (the baseline, the band, the prompt) are too; the criteria counts guide the grouping and do not key it (C-2⁸). An added requirement is placed by a slice session that may only add, to an existing slice or a new one, and existing slices keep their ids and members. A removed requirement re-plans its slice. Tests cover both.", "The slicer estimates no ticket count. The announcement states the session formula for the slice count (the redesign plan's §10).", "`tests/init/plan-cache.test.ts` no longer holds SLICE's output constant to pass: its reuse test drives a real re-slice."]
non_goals: ["Does NOT make the walking skeleton a rule: which increment goes first stays the model's judgement.", "Does NOT change `--replan` (C-8′); it still re-derives every slice."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-117", "PRDR-118", "PRDR-286"]
depends_on: ["PRDR-278", "PRDR-280"]
---

# PRDR-291 — SLICE seeded by the pack, keyed by requirement ids

## Where this came from

The planning audit of 2026-09-26:
- SLICE's estimate for identical documents was 554 tickets on 5 Sep and 308 on 16 Sep;
- 1 of 24 slice titles matched between runs 4 and 6;
- the walking-skeleton slice produced between 19 and 41 tickets across six runs.

## Problem

`sliceKey` hashes the whole slice object, the model's prose included
(`src/init/plan-slices.ts:156-162`), and any document edit re-runs SLICE
(`src/init/pipeline.ts:271-282`). Unless SLICE writes byte-identical JSON again, every slice misses
its cache. Yet `present.ts` tells the operator that only the slices whose inputs changed are
re-planned. The cache test passes because it holds SLICE's output constant.

The specification phase's scoped re-plan (PRDR-286) needs this to work.

## Design

The redesign plan's §4. With a pack, the structure SLICE re-derived from prose is already data:
requirement ids, milestones and module codes. Code builds the seed, the model makes the one
judgement code cannot, and identity rests on the ids.
