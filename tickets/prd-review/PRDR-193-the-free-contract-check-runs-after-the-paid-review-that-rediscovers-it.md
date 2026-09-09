---
id: PRDR-193
title: "applyContracts runs after wholePlanReview, so a paid session rediscovers defects a deterministic check proves for nothing — and the review said so itself"
state: DONE
severity: minor
category: design
labels: ["prd-review", "found-by-live-run", "cost", "planning"]
surface: ["src/init/plan.ts", "src/init/plan-whole.ts", "src/init/contracts.ts", "tests/init/contracts.test.ts", "detent-prd-v3.md"]
prd_refs: ["A-1‴", "C-2‴", "PRDR-117", "PRDR-120"]
acceptance_criteria: ["The contract check's FINDING half runs on the planned tickets before `wholePlanReview`, and its findings are passed into that review as already-known issues.", "The EDGE-derivation half stays where it is, last, on the reviewed tickets — a derived edge must land on the text that reaches disk, and a redraft rewrites that text.", "A defect the mechanical union check can decide is never first reported by a paid session. Falsifiable directly: a plan whose ticket consumes an unprovided name yields the finding with NO session launched.", "The review's inputs say which findings are already known, so its budget is spent on what only judgement can reach rather than on restating them."]
non_goals: ["Does not move the check into per-slice planning. A forward reference is not a defect until the plan is complete — `t-s02-003 consumes X` is legal while a later slice may provide X — so the whole-plan pass is genuinely required for this class, and running it per slice would fire on every legitimate forward reference.", "Does not change what `contracts.ts` decides, only when the deciding happens.", "Does not remove the whole-plan review. Four of the five other findings in the run below are judgement calls no code can make."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-117", "PRDR-120", "PRDR-192"]
depends_on: []
---

# PRDR-193 — the free check runs after the paid one

**Severity:** minor · **Category:** design · **Found by:** the gate-312 planning run, at the
moment it paid for something it already knew

## Problem

[`plan.ts`](../../src/init/plan.ts) runs three things in this order:

```ts
const planned  = await planSlices(deps, slices);          // 15 slices, per-slice review
const reviewed = await wholePlanReview(deps, slices, planned.tickets);  // a model session
const contracts = applyContracts(reviewed.tickets, ...);  // deterministic, no session
```

`applyContracts` is free. `wholePlanReview` is a planner session over every ticket in the plan —
the largest paid prompt `init` builds. **The free one runs second.**

## The evidence, in the reviewer's own words

gate-312's whole-plan review returned six findings. One of them is this:

> `t-s02-003` declares `consumes: src/schemas/binding.bindingRecordSchema`, a name no ticket in
> the plan provides … **Under the plan's own mechanical union check** (`t-s10-006`: "a name a
> ticket `consumes` that no ticket in the plan or the plan index provides" is a `dependency`
> finding), **this fails at draft time.** The same class affects `t-s13-008`, which consumes the
> file `tests/arch/single-caller.test.ts` — created inside `t-s01-021`'s surface but declared in
> no ticket's `provides`. Both are one-line declaration fixes, but **they will fail the contract
> checker `t-s10-006` builds, so they should be corrected rather than discovered by it.**

The model paid to review the plan found two instances of a class, cited the mechanical checker by
ticket id, and said explicitly that they should be corrected rather than discovered. It is
describing [`contracts.ts:188`](../../src/init/contracts.ts), which emits, verbatim:

> `consumes the … and no ticket in the plan provides it — the work it depends on is either
> missing or unowned`

That finding then triggered a redraft of s02: a second paid session, rewriting a slice's tickets,
for a one-line declaration fix that a deterministic check would have named for nothing.

**One of six, honestly counted.** The other five are judgement — whether two criteria contradict
each other, whether a projection matches what a requirement demands — and no code decides those.
This ticket does not claim otherwise. It claims that the one which WAS decidable should not have
cost a session and a redraft.

## Why the order is what it is

There is no argument for it anywhere. Commit archaeology:

| | |
|---|---|
| `wholePlanReview` placed | `37d8ea3`, 3 Sep 2026 (PRDR-117, the slicing layer) |
| `applyContracts` placed | `56412a5`, 5 Sep 2026 (PRDR-120, contracts) |

PRDR-120 landed two days after the review already existed and appended its call after it.
PRDR-120's ticket, its commit body and A-1‴ in the PRD were each checked: **none argues for the
position.** The PRD says only that Detent "then checks the union with CODE" — after the
declarations exist, not after the review.

## The rationale that does exist, and what it conflates

The doc comment above the call:

> the declarations are checked by code, after every model has had its say and before a ticket
> reaches disk

That is two jobs described as one:

- **Deriving edges onto tickets** must run last. An edge has to land on the text that reaches
  disk, and a redraft rewrites that text, so an edge derived earlier would attach to a ticket
  that no longer exists.
- **Producing findings** has no such constraint. It needs every ticket to exist, which is true
  the moment `planSlices` returns — one line before the review is called with those very
  tickets.

The comment justifies the first and was applied to both.

## Why this is small

`wholePlanReview(deps, slices, planned.tickets)` already receives every ticket. `applyContracts`
already returns its three parts separately — `findings`, `derived`, `tickets`. Nothing needs
restructuring: compute the findings on `planned.tickets`, hand them to the review as known
issues, and leave the edge derivation exactly where it stands.
