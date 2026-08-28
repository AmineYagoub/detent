---
id: PRDR-087
title: "A stale approval re-derives the plan — you approve one you never saw"
state: DONE
severity: major
category: correctness
labels: ["prd-review", "found-by-execution"]
surface: ["src/init/machine.ts"]
prd_refs: ["C-7", "C-8", "C-4", "P1"]
acceptance_criteria:
  - "A stale approval forces PRESENT to re-execute and nothing earlier; ANALYZE and PLAN are reused from their checkpoints."
  - "No planner session runs while re-presenting — a re-presentation costs nothing and changes nothing."
  - "`--replan` still re-derives from ANALYZE; the two forced-replay entry points share one mechanism."
non_goals:
  - "Does not change what makes an approval stale (the plan hash), nor C-7's dual exit."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-085"]
depends_on: []
---

# PRDR-087 — a stale approval re-derives the plan you never saw

**Severity:** major · **Category:** correctness · **Found by:** approving a freshly
replanned project and watching a different plan come back.

## Problem

C-7's approval gate rests on one property: **you approve the plan you were shown.**
`runInit` broke it. A stale approval — which is exactly the state a `--replan` leaves
behind, since the new tickets no longer match the old approval's hash — set the replay
flag before the loop began:

    let replaying = approval.approved && approval.stale;

`replaying` starts the loop at phase one, so every phase re-executed: ANALYZE and PLAN
included. Planning is a model act and therefore nondeterministic, so the plan that
reached PRESENT was a NEW plan, and the approval recorded consent to tickets the human
had never read. Observed directly: an eleven-ticket plan was reviewed and presented,
`--approve` was relayed, and fourteen different tickets were approved — at the cost of
two extra model sessions nobody asked for.

The code's own comment said what it meant to do: *"Hand-edited tickets invalidate the
approval; PRESENT re-presents the diff."* Re-present. Not re-plan.

## Resolution

Forced re-execution names its entry phase instead of tripping a boolean at phase one.
A stale approval forces **PRESENT** alone — the presentation is what went stale — and
the planning phases are reused from checkpoints whose digests are fresh. `--replan`
keeps its own entry point (ANALYZE, PRDR-085), and both now flow through one
`forceFrom` phase so the two cannot drift apart. Re-presenting costs nothing and
derives nothing; the plan you approve is the plan you read.
