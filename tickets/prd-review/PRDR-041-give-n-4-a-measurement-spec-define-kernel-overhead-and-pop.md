---
id: PRDR-041
title: "Give N-4 a measurement spec: define kernel overhead, percentile, and population"
state: READY
severity: minor
category: testability
labels: ["prd-review"]
surface: ["foreman-prd-v2.md"]
prd_refs: ["N-4", "N-2", "X-3", "F-4", "§14"]
acceptance_criteria: ["N-4's text names which operations count as kernel overhead and which are excluded, such that a reader can classify checkpoint fsync, JSONL append, and zod validation from that sentence alone.", "N-4 states a percentile and a sample population (transition count and whether gates are stubbed), and its AC is decidable from a single benchmark run's output without human judgement.", "The reading guide's claim that every requirement carries a machine-checkable AC holds for N-4 — it has an AC line of its own, in the same form as N-1 and N-3.", "A benchmark harness location is named, and the AC states whether a regression fails CI or is reported only."]
non_goals: ["Does not change the 100ms target itself, nor add any performance requirement to the verification adapter or session layer — gates dominating wall time (N-4's own second clause) stays the design intent.", "Does not require the benchmark to run on every PR; a nightly or release-gated occasion satisfies this ticket as long as the occasion is named.", "Does not introduce a §14 metrics row for kernel latency."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-041 — Give N-4 a measurement spec: define kernel overhead, percentile, and population

**Severity:** minor · **Category:** testability · **Amends:** N-4

## Problem

N-4 states a number with no measurement definition. Three terms are load-bearing and undefined.

*What counts as overhead.* A transition applies an event to the machine, but the surrounding work is unattributed: zod validation of the artifact that produced the event (§10), the `transitions.jsonl` append (F-1), and a content-addressed checkpoint write with its hash computation (F-4) all occur per transition. An implementer measuring only `machine.apply` and one measuring the full persist cycle will report figures an order of magnitude apart and both claim conformance.

*Which statistic.* "<100ms per transition" admits mean, median, p95, p99, or absolute-max readings. A run whose transitions average 8ms but whose checkpoint-heavy phase boundaries take 400ms passes under mean and fails under max.

*Over what.* No population, no transition count, and no statement of whether gates are stubbed. Since gates are the dominant wall-time cost by N-4's own second clause, an end-to-end measurement is nearly all gate time and the kernel figure is unrecoverable from it.

The reading guide asserts that every requirement has a machine-checkable AC. N-4 is one of the requirements that carries none — N-1 and N-3 are testable as written, N-4 is not.

## Evidence (verbatim from foreman-prd-v2.md)

- Reading guide: "Every requirement has a machine-checkable acceptance criterion (*AC*)."
- N-4: "**N-4 Performance:** kernel overhead <100ms per transition; gates dominate wall time by design."
- F-4: "each phase persists outputs plus a hash of its inputs"
- F-1 local set: "`transitions.jsonl`"
- §10: "All JSON, schema-validated (zod), `schema_version`-stamped."

## Proposed change

Replace N-4 with:

"**N-4 Performance:** kernel overhead is the wall time from event construction to the transition being durable — event validation, `machine.apply`, the `transitions.jsonl` append, and any checkpoint write triggered by the transition. It excludes gate execution, session time, and network. Budget: **p95 < 100 ms** and **max < 500 ms** over a synthetic run of ≥500 transitions traversing every X-3 row at least once, with gates stubbed to a constant-time green. Gates dominate wall time by design and are excluded from this figure.
*AC:* `tests/perf/transition-overhead.bench.ts` reports p95 and max over the synthetic run; CI fails on p95 ≥ 100 ms or max ≥ 500 ms; the harness prints the per-component split (validate / apply / append / checkpoint) so a regression names its cause."

## Acceptance criteria

1. N-4's text names which operations count as kernel overhead and which are excluded, such that a reader can classify checkpoint fsync, JSONL append, and zod validation from that sentence alone.
2. N-4 states a percentile and a sample population (transition count and whether gates are stubbed), and its AC is decidable from a single benchmark run's output without human judgement.
3. The reading guide's claim that every requirement carries a machine-checkable AC holds for N-4 — it has an AC line of its own, in the same form as N-1 and N-3.
4. A benchmark harness location is named, and the AC states whether a regression fails CI or is reported only.

## Non-goals

- Does not change the 100ms target itself, nor add any performance requirement to the verification adapter or session layer — gates dominating wall time (N-4's own second clause) stays the design intent.
- Does not require the benchmark to run on every PR; a nightly or release-gated occasion satisfies this ticket as long as the occasion is named.
- Does not introduce a §14 metrics row for kernel latency.
