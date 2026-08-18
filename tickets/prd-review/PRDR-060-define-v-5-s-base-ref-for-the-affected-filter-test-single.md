---
id: PRDR-060
title: "Define V-5's [BASE] ref — `test_single` claims a deterministic affected filter against an undefined baseline"
state: DONE
severity: minor
category: gap
labels: ["prd-review"]
surface: ["detent-prd-v2.md"]
prd_refs: ["V-5", "V-2", "D-5", "B-1", "N-2"]
acceptance_criteria: ["A reader can determine, from the PRD alone, what `[BASE]` resolves to when Detent writes an affected-filter binding.", "The claim that the affected-filter command is *deterministic* is either supported by a defined baseline or withdrawn.", "V-2's binding record says whether the resolved baseline is stored in `resolved` or substituted at invocation time, since the two differ under V-3's drift comparison.", "The behaviour is defined for the case the baseline names no reachable commit — a shallow clone, or a run branch whose base has been deleted."]
non_goals: ["Does not lift D-5's root-only restriction or introduce per-workspace scoping; the affected filter is still a single root command.", "Does not require an affected filter where the orchestrator has none — the root test command remains the fallback.", "Does not change which orchestrators are preferred (V-5's turbo/pnpm/nx ordering is unaffected)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-060 — Define V-5's `[BASE]` ref

**Severity:** minor · **Category:** gap · **Amends:** V-5

## Problem

V-5 permits `test_single` to bind to "a deterministic affected-filter command" and gives `turbo … --filter=…[BASE]` as the shape. `[BASE]` is never defined. It is not in V-2's binding record, not in B-1's branch contract, and not a config key in F-1.

Three readings are all consistent with the text, and they behave differently:

1. **The run's base branch** (B-1: `run` creates `detent/run-<id>` off the base branch). Affected = everything the run has changed so far. This grows monotonically through a run, so a later ticket re-tests earlier tickets' packages.
2. **The previous commit** (`HEAD^1`). Affected = the last ticket's diff only.
3. **A configured ref.** Nothing in F-1 provides one.

Reading 1 is the only one that makes `test_single` mean "the tests that could have been broken by this run", and it is the one B-1 suggests — but the PRD does not say so, and N-6's no-deviation rule makes choosing on the implementation's behalf a defect rather than a judgement call.

There is a second-order question the same sentence raises. V-5 calls the command *deterministic*, but an affected filter against a moving ref is deterministic only relative to that ref. `nx affected --base=HEAD^1` returns different work on two runs of the same command against the same tree if a commit landed in between. Whatever `[BASE]` resolves to, the resolution point matters: substituting it at invocation time keeps the stored binding stable but means V-3 compares a command that is not the command that runs; storing it in `resolved` makes every new run drift.

This surfaced at implementation: T-029 needed a literal to put in the candidate's `resolved`, and picked `HEAD^1` as a documented placeholder with an override, because there was nothing to derive.

## Evidence (verbatim from detent-prd-v2.md)

- V-5: "- **V-5** Monorepo (D-5): root entrypoints only; when workspace markers are detected, prefer orchestrator-native candidates (`turbo run test`, `pnpm -r test`, `nx run-many`) and print the workspace-wide-gates notice; `test_single` may bind to a deterministic affected-filter command (`turbo … --filter=…[BASE]`, `nx affected …`). No per-ticket arguments."
- V-2: "Binding record: `{ slot, adapter, ref, resolved, pm, config_hash, executed_at, approved_by, status, schema_version }`. `resolved` is the literal command Detent will run"
- B-1: "Default mode (D-8): `run` creates `detent/run-<id>` off the base branch and commits directly to it"
- N-2: "**N-2 Determinism:** discovery, classification, signatures, resolver, and transitions are pure code; identical inputs ⇒ identical outputs."

## Proposed change

**1. Define the baseline.** Append to V-5: "`[BASE]` is the merge-base of the run branch and the base branch it was created from (B-1) — the point the run diverged, so 'affected' means 'changed by this run'. It is resolved once per run and does not move as the run commits."

**2. Say where it is substituted.** Append: "The baseline is substituted at invocation time, not stored: `resolved` holds the template with `[BASE]` intact, so a binding does not drift (V-3) merely because a new run started from a new merge-base."

**3. Define the degenerate case.** Append: "If the merge-base cannot be resolved — a shallow clone, or a deleted base ref — the affected filter is not bound and `test_single` falls back to the root test command, with the reason recorded. A filter against an unresolvable baseline is not a narrower gate, it is an unpredictable one."

## Acceptance criteria

1. A reader can determine, from the PRD alone, what `[BASE]` resolves to when Detent writes an affected-filter binding.
2. The claim that the affected-filter command is *deterministic* is either supported by a defined baseline or withdrawn.
3. V-2's binding record says whether the resolved baseline is stored in `resolved` or substituted at invocation time, since the two differ under V-3's drift comparison.
4. The behaviour is defined for the case the baseline names no reachable commit — a shallow clone, or a run branch whose base has been deleted.

## Non-goals

- Does not lift D-5's root-only restriction or introduce per-workspace scoping; the affected filter is still a single root command.
- Does not require an affected filter where the orchestrator has none — the root test command remains the fallback.
- Does not change which orchestrators are preferred (V-5's turbo/pnpm/nx ordering is unaffected).
