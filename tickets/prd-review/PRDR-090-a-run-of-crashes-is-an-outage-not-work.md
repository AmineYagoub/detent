---
id: PRDR-090
title: "A run of crashes is an outage, not work"
state: DONE
severity: major
category: correctness
labels: ["prd-review", "found-by-execution"]
surface: ["src/kernel/referee-session.ts"]
prd_refs: ["X-1", "X-2", "P6", "D-25"]
acceptance_criteria:
  - "Three consecutive crashed sessions halt the run as a SessionRefusal, regardless of their turn counts."
  - "A session that returns real work resets the streak, so isolated crashes keep PRDR-053's judge-the-tree behaviour."
  - "The honest $0 ledger rows are still recorded before the halt."
non_goals:
  - "Does not retry: the operator re-fires when the backend is back, as with PRDR-072."
  - "Does not reclassify a single crash — one crash with turns is plausible partial work and still marches."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-072", "PRDR-053"]
depends_on: []
---

# PRDR-090 — a run of crashes is an outage, not work

**Severity:** major · **Category:** correctness · **Found by:** a live backend outage
during the PRDR-089 A/B, which ate nine tickets of a release gate in three minutes.

## Problem

PRDR-072 halts a run when a session crashes with ZERO turns — the backend refused it,
nothing happened. A crash WITH turns deliberately keeps PRDR-053's behaviour: partial
work exists, so the gate judges the tree as it stands. Both rules are right in isolation.

An outage produces the second kind. At 09:09 the backend began failing every session:
nineteen consecutive crashes, every one at $0.00, several carrying twenty-plus turns. The
zero-turn rule never fired. Instead each ticket walked its ladder at machine speed —
`IN_PROGRESS → BLIND_FIX → RESEARCH → NEEDS_HUMAN` in about ten seconds — because every
stage's session "returned" instantly with nothing, the gate stayed red, and the ladder
did exactly what it is built to do with a persistently failing ticket. Nine tickets
escalated, their blind-fix and research slots consumed, over work no session performed.
Two A/B trial arms and a benchmark init died in the same window.

The signal PRDR-072 missed is not the turn count. It is **consecutiveness**: one crash
with turns is plausible; nineteen in a row is infrastructure.

## Resolution

The session arm counts consecutive crashed results and halts the run at three, naming
the streak. Any session that returns real work resets the counter, so an isolated crash
keeps marching exactly as PRDR-053 intends and a genuinely hard ticket still gets its
full ladder. The ledger's honest $0 rows are written before the halt, as ever. No retry:
the operator re-fires when the backend is back, which is the same contract PRDR-072
established and the same one this outage's recovery followed.
