---
id: PRDR-147
title: "Two runs on one root each enforced the full ceiling and jointly spent past it"
state: DONE
severity: critical
category: bug
labels: ["prd-review", "found-by-audit", "budgets", "recovered"]
surface: ["src/kernel/run-lock.ts", "src/kernel/run.ts", "tests/kernel/run.test.ts"]
prd_refs: ["X-1‴", "NG4"]
acceptance_criteria: ["A run takes an exclusive root lock on the O_EXCL primitive the claim mechanism already proves.", "The lock is breakable only on a dead pid on the same host."]
non_goals: ["Does not make concurrent runs safe. NG4 stands: they are made to DECLINE, not to cooperate."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-136", "PRDR-168", "PRDR-192"]
depends_on: []
---

# PRDR-147 — two runs, one root, two ceilings

**Severity:** critical · **Category:** bug · **Found by:** the phase-2 audit (`e02cf44`)

> **Recovered 2026-09-09 (PRDR-192).** Filed as an empty file — the filename carried the
> title and nothing else was ever written. Its reasoning survived in the commit that created
> it, and this body is that account. Fields the original never recorded are derived from
> evidence, not invented.

## Problem

The other half of PRDR-136: with the ceiling held per process, two runs on one root each
enforced the full cap and jointly spent past it. Observed later at **$16 against a $10
ceiling, with neither run ever seeing `SpendExhaustedError`** — the episode PRDR-191 cites
when it argues the ceiling was never the backstop X-8 calls it.

## Resolution

A run takes an exclusive root lock on the `O_EXCL` primitive the claim mechanism already
proves, breakable only on a dead pid on the same host. **NG4 stands** — concurrent runs are
not made safe, they are made to decline. PRDR-168 later extended the same lock to `init`.
