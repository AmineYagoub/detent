---
id: PRDR-044
title: "Reconcile S-1's role identifiers with D-12's BLIND_FIX rename and pin the role set as a wire format"
state: READY
severity: minor
category: clarity
labels: ["prd-review"]
surface: ["foreman-prd-v2.md"]
prd_refs: ["S-1", "S-7", "D-12", "X-3", "§7", "F-1"]
acceptance_criteria: ["S-1's role list and §7's state list are reconcilable from the PRD alone: either the role is renamed to match the state, or a role↔state mapping is stated for every role whose identifier differs from its namesake state.", "The PRD states that the role identifier set is a persisted wire format (referenced by `agents/assignments.json` as role@hash) and that changing an identifier is a schema-version event under F-3.", "A reader can answer \"what are the exact eight role identifiers?\" from one location, and the answer is stable enough to hash-pin against.", "No role identifier in S-1 names a state that no longer exists in §7."]
non_goals: ["Does not change the number of roles or merge any two roles.", "Does not require role identifiers to equal lowercased state names — `implement`/`IN_PROGRESS` and `review`/`IN_REVIEW` may stay divergent as long as the mapping is stated.", "Does not alter S-7's vendoring or hash-pinning mechanism."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-044 — Reconcile S-1's role identifiers with D-12's BLIND_FIX rename and pin the role set as a wire format

**Severity:** minor · **Category:** clarity · **Amends:** S-1, S-7

## Problem

D-12 split fix capacity into three unit budgets and §7 renamed the corresponding state from `FIX` to `BLIND_FIX`. S-1's role list was not updated and still names the role `fix`. The result is that `fix` is the only role identifier naming a state that no longer exists in the document.

The role↔state relationship is already non-mechanical — `implement` maps to `IN_PROGRESS`, `review` to `IN_REVIEW`, `diagnose` to `DIAGNOSED` — so a reader cannot resolve `fix` by lowercasing. Two of the eight roles (`informed_fix`, `review_fix`) *do* match their states exactly, which makes the pattern look mechanical and the `fix`/`BLIND_FIX` case look like an oversight rather than a deliberate divergence. Either reading is available and the PRD does not settle it.

This matters more than a naming nit because S-7 makes the identifier a persisted wire format: `agents/assignments.json` references `role@hash`, that file is in F-1's **committed** set, and assignments referencing unknown hashes must fail closed. An identifier that changes after assignments are written invalidates them in a repository that has already committed them, and F-3's schema-version machinery is the only sanctioned way to handle that. The PRD does not currently say the role set is a stable identifier space, so nothing signals that renaming a role is a breaking change.

## Evidence (verbatim from foreman-prd-v2.md)

- S-1: "Roles: planner (init), diagnose, implement, fix, informed_fix, review_fix, research, review."
- §7: "States: `READY, DIAGNOSED, IN_PROGRESS, BLIND_FIX, RESEARCH, INFORMED_FIX, REVIEW_FIX, IN_REVIEW, APPROVED, DONE, BLOCKED, NEEDS_HUMAN`."
- D-12: "Fix capacity = three independent **unit budgets** (blind, informed, review), each consumed on entry to its namesake state"
- X-3: "| IN_PROGRESS / BLIND_FIX / REVIEW_FIX | GATE_RED | resolveRed |"
- S-7: "PREPARE_AGENTS selects from this vendored set only; `agents/assignments.json` references role@hash."
- F-1 committed set: "`agents/assignments.json`"
- F-3: "Every committed file carries `schema_version`; migrations are explicit, versioned, and tested"

## Proposed change

**1. Settle the identifier.** Rename the role `fix` to `blind_fix` in S-1, so that all three ladder-writing roles share the naming scheme D-12 established:

"Roles: `planner` (init), `diagnose`, `implement`, `blind_fix`, `informed_fix`, `review_fix`, `research`, `review`."

**2. State the mapping for the roles that legitimately differ.** Add to S-1: "Role identifiers are not derived from state names; the mapping is: `planner` → init pipeline (no execution state), `diagnose` → `DIAGNOSED`, `implement` → `IN_PROGRESS`, `blind_fix` → `BLIND_FIX`, `informed_fix` → `INFORMED_FIX`, `review_fix` → `REVIEW_FIX`, `research` → `RESEARCH`, `review` → `IN_REVIEW`."

**3. Pin the set as a wire format.** Add to S-7: "The eight role identifiers of S-1 are a stable identifier space: `agents/assignments.json` is committed (F-1) and references `role@hash`, so adding, removing, or renaming a role is a `schema_version` event under F-3 with a migration, not an editorial change."

## Acceptance criteria

1. S-1's role list and §7's state list are reconcilable from the PRD alone: either the role is renamed to match the state, or a role↔state mapping is stated for every role whose identifier differs from its namesake state.
2. The PRD states that the role identifier set is a persisted wire format (referenced by `agents/assignments.json` as role@hash) and that changing an identifier is a schema-version event under F-3.
3. A reader can answer "what are the exact eight role identifiers?" from one location, and the answer is stable enough to hash-pin against.
4. No role identifier in S-1 names a state that no longer exists in §7.

## Non-goals

- Does not change the number of roles or merge any two roles.
- Does not require role identifiers to equal lowercased state names — `implement`/`IN_PROGRESS` and `review`/`IN_REVIEW` may stay divergent as long as the mapping is stated.
- Does not alter S-7's vendoring or hash-pinning mechanism.
