---
id: PRDR-207
title: "The question batch dedups on exact text, so a founder question asked at ANALYZE and asked again at PLAN reaches the human twice, each with its own paid assumption — gate-313's q-analyze-1 and s14-q2"
state: OPEN
severity: minor
category: defect
labels: ["prd-review", "questions", "present", "init", "C-3′"]
surface: ["src/init/present.ts", "src/init/plan.ts", "src/init/plan-slices.ts", "prompts/planner.md", "tests/init/present.test.ts", "tests/init/plan-quality.test.ts"]
prd_refs: ["C-3′", "C-3a", "C-8", "S-6", "V-6", "N-6", "PRDR-117", "PRDR-119", "PRDR-166"]
acceptance_criteria: ["PLAN and SLICE are handed the questions already raised — `open_questions`: id, text and the assumption — and told that a question already in it is not asked again; a session that needs a different assumption records the difference in the ticket's `description` instead of re-asking. gate-313's `s14-q2` is the fixture: a scripted planner that would re-ask it, given the batch, does not (V-6: observed re-asking first).", "PRESENT merges near-duplicates as a backstop: two questions whose normalised token sets overlap at or above a stated threshold render as ONE, carrying both ids and both stages, so the human answers once. gate-313's two texts merge; two genuinely different questions sharing vocabulary do not — both fixtures pinned.", "An unchanged root still reuses every slice cache (C-8): the batch handed to PLAN is part of the slice's inputs only when it is non-empty, and a resumed root with no questions produces byte-identical prompts to today's — asserted on the fixture that already pins reuse."]
non_goals: ["Does not answer questions or change what a question IS (C-3′): the founder-owned facts still go to the human, once.", "Does not dedup across RUNS — a question answered in a planning document is C-8's business and PRDR-166's instruction.", "Does not touch the id-collision rule PRDR-119 added; that stays."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-117", "PRDR-119", "PRDR-166"]
depends_on: []
---

# PRDR-207 — one question, two stages, two assumptions, two answers

**Severity:** minor · **Category:** defect · **Found by:** reading gate-313's open questions

## Problem

C-3′ batches every stage's questions once, at PRESENT. The batch dedups on exact text
(`present.ts`: `key = q.question.trim().toLowerCase()`), and a slice dedups its own draft's
questions against its redraft's the same way. Nothing dedups across STAGES by meaning, and no
stage is told what an earlier one asked: the planner prompt requires ids unique "across
everything you write in this session" — this session.

gate-313 asked the founder four questions. Two of them are one question:

> **q-analyze-1:** Which npm identity publishes Detent, and which repository hosts the Claude Code
> plugin marketplace entry? …

> **s14-q2:** Which npm identity publishes the headless driver, and which repository hosts the
> marketplace listing? …

Each came with its own paid assumption, written by a different session, and both proceed on the
same one. The human is asked twice, and if they answer in a planning document the next `init`
resolves both — or, if the two assumptions had drifted, neither cleanly.

## The shape

Two remedies, in the order they pay:

1. **Don't ask twice.** PLAN and SLICE receive `open_questions` — what ANALYZE (and the slices
   before this one) already raised, with the assumption each proceeds on. A slice that needs a
   different assumption says so in the ticket's `description`, which is where C-3′ already puts
   decisions. This is where the duplicate is created, so it is where it is prevented.
2. **Merge what slipped through.** At PRESENT, questions whose normalised token sets overlap at
   or above a threshold render as one entry carrying both ids and stages. A backstop, pinned on
   gate-313's pair and on a pair that must NOT merge.

The first changes the planner's inputs, so C-8 has to be respected: the batch joins a slice's
inputs only when non-empty, and a root with no questions produces today's bytes exactly — the
S-6 prefix is untouched either way.
