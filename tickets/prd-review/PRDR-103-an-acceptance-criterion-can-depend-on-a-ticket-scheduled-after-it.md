---
id: PRDR-103
title: "An acceptance criterion can depend on a sibling scheduled after it, and neither depends_on nor the surface says so"
state: READY
severity: major
category: gap
labels: ["prd-review", "found-by-execution"]
surface: ["prompts/planner.md", "src/init/plan-review.ts", "src/schemas/init.ts"]
prd_refs: ["A-1", "A-2", "C-4", "D-6", "D-21"]
acceptance_criteria: ["A drafted ticket whose acceptance criterion requires behaviour in code another ticket builds either depends on that ticket, or declares the surface it needs — the plan cannot leave the requirement implicit.", "REVIEW_PLAN can fail a plan for it: the closed tag set gains a tag distinguishing 'this criterion cannot be met when this ticket runs' from `shape` (walking-skeleton ordering) and `sizing` (too much work).", "A finding names both tickets — the one whose criterion reaches, and the one that owns what it reaches for — because an operator's remedy is a dependency edge or a surface, and both need the pair.", "Nothing forbids a ticket from depending on earlier work; the defect is a dependency that exists in the criteria and nowhere in the plan's structure."]
non_goals: ["Does not auto-derive dependencies from prose. Inferring 'status and dossiers' to a file set is exactly the guess C-3a tells the planner not to make.", "Does not weaken D-21. The surface denying the write is correct behaviour, and widening surfaces to make criteria reachable would trade a plan defect for a containment one.", "Does not change X-4. The session falsifying was right, and the falsified signal is what surfaced this."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-094", "PRDR-100", "PRDR-102"]
depends_on: []
---

# PRDR-103 — a criterion can depend on a ticket scheduled after it

**Severity:** major · **Category:** gap · **Found by:** execution, on the N-7 gate

## Problem

`t-112` ("X-8 attempt generations on HUMAN_REQUEUE") carries this acceptance criterion:

> AC2: *status and dossiers display cumulative totals across generations; cumulative
> spend still trips the run ceiling regardless of generation count*

At the moment t-112 runs:

- `src/cli/status` **does not exist** — nothing in `src/cli/` references generations at all.
- The tickets that own `src/cli/**` display work — `t-154`, `t-156` — are still `READY`,
  scheduled AFTER t-112.
- t-112's blockers are `[t-001-bootstrap, t-105, t-106]`. None of them builds a display.
- t-112's surface is `[src/kernel/generations/**, tests/generations/**]`, which excludes
  `src/cli/**` regardless.

So the ticket is required to wire behaviour into a renderer a later ticket has not written,
through a surface that forbids touching it. The implementer did the reachable half —
`cumulativeCounters`, `checkCumulativeRunSpend` as pure functions — the reviewer correctly
observed they are never wired into live behaviour, and the session, requeued to wire them,
requested a surface expansion, had it refused, and reported the premise falsified (X-4).

Every actor behaved correctly. The reviewer's finding was right, the falsification was
right, D-21's denial was right. The plan asked for something that could not be done when it
was asked.

## The operator makes it worse, not better

Worth recording because it happened. Reading only the review finding — "code written but
not wired in" — the operator requeued with guidance to wire it in. That guidance named
`status`, `dossiers` and the state-machine trigger: three places outside the ticket's
surface, two of which did not yet exist. The requeue could not have succeeded, and cost a
generation to discover it.

The dossier gives an operator no way to see this. It records a review finding and a
falsification; nothing says the criterion reaches outside the surface, and nothing says the
owner of what it reaches for has not run yet. Both facts are in the plan and neither is in
the artifact the operator reads.

## Why it belongs with PRDR-094 and PRDR-100

This is the third instance of one family: **a ticket judged against something it cannot
reach.** PRDR-094 showed the reviewer another ticket's commits. PRDR-100 failed a ticket's
gate on another ticket's uncommitted files. Here a criterion requires another ticket's
unwritten code. In all three the fix ladder is structurally incapable of resolving it, and
in all three the artifact blames the implementer.

The shared root is that a ticket's *reachable world* — its surface, its dependencies, what
exists when it runs — is known to the kernel and to the plan, and is absent from the
judgement made against it.

## Direction (not a decision)

The plan already holds both halves: every ticket's surface, and every ticket's position in
the dependency order. A criterion naming behaviour whose owner runs later is checkable at
REVIEW_PLAN with no new information — the same place `sizing` and `coverage` are already
judged, and cheaper than discovering it with a falsified generation.

The tag must be its own: `shape` is about the walking skeleton's ordering, `sizing` about a
ticket being too large, and neither expresses "this criterion cannot be met at the point
this ticket runs".
