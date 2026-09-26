---
id: PRDR-278
title: "`init` plans from documents nothing has judged: a contradiction, a wrong external fact or a rule that is consistent but wrong reaches a ticket as an assumption, and a session that implements it literally ships it with green gates. The operator's decisions: a specification phase inside `init` (AUDIT, DECIDE, WRITE, VALIDATE), and a planning phase rebuilt on the pack it produces, recorded in one PRD amendment before any code"
state: OPEN
severity: major
category: decision
labels: ["prd-review", "specification-phase", "planning-redesign", "operator-decision", "C-3′", "C-5", "C-14′", "D-5", "D-10", "N-7", "doc-claim-drift"]
surface: ["detent-prd-v3.md", "docs/plan-specification-phase.md", "docs/plan-planning-redesign.md", "docs/planning-phase-audit-2026-09-26.md", "docs/release-checklist.md"]
prd_refs: ["N-6", "C-2‴", "C-3′", "C-3″", "C-3‴", "C-4″", "C-5", "C-8", "C-8′", "C-8‴", "C-10", "C-14′", "X-4", "D-5", "D-10", "D-26", "V-5", "NG2", "OQ-4", "N-7", "F-3", "F-4", "S-1", "S-1′", "X-3"]
acceptance_criteria: ["The PRD records the phase as four `init` phases between DISCOVER and DETERMINE_VERIFICATION: AUDIT, DECIDE, WRITE and VALIDATE, each with what it reads, what it writes and when it stops. v3's line for the inherited pipeline shows them in order.", "C-3′ is amended, not contradicted. Planning still never stops for a question an assumption can carry. AWAIT_INFO may now also be raised at DECIDE, on a TTY, for C-3″ (PRDR-119) questions, and at VALIDATE for a blocker left at the validation ceiling. The interrupt set stays C-5's five, and the amendment says why a sixth was refused: C-14′ makes a new decision class a major-version decision.", "The operator's thirteen decisions of 2026-09-26 are recorded with their reasons (the plan's §2). Decision 8 is recorded with its correction: the re-plan after an amendment covers only the affected slices, because `--replan` re-derives every slice (C-8′).", "X-3 is amended: PREMISE_FALSIFIED is admitted from BLIND_FIX, INFORMED_FIX and REVIEW_FIX with IN_PROGRESS's outcome, so a fix session may declare a false premise and file an amendment (decision 12, PRDR-289). No state or event is added.", "S-1 gains two roles, `audit` (decision 11) and `plan_review` (the redesign), in one F-3 `schema_version` event with a migration for `role@hash` assignments.", "There is no switch that skips the phase (decision 10), and `spec_validation_rounds` defaults to 8 (decision 13).", "Off a TTY, DECIDE takes every recommended answer and logs it as a vetoable default. PRESENT lists every default with C-3′'s assumptions.", "N-7 keeps `detent-prd-v3.md` as its only input and runs the phase headless. Release-checklist item 5 records the self-build's duration and spend beside the green.", "The PRD records the planning redesign of `docs/plan-planning-redesign.md`: ANALYZE folded into DECIDE, with D-10's order naming DECIDE; SLICE seeded by the pack and keyed by requirement ids; PLAN drafted from pack records, with `criterion_ids` and `spec_defects` in place of questions, which amends C-3‴ (PRDR-207): no planning stage asks, so DECIDE's decision log is what keeps a question to one asking; mechanical checks that drive one targeted redraft and block approval when they still fail; one review read by a `plan_review` role; gates bound per package, which amends D-5, V-5 and NG2 and closes OQ-4; the explicit approval of a plan more than one Detent build produced (that plan's decision 8); and PRESENT as that plan's §9 describes.", "The PRD states the rule the operator chose on 2026-09-26: a planning mechanism that claims to improve plans names the run-time outcome it should move, and reviewer finding counts are not an outcome.", "Every id the amendment adds is defined exactly once, the first rule the plan gives the pack checker, and in a shape `tests/docs/prd-requirement-ids.test.ts` (PRDR-287) parses, so that test fails the PRD otherwise."]
non_goals: ["Does NOT renumber PRD marks. PRDR-287 and PRDR-288 did: nine marks each named more than one rule, and ten definitions moved. The plan cites them as the evidence for the checker's first rule.", "Does NOT write code. PRDR-279 to PRDR-286 implement the phase, each after this lands (N-6).", "Does NOT settle what both plans still leave open: the model and effort per phase and for the plan reviewer, the cost, and whether a model re-reads the cross-slice contracts. Each stays the operator's, and the amendment lists them as open."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-117", "PRDR-119", "PRDR-207", "PRDR-263", "PRDR-287", "PRDR-288", "PRDR-289", "PRDR-265", "PRDR-290", "PRDR-291", "PRDR-292", "PRDR-293", "PRDR-294", "PRDR-295", "PRDR-296", "PRDR-297", "PRDR-298"]
depends_on: []
---

# PRDR-278 — the specification phase, recorded in the PRD before any code

## Where this came from

The operator's trials of Detent on other projects kept raising one complaint: Detent keeps hitting
contradictions in the PRD. The ksarjs specification (2026-09-24 … 26) then showed what fixing the
documents before planning takes. A raw PRD became a pack of 2,024 requirements and 1,144
acceptance criteria through an audit, founder decisions, writing and seven validation rounds.
The defects it found, and what found each, are the table in `docs/plan-specification-phase.md`
§1. On 2026-09-26 the operator decided to make that work a phase of `init`. The thirteen
decisions are the plan's §2; the last four settled its open questions later that day.

## Problem

Nothing in `init` judges the documents. ANALYZE records an assumption where they are silent or
disagree (C-3″, PRDR-119), SLICE and PLAN work from them, and C-4″'s review judges the plan
against them. A rule that is wrong but consistent survives all of it. The implement session
builds it, the tests are written from the same criteria, and review approves. This is the
doc-claim drift PRDR-263 names, one level up, where no test can see it.

N-6 forbids building the phase before the PRD says so. The phase changes C-3′'s central sentence,
"Planning does not stop for a question". It also adds phases to the pipeline v3 inherits from v2
§4.1, and raises AWAIT_INFO in two new places.

## What the amendment records

- The four phases, and the pipeline with them (plan §3).
- C-3′ amended: AWAIT_INFO at DECIDE and at VALIDATE's ceiling. The five interrupts are unchanged,
  and the amendment says why (C-5, C-14′).
- The pack, its precedence and its conformance record (plan §4), and the checker as a referee
  gate (plan §5).
- Vetoable defaults, and the defaults taken off a TTY (plan §6).
- VALIDATE's stop rule and ceiling, 8 rounds by default (plan §7, decision 13).
- The amendment path during `run`, with decision 8's correction (plan §8). Fix sessions may file
  too, so X-3's table gains a PREMISE_FALSIFIED row from each fix state (decision 12, PRDR-289).
- The `audit` role, added with the redesign's `plan_review` in one F-3 event (decision 11), and no
  switch that skips the phase (decision 10).
- N-7: the raw PRD stays its input, and the checklist records the added time and spend
  (plan §9).

## The planning redesign, in the same amendment

On 2026-09-26 an audit of the planning phase (`docs/planning-phase-audit-2026-09-26.md`) found that
September's 79 planning tickets mostly measured the planner rather than improved it. ksar-cloud's
approved plan was never reviewed as a whole, kept 34 defects that code had proved, and spent 78% of
its planning on a review that never approved. The operator decided to rebuild planning on the pack,
in this amendment (`docs/plan-planning-redesign.md`, PRDR-290 to PRDR-298). The amendment records:
- ANALYZE folded into DECIDE, and D-10 amended to match;
- SLICE, PLAN, the mechanical checks, the single review and PRESENT as that plan describes;
- C-3‴ (PRDR-207) amended to match: no planning stage asks, so DECIDE's decision log is what keeps
  a question to one asking;
- gates per package, which amends D-5, V-5 and NG2 and closes OQ-4;
- the explicit approval of a plan more than one Detent build produced (that plan's decision 8);
- the rule that run-time outcomes, not reviewer findings, decide which planning mechanisms stay.
