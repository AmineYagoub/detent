---
id: PRDR-101
title: "Every ticket loses its non_goals between the draft and the written plan — the writer never copied the field"
state: DONE
severity: major
category: correctness
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

## Amendment — the diagnosis above was wrong

Filed on the premise that the planner was ignoring an instruction with no feedback loop.
It was not. Verified after the change shipped, by replanning the same documents and
comparing the draft to the written plan:

```
plan-draft.json      48 tickets, 0 with empty non_goals   (mean 2.04 entries)
written t-*.json     49 tickets, 48 with empty non_goals  (mean 0.04)
```

And on the ORIGINAL gate, planned before any of this: **draft 65 tickets, 0 empty**. The
planner has always complied. `src/init/plan.ts` builds its `createTicket` call from eight
draft fields and `non_goals` is the one it never passed, so the ticket schema defaulted it
to `[]`. Silent, because an empty list is legal — and invisible to the suite, because the
shared draft fixture writes `non_goals: []` and could not distinguish dropped from empty.

The consequence is larger than the original framing. `NewTicket` documents the field it was
not being given — *"A-1: non-goals are part of a ticket, and the reviewer reads them (A-5
scope)"* — so every ticket in every plan reached both the implementer and the reviewer with
its boundaries stripped. The reviewer's commonest judgement, is this work in scope, has
been made without the field that answers it, for the entire life of the plan pipeline.

The prompt and tag changes below stand, but they are not what fixes this. They were treating
a symptom that did not exist. The fix is one field on one call, plus two tests that draft a
NON-empty list so the pass-through cannot regress into the fixture's blind spot.

## The structural half — so the next field cannot go the same way

Fixing `non_goals` fixes one field. The mapping that lost it is hand-written, the draft
schema has nine fields, and an unmapped tenth would default just as silently tomorrow. The
suite would not catch it either: the shared fixture writes defaults, and a default cannot
be told from a dropped value.

So the mapping is now total at compile time. `MappedDraftKeys` lists what the writer
handles, `UnmappedDraftKeys` is `Exclude<keyof PlanDraftTicket, MappedDraftKeys>`, and a
`const … : UnmappedDraftKeys extends never ? true : never` fails to build the moment a
drafted field is left unhandled. Verified by adding a throwaway field to
`planDraftSchema`: `src/init/plan.ts` failed to compile, and removing it went green again.

The list is still hand-written — but it is now checked against the schema, and that check
is precisely what was missing. Zero runtime cost, and the failure arrives at build time
rather than in a plan nobody inspects.
