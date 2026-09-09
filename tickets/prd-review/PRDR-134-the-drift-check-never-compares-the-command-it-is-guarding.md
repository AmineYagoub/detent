---
id: PRDR-134
title: "SEC-5 compared `config_hash` and never `resolved` — the only field that executes"
state: DONE
severity: critical
category: gap
labels: ["prd-review", "found-by-audit", "security", "recovered"]
surface: ["src/adapter/drift.ts", "tests/adapter/drift.test.ts"]
prd_refs: ["SEC-5", "V-3"]
acceptance_criteria: ["The drift check compares the BOUND COMMAND against what discovery finds, not only a hash of the config region.", "A committed `bindings.json` pairing a validating hash with an arbitrary command is refused."]
non_goals: ["Does not change the binding schema."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-192"]
depends_on: []
---

# PRDR-134 — the hash that guarded the wrong field

**Severity:** critical · **Category:** gap · **Found by:** the phase-1 audit (`e192c25`)

> **Recovered 2026-09-09 (PRDR-192).** This ticket was filed as an empty file: the
> filename carried the title and nothing else was ever written. Its reasoning survived in
> the commit that created it, and this body is that account. Fields the original never
> recorded are derived from evidence — `surface` from the files the commit changed,
> `state` from the id being cited in shipped code — not invented.

## Problem

SEC-5 compared `config_hash` and never `resolved`, the only field that executes.
`config_hash` is computable from the repository's own config region, so **a committed
`bindings.json` could pair a validating hash with an arbitrary command** and the first gate
would run it through a shell with the operator's full environment.

## Resolution

The bound command is now compared to what discovery finds.
