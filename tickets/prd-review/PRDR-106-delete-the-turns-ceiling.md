---
id: PRDR-106
title: "Delete the turns ceiling: no session is terminated on turns, the referee never halts on one, and the key survives only as the planner's sizing target"
state: READY
severity: major
category: decision
labels: ["prd-review", "user-raised", "found-by-execution"]
surface: ["src/sessions/sdk.ts", "src/sessions/backend.ts", "src/kernel/referee-session.ts", "src/kernel/ledger.ts", "src/init/session.ts", "src/init/pipeline.ts", "src/schemas/budgets.ts", "scripts/build-plugin.ts", "agents/**", "detent-prd-v3.md"]
prd_refs: ["X-1", "C-4", "D-25", "X-8", "S-4"]
acceptance_criteria: ["No session launched by the referee or by init carries a turn ceiling: the SDK option is absent unless a caller sets it explicitly, and the only caller that does is the doctor probe (one turn).", "The referee has no turns-breach path: nothing halts the run, nothing throws, and the ledger writes no `turns_breach` row. Old rows carrying that value still parse.", "The plugin agents ship no `maxTurns` frontmatter.", "`turns_per_stage` still parses in every existing config and still reaches PLAN and REVIEW_PLAN as `session_budget.implement_turns` (C-4'), documented as a sizing target that nothing enforces.", "The ledger keeps recording `turns` on every row — the measurement PRDR-102 needs exists without a ceiling."]
non_goals: ["Does not remove `run_spend_usd`, `sessions`, or `ticket_wall_clock_ms`. Those are what bound the run and the ticket; they bounded it before this ticket and they bound it after.", "Does not rename `turns_per_stage`. A rename is a config migration for every project on F-1's committed config, to fix a name that is merely imprecise.", "Does not decide PRDR-102. A session that notices it is oversized should still say so; it just will not be killed for failing to."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-097", "PRDR-098", "PRDR-102", "PRDR-105"]
depends_on: []
---

# PRDR-106 — delete the turns ceiling

**Severity:** major · **Category:** decision · **Raised by:** the user — "I want to delete
this turns blocker, we don't need that" · **Found by:** the certification gate, four times

## The decision

PRDR-105 measured the ceiling and specified a redesign of its consequence: per-ticket
scope, estimated accounting, a soft ceiling, one automatic resume. The user's decision is
simpler and it is theirs to make: delete the ceiling. This ticket records the decision and
its consequences, and supersedes PRDR-105's redesign.

The measurement that decided it, restated once:

```
ticket   breached at   resumed → finished in   recorded
t-116        103              63                 $0
t-106        145              47                 $0
t-146        307              46                 $0
t-154        222           (pending)             $0
```

87 completed implement sessions, maximum 118 turns. Four firings, zero runaways; each one
halted the run, recorded $0, and stranded the work. A guard that has only ever stopped
legitimate work is a blocker, and the user does not want a blocker.

## What is deleted

- **The SDK ceiling.** `SessionSpec.maxTurns` becomes optional and neither the referee nor
  init sets it. The option reaches the SDK only when a caller passes one; the doctor probe
  does (one turn, a probe), nothing else does.
- **The halt.** `referee-session.ts` no longer throws on a breach, because there is no
  breach: PRDR-097's by-name halt and its `turnsBreached` flag go, and the ledger writes
  `partial: "crash"` for a crash and nothing else.
- **The plugin cap.** `scripts/build-plugin.ts` stops rendering `maxTurns` into
  `agents/*.md`. The plugin path was the same ceiling in a different skin.

## What stays

- **`turns_per_stage` as a number.** It still parses (every committed config carries it)
  and still reaches PLAN and REVIEW_PLAN as `session_budget.implement_turns` — the sizing
  target C-4′ gave the planner. Its X-1 row now says so: scope `plan-sizing`, advisory,
  never enforced. The name is imprecise and a rename is a migration, so it keeps its name.
- **The measurement.** Every ledger row still records `turns`. That is the only input
  PRDR-102's sizing signal needs, and it never needed a ceiling to exist.
- **`turns_breach` in the ledger schema**, read-only: 266 rows on the gate's ledger carry
  it and an audit must still parse them.

## What bounds a session now

Nothing per session. What bounds the run is what bounded it before: `run_spend_usd` at
launch (D-25, one-session overshoot), `sessions` per generation, `ticket_wall_clock_ms`
per ticket. A session that genuinely spins — the case the ceiling existed for and never
met in 87 sessions — now runs until the spend cap's next launch check or the ticket's
wall clock, whichever comes first. That is the trade the decision makes, stated plainly.

## Sequencing

Built immediately, against the freeze, because the ceiling is the thing blocking the gate
and the user's priority is finishing. The change is confined to the breach path — a
session that never breached behaves identically — so the 57 tickets certified before it
stand. It takes effect at the driver's next restart; the live run keeps the 400 ceiling
it loaded until then.
