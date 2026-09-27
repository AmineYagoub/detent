---
id: PRDR-298
title: "The redesign leaves behind code whose job has moved or never started: planning research whose answers no phase reads, the question machinery DECIDE replaces, setup-consent code only a test imports, and doc-blocks that describe a spend gate PRDR-265 removed. Each is deleted with its tests, and every stale doc-block the planning audit names is corrected"
state: OPEN
severity: normal
category: capability
labels: ["prd-review", "planning-redesign", "operator-decision", "deletion", "doc-claim-drift"]
surface: ["src/init/plan-research.ts", "src/init/questions.ts", "src/init/consent.ts", "src/init/allowlist.ts", "src/init/pipeline.ts", "src/init/session.ts", "src/init/launch-batch.ts", "src/init/retry.ts", "src/init/symbol-reminder.ts", "src/init/contracts.ts", "src/init/present.ts", "src/init/plan-slices.ts", "src/init/plan-write.ts", "tests/init/"]
prd_refs: ["C-3a", "C-3‴", "X-1⁵", "PRDR-207", "PRDR-262", "PRDR-264", "PRDR-265", "PRDR-278", "PRDR-281"]
acceptance_criteria: ["Planning research is gone from `init`'s planning phases. AUDIT (PRDR-281) reuses its engine and the brief format of PRDR-262/264, and no planning phase launches a research session.", "`questions.ts`, PRESENT's question merge and renumbering, and PLAN's question inputs are gone; DECIDE owns questions.", "`consent.ts`, `allowlist.ts`, `bootstrapBlocks` and `planPath` are gone, with the tests that were their only callers.", "Every stale doc-block the audit names is corrected: the spend-gate wording in `session.ts`, `launch-batch.ts` and `plan-slices.ts`; `retry.ts:2`; `symbol-reminder.ts:55`; `contracts.ts:19`; `present.ts:49`.", "The ticket records `src/init`'s line counts before and after."]
non_goals: ["Does NOT delete the research role; `run` still uses it.", "Does NOT touch AWAIT_SETUP_CONSENT, which `bind.ts` still raises."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-262", "PRDR-264", "PRDR-265"]
depends_on: ["PRDR-290", "PRDR-291", "PRDR-292", "PRDR-293", "PRDR-294", "PRDR-295", "PRDR-296"]
---

# PRDR-298 — delete what the redesign replaces

## Where this came from

The planning audit of 2026-09-26, §5:
- research answers are never read by SLICE, PLAN or PRESENT;
- `consent.ts` and `allowlist.ts` are imported only by `tests/init/backhalf.test.ts`;
- the spend-gate wording in `session.ts:343`, `launch-batch.ts:11-15` and `plan-slices.ts:490`
  predates PRDR-265, after which nothing refuses a launch.

## Problem

Code that no longer does its job still has to be read, tested and kept consistent. September's
patches kept most of what they replaced, and doc-blocks went on describing mechanisms that had
changed underneath them.

## Design

The redesign plan's §11. This lands last, after the tickets that replace each piece, so nothing is
deleted before its replacement works.

## From PRDR-281

AUDIT has its own claim checker (`src/init/audit-claims.ts`), so taking planning research out of
ANALYZE removes nothing AUDIT uses: it shares `withOneRelaunch`, the X-6a refinements in
`src/schemas/init.ts` and `EXTERNAL_TIER`, and not `plan-research.ts`. Until then each of the two
phases reports its own tool calls against `planning_research_tool_calls` (C-2¹¹).

## From PRDR-282

DECIDE and PRESENT use `similarQuestions` from `src/init/questions.ts`: DECIDE refuses a question
the log's decisions already answer, and PRESENT names each planning question the log answers
(`answeredByLog`) rather than asking it. Removing the question machinery keeps that function or
moves it; the rest of `questions.ts` is this ticket's to remove.

## From PRDR-290

ANALYZE was planning research's one caller, so since PRDR-290 no phase launches a research
session, and `src/init/plan-research.ts` has no caller in `src/`: the first criterion's second
half holds, and the file is this ticket's to delete. Its tests drive it directly: the T-063 cases
in `tests/init/stages.test.ts`, `research-batch.test.ts`, `research-contract.test.ts`,
`research-share.test.ts` and the planning half of `tests/kernel/x1-counting.test.ts`. X-1's site
map names `init/audit` for `planning_research_tool_calls`. SLICE no longer takes `open_questions`;
PLAN's drafts still do, from the slices before them.

## From PRDR-292

No planning stage asks (C-3⁗, C-4⁷). SLICE's slicing and PLAN's draft have no `questions`, and one
carrying any is refused. `openQuestionsInput` and `openQuestionsInstruction` are gone from
`src/init/questions.ts`, and no planning session is handed open questions. What is left has
nothing to feed it:
- PRESENT still gathers SLICE's and PLAN's `questions` outputs, renumbers and merges them
  (`mergeSimilar`), and renders them with `answerInstruction`.
- `questions.ts` keeps `mergeSimilar`, and `similarQuestions`, which DECIDE uses.

Deleting what planning no longer feeds is this ticket's second criterion.
