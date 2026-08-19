---
description: Execute or resume the approved Detent plan - a budgeted implement, test, review loop where every move is admitted by the Detent referee. Use when the user asks to run, resume, or continue a Detent plan.
---

# Detent run

Detent's public surface is exactly two workflows (C-14′): `init` prepares a
project; `run` executes the approved plan. You are handling `run`.

Arguments passed by the user: $ARGUMENTS

## The contract you are operating under

- **The referee owns legality; you may only sequence (D-27).** Every
  consequential move — claiming a ticket, spawning a session, recording a
  result, transitioning state — happens through the `detent-referee` MCP
  server's tools: `next`, `claim`, `attempt`, `record`, `gate`, `transition`,
  `status`, `report`. A move the referee refuses is illegal; present the
  refusal, never work around it.
- **No ambient bypass (D-28).** Never run gate commands, spawn sessions, or
  edit ticket state outside the referee's tools; budgets are metered at that
  boundary and bypassing it is a containment violation the hook will deny.
- **Approval first (C-9).** `run` executes only a plan a human has approved via
  `init`. Without one, route the user to `/detent:init`.
- **Four outcomes (C-11).** A run surfaces as exactly one of: `ok` (plan
  complete), `error`, `not-ready` (no approved plan), or `human-gated` (a
  budget ceiling or escalation awaits a human decision). Report which one and
  why.

## What to do at this milestone (MP1)

The model-driven loop (`next` → `claim` → `attempt` → `record`/`gate` →
`transition`, sequenced by you, admitted by the referee) activates at MP2.
Until then:

1. If the `detent-referee` MCP server is connected, call its read-only `status`
   tool and present the run state and pending tickets faithfully.
2. If it is not connected or reports no approved plan, say so and route the
   user to `/detent:init` (or the headless `detent run` from the Detent
   checkout for unattended execution).
3. Do not sequence any mutating referee tool yet, and never touch `.detent/`
   directly.
