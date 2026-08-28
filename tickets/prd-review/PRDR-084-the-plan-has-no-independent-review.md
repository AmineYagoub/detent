---
id: PRDR-084
title: "The plan has no independent review"
state: DONE
severity: major
category: gap
labels: ["prd-review", "user-raised"]
surface: ["src/schemas/init.ts", "src/init/plan.ts", "src/init/pipeline.ts", "prompts/planner.md"]
prd_refs: ["C-4", "A-1", "A-2", "D-6", "C-7"]
acceptance_criteria:
  - "A drafted plan is judged by a fresh planner-role session at a REVIEW_PLAN stage before tickets are written."
  - "The finding tag set is closed: sizing | testability | coverage | shape | traceability."
  - "A `changes` verdict buys exactly ONE revision, whose inputs carry the findings; findings surviving it are noted for the human at approval."
  - "An unreadable or absent review artifact leaves the draft standing, announced — the review advises, it never blocks the pipeline."
non_goals:
  - "No new role: the planner prompt already multiplexes by stage, and a new RoleId is an F-3 schema event with a migration for `role@hash` assignments."
  - "No new X-1 key: the revision ceiling is fixed at one, following D-24's argument that a second bite adds cost without information."
  - "Does not gate approval — the human still decides at AWAIT_APPROVAL; the review informs that decision."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-081", "PRDR-080"]
depends_on: []
---

# PRDR-084 — the plan has no independent review

**Severity:** major · **Category:** gap · **Found by:** the user, asking how ticket
quality is assured.

## Problem

D-6's whole argument is that work must be judged by something that did not do it:
every implementation faces a fresh reviewer, reading the diff against the criteria,
with a closed finding set and a strict artifact. The **plan** — which determines every
one of those implementations, their surfaces, their criteria and their order — faced
no such thing. Its only check was a human reading the presentation at AWAIT_APPROVAL,
which is a real check at 5 tickets, a weak one at 32, and no check at all at 300.

The asymmetry had teeth. PRDR-081 landed because a plan of 32 epic-grained tickets
reached approval unchallenged: nothing in the pipeline was positioned to say "these
do not fit their budget" or "nothing runs end-to-end until ticket twenty-two."

## Resolution

D-6, one level up. After PLAN validates its draft and before tickets are written, a
fresh session judges the draft at a new **REVIEW_PLAN** stage over a closed tag set:
`sizing` (a ticket larger than one implement session), `testability` (a criterion no
command can settle), `coverage` (a documented requirement no ticket reaches), `shape`
(no walking skeleton; layers before end-to-end), `traceability` (a ticket the documents
do not source). A `changes` verdict buys exactly one revision carrying the findings;
anything the reviewer still faults afterwards is noted for the human at approval rather
than ground on — the same reasoning D-24 gives for the ladder's ceilings.

No new role: the planner prompt already serves multiple stages and a new `RoleId` is an
F-3 schema event with a migration, which this does not warrant. The review advises and
never blocks: an absent or unparseable verdict leaves the draft standing, announced.
