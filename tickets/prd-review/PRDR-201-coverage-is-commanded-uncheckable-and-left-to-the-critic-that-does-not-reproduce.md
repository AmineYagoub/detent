---
id: PRDR-201
title: "PLAN is commanded to cover every requirement and baseline item, nothing can check that it did, and the only thing watching is the critic PRDR-200 measured at 0.45"
state: OPEN
severity: major
category: gap
labels: ["prd-review", "found-by-measurement", "planning", "traceability", "coverage"]
surface: ["src/init/contracts.ts", "src/init/plan.ts", "src/schemas/init.ts", "tests/init/contracts.test.ts", "detent-prd-v3.md"]
prd_refs: ["A-1‴", "C-2‴", "C-2⁗", "C-4⁗″", "PRDR-193", "PRDR-196", "PRDR-200", "D-24"]
acceptance_criteria: ["A baseline citation has ONE enforced form and ONE enforced home, and the planner prompt, the validator and the checker agree on it. Today `[baseline:PB-008]` in an acceptance criterion and a bare `PB-012` in a description are both produced by the same prompt, and a non-goal naming `PB-009` as excluded is indistinguishable from coverage by text alone.", "Baseline coverage is then DECIDED: for each slice, every id in `baseline_items` is sourced by at least one ticket, and an unsourced item is a finding with NO session launched — PRDR-193's bar, applied to what the check decides rather than to when it runs.", "A ticket records the requirement ids it serves, so requirement coverage becomes decidable at all. `plan.ts:220` already commands it — `every requirement id in its requirement_ids ... reaches a ticket` — and no field exists to record the answer, so no check can be written and none is. Adding the field is an F-3 schema event and is the point of this ticket, not a side effect of it.", "The findings join PRDR-193's contract set and reach PRESENT under the PROVED heading, never merged with the review's. One kind is a proof and the other is judgement, and merging them discards the distinction that makes the first worth having (PRDR-196).", "The falsification lands first: a slice whose `baseline_items` names an id no ticket sources, observed to FAIL before any fix, asserted on `applyContracts` as `plan.ts` calls it (V-6)."]
non_goals: ["Does NOT widen the checker into sizing. PRDR-196 measured that and it is not decidable: against the review's own 16 sizing findings the strongest available gate was surface>=7 at 20% precision — four flags in five wrong. A ticket that re-proposes ticket-size proxies has not read PRDR-196.", "Does not change WHEN the check runs. PRDR-193 settled that and made its own non-goal `does not change what contracts.ts decides` — this ticket is that sentence's other half, and nothing more.", "Does not remove or shrink the model critic. Coverage is one tag; coherence and testability are judgement calls no set operation reaches, and D-24 keeps them advisory.", "Does not claim the check finds a defect in either plan on disk. Both cover every baseline item they were assigned. The defect is that neither could have been shown to, which is a different and worse thing.", "Does not touch the requirement ids themselves. SLICE already assigns them and they are stable; this is about recording where they land."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-193", "PRDR-196", "PRDR-200"]
depends_on: []
---

# PRDR-201 — the coverage nobody can check

**Severity:** major · **Category:** gap · **Found by:** trying to write the check, and watching it
accuse a good plan of dropping four production requirements

## The command with no check behind it

[`plan.ts:220`](../../src/init/plan.ts) tells every planning session:

> Draft ONLY slice `s15`: **every requirement id in its `requirement_ids` and every baseline item
> in its `baseline_items` reaches a ticket**, and nothing outside it does. A `production_baseline`
> item becomes tickets whose criteria are its `verifiable_by`, sourced `baseline:PB-###`.

SLICE assigns both — smoke-1's s01 carries `requirement_ids: [R-1, R-10, R-11, R-13]` and
`baseline_items: [PB-004, PB-008, PB-011]`. The instruction is precise, the data is there, and
**`requirement_ids` appears nowhere in any check.** Its only occurrences in `src/` are the prompt
that commands it, the skeleton that shapes it, and the schema that types it.

So the sole thing standing between a silently dropped requirement and a human approving the plan
is the review's `coverage`/`traceability` tag — and PRDR-200 measured that critic at **Jaccard
0.45 across two independent sweeps, 0.56 after majority filtering**. A set operation would decide
the same question at 1.0 for zero sessions.

## Why it is not merely unwritten

I tried to write it. Against gate-312's finished 264-ticket plan the check reported:

```
s15   told  4 baseline item(s), sourced  0, MISSING ['PB-012','PB-013','PB-014','PB-015']
```

Four production-baseline items — CI and release, the runbook, requirement-to-test traceability,
the golden path — apparently dropped by the slice whose title is *"Proof and release"*.

**That was wrong.** s15 delivers all four: `t-s15-010`, `-012`, `-013` carry PB-012, `t-s15-014`
PB-015, `t-s15-016` PB-013, `t-s15-017` and `-018` PB-014. The check was strict about the form the
prompt asks for, `baseline:PB-###`, and gate-312's planner cited the ids bare. smoke-1's planner
used the prefixed form, `[baseline:PB-008] store.Migrate(...)`. **Same prompt, two conventions.**

Loosening the check to any `PB-\d+` does not fix it, it inverts the error. smoke-1's `t-s01-00x`
carries this **non-goal**:

> Localisation, error codes as machine-readable identifiers, or structured/JSON diagnostics
> (PB-009, slice s06).

A loose check reads an explicit *exclusion* as coverage. So the citation is unusable in both
directions: strict, it accuses a complete plan of dropping four release requirements; loose, it
certifies a slice for an item it says in writing it is not doing.

This is the finding. Not that coverage is unchecked — that it **cannot be checked**, because the
citation has no enforced form and no enforced home, and requirement coverage has no field at all.

## Why now

PRDR-200 spent nine sessions and $8.56 establishing that this critic does not reproduce itself,
and nine more establishing that aggregating it buys eleven points and stops there. That result is
an argument FOR this ticket rather than against the reviewer: the durable move is to keep taking
decidable properties away from a process measured at 0.45 and giving them to one that is exact.

Coverage is the best remaining candidate because it is pure set membership over data SLICE already
produces. Sizing is not — PRDR-196 tested it and the strongest gate available flagged four wrong
in five.

## Note on scope

Adding a requirement link to the ticket schema is an F-3 event and the cache is a strict trust
boundary: an added field lands in `sliceCacheSchema` with a default, or every slice planned before
it misses and re-plans at full price. PRDR-200 nearly paid that and `plan-cache.test.ts` now pins
both directions of it.

The narrower question of whether a ticket should cite the baseline item in a structured field
rather than in prose is left open here deliberately. `provides`/`consumes` already show the shape
that works — a typed list beats a convention inside free text, and the evidence above is what a
convention inside free text costs.
