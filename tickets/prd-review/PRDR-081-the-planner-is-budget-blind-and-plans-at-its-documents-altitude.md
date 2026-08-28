---
id: PRDR-081
title: "The planner is budget-blind and plans at its documents' altitude"
state: DONE
severity: major
category: gap
labels: ["prd-review", "found-by-execution", "field"]
surface: ["src/init/plan.ts", "src/init/pipeline.ts", "prompts/planner.md"]
prd_refs: ["C-4", "A-1", "A-2", "X-1", "D-16"]
acceptance_criteria:
  - "PLAN receives `session_budget` — the implement turn ceiling, the ticket wall clock in minutes, and the per-generation session ceiling."
  - "The planner prompt states that a ticket is ONE implement session's work inside that budget, and that a larger requirement decomposes into dependent tickets."
  - "The planner prompt requires vertical slices ordered walking-skeleton-first, over infrastructure layers completed ahead of the first end-to-end path."
  - "A test pins the `session_budget` input's exact shape against the configured budgets."
non_goals:
  - "No schema change: ticket size stays a planning judgment, not a validated field — a strict size validator would refuse honest large-but-atomic work."
  - "Does not cap ticket counts; decomposition is bounded by the documents, not by a number in the kernel."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-075", "PRDR-067"]
depends_on: []
---

# PRDR-081 — the planner is budget-blind and plans at its documents' altitude

**Severity:** major · **Category:** gap · **Found by:** the first live init against a
large product specification (ksar-cloud, 2026-08-28) — 27 planning documents in, 32
tickets out.

## Problem

The whole system is budget-bounded: an implement session gets `turns_per_stage` turns,
a generation gets `sessions`, a ticket gets `ticket_wall_clock_ms`. The planner is told
none of it. Its inputs carry the analysis, the docs, the greenfield flag, the bound
slots and the output skeleton — no budget, and no rule about how big a ticket should be.
Neither PRD says a word about granularity either.

So the plan mirrors its input's altitude. Fed a PRD set, the planner emitted roughly one
ticket per requirement cluster: "Node agent binary with containerd, WireGuard mesh, and
tenant isolation" is weeks of engineering with five accurate, ADR-sourced criteria — and
it is one ticket, budgeted at thirty turns and an hour. The failure mode is not an honest
red: the session exhausts its turns on a partial tree, and on a greenfield repo the gates
are near-vacuous (`go test ./...` with no tests exits 0; `go build ./...` passes on
stubs), so a skeleton reaches review wearing a green gate. One judgment layer is left
holding the line that sizing should have held.

Independently, the same plan ordered itself as horizontal layers — control plane, then
transport, then agent, then scheduler — with the first end-to-end deployment at ticket
twenty-two of thirty-two. Integration risk is deferred to exactly where it is most
expensive, and the early tickets have nothing but vacuous gates to verify them.

## Resolution

Two inputs the planner always needed. **`session_budget`** reaches PLAN with the
implement turn ceiling, the ticket wall clock in minutes, and the per-generation session
ceiling, and the prompt states the rule those numbers imply: a ticket is one implement
session's work — roughly one to three hours, as few files as its criteria allow — and a
larger requirement decomposes into dependent tickets. The prompt names the common
failure explicitly, since it is the one observed: too few tickets, each too large.

**Shape** joins size: order the plan as vertical slices, walking skeleton first through
the riskiest integration, infrastructure built only as far as the current slice needs it.
This is the practice Detent already applies to itself — D-16's self-build gate *is* a
walking skeleton, and §13's scoping note says so — never previously taught to the planner
that ships it. Public practice converges on the same unit: spec-driven tooling sizes a
task at one to three hours and 15–30 tasks per feature, and agent-assisted developers
feed plans piece-wise for the same reason.

No schema change. Size stays judgment: a validator refusing large tickets would refuse
honest atomic work too, and P2 does not gain from a number nobody can defend.
