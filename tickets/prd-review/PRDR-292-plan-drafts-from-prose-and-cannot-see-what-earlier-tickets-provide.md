---
id: PRDR-292
title: "PLAN drafts from prose it must re-read, cannot see what earlier tickets provide (56 of 60 drafting sessions dug through Detent's state files for it), and one 1,826-word prompt for four jobs tells it to ask questions the pack has already settled. PLAN is drafted from the pack's records: tickets carry `criterion_ids`, contracts use catalogue ids, the drafter reports only spec defects, each job gets its own prompt, and planner sessions lose Bash"
state: OPEN
severity: major
category: capability
labels: ["prd-review", "planning-redesign", "operator-decision", "A-1", "prompts", "traceability"]
surface: ["src/init/plan.ts", "src/init/plan-slices.ts", "src/init/plan-write.ts", "src/init/session.ts", "src/schemas/init.ts", "src/schemas/ticket.ts", "prompts/planner.md", "prompts/plan.md", "prompts/manifest.json", "tests/init/plan-inputs.test.ts"]
prd_refs: ["A-1", "A-1‴", "A-2", "C-2⁗", "C-3′", "F-3", "S-1′", "PRDR-120", "PRDR-278", "PRDR-279", "PRDR-286"]
acceptance_criteria: ["A PLAN session's inputs come from the checker's parse of the slice's records: each requirement's id, milestone and text; its criteria, with ids and Given / When / Then; and the decisions, facts and catalogue entries it cites. With them come the slice's baseline items, the stack, the bindings, the session budget, X-4″'s `sizing_evidence` (C-4⁵, PRDR-278), and a compact index of the tickets in the slices it depends on: id, title, surface, and `provides` as `kind:id`. `analysis` and document paths are not among them.", "The draft schema and the A-1 ticket gain `criterion_ids`. Each pack criterion a ticket carries appears verbatim among its acceptance criteria. A test drafts a ticket that paraphrases one, and asserts that it is refused.", "For every kind a catalogue covers, catalogue ids are the canonical names in `provides` and `consumes`. A name of such a kind that is not in the catalogue is a contract failure (PRDR-293).", "The draft has no `questions`. It has `spec_defects`, each quoting, with ids, the pack passages that contradict each other or the gap. A spec defect found while planning takes the specification phase's amendment path before approval (PRDR-286), and PRESENT refuses approval while one is open.", "`prompts/planner.md` is replaced by `prompts/slice.md` and `prompts/plan.md`; the review prompt is PRDR-294's. No prompt a model reads cites a Detent PRD id. Every rule in them is enforced by code or stated as a judgement the reviewer makes, and the ticket lists which is which.", "Planner sessions get Read, Grep, Glob and their artifact write, and neither Bash nor subagents. A test launches one and asserts the tool list. They never read `archive/`: discovery keeps the originals out of their inputs (PRDR-279), and their tools must not reach them either.", "The persisted draft and ticket shapes change under F-3, with their migration."]
non_goals: ["Does NOT anchor ticket counts to a number. Sizing is judged by the reviewer (PRDR-294) and measured at run time (PRDR-297).", "Does NOT let a drafter ask the founder anything. What the pack does not settle is a spec defect, and the amendment path owns it."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-120", "PRDR-271", "PRDR-286"]
depends_on: ["PRDR-291"]
---

# PRDR-292 — PLAN drafted from pack records

## Where this came from

The planning audit of 2026-09-26, §5 and §6.
- `plan_index` carries id, slice, title and surface (`src/init/plan.ts:229`). What earlier tickets
  provide is missing, so 56 of 60 drafting sessions read `.detent/state/plan/*.json` to recover it,
  in 892 tool calls.
- The prompt serves four stages, contradicts the code in four places, and cites Detent PRD ids no
  input defines.
- Of 6,117 tool calls, 1,104 errored or were denied, and read-only Bash ran 2,846 times.

## Problem

The drafter re-derives from prose what a pack states as data, guesses the names other tickets own,
and is told to ask questions. After the specification phase, the founder has already answered them,
and anything the pack leaves unsettled is a defect in the pack, not a question for planning.

## Design

The redesign plan's §5. Criteria copied verbatim give PRDR-293's coverage check something to
count, and the run phase something to test. Catalogue ids give contracts one spelling. A spec defect
is routed like any other amendment.
