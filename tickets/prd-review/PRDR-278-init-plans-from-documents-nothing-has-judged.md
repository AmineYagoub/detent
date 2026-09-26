---
id: PRDR-278
title: "`init` plans from documents nothing has judged: a contradiction, a wrong external fact or a rule that is consistent but wrong reaches a ticket as an assumption, and a session that implements it literally ships it with green gates. The operator's decision is a specification phase inside `init` (AUDIT, DECIDE, WRITE, VALIDATE), recorded in the PRD before any code"
state: OPEN
severity: major
category: decision
labels: ["prd-review", "specification-phase", "operator-decision", "C-3′", "C-5", "C-14′", "N-7", "doc-claim-drift"]
surface: ["detent-prd-v3.md", "docs/plan-specification-phase.md", "docs/release-checklist.md"]
prd_refs: ["N-6", "C-2‴", "C-3′", "C-3″", "C-4″", "C-5", "C-8", "C-8′", "C-8‴", "C-10", "C-14′", "X-4", "D-26", "N-7", "F-3", "F-4", "S-1′"]
acceptance_criteria: ["The PRD records the phase as four `init` phases between DISCOVER and ANALYZE: AUDIT, DECIDE, WRITE and VALIDATE, each with what it reads, what it writes and when it stops. v3's line for the inherited pipeline shows them in order.", "C-3′ is amended, not contradicted. Planning still never stops for a question an assumption can carry. AWAIT_INFO may now also be raised at DECIDE, on a TTY, for C-3″ (PRDR-119) questions, and at VALIDATE for a blocker left at the validation ceiling. The interrupt set stays C-5's five, and the amendment says why a sixth was refused: C-14′ makes a new decision class a major-version decision.", "The operator's nine decisions of 2026-09-26 are recorded with their reasons (the plan's §2). Decision 8 is recorded with its correction: the re-plan after an amendment covers only the affected slices, because `--replan` re-derives every slice (C-8′).", "Off a TTY, DECIDE takes every recommended answer and logs it as a vetoable default. PRESENT lists every default with C-3′'s assumptions.", "N-7 keeps `detent-prd-v3.md` as its only input and runs the phase headless. Release-checklist item 5 records the self-build's duration and spend beside the green.", "Every id the amendment adds is defined exactly once, the first rule the plan gives the pack checker."]
non_goals: ["Does NOT renumber the five ids `detent-prd-v3.md` already defines twice, as different rules (C-3″, C-9′, S-3′, V-1⁵, X-1‴). That is its own amendment; the plan cites them as evidence.", "Does NOT write code. PRDR-279 to PRDR-286 implement the phase, each after this lands (N-6).", "Does NOT settle the plan's open questions (§10): a switch to turn the phase off, the ceiling's default, the auditor's role, the model per phase, the cost. Each stays the operator's, and the amendment lists them as open."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-117", "PRDR-119", "PRDR-207", "PRDR-263", "PRDR-265"]
depends_on: []
---

# PRDR-278 — the specification phase, recorded in the PRD before any code

## Where this came from

The operator's trials of Detent on other projects kept raising one complaint: Detent keeps hitting
contradictions in the PRD. The ksarjs specification (2026-09-24 … 26) then showed what fixing the
documents before planning takes. A raw PRD became a pack of 2,024 requirements and 1,144
acceptance criteria through an audit, founder decisions, writing and seven validation rounds.
The defects it found, and what found each, are the table in `docs/plan-specification-phase.md`
§1. On 2026-09-26 the operator decided to make that work a phase of `init`. The nine decisions
are the plan's §2.

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
- VALIDATE's stop rule and ceiling (plan §7).
- The amendment path during `run`, with decision 8's correction (plan §8).
- N-7: the raw PRD stays its input, and the checklist records the added time and spend
  (plan §9).
