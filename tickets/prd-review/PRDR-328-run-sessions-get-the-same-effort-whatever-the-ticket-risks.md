---
id: PRDR-328
title: "Every run session of a role gets the same effort, whatever the ticket risks and whatever its attempts have shown. S-5⁵ routes implement and review to xhigh for every ticket. A ticket the plan labels risky, or whose surface the config's risk globs match, runs at the same level as a rename. A ticket that failed its gates or was falsified retries at the same level until X-2's ladder moves it to Opus. The user asked on 2026-09-30 for effort set by risk and by code quality. Risk will set where a ticket starts, and evidence will move it, only up. A lower starting level for low-risk tickets waits for measured run outcomes (D-33)"
state: DONE
severity: major
category: quality
labels: ["prd-review", "cost-strategy", "S-5⁸", "S-5⁵", "B-4′", "X-2", "D-33", "effort", "risk"]
surface: ["src/kernel/effort-route.ts", "src/kernel/session-effort.ts", "src/kernel/referee-session.ts", "src/kernel/referee-context.ts", "src/kernel/ledger.ts", "src/kernel/plan-quality.ts", "src/schemas/roles.ts", "src/schemas/records.ts", "src/cli/status.ts", "tests/kernel/effort-by-risk.test.ts", "README.md", "detent-prd-v3.md"]
prd_refs: ["S-5⁵", "S-5⁶", "S-4⁵", "B-4", "B-4′", "X-2", "D-33", "N-5′", "D-35"]
acceptance_criteria: ["A ticket is high-risk when its risk_label is set, or when its surface matches a glob of the config's risk list. Its implement and review sessions are routed to max, and every other ticket's are routed as the config says.", "When an attempt fails a gate, is falsified, or draws a review that asks for changes, the ticket's next implement or fix attempt is routed one level above the last, up to max. The step is noted on the ticket.", "A ticket whose surface overlaps a surface an earlier ticket of the run touched, where that earlier ticket escalated to NEEDS_HUMAN or was falsified, starts one level above its role's level.", "No rule routes a session below its role's configured level. A lower starting level for low-risk tickets is not built here: it waits for D-33's outcomes from measured runs, and the PRD says so.", "Each session's effort_settled event, which records the routed and the settled level (S-4⁵), also records why the level was chosen: the role, risk, or evidence. detent status counts sessions and their cost by reason.", "Falsifying tests, against HEAD: a risk-labelled ticket's implement session is routed to xhigh, and a ticket's second implement attempt, after a failed gate, is routed to the level of its first."]
non_goals: ["Does NOT lower any level.", "Does NOT change X-2's ladder, or which model each of its steps runs on.", "Does NOT make risk_label a stop again (B-4′).", "Does NOT change init's roles."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-107", "PRDR-237", "PRDR-263", "PRDR-297", "PRDR-299", "PRDR-318", "PRDR-319", "PRDR-327"]
depends_on: ["PRDR-318", "PRDR-319"]
---

# PRDR-328 — in `run`, risk sets where effort starts and evidence moves it

## Where this came from

On 2026-09-30 the user asked whether Detent can set effort dynamically, and then whether by risk
or by risk and code quality. The answer was both, with different jobs (`docs/plan-cost-strategy.md`
§6.2). Risk is known before a session starts. Evidence of how the code is going only comes from
Detent's own checks.

## Problem

- **One level per role.** S-5⁵ routes `implement` and `review` to `xhigh` for every ticket
  (`DEFAULT_EFFORT_ROUTING`, `src/schemas/roles.ts`).
- **Risk is known and unused.** The planner sets `risk_label` on a ticket, and the config's `risk`
  globs name paths whose changes wait for a person (B-4, B-4′). Neither changes how hard a session
  works on the ticket.
- **A failure changes nothing until the ladder moves.** A ticket that fails its gates, is
  falsified, or is sent back by its review retries at the same level. Only X-2's ladder, which
  moves a failing ticket from Sonnet's blind fix to Opus's diagnosis and informed fix, changes
  anything.

## Design

- **Risk sets the start.** A ticket is high-risk when it carries `risk_label`, or when its surface
  matches a `risk` glob. Its implement and review sessions start at `max`. Every other ticket
  starts at its role's level.
- **Evidence moves it, and only up.** Each of these raises the next attempt one level, up to `max`,
  and notes it on the ticket:
  - a failed gate;
  - a falsification;
  - a review asking for changes.

  X-2's ladder is untouched and still moves the ticket to Opus when it would.
- **The code's own record.** A ticket whose surface overlaps one where an earlier ticket of the run
  escalated or was falsified starts one level up.
- **Nothing goes lower here.** A low-risk ticket may later start below its role's level, but only
  once D-33's outcomes from measured runs show no loss: first-generation DONE, escalations,
  falsifications, and review rounds. This ticket does not build that.
- **Measured.** `effort_settled` records why each level was chosen, and `detent status` counts
  sessions and cost by reason.
- **The PRD:** S-5⁸.

## Building it

- `src/kernel/session-effort.ts` and `src/kernel/referee-session.ts`: the level per session, and
  the reason.
- `src/kernel/session-inputs.ts`: the ticket's risk, and its attempts' outcomes.
- `src/kernel/outcomes.ts` and `src/cli/status.ts`: sessions and cost by reason.

### Vetoable calls

1. **`max` for high-risk, not one level up.** The floor for the tickets that matter most should not
   depend on the configured level.
2. **One level per failure.** Two failures from `xhigh` reach `max`, as far as it goes.
3. **The code's record counts the run's own tickets only.** Earlier runs' outcomes are not kept in
   a form this can read yet.
4. **Review sessions follow risk too.** The review is where a risky change is caught.

## As built (2026-10-02)

- **The route.** `src/kernel/effort-route.ts`. `routeEffort` takes a session's role, its role's
  configured level, and the evidence, and returns the level and the reason: `role`, `risk` or
  `evidence`. Each rule only raises, so nothing goes below the configured level:
  1. a high-risk ticket's implement, fix and review sessions run at `max`;
  2. a ticket whose surface meets that of one that escalated to NEEDS_HUMAN, or had its premise
     falsified, earlier in this run runs those sessions one level up;
  3. each failed attempt (a red gate, a falsified premise, a review asking for changes) raises
     the ticket's later implement and fix sessions one level, up to `max`.
- **The evidence.** `effortEvidence` reads the ticket, the config's `risk` globs, every line of
  `transitions.jsonl` and every ticket. High-risk means `risk_label` set or the surface meeting a
  `risk` glob. Failures are the ticket's own lines, in every generation. A neighbour's outcome is
  counted from this run's lines only, by N-5″'s figures, so an escalation an outage's requeue
  answered does not count. This run is the referee's lifetime (`RefereeContext.startedAt`).
- **The launch.** `src/kernel/referee-session.ts` launches the session at the routed level, and
  names it on the `start` event. When evidence raised the level, the ticket is noted. The
  `effort_settled` event and the ledger row name the reason.
- **The count.** `detent status` counts sessions and their cost by reason from the ledger's rows
  (`effort_reason`), and says nothing while no row names one.
- **The PRD:** S-5⁸, recorded by PRDR-318 before it was built, now says what was built, and its
  amendment under B-4′ names the fix roles. **The README:** the raises, under Models, and the
  count, under `detent status`.

### Vetoable calls (as built)

1. **`max` for high-risk, not one level up** (the ticket's call 1).
2. **One level per failure** (call 2), counted over all of the ticket's generations. A requeue
   opens a generation, and the attempts before it still say how the code is going.
3. **The neighbours are this run's only** (call 3), and this run is the referee's lifetime. A run
   interrupted and resumed in a new referee starts counting again.
4. **Review sessions follow risk and neighbours** (call 4), **and not failures.** AC 2 names the
   implement and fix attempts. A review is where a risky change is caught, and its level does not
   depend on how many attempts preceded it.

Added while building:

5. **Risk and neighbours raise the fix roles too.** AC 1 names the implement and review sessions.
   Leaving the fix roles at their own level could send a high-risk ticket's fix to a level below
   its implement attempt, under a routing that puts implement below `max`. That contradicts AC 2's
   "one level above the last". With the fix roles raised, every code-writing session of a ticket
   starts from one level, and each failure moves them together.
6. **A role routed to no level** is raised to `max` by risk, and by no step. One level above
   the SDK's own default is not a level Detent can name.
7. **Two surfaces meet** when an entry of one, read as a path, matches a glob of the other,
   either way round. Surfaces are globs (B-1), and no closer test of two globs' overlap exists in
   the code.
8. **"Falsified" is a falsified premise.** An oversized ticket goes to a human, so it counts as an
   escalation. A discovered dependency is about order, not about how hard the code is.
9. **The reason is on the ledger row** (`effort_reason`, optional), which `detent status` sums.
   The `effort_settled` event carries it too. Reading the cost by joining events to rows would be
   a guess.
10. **The note is per raised session.** It names the role, the level, the role's level and why,
    so a ticket's notes show each step.
11. **The routing lives in its own module, `effort-route.ts`.** `referee-context.ts` would have
    passed the 300-line ceiling. `readTransitions` is now exported from `plan-quality.ts` for it.

## Falsification (verification protocol, item 1)

A scratch probe, using only what HEAD has, run in a worktree at HEAD (`07be268`, PRDR-099):

```
× PRDR-328 falsification probe > A: a risk-labelled ticket's implement session runs at max
  → expected [ 'implement', 'xhigh' ] to deeply equal [ 'implement', 'max' ]
× PRDR-328 falsification probe > B: the attempt after a red gate runs one level above the one that failed
  → expected [ [ 'implement', 'xhigh' ], …(1) ] to deeply equal [ [ 'implement', 'xhigh' ], …(1) ]
    (the blind fix ran at xhigh, where max was expected)
Tests  2 failed (2)
```

That is AC 6 as written: at HEAD a risk-labelled ticket's implement session is routed to `xhigh`,
and the attempt after a failed gate to its first attempt's level. On the fix, both pass.

## Mutation battery

Each mutant was applied to a snapshot copy of its file. Then
`tests/kernel/effort-by-risk.test.ts`, `tests/kernel/effort-record.test.ts`,
`tests/sessions/effort-settled.test.ts`, `tests/kernel/ledger.test.ts` and
`tests/kernel/plan-quality.test.ts` ran, and the file was restored from its copy and checked with
`cmp`. The first pass killed 23 of 24. C1 survived: the run's start was held only in the pure
function's tests. The two-run case, added, kills it, re-run against the mutant.

| Mutant | Killed by |
|---|---|
| E1 risk is ignored | the risk cases, the count case, the routing case |
| E2 risk reaches implement only | the risk cases, the count case |
| E3 neighbours are ignored | the neighbour case |
| E4 failures are ignored | the red-gate case, the routing case |
| E5 every failure counts as one | the routing case |
| E6 an equal level replaces the reason | the routing cases |
| E7 a level outside the set steps to `max` | the no-level case |
| E8 surfaces meet one way only (a in b) | the risk-glob case, the evidence case, the surfaces case |
| E9 surfaces meet one way only (b in a) | the evidence case, the surfaces case |
| E10 every line is the run's | the evidence case |
| E11 escalations are ignored | the neighbour case, the evidence case |
| E12 falsified neighbours are ignored | the evidence case |
| E13 another ticket's failures count | the evidence case |
| E14 a risk glob never makes a ticket risky | the risk-glob case, the evidence case |
| E15 the label never makes a ticket risky | the label case, the count case, the evidence case |
| E16 the step is never said | the red-gate case, the neighbour case |
| S1 the session is launched at its role's level | the label case (the backend's calls) |
| S2 the start event names the role's level | the risk cases, the red-gate case, the neighbour case |
| S3 the step is not noted | the red-gate case, the neighbour case |
| S4 the ledger row names no reason | the count case |
| K1 `effort_settled` names no reason | the risk cases, the red-gate case |
| K2 the ledger drops the reason | the count case |
| T1 status says nothing of effort | the count case |
| C1 the run began at the epoch | the two-run case (added) |

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: not run for this ticket. On 2026-10-02 the user asked for the full suite to run
  once, after the last ticket of the batch, and the batch's closing commit records it. The suites
  nearest the change ran instead (see the commit).

## What changed

- `src/kernel/effort-route.ts` (new): `routeEffort`, `effortEvidence`, `surfacesMeet`,
  `effortRouteFor`, `effortStepNote`, `effortTally`.
- `src/kernel/referee-session.ts`: the session's level from the route, the step's note, the reason
  on `effort_settled` and on the ledger row.
- `src/kernel/referee-context.ts`: `startedAt`.
- `src/kernel/session-effort.ts`: `recordEffort` records the reason.
- `src/kernel/ledger.ts`: `RowFields` (was `InitRowFields`) with `effortReason`.
- `src/kernel/plan-quality.ts`: `readTransitions` exported.
- `src/schemas/roles.ts`: `EFFORT_REASONS`. `src/schemas/records.ts`: the ledger's `effort_reason`.
- `src/cli/status.ts`: the count by reason.
- `README.md`, `detent-prd-v3.md`: as above.
- `tests/kernel/effort-by-risk.test.ts` (new): 14 cases.

## Recorded, not fixed

- **Each launch reads all of `transitions.jsonl` and every ticket.** On ksar's scale (547
  tickets) that is milliseconds against a session of minutes. It was not measured.
- **The SDK may still settle below the routed level.** A raise to `max` on a model that cannot
  serve it is recorded by `effort_settled` and noted (PRDR-237), as before.
