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

## Measured: the text carries no size signal at all

A second breach on the same gate makes the case sharper than the original filing did.
`t-146` ("C-4/C-4' PLAN phase with greenfield bootstrap ticket #1") ran **307 turns** — three
times the highest completed session — and committed ten files before the ceiling cut it off.
It was building, not spinning.

Turn count against the length of the acceptance criteria that produced it:

```
t-146   307 turns    62 words
t-106   145 turns    69 words
t-133   118 turns    74 words
t-130   110 turns    54 words
t-109   110 turns    52 words
t-151   106 turns    50 words
```

The relationship is absent. t-146 has FEWER words than t-133 and took nearly three times the
turns; t-130 and t-109 tie on turns with a 2-word gap between them.

That is the whole problem in one table. PRDR-081 asks the planner to size a ticket against
`session_budget`; PRDR-084 asks REVIEW_PLAN to check that estimate. **Both judge the text,
and the text does not encode the work.** No amount of care at either stage recovers a signal
that is not in the artifact they read — which is why the measurement, discarded today,
is the only thing that could inform the next plan.

It also revises this ticket's own framing. The original filing called t-106 "a milestone
wearing a ticket's clothes", read off its criteria. That reading was wrong for t-146 and is
suspect for t-106: neither is textually large. Oversized tickets do not look oversized.
