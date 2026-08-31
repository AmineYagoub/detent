---
id: PRDR-101
title: "The planner leaves non_goals empty on 98% of tickets, and no plan review tag fails a plan for it"
state: DONE
severity: major
category: gap
labels: ["prd-review", "user-raised", "found-by-execution"]
surface: ["prompts/planner.md", "src/schemas/init.ts", "src/init/plan-review.ts"]
prd_refs: ["A-1", "A-2", "C-4", "D-6"]
acceptance_criteria: ["A drafted ticket states what it is NOT for, in the `non_goals` field the schema already carries, whenever the ticket has a boundary worth stating — which is most of them.", "REVIEW_PLAN can fail a plan whose tickets do not state their boundaries: the closed tag set gains a tag for it, in the schema and in the prompt, so the instruction has a consequence rather than being one clause nobody checks.", "The tag is distinguishable from `sizing`: sizing is about a ticket being too large, boundaries about a ticket not saying where it stops. A finding names the ticket at fault.", "Nothing forces non_goals onto a ticket that genuinely has none — an honest empty list stays legal, exactly as an honest `approve` verdict does."]
non_goals: ["Does not add a role. The idea this ticket came from was a pre-implementation analyst session; that would be an F-3 schema event, a session per ticket, and prose where P2 wants artifacts — while the field it would populate already exists.", "Does not change what the implementer or reviewer is SHOWN: both already receive `non_goals`. The gap is that it is empty.", "Does not claim this improves outcomes. First-pass rate is already 15/18; this is filed as under-specification, not as a fix for a measured failure."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-084", "PRDR-081"]
depends_on: []
---

# PRDR-101 — the planner leaves non_goals empty, and nothing fails a plan for it

**Severity:** major · **Category:** gap · **Raised by:** the user, proposing a
pre-implementation analyst role · **Found by:** measuring the N-7 plan

## Problem

Of the 66 tickets in Detent's own N-7 plan, **65 have an empty `non_goals`** — 98%. The
one exception is the bootstrap ticket, which Detent writes itself.

The field is not decorative. `non_goals` reaches the implementer in its ticket and the
reviewer in `buildReviewerInputs`, and it is the only place a plan states where a ticket
stops. Empty, it leaves the reviewer making its most frequent judgement — is this work in
scope — with no stated boundary to judge against, and leaves the implementer to infer one.

The planner prompt already asks for it: *"produce tickets with non-empty, testable
acceptance criteria (A-1), explicit non-goals, dependency edges via `depends_on`, and
per-ticket surfaces."* One clause in a dense sentence, with **no consequence attached**.
PRDR-084's REVIEW_PLAN judges a draft on `sizing`, `testability`, `coverage`, `shape` and
`traceability` — none of which covers a ticket that never says what it is not for. So the
instruction is asked for, never checked, and duly ignored 98% of the time.

That is the general failure: an instruction with no feedback loop decays to noise. The
same prompt's SIZE and SHAPE rules DID land (PRDR-081 took the plan from 14 tickets to 66)
because REVIEW_PLAN checks them.

## What this replaces

It arrives as the cheap form of a proposal to add a "Senior Principal Engineer explains
the ticket" role ahead of implementation. That would be an F-3 schema event (`ROLE_IDS` is
a wire format), a session per ticket, and prose where P2 admits only artifacts — to
populate context the ticket schema already has a field for and the planner already has an
instruction to write.

It should also be said plainly that this is not backed by a measured failure. The
first-pass rate on this plan is 15 of 18 tickets, and the three exceptions were a debris
bug (PRDR-100), one review round and one gate round — not comprehension failures. This is
filed as under-specification of an artifact, not as a fix for an observed defect, and the
non-goals above say so.

## Resolution

Three files, no new role and no schema event for `ROLE_IDS`:

- `src/schemas/init.ts` — `boundaries` joins `PLAN_FINDING_TAGS`, the closed set REVIEW_PLAN
  validates against, so the tag exists where it is enforced rather than only where it is
  described.
- `src/init/plan-review.ts` — the REVIEW_PLAN instruction names it, and says why the field
  matters (both the implementer and the reviewer receive it) rather than merely demanding
  it. An honest empty `non_goals` is explicitly not a finding.
- `prompts/planner.md` — at PLAN, `non_goals` stops being one clause in a list and gets the
  reason it exists plus what to write: the adjacent feature this ticket does not cover, the
  generalisation it should not reach for, the edge case belonging to a sibling.

The mechanism being fixed is the feedback loop, not the wording. The same prompt's SIZE and
SHAPE rules landed hard — PRDR-081 took the plan from 14 tickets to 66 — because REVIEW_PLAN
checks them. `non_goals` was asked for and never checked, and decayed to 2% compliance.
