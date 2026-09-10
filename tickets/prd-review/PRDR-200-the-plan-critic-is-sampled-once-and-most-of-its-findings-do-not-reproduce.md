---
id: PRDR-200
title: "The plan critic is sampled once, most of its findings do not reproduce, and both consumers — the reviser and PRDR-196's own instrument — treat that one sample as fact"
state: OPEN
severity: major
category: design
labels: ["prd-review", "found-by-measurement", "planning", "cost", "measurement"]
surface: ["src/init/plan-review.ts", "src/init/plan-slices.ts", "tests/init/plan-critic-sampling.test.ts", "detent-prd-v3.md"]
prd_refs: ["PRDR-084", "PRDR-193", "PRDR-196", "PRDR-199", "D-24", "C-2‴"]
acceptance_criteria: ["The per-slice review is sampled k times and only findings that recur in at least ⌈k/2⌉ samples are handed to the reviser. On the measurement below (k=3, ≥2) that keeps 6 of 16 findings and discards 10. The threshold is a declared value, not a constant nobody can see — PRDR-197's lesson about `effort_routing`.", "The falsification lands first: a test that shows the CURRENT path handing the reviser a single-sample finding set, observed to FAIL before any fix (V-6).", "Asserted on the path as `plan-slices.ts` CALLS IT — `reviewPlan` through to the `draftAndRead` that receives `findings` — not on an aggregation helper called from nowhere. PRDR-141's shape (implemented, tested, documented, unreachable) is what this criterion refuses, and PRDR-191, PRDR-194 and PRDR-199 are the three most recent times this line paid for it.", "`revisionOutcome` stops being reported as though it isolated the revision. Either it is reported alongside a null measured the same way, or the slice's `revision` field is documented as containing critic churn. It is not wrong; it is read as something it is not.", "The re-review's session is re-decided. It exists to produce an after-count — the endpoint PRDR-196 already replaced, and the one this ticket shows carries no information about the revision. It either earns its cost against a stated question or it goes."]
non_goals: ["Does NOT retire the revision round. That was the conclusion this measurement was built to test, and the data does not support it — it shows the measurement cannot decide it, which is a different finding. A ticket that removes revision on the strength of THIS evidence has misread it.", "Does not touch D-24. The review advises and never blocks; that was right and stays. Sampling changes what reaches the reviser, not the reviewer's authority.", "Does not add revision ROUNDS. PRDR-196's non-goal stands: more passes of intrinsic critique is the thing the evidence says does not work, and this ticket is about the quality of one pass's input, not the count of passes.", "Does not implement best-of-k PLANNING. `sliceKey` (plan-slices.ts:136) hashes what a slice READ and deliberately ignores the index, so two independent drafts of one slice collide on the same cache entry. Sampling the DRAFT is therefore a change to what C-8 content-addressing means and belongs in its own ticket.", "Does not claim the deterministic checker (PRDR-193) has this problem. It cannot: its findings reproduce by construction. That contrast is the argument, not an aside."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-084", "PRDR-193", "PRDR-196", "PRDR-199"]
depends_on: []
---

# PRDR-200 — the critic that does not agree with itself

**Severity:** major · **Category:** design · **Found by:** pointing PRDR-196's own instrument at
a null and discovering it reads the same with the revision removed

## What was measured

PRDR-196 replaced a finding COUNT with a finding IDENTITY measure, on the correct reasoning that
a count answers neither question worth asking. `revisionOutcome(before, after)` compares the
review of the first draft against the review of the redraft and reports `resolved`, `survived`,
`introduced`.

It has never been run against a control. This is that control: **the same production
`reviewPlan`, three times per slice, over byte-identical tickets read back from the slice
checkpoints, with no redraft between the passes.** Every `resolved` and every `introduced` it
reports is therefore critic churn by construction — there was no revision to resolve or
introduce anything.

Three slices of `detent-smoke-1` (22 tickets), nine planner sessions on the routed model,
**$8.56**:

```
                        resolved  survived  introduced       c        g   intro/res
NULL   ( 18 pairs)        28        20          28   0.583    0.333       1.00
PRODUCTION (3 slices)      5         2           8   0.714                1.60
```

The null is not near zero. It is most of the production number: it accounts for **82% of the
measured correction rate and 62% of the measured corruption rate.**

## The reductio

The two-rate reading of the production figures was that revision cannot pay: with a baseline
correctness `p₀ = 0.682`, break-even needs `c > (p₀/(1−p₀))·γ = 2.145 × 0.533 = 1.143`, above
the maximum possible correction rate of 1.0.

Run the identical arithmetic on the null. `γ₀ = 0.333` requires `c > 2.145 × 0.333 = 0.714`, and
the null delivers `c₀ = 0.583`.

**The break-even test fails an operation that provably did nothing.** A revision that did not
happen, on tickets that did not change, scores as net-harmful. The test is measuring the
instrument.

## The raw evidence

`s01`, three reviews of the same eight tickets, same prompt, same model:

```
run 1   t-s01-002/dependency   t-s01-007/coherence   t-s01-007/sizing
run 2   t-s01-002/dependency   t-s01-004/sizing      t-s01-007/sizing   t-s01-004/testability
run 3   t-s01-008/sizing       t-s01-007/dependency  t-s01-005/coherence
```

Run 1 and run 3 share **nothing**. Production would have recorded that pair as 3 resolved and 3
introduced by a revision that never occurred. Four of eighteen ordered pairs have zero overlap.
Across three reads the critic blamed five of eight tickets and gave `t-s01-007` three different
tags.

## What does reproduce

It is not noise. There is a stable core under the churn. Sixteen distinct findings appeared
across all runs of all three slices:

| recurrence | count | examples |
|---|---|---|
| all 3 runs | 2 | `t-s02-007/sizing`, `t-s03-004/dependency` |
| 2 of 3 runs | 4 | `t-s01-002/dependency`, `t-s02-005/coherence` |
| **1 run only** | **10** | everything else |

**Ten of sixteen findings do not survive repetition.** A ≥2-of-3 vote keeps six.

## Why this is a defect and not a curiosity

Production samples the critic **once** and hands the result straight to the reviser. On these
numbers roughly two of every three findings the reviser is told to fix are not reliably there.
It then rewrites the slice — a whole-plan-index-carrying session — to address them.

That is a mechanism by which the revision round could look corrupting while doing its job
correctly: it is faithfully acting on unreliable input. The measured corruption may belong to
the critic's sampling, not to the reviser's edits, and nothing currently distinguishes them.

`t-s03-004/dependency` appeared in all three reads. That finding is worth a session. The nine
singletons around it are what the reviser is also being asked to chase.

## What this does NOT establish

It does not show the revision round is worth keeping, and it does not show it should go.
Production sits above the null on all three measures, and even crude noise-subtraction leaves it
short of break-even — but that comparison is n=3 slices against an instrument whose own noise is
the majority of the signal. **Both readings are unsupported.** The conclusion this measurement
was built to test — retire the revision round — is the one it declines to license.

## Note on scope

PRDR-196 was right that counts answer nothing and identity is the question. What it could not
know is that identity across rounds has the same disease for the same reason: both endpoints
are downstream of a critic that does not reproduce itself, and `introduced` is not observed
anywhere — it is derived as `after − survived`, so it inherits whatever the second review's
instability contributes.

The finding identity `revisionOutcome` uses is `(ticket, tag)` (`findingKey`,
plan-slices.ts:196). It is coarse: the same complaint moving one ticket over scores as one
resolved plus one introduced. How much of the churn above is that, rather than genuinely
different findings, is not separated here and is worth knowing before a threshold is chosen.

Findings carrying no `ticket` are keyed `null` and are invisible to `revisionOutcome` entirely,
so the count a run logs and the set the arithmetic sees can differ. No run in this measurement
produced one, so it is recorded as a known gap rather than an observed fault.

The harness that produced this is `experiments/null-review.ts`, local-only and outside the
repository — it calls the production `reviewPlan` and the production `revisionOutcome` through
the same `launchInitSession` seam the PLAN phase uses, so it measures the shipped path and not a
copy of it. Whether a control of this kind belongs in the tree, gated, is a real question and
deliberately left open here; the fix for this ticket does not wait on it.
