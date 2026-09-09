---
id: PRDR-142
title: "`--max-tickets tenn` yielded NaN and was silently dropped; `model_routing` accepted any key; ENFORCEMENT_SITES was tested for a totality the compiler already guaranteed"
state: DONE
severity: major
category: bug
labels: ["prd-review", "found-by-audit", "recovered"]
surface: ["src/cli/run.ts", "src/kernel/budgets.ts", "src/kernel/worstcase.ts", "tests/oracle/budgets.test.ts"]
prd_refs: ["X-1", "PRDR-114", "V-1‴"]
acceptance_criteria: ["A non-numeric `--max-tickets` is refused, never silently dropped.", "`model_routing` rejects an unknown role key.", "The ENFORCEMENT_SITES test READS the named module and requires it to mention the ceiling."]
non_goals: ["Deferred deliberately: collapsing `fs/checkpoints.ts`'s unused resume helpers into `init/machine.ts`'s live implementation. The two use different hash schemes and must be shown to agree first — that belongs with PRDR-144."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-144", "PRDR-192"]
depends_on: []
---

# PRDR-142 — a dropped limit, an unvalidated routing, a stale map

**Severity:** major · **Category:** bug · **Found by:** the phase-4 audit (`ccdc501`)

> **Recovered 2026-09-09 (PRDR-192).** Filed as an empty file — the filename carried the
> title and nothing else was ever written. Its reasoning survived in the commit that created
> it, and this body is that account. Fields the original never recorded are derived from
> evidence, not invented.

## Problem

- `--max-tickets tenn` yielded `NaN` and the option was **silently dropped**, so the full pool
  ran against the full ceiling having been asked for a bound.
- `model_routing` accepted any key, so a typo routed that role to the runtime default forever.
- `ENFORCEMENT_SITES` was tested for totality, which `satisfies Record<CeilingKey, string>`
  already guarantees at compile time — so the test **could not notice an entry becoming
  untrue. Two had.**

The replacement test reads the named module and requires it to mention the ceiling. It found
the second one.
