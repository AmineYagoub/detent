---
id: PRDR-140
title: "`ticket_wall_clock_ms` had exactly one enforcement site, so the model-driven driver had no time check at all"
state: DONE
severity: major
category: gap
labels: ["prd-review", "found-by-audit", "driver-parity", "recovered"]
surface: ["src/kernel/run.ts", "src/kernel/referee-session.ts", "src/kernel/budgets.ts"]
prd_refs: ["X-1⁗", "ARCH-2"]
acceptance_criteria: ["The ceiling moves to the launch seam where `sessions` and `run_spend_usd` already live, so BOTH drivers inherit it and ARCH-2 parity is true by construction rather than by duplication.", "The clock is the CLAIM's timestamp, not the generation's `started_at`, which would date from a requeue days old."]
non_goals: ["The outage backoff is deliberately NOT moved: waiting is something a loop does, and the referee has none."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-181", "PRDR-192"]
depends_on: []
---

# PRDR-140 — a ceiling one driver enforced

**Severity:** major · **Category:** gap · **Found by:** the phase-3 audit (`7b652d1`)

> **Recovered 2026-09-09 (PRDR-192).** Filed as an empty file — the filename carried the
> title and nothing else was ever written. Its reasoning survived in the commit that created
> it, and this body is that account. Fields the original never recorded are derived from
> evidence, not invented.

## Problem

`ticket_wall_clock_ms` had exactly one enforcement site, the headless loop, while
`skills/run/SKILL.md` — **the published program the model-driven driver executes** — has no
time check at all. The canonical ARCH-2 shape: a control on one driver and not the other.

## Resolution

It moves to the launch seam where `sessions` and `run_spend_usd` already live, so both drivers
inherit it and parity becomes true by construction. The clock is the claim's timestamp rather
than the generation's `started_at`, which would date from a requeue days old.

The outage backoff is deliberately left where it is: waiting is something a loop does, and the
referee has none.
