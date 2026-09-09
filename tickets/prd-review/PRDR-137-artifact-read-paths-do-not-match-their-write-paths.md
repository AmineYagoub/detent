---
id: PRDR-137
title: "Four artifacts were validated on write and cast on read, so a torn or stale file took five commands down with no filename"
state: DONE
severity: major
category: bug
labels: ["prd-review", "found-by-audit", "recovered"]
surface: ["src/init/plan-slices.ts", "src/kernel/tickets/readers.ts", "src/kernel/tickets/mutations.ts", "src/kernel/journal.ts"]
prd_refs: ["F-3′"]
acceptance_criteria: ["Every artifact validated on write is validated on read, with the same schema.", "A parse failure names the file it came from."]
non_goals: ["Does not change the artifact schemas themselves."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-151", "PRDR-192"]
depends_on: []
---

# PRDR-137 — validated on write, cast on read

**Severity:** major · **Category:** bug · **Found by:** the phase-2 audit (`e02cf44`)

> **Recovered 2026-09-09 (PRDR-192).** Filed as an empty file — the filename carried the
> title and nothing else was ever written. Its reasoning survived in the commit that created
> it, and this body is that account. Fields the original never recorded are derived from
> evidence, not invented.

## Problem

Four artifacts were validated on write and cast on read.

- **The slice cache** advertised itself as a validated trust boundary while checking 3 of 11
  fields, so a cache from an older build was a *hit* that crashed init mid-PLAN.
- **Ticket writes** truncated in place on every transition, and `readTicket` parsed outside
  the guard that names the file, so one torn ticket took `ready`, `pool`, `status`, `report`
  and `doctor` down together **with no filename to point at.**
- **Both journal readers** parsed unguarded — including `unfinished`, which exists to be read
  after a crash, which is exactly what tears the last line of an append-only file.
