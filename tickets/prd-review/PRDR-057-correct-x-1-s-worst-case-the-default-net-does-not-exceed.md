---
id: PRDR-057
title: "Correct X-1's worst case: it computes to 14, so the default net does not exceed it and no default config loads"
state: READY
severity: major
category: contradiction
labels: ["prd-review"]
surface: ["detent-prd-v2.md"]
prd_refs: ["X-1", "X-2", "X-3", "X-8", "P6", "M0"]
acceptance_criteria: ["The default budgets in X-1 satisfy X-1's own config-load assertion: the default net strictly exceeds the computed worst case, so a config written by `init` with no overrides loads.", "X-1's informative figure matches what the exhaustive walk over the X-3 table actually produces, or the note is removed rather than left contradicting the computation.", "The PRD states whether the APPROVED close-check re-entering the ladder is intended, since that path is what carries the worst case from 12 to 14.", "A regression pin exists so that a table or budget edit which moves the computed figure fails a test rather than silently invalidating the default config."]
non_goals: ["Does not change X-1's 'computed, never quoted' rule — this ticket makes the quoted informative figure agree with the computation, not the reverse.", "Does not remove the APPROVED close-check from X-2's caller set; if that path is intended, the net budget is what moves.", "Does not alter any per-slot unit budget (blind, informed, review, research all stay at 1)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-057 — Correct X-1's worst case: it computes to 14, so the default net does not exceed it and no default config loads

**Severity:** major · **Category:** contradiction · **Amends:** X-1

## Problem

X-1 requires the implementation to derive `maxPossibleSessions(state_machine, budgets)` from the transition table and to assert `sessions_net > computed` **at config load**, rejecting a violating configuration before any run. It then notes informatively that with the default budgets the computed worst case is 12 and the default net is 14.

Implemented and executed at T-014, the exhaustive walk over the X-3 table returns **14**, not 12. Since the assertion is strict, `14 > 14` is false and **the default configuration is rejected at load**. A user who runs `init` and accepts every default gets a config that cannot start a run.

The extra two launches are not a walk artifact. They come from the `APPROVED | GATE_RED | resolveRed` row, which X-2 names explicitly as a caller — the close-check can send an already-approved ticket back into the ladder, and each re-entry launches a fix session and then a second review. The worst path is:

```
CLAIMED→DIAGNOSED · REPRO_AS_PREDICTED→IN_PROGRESS
PREMISE_FALSIFIED→DIAGNOSED · REPRO_AS_PREDICTED→IN_PROGRESS   (×2, to the hypothesis ceiling)
GATE_GREEN→IN_REVIEW · REVIEW_APPROVE→APPROVED
GATE_RED→BLIND_FIX · GATE_GREEN→IN_REVIEW · REVIEW_APPROVE→APPROVED
GATE_RED→RESEARCH · RESEARCH_VALID→INFORMED_FIX · GATE_GREEN→IN_REVIEW
REVIEW_CHANGES→REVIEW_FIX · GATE_GREEN→IN_REVIEW
```

Fourteen entries into a session-launching state, every edge a real table row, no cycle truncation anywhere in the walk.

The PRD's own arithmetic hints at the same number. Draft.1 decomposed it as "diagnose ≤3, implement ≤3 via falsified recycles, fix 1, research 1, informed 1, reviews ≤4 minus overlaps, review-fix 1" — which sums to 14 before an unexplained "minus overlaps" reduction to 12. The graph shows there are no overlaps to subtract on the worst path.

This is exactly the failure "computed, never quoted" exists to prevent, and it survived six drafts because the walk had never been executed. The rule was right; only the quoted figure beside it was wrong.

## Evidence (verbatim from detent-prd-v2.md)

- X-1: "The worst-case launch count is **computed, never quoted**: the implementation derives `maxPossibleSessions(state_machine, budgets)` from the transition table and asserts `sessions_net > computed` both in the test suite **and at config load** — a configuration violating it is rejected before any run."
- X-1: "(Informative, non-normative: with these defaults the computed worst case is 12 and the default net is 14; both are per-generation, X-8.)"
- X-1: "| `sessions` (net) | 14 | ticket/generation | NEEDS_HUMAN |"
- X-2: "Caller set, closed and property-tested: `IN_PROGRESS`, `BLIND_FIX`, `REVIEW_FIX`, and the `APPROVED` close-check."
- X-3: "| APPROVED | GATE_RED | resolveRed |"
- P6: "**Budgets are hard.** Every loop has a counter; every counter has a ceiling; every ceiling routes to a human."

## Proposed change

**1. Raise the default net above the computed figure.** In X-1's table, change the `sessions` row default from 14 to **18**, leaving headroom above the computed 14 rather than sitting exactly on it — the assertion is strict, and a figure chosen to just clear today's computation breaks on the next table edit.

**2. Correct or drop the informative note.** Replace it with: "(Informative, non-normative: with these defaults the computed worst case is 14 and the default net is 18. The figure is derived, so it is reported by `doctor` rather than trusted from this sentence; if the two ever disagree, the computation is authoritative.)"

**3. Say whether the close-check re-entry is intended.** Append to X-2: "The `APPROVED` close-check may re-enter the ladder, so a ticket can traverse fix and review stages more than once within a generation. That is deliberate — a close-check red is a real failure — and it is what carries the worst case above the single-pass figure."

**4. Pin it.** Append to X-1's AC: "…and a regression test pins the computed figure, so a table or budget edit that moves it fails CI rather than silently invalidating the shipped defaults."

## Acceptance criteria

1. The default budgets in X-1 satisfy X-1's own config-load assertion: the default net strictly exceeds the computed worst case, so a config written by `init` with no overrides loads.
2. X-1's informative figure matches what the exhaustive walk over the X-3 table actually produces, or the note is removed rather than left contradicting the computation.
3. The PRD states whether the APPROVED close-check re-entering the ladder is intended, since that path is what carries the worst case from 12 to 14.
4. A regression pin exists so that a table or budget edit which moves the computed figure fails a test rather than silently invalidating the default config.

## Non-goals

- Does not change X-1's "computed, never quoted" rule — this ticket makes the quoted informative figure agree with the computation, not the reverse.
- Does not remove the APPROVED close-check from X-2's caller set; if that path is intended, the net budget is what moves.
- Does not alter any per-slot unit budget (blind, informed, review, research all stay at 1).
