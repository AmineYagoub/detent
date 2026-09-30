---
id: PRDR-328
title: "Every run session of a role gets the same effort, whatever the ticket risks and whatever its attempts have shown. S-5⁵ routes implement and review to xhigh for every ticket. A ticket the plan labels risky, or whose surface the config's risk globs match, runs at the same level as a rename. A ticket that failed its gates or was falsified retries at the same level until X-2's ladder moves it to Opus. The user asked on 2026-09-30 for effort set by risk and by code quality. Risk will set where a ticket starts, and evidence will move it, only up. A lower starting level for low-risk tickets waits for measured run outcomes (D-33)"
state: OPEN
severity: major
category: quality
labels: ["prd-review", "cost-strategy", "S-5⁸", "S-5⁵", "B-4′", "X-2", "D-33", "effort", "risk"]
surface: ["src/kernel/session-effort.ts", "src/kernel/referee-session.ts", "src/kernel/session-inputs.ts", "src/kernel/outcomes.ts", "src/schemas/roles.ts", "src/cli/status.ts", "tests/kernel/effort-record.test.ts", "tests/kernel/effort-by-risk.test.ts", "tests/sessions/effort-settled.test.ts", "README.md", "detent-prd-v3.md"]
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

## Falsification (to run against HEAD when this is built)

- A risk-labelled ticket's implement session is routed to `xhigh`.
- A ticket's second implement attempt, after a failed gate, is routed to the level of its first.
