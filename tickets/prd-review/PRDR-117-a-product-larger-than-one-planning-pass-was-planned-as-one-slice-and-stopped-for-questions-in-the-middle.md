---
id: PRDR-117
title: "A product larger than one planning pass was planned as one slice: `init` produced twenty-seven tickets for a product sized at five hundred, stopped at ANALYZE for questions, and inherited the documents' silence on production hardening"
state: DONE
severity: major
category: capability
labels: ["prd-review", "found-by-execution"]
surface: ["src/init/slice.ts", "src/init/baseline.ts", "src/init/plan.ts", "src/init/plan-slices.ts", "src/init/plan-whole.ts", "src/init/plan-write.ts", "src/init/plan-review.ts", "src/init/present.ts", "src/init/analyze.ts", "src/init/pipeline.ts", "src/init/machine.ts", "src/init/config.ts", "src/cli/init.ts", "src/schemas/init.ts", "src/schemas/records.ts", "src/kernel/worstcase.ts", "prompts/planner.md", "skills/init/SKILL.md", "README.md", "detent-prd-v3.md"]
prd_refs: ["C-2", "C-3", "C-4", "C-5", "C-8", "D-24", "A-1"]
acceptance_criteria: ["A SLICE phase between DETERMINE_VERIFICATION and PLAN cuts the whole document set into ordered increments, walking skeleton first, every requirement id placed in exactly one slice, and the pipeline's phase list and the init skill say so.", "PLAN plans every slice in turn without stopping: each slice is drafted with the earlier slices' ticket index in view, reviewed as its own plan, revised once, and cached keyed by everything it read, so an edited document re-plans only its slice while `--replan` re-plans all of them.", "When every slice is planned, a fresh session reviews the whole plan under a tag set that gains `coherence`; a `changes` verdict redrafts only the slices its findings name, keeping the ids later slices depend on; a second review's remaining findings reach the presentation.", "The written plan enforces slice order: a ticket with no edge of its own into the slice it thickens is blocked on that slice's capstones; `plan.json` records the slices.", "Every question from ANALYZE, SLICE and each slice's PLAN carries an assumption and is presented once, with the plan, at PRESENT; `AWAIT_INFO` is raised there and only for a blocking question; the interrupt set stays at five.", "A production baseline is placed by SLICE and delivered by PLAN as `baseline:PB-###` tickets unless `config.plan_baseline` is `none`; the plan review accepts that provenance.", "The draft's ids and edges are normalised, not trusted: a colliding id is renamed with its slice's references following, and an edge to nothing planned is dropped as a `dependency` finding."]
non_goals: ["Does not add an interrupt. AWAIT_INFO moves; C-5's set is unchanged at five.", "Does not remove `plan_docs` (C-2″). It stays as the manual scope for a deliberate narrowing.", "Does not run slices' execution in sequence by itself — `run` already orders by blockers; this ticket makes the plan carry the order.", "Does not validate slice size or ticket count numerically (A-1 remains planning judgement); the reviewer's `sizing` tag and X-4″'s evidence keep that seat.", "Does not add a second revision round anywhere. PLAN_REVISIONS stays 1 (D-24)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-081", "PRDR-084", "PRDR-085", "PRDR-086", "PRDR-103", "PRDR-116"]
depends_on: []
---

# PRDR-117 — a product larger than one planning pass was planned as one slice

**Severity:** major · **Category:** capability · **Found by:** `detent init` on ksar-cloud,
2–3 September 2026

## What happened

ksar-cloud is a product whose documents run to dozens of files and whose owner sizes it at
more than five hundred tickets. The only way the pipeline could plan it was C-2″'s
`plan_docs`: point `init` at one slice's documents, plan, approve, run to DONE, re-point,
replan. The first pass produced a reviewed twenty-seven-ticket plan for slice one and
stopped at `AWAIT_APPROVAL`. The sequencing of the slices, the trigger for the next one,
and the coherence of the whole were the operator's to carry — and the operator's reaction
was the finding: *"27 tickets for big project like this? I expect more than 500 ticket."*

Two more things were true of that run. `ANALYZE` stopped the pipeline with `AWAIT_INFO`
for questions the analyst could have proceeded on under a stated assumption, so a plan
that takes hours to produce could not be left alone. And the plan planned what the
documents said: a PRD written about features says nothing about backups, health checks,
secrets, or rate limits, and the plan inherited that silence — a fault for a tool whose
users are, by design, not always engineers.

The user's direction, verbatim: *"the planner mission is to build the full product
implementation plan with production grade best practices … this should be autonomous and
should not stop until all slices finished, all questions for human should be asked when
the full product planned, the last step is answer question and approve the full plan …
Detent should do that layer itself … ALSO we need a step to review the plan produced and
confirm all tickets align with each other and more important all tickets align with the
product docs … Detent could be used by non tech users, so we need to make sure we plan
for production grade products even when the user ignore this hardening."*

## Evidence

The PRD names slice-by-slice planning as the workflow and gives it only a manual scope:

> **C-2″ (3.0.3, PRDR-086).** `config.plan_docs` narrows C-2 discovery to the documents
> the current increment plans from; empty (the default) keeps the full family discovery.
> Without it, planning a large product slice by slice — the workflow the README
> documents — was impossible: every replan rediscovered the whole `docs/` tree and
> re-planned the entire product.

The plan review's own argument reaches across slices and had no way to:

> D-6 held that work must be judged by something that did not do it, and every
> implementation had such a judge while the plan that determines them all had only a
> human reading a presentation — a real check at five tickets, none at three hundred.

## Resolution

Three amendments, one ticket. **C-2‴**: a `SLICE` phase and per-slice `PLAN` with a
whole-plan review (`coherence`), targeted revision, capstone blockers, per-slice caches,
and normalised ids and edges. **C-2⁗**: a fifteen-item production baseline placed by
SLICE and delivered by PLAN as `baseline:PB-###` tickets, `plan_baseline` in config.
**C-3′**: every question carries its assumption and is asked once, at PRESENT;
`AWAIT_INFO` moves there and fires only for a blocking question. The planner prompt
serves four stages. The interrupt set is unchanged. Exercised by `tests/init/slicing.test.ts`
and the existing init suites, whose fixtures now serve a one-slice product.
