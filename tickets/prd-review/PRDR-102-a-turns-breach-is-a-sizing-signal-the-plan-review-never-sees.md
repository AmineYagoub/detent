---
id: PRDR-102
title: "A turns breach is the sharpest sizing signal Detent produces, and REVIEW_PLAN never sees it"
state: READY
severity: minor
category: gap
labels: ["prd-review", "found-by-execution"]
surface: ["prompts/planner.md", "src/init/plan-review.ts", "detent-prd-v3.md"]
prd_refs: ["A-1", "X-1", "D-6"]
acceptance_criteria: ["A ticket whose implement session breaches `turns_per_stage` is recorded in a way that reaches the next PLAN or REVIEW_PLAN of the same documents, so a plan can be judged against what its predecessor actually cost rather than against an estimate alone.", "A breach is distinguishable in that record from a ceiling that was merely set too low for the model — the distribution decides which, and the record carries enough to tell.", "Nothing auto-splits a ticket. The signal informs the plan review's `sizing` judgement; the decision stays the planner's and the operator's."]
non_goals: ["Does not change PRDR-097's halt or PRDR-098's default. Both behaved correctly here — this is about what the breach TELLS us, not what it does.", "Does not propose raising the shipped ceiling to cover the outlier: 27 of 28 sessions finish in 27-75 turns, and widening the runaway bound for everyone on the strength of one ticket is the wrong trade.", "Does not claim every breach is an oversized ticket. A slow model breaches a fair ceiling too, which is exactly why the distribution has to be part of the record."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-097", "PRDR-098", "PRDR-081", "PRDR-084"]
depends_on: []
---

# PRDR-102 — a turns breach is a sizing signal the plan review never sees

**Severity:** minor · **Category:** gap · **Found by:** the certification gate halting on
t-106

## Problem

Sonnet implement sessions on Detent's own plan, across every run so far:

```
27 32 36 39 40 43 45 47 49 50 51 58 58 59 60 68 68 69 69 70 70 72 72 72 74 74 75
```

Twenty-seven sessions, tightly clustered, maximum 75. Then `t-106` — "X-1 budget counters
and config-load validator" — ran **145 turns** and was terminated, nearly double the
highest completion ever observed.

That is not a ceiling set too low. Against this distribution 80 is generous, and PRDR-097
and PRDR-098 both did the right thing: the breach halted by name rather than being
mis-recorded as an outage, and the ledger did not silently under-count it. The signal is
about the TICKET. Read its criteria and the shape is plain — *"every X-1 key has a named
enforcement site emitting the breach target its row declares"* — a ticket that touches
every budget key in the system, wearing the size of a milestone.

`sizing` is the first tag in REVIEW_PLAN's closed set, and the plan containing t-106 was
approved. That is not the reviewer being careless: it judged the draft with nothing but the
draft in front of it. A turns breach is the only hard, measured evidence Detent ever
produces that a ticket was larger than one session, and it arrives after the plan is
frozen and reaches nothing.

## Why it is only minor

Nothing is broken. The breach halts, the operator raises the ceiling or splits the ticket,
the run continues — and that is a legitimate, documented remedy, printed in the breach
message itself. What is missing is that the most expensive lesson the system learns gets
thrown away instead of returned to the stage whose job is to prevent it.

The asymmetry is worth naming: PRDR-081's SIZE rule asks the planner to estimate a session's
worth of work, and PRDR-084 asks REVIEW_PLAN to check the estimate. Neither has ever seen a
measurement. This is the measurement.

## Direction (not a decision)

A breach is already journaled and already carries the ticket id and the observed turns. The
cheapest useful form is for a subsequent PLAN or REVIEW_PLAN over the same documents to
receive the breaches its predecessor recorded, as evidence rather than as instruction —
"this ticket cost 145 turns and did not finish" is a fact a sizing judgement can use, and
one no estimate would have produced.
