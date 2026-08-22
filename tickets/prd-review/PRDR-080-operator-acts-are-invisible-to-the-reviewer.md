---
id: PRDR-080
title: "Operator acts are invisible to the reviewer — sanctioned work reads as scope creep"
state: DONE
severity: minor
category: consistency
labels: ["prd-review", "found-by-execution"]
surface: ["src/kernel/stages/review.ts", "prompts/review.md"]
prd_refs: ["SEC-3", "D-6", "C-12", "X-8"]
acceptance_criteria:
  - "The reviewer receives the ticket's recent kernel/human note trail (operator_record) beside the diff."
  - "The review prompt states that a recorded surface grant makes the granted file in-scope and that requeue guidance names the generation's sanctioned work."
  - "The closed input set stays closed — operator_record joins REVIEWER_INPUT_KEYS and the set test enforces exactly the widened set."
non_goals:
  - "Worker sessions still cannot author notes; the record stays kernel/plumbing-written, so a session cannot sanction its own scope."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-073", "PRDR-069"]
depends_on: []
---

# PRDR-080 — operator acts are invisible to the reviewer

**Severity:** minor · **Category:** consistency · **Found by:** the v3.0.1
release gate — an operator-granted cross-surface fix flagged as scope creep.

## Problem

A blocked worker diagnosed a foreign ticket's brittle test, the operator
granted the file into its surface (the SEC-3 lever's act, recorded as a
ticket note), and the fix landed — then review flagged the granted file as
"scope: not traceable to this ticket's criteria". Correctly, by its inputs:
grants, requeue guidance, and claim breaks all live in ticket notes, and the
reviewer sees ticket + diff + hypothesis only. Sanctioned work would be
re-flagged on every round, converting each operator grant into a permanent
human stop.

## Resolution

`operator_record` — the last eight notes, author and text — joins the
reviewer's closed input set, and the review prompt names its authority: a
recorded grant makes the granted file in-scope; recorded guidance names what
this generation was asked to do. Sessions cannot author notes, so the record
cannot be forged from inside a worktree; the scope lens otherwise stands.
