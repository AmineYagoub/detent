---
id: PRDR-138
title: "A stream ending with no result parsed as ok:true, so a session that died on the wire reset the outage streak and reported a budget breach at $0"
state: DONE
severity: major
category: bug
labels: ["prd-review", "found-by-audit", "telemetry", "recovered"]
surface: ["src/kernel/referee-session.ts", "src/kernel/ledger.ts"]
prd_refs: ["S-4″", "PRDR-112"]
acceptance_criteria: ["A stream ending with no result message is a CRASHED session, flagged, never a success.", "The outage streak is not reset by a transport death, so CRASH_STREAK_HALT remains reachable."]
non_goals: ["Does not change the ladder itself."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-187", "PRDR-192"]
depends_on: []
---

# PRDR-138 — a transport death that read as success

**Severity:** major · **Category:** bug · **Found by:** the phase-2 audit (`e02cf44`)

> **Recovered 2026-09-09 (PRDR-192).** Filed as an empty file — the filename carried the
> title and nothing else was ever written. Its reasoning survived in the commit that created
> it, and this body is that account. Fields the original never recorded are derived from
> evidence, not invented.

## Problem

A stream ending with no result message parsed as `ok: true` with no crashed flag. So the
ledger took a $0 row unflagged, the journal recorded a successful end for a session that died
on the wire, and **the success branch reset the outage streak.**

A repeated backend outage could therefore never reach `CRASH_STREAK_HALT`, and the operator
was told "budget breach", at $0, about an outage. PRDR-187 later found the same branch
discarding the reason and blinding the retry.
