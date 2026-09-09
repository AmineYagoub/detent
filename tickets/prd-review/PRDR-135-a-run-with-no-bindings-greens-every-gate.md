---
id: PRDR-135
title: "`runScopedGates` returned null when no binding matched, and the caller read absence as a pass — minting GATE_GREEN with zero commands executed"
state: DONE
severity: critical
category: bug
labels: ["prd-review", "found-by-audit", "verification", "recovered"]
surface: ["src/kernel/referee-gate.ts", "src/kernel/run.ts"]
prd_refs: ["V-1″", "P2"]
acceptance_criteria: ["No bound gate is UNVERIFIABLE, never a pass.", "`run` refuses at startup beside its config and approval preconditions."]
non_goals: ["Does not change how bindings are discovered."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-192"]
depends_on: []
---

# PRDR-135 — the gate that greened on nothing

**Severity:** critical · **Category:** bug · **Found by:** the phase-2 audit (`e02cf44`)

> **Recovered 2026-09-09 (PRDR-192).** Filed as an empty file — the filename carried the
> title and nothing else was ever written. Its reasoning survived in the commit that created
> it, and this body is that account. Fields the original never recorded are derived from
> evidence, not invented.

## Problem

`runScopedGates` returned `null` when no binding matched any requested slot, and the caller
read it as a pass — minting a real GATE_GREEN carrying the evidence string `"no bound gates"`.
So a `bindings.json` **deleted, gitignored or never committed sent every ticket to DONE with
zero verification commands executed**, merged each into the run branch, and exited 0.

A corrupt bindings file correctly threw. It was specifically *absence* that failed open —
the V-1‴ shape exactly: a gate that exits 0 having verified nothing.
