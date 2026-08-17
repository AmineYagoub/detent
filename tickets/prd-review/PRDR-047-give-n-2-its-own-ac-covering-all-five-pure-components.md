---
id: PRDR-047
title: "Give N-2 its own AC covering all five components it declares pure"
state: DONE
severity: minor
category: testability
labels: ["prd-review"]
surface: ["foreman-prd-v2.md"]
prd_refs: ["N-2", "C-2", "X-2", "X-5", "X-7", "X-3", "ARCH-1"]
acceptance_criteria: ["N-2 carries an AC line of its own, in the same form as N-1 and N-3, satisfying the reading guide's claim that every requirement has a machine-checkable AC.", "The AC covers all five components N-2 names — discovery, classification, signatures, resolver, transitions — not only discovery.", "The AC states what determinism means per component (byte-identical output for discovery; equal output for equal input for the pure functions) so a reviewer can tell the two forms apart.", "N-2's AC does not merely cross-reference C-2's byte-identical discovery fixture; a reader can grade N-2 without navigating to another requirement."]
non_goals: ["Does not add a purity or immutability requirement to any component N-2 does not already name.", "Does not require property-based testing specifically; table-driven repeat-execution tests satisfy the AC.", "Does not duplicate C-2's discovery fixture — N-2's AC may subsume it by reference as one of the five, but must cover the other four itself."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-047 — Give N-2 its own AC covering all five components it declares pure

**Severity:** minor · **Category:** testability · **Amends:** N-2

**Applied in 2.0-draft.5.** See the PRD's draft.5 amendment note for where this ticket was reconciled against another.

## Problem

N-2 names five components as pure and asserts that identical inputs yield identical outputs, then stops — it is one of the few requirements in the document with no AC line. The reading guide states that every requirement has a machine-checkable acceptance criterion, so this is a self-inconsistency rather than a stylistic omission.

Coverage for the five is uneven and lives elsewhere. Discovery has a byte-identical fixture assertion, but it sits in C-2, not N-2. Signatures are covered by X-7's oracle stability tests. The resolver has a property test over counter states in X-2. **Classification and transitions have no determinism assertion anywhere in the document** — X-5's ACs test the flake filter's *behaviour* (green rerun permits quarantine, red rerun enters the ladder), not that classifying the same output twice yields the same class, and X-3's AC tests that illegal pairs raise, not that legal pairs are reproducible.

The gap has teeth because determinism is what ARCH-1 relies on: the kernel is trusted to decide, and a classifier that is order- or environment-sensitive would make the ladder non-reproducible while every existing AC still passed. It also matters for N-5 — a run is reconstructable from `transitions.jsonl` only if replaying the same inputs produces the same transitions.

Note the two forms of determinism are not the same claim. Discovery's is byte-identical serialized output across process invocations, which is a stronger property involving key ordering and path normalization. The other four are referential transparency of a pure function within a process. Collapsing them under one sentence hides that distinction from whoever writes the tests.

## Evidence (verbatim from foreman-prd-v2.md)

- Reading guide: "Every requirement has a machine-checkable acceptance criterion (*AC*)."
- N-2: "**N-2 Determinism:** discovery, classification, signatures, resolver, and transitions are pure code; identical inputs ⇒ identical outputs."
- N-1 (for contrast, carries its own criterion): "**N-1 Portability = repositories, not backends:** fixture matrix ≥3 ecosystems (TS/Node service, Python service, Go or Rust CLI) passes E2E with zero kernel changes (bindings-only differences)."
- C-2 AC: "discovery of the fixture matrix produces byte-identical `discovery.json` across runs."
- X-7: "classification and signatures are code, zero tokens. *AC:* oracle signature-stability tests port."
- X-2 AC: "property test over all counter states"
- X-3 AC: "table is data; every (state,event) pair outside it raises"
- N-5: "`transitions.jsonl` + ledger + journals reconstruct any run without model output."

## Proposed change

Replace N-2 with:

"**N-2 Determinism:** discovery, classification, signatures, resolver, and transitions are pure code; identical inputs ⇒ identical outputs. Two forms are required and tested separately: **serialization determinism** for discovery — the emitted `discovery.json` is byte-identical across process invocations, which constrains key ordering and path normalization; and **referential transparency** for the other four — repeated evaluation on equal input yields equal output, with no dependence on wall-clock, environment, filesystem order, or iteration order of a hash container.
*AC:* one determinism suite covering all five — discovery emits byte-identical JSON across two separate process invocations on every fixture; classification returns the same class for the same gate output over 100 repeats with shuffled invocation order; signatures satisfy X-7's stability tests; the resolver's property test covers all reachable counter states; replaying a recorded event sequence against the transition table reproduces the recorded `transitions.jsonl` exactly. No component in the list may be omitted from the suite."

## Acceptance criteria

1. N-2 carries an AC line of its own, in the same form as N-1 and N-3, satisfying the reading guide's claim that every requirement has a machine-checkable AC.
2. The AC covers all five components N-2 names — discovery, classification, signatures, resolver, transitions — not only discovery.
3. The AC states what determinism means per component (byte-identical output for discovery; equal output for equal input for the pure functions) so a reviewer can tell the two forms apart.
4. N-2's AC does not merely cross-reference C-2's byte-identical discovery fixture; a reader can grade N-2 without navigating to another requirement.

## Non-goals

- Does not add a purity or immutability requirement to any component N-2 does not already name.
- Does not require property-based testing specifically; table-driven repeat-execution tests satisfy the AC.
- Does not duplicate C-2's discovery fixture — N-2's AC may subsume it by reference as one of the five, but must cover the other four itself.
