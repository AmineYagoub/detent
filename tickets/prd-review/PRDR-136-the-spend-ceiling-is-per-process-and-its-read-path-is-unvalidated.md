---
id: PRDR-136
title: "The spend ceiling was enforced against an in-memory figure seeded once at construction, and its read path was an unvalidated cast"
state: DONE
severity: critical
category: bug
labels: ["prd-review", "found-by-audit", "budgets", "recovered"]
surface: ["src/kernel/ledger.ts", "tests/kernel/ledger.test.ts"]
prd_refs: ["X-1‴", "D-25"]
acceptance_criteria: ["The launch gate RE-READS the ledger file rather than trusting a figure seeded at construction.", "The file is validated with the schema that wrote it."]
non_goals: ["Does not make concurrent runs safe; PRDR-147 makes them decline."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-147", "PRDR-191", "PRDR-192"]
depends_on: []
---

# PRDR-136 — a ceiling per process

**Severity:** critical · **Category:** bug · **Found by:** the phase-2 audit (`e02cf44`)

> **Recovered 2026-09-09 (PRDR-192).** Filed as an empty file — the filename carried the
> title and nothing else was ever written. Its reasoning survived in the commit that created
> it, and this body is that account. Fields the original never recorded are derived from
> evidence, not invented.

## Problem

The spend ceiling was enforced against a figure **seeded once at construction and incremented
in memory**, so two runs on one root each enforced the full cap and jointly spent past it —
silently, because per-ticket claims correctly kept them off the same ticket, so nothing else
looked wrong.

The read path was an unvalidated cast, which the same fix closed. Validated with the schema
that wrote it, three real shapes were caught: **a string cost concatenated** (`5`, `"5"`, `3`
gave `"553"`), a negative subtracted, and `1e999` refused every launch.
