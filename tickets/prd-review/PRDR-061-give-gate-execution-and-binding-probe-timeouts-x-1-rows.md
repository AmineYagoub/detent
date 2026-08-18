---
id: PRDR-061
title: "Give the gate-execution and binding-probe timeouts X-1 rows — two ceilings route nowhere and cannot be configured"
state: READY
severity: major
category: gap
labels: ["prd-review"]
surface: ["detent-prd-v2.md"]
prd_refs: ["X-1", "X-5", "V-1", "P6", "F-1", "N-6"]
acceptance_criteria: ["Every timeout Detent enforces appears in X-1's table with a default, a scope, and a breach target, so X-1's claim that the config key set is enumerable from the table alone is true.", "The gate-execution timeout has a stated default, so two conforming implementations classify the same slow suite the same way.", "The PRD states the relationship between a gate timeout and X-5: a timed-out gate is a red gate with no exit status, and what the flake filter does with it is defined rather than inferred.", "The binding-probe timeout of V-1 is distinguishable from the gate-execution timeout, or the PRD says they are the same figure."]
non_goals: ["Does not change X-5's rule that a timeout is treated as environmental until a rerun proves otherwise.", "Does not propose a per-slot timeout; one figure per scope is sufficient for v1.", "Does not alter `ticket_wall_clock_ms`, which bounds the ticket rather than any single gate."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-061 — Give the gate-execution and binding-probe timeouts X-1 rows

**Severity:** major · **Category:** gap · **Amends:** X-1, V-1

## Problem

Detent enforces at least two timeouts that X-1's table does not contain.

**The gate-execution timeout.** Every gate runs under one — a gate that never returns would hang a run indefinitely, and X-5 explicitly contemplates the timeout case by treating a null exit status as environmental. No figure is given anywhere in the document.

**The binding-probe timeout.** V-1 requires every candidate to be "executed once with a timeout before it may be approved", and derives watch-mode detection from it: "timeout with no exit ⇒ rejected candidate". The whole mechanism turns on a duration the PRD never states.

Both are ceilings in P6's sense — a bound on a thing that would otherwise not terminate — and X-1 says its table is complete: "the set a config-load validator must accept is enumerable from this table alone." It is not. A config-load validator built from X-1 rejects a config that sets a gate timeout, because the key does not exist in the enumerable set. So an operator whose integration suite legitimately takes twenty minutes has no way to say so.

The values are not cosmetic. The gate timeout feeds X-5 directly: a timed-out gate has no exit status, X-5 classifies that as environmental, the flake filter spends its one rerun on it, and the rerun times out too — so a suite that is merely slower than the timeout consumes `flake_reruns` and then enters the ladder as though it were a real failure. Set the figure too low and slow suites burn ladder budget; set it too high and a watch-mode binding stalls `init` for as long as it takes to notice. Leaving both to the implementation is exactly what N-6's no-deviation rule exists to prevent, and the Python reference's own choices (900s for a gate, 600s for the validation gate) are not carried into this document.

This surfaced at implementation: T-020 needed a default gate timeout and T-026 needed a probe timeout, and both were invented.

## Evidence (verbatim from detent-prd-v2.md)

- X-1: "Every ceiling is a named key in `config.json`'s budgets object (F-1), so the set a config-load validator must accept is enumerable from this table alone. `run_spend_usd` is the only run-scoped ceiling and is the cross-generation backstop of X-8; it has no v1 default because there is no defensible universal figure — `init` requires an explicit value and refuses to write a config without one."
- V-1: "Every proposed binding is executed once with a timeout before it may be approved; watch-mode is detected (timeout with no exit ⇒ rejected candidate with explanation)."
- X-5: "A suspected flake is re-run once in isolation; a **green rerun is the sole evidence** that permits quarantine (ticket linked `discovered_from`, nothing charged) and continuation. A red rerun enters the ladder regardless of pattern class; pattern matching alone can never mark a failure non-actionable."
- P6: "**Budgets are hard.** Every loop has a counter; every counter has a ceiling; every ceiling routes to a human."
- N-6: "implementation may not \"improve\" the architecture in flight; divergence requires a PRD amendment (tickets tagged `prd-review`) first"

## Proposed change

**1. Add two rows to X-1.**

| Counter | Max | Scope | Breach target |
|---|---|---|---|
| `gate_timeout_ms` | 900_000 | gate execution | red gate with no exit status (X-5) |
| `binding_probe_timeout_ms` | 120_000 | binding probe | rejected candidate, watch-mode (V-1) |

The gate default matches the porting oracle's 900s. The probe figure is deliberately shorter: a probe is asking "does this terminate at all", and the answer arrives sooner than a full suite.

**2. Say what a timed-out gate is.** Append to X-5: "A gate that exceeds `gate_timeout_ms` is killed and treated as a red gate with no exit status. The classifier reports it as environmental, so it is eligible for the one isolated rerun; a rerun that also times out is a red rerun and enters the ladder, exactly as any other persistent failure does. A timeout is never quarantined without a green rerun."

**3. Distinguish the two figures in V-1.** Amend to: "Every proposed binding is executed once under `binding_probe_timeout_ms` before it may be approved; watch-mode is detected (timeout with no exit ⇒ rejected candidate with explanation). An approved gate runs under `gate_timeout_ms` thereafter."

## Acceptance criteria

1. Every timeout Detent enforces appears in X-1's table with a default, a scope, and a breach target, so X-1's claim that the config key set is enumerable from the table alone is true.
2. The gate-execution timeout has a stated default, so two conforming implementations classify the same slow suite the same way.
3. The PRD states the relationship between a gate timeout and X-5: a timed-out gate is a red gate with no exit status, and what the flake filter does with it is defined rather than inferred.
4. The binding-probe timeout of V-1 is distinguishable from the gate-execution timeout, or the PRD says they are the same figure.

## Non-goals

- Does not change X-5's rule that a timeout is treated as environmental until a rerun proves otherwise.
- Does not propose a per-slot timeout; one figure per scope is sufficient for v1.
- Does not alter `ticket_wall_clock_ms`, which bounds the ticket rather than any single gate.
