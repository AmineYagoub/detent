---
id: PRDR-246
title: "The ticket wall clock is enforced at the launch seam only, so the `gate` tool evaluates past the ceiling and only the headless loop stops it"
state: DONE
severity: major
category: gap
labels: ["prd-review", "found-by-audit", "driver-parity", "X-1", "ARCH-2"]
surface: ["src/kernel/ticket-clock.ts", "src/kernel/referee-session.ts", "src/kernel/referee-gate.ts", "tests/kernel/wall-clock-parity.test.ts"]
prd_refs: ["X-1", "X-1⁗", "ARCH-2", "C-13"]
acceptance_criteria: ["The `gate` tool refuses with BREACH when the elapsed time since the ticket's claim exceeds `ticket_wall_clock_ms`, on the close-check path and the ordinary evaluation path alike.", "The check reads the CLAIM's timestamp, not the generation's `started_at`, and is the same computation the launch seam uses — one implementation, called from both arms.", "A test drives the referee tool surface both drivers share, with a clock advanced past the ceiling after the claim is taken, and fails on today's tree.", "The headless loop's own check at `driver.ts` is left in place: it bounds a ticket whose remaining work launches no session at all."]
non_goals: ["Does not remove the headless driver's loop-level check; belt and braces across two drivers is the point, and removing it would narrow coverage to re-prove parity.", "Does not change the ceiling, its default, or its breach target.", "Does not add a time check to `skills/run/SKILL.md`; the referee is where both drivers inherit one, which is X-1⁗'s own argument.", "Does not bound gate SUBPROCESS duration — `gate_timeout_ms` is a separate ceiling with its own enforcer."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-140", "PRDR-153", "PRDR-181"]
depends_on: []
---

# PRDR-246 — the launch seam is not the only place work starts

## Problem

X-1⁗ (PRDR-140) moved the wall clock off the headless loop and onto the launch seam,
and `src/kernel/referee-session.ts` says why: `skills/run/SKILL.md`, the published
program the model-driven driver executes, has no time check at all, so enforcing it
where sessions are launched lets *both* drivers inherit it.

That argument is right and the implementation is right for launches. It does not cover
the other thing a driver asks the referee to do. `RefereeGate.evaluate` — the `gate`
tool — runs the bound verification commands and mints a transition ref, and it never
consults the clock. So a ticket whose claim is older than `ticket_wall_clock_ms` is
still evaluated, including on the `close_check: true` path that carries a ticket to
DONE.

The headless driver does not notice, because `driver.ts` still checks elapsed time at
the top of its stage loop. The model-driven driver has no such loop, which is the
premise PRDR-140 started from. So the ceiling holds on one driver and half-holds on the
other — the same asymmetry X-1⁗ was written to remove, in the half it did not reach.

`ENFORCEMENT_SITES` names `kernel/referee-session` as this ceiling's enforcer, which is
accurate for launches and is why the gap reads as closed.

## Scope, stated plainly

This is not a spend hole. No additional billable session runs past the ceiling: every
launch re-enters the seam that does check. What runs past it is gate execution — real
wall-clock time in a subprocess — and a ticket can reach DONE after its ceiling on the
model-driven driver. The consequence is a ticket that outlives its bound without the
run saying so, not an unbounded escape.

It is filed as `major` for that reason, and because ARCH-2 parity is the property being
violated rather than a budget being overspent.

## Design decision this records

The check moves into one function called from both arms rather than being copied into
`evaluate`. The clock basis stays the CLAIM's timestamp for the reason X-1⁗ already
gives: a generation's `started_at` may date from a requeue days old, and a ticket
planned last week must not breach the moment it is first claimed.

Checking at the top of `evaluate` matches what the headless loop already does — its
check sits before each stage, and a close-check is a stage — so this brings the
model-driven driver to the behaviour headless has had since PRDR-140, rather than
introducing a new policy for either.

## Why no test caught it

Every ARCH-2 parity case pins a frozen clock (`now: () => NOW`), so elapsed is zero and
a wall-clock divergence is unobservable by construction. PRDR-153 recorded this exact
lesson once already, in `src/kernel/tickets/mutations.ts`: under a frozen fixture clock
the elapsed time came out wrong and the check never fired. The parity suite still pins
one.

## Falsification (verification protocol, item 1)

`tests/kernel/wall-clock-parity.test.ts`, written before the fix and run against `6f8ca17`:

```
× refuses a close-check on a claim older than the ceiling
  → an evaluation past the ceiling must not mint a ref: expected false to be true
× refuses an ordinary evaluation past the ceiling too, not only the close-check path
  → the ceiling breaches (X-1): expected '' to be 'BREACH'
✓ evaluates normally while the claim is inside the ceiling
```

The third case is the control and passed before and after, so the two failures are the
ceiling being absent rather than the fixture refusing everything.

## What changed

`assertTicketWallClock` in a new `src/kernel/ticket-clock.ts`, called from `SessionArm.launch`
and from the top of `GateArm.evaluate`. `driver.ts`'s loop-level check stays: it bounds a
ticket whose remaining work launches no session at all.

`ENFORCEMENT_SITES` now names `kernel/ticket-clock` for this ceiling. It said
`kernel/referee-session`, which was true of the only caller there was, and
`tests/oracle/budgets.test.ts` failed the moment the computation moved — the map is
checked by grepping the named module for the key with comments stripped, so moving an
enforcer without updating the map is caught. That is the same oracle whose weakness this
session documented at `src/kernel/budgets.ts` for `failure_research_tool_calls`: it proves
the named module MENTIONS the key, not that it bounds anything. Here it happened to be
exactly the right check.
