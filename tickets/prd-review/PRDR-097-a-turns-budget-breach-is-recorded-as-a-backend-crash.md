---
id: PRDR-097
title: "A turns_per_stage breach is recorded as a backend crash — it under-counts spend, and three in a row read as an outage"
state: READY
severity: major
category: correctness
labels: ["prd-review", "found-by-execution"]
surface: ["src/sessions/sdk.ts", "src/kernel/ledger.ts", "src/kernel/referee-session.ts", "src/schemas/budgets.ts"]
prd_refs: ["X-1", "S-4", "D-25"]
acceptance_criteria: ["A session terminated for exceeding `turns_per_stage` is distinguishable in the record from one killed by transport death — the two have different causes and different remedies.", "A turns breach routes to the BUDGET_BREACH target its own ceiling declares (X-1), rather than being recorded as infrastructure failure.", "PRDR-090's outage halt counts only genuine backend failures, so a run cannot be halted as an 'outage' by a model that simply needs more turns than the ceiling allows.", "Spend from a turns-breached session is not silently recorded as $0.00 — a session that did real work and billed for it must not leave `run_spend_usd` under-counting, since the cap is the thing that makes spend un-restartable-around."]
non_goals: ["Does not raise the default `turns_per_stage`; the ceiling is the operator's to set and 30 is not the defect.", "Does not revisit PRDR-053's decision that an SDK throw must not kill the run — that call was right and stays. This is about what the throw is then CALLED.", "Does not change PRDR-090's halt threshold, only what feeds it."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-053", "PRDR-072", "PRDR-090", "PRDR-095"]
depends_on: []
---

# PRDR-097 — a turns budget breach is recorded as a backend crash

**Severity:** major · **Category:** correctness · **Found by:** running the N-7 gate on a
cheaper model

## Problem

`turns_per_stage` (default 30) reaches the SDK as `maxTurns`. When a session exceeds it
the SDK throws, and `sdk.ts` converts the throw into a crashed result with zeroed cost and
tokens — deliberately, per PRDR-053, so a throw cannot take the run down. That decision was
right. The problem is that a **budget breach and a transport death then look identical**.

Measured on the N-7 gate with the implement role on Haiku 4.5, six sessions:

| turns | cost | recorded as |
|---|---|---|
| 19, 20, 25 | $0.104 – $0.110 | ok |
| 61, 65, 68 | **$0.000** | **crash** |

The split is exactly the ceiling. Every session under it bills and reads clean; every
session over it bills nothing and reads as a backend failure. The work was real — the
65-turn bootstrap session scaffolded an entire TypeScript project and its ticket went on
to reach DONE.

## Three consequences

**X-1's own declaration is not honoured.** `src/schemas/budgets.ts` gives
`turns_per_stage` `breachTarget: "BUDGET_BREACH"`, and X-1's posture is that a breached
ceiling presents a human decision and never silently retries. `breachTarget` has no
consumer anywhere in `src/` — the field is declared and never read — so this breach
routes nowhere and is filed as infrastructure failure instead.

**PRDR-090 can halt on a phantom outage.** Three consecutive crashed sessions halt the run
with "backend outage: … halting rather than burning ladder budget on failures no session
produced". For a model that routinely needs more than 30 turns, that message is simply
false, and it sends the operator to look at a backend that is fine. On this gate it has
not fired only by luck: Sonnet review sessions interleave and reset the streak.

**The spend cap under-counts.** The ledger records $0.000 for a session that did 68 turns
of billable work. `run_spend_usd` is the ceiling that D-25 evaluates at launch and the one
thing that makes spend un-restartable-around — and it is blind to every turns-breached
session. The more a model breaches, the further the ledger drifts below reality.

## Why it took a cheap model to find

Opus and Sonnet finish these tickets inside 30 turns, so the ceiling is never reached and
the misclassification never appears. It surfaced within four sessions of routing implement
to Haiku. Every N-7 gate to date has run on a model that hides this.
