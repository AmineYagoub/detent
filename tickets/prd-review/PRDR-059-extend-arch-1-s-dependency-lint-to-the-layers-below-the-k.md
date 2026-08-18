---
id: PRDR-059
title: "Extend ARCH-1's dependency lint to the layers below the kernel — adapter and fs are unzoned"
state: READY
severity: minor
category: gap
labels: ["prd-review"]
surface: ["detent-prd-v2.md"]
prd_refs: ["ARCH-1", "D-19", "P2", "P3", "R-5"]
acceptance_criteria: ["ARCH-1's AC names a zone for every layer its own diagram draws, or states explicitly which layers are deliberately unzoned and why.", "A source file under the verification adapter that imports a kernel state mutator fails CI, in the same way a kernel file importing the SDK already does.", "The set of lint zones is derivable from the §3a diagram rather than being an independent list that can silently fall behind it.", "The rule distinguishes importing a schema (allowed at every layer) from importing a kernel mutator or the transition table (allowed only in the kernel)."]
non_goals: ["Does not change the layering itself — the diagram in §3a already says the adapter sits below the kernel; this is about enforcement, not design.", "Does not propose dependency-cruiser or any new tool; the existing eslint `no-restricted-imports` zones are sufficient (R-5).", "Does not touch the audit half of ARCH-1's AC (`machine.apply` call sites), which is a separate mechanism landing at T-054."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-059 — Extend ARCH-1's dependency lint to the layers below the kernel

**Severity:** minor · **Category:** gap · **Amends:** ARCH-1

## Problem

§3a draws four layers: CLI, deterministic kernel, and — below the kernel — the verification adapter and the Agent SDK sessions. ARCH-1's AC zones two of them. `kernel/**` may not import the SDK or reach into `sessions/**`; `sessions/**` may not import kernel state mutators. Nothing is said about the adapter, and nothing is said about the filesystem layer that F-1…F-4 imply.

The consequence is asymmetric enforcement of the same rule. A session that imports `kernel/tickets/mutations` fails CI. An adapter module that imports the same file does not — even though "only the kernel writes ticket state" is a property of the kernel, not a property of sessions. The same holds for `kernel/machine`: `sessions/**` is forbidden from applying events, the adapter is not.

This surfaced at implementation. M1 lands three modules below the kernel (`adapter/run.ts`, `adapter/discover/*`, `fs/layout.ts`) and one above it (`kernel/flake.ts`, which imports the adapter's gate-result type — the correct direction). Keeping the direction correct was a judgement call made while reading the diagram, and it was verified with `grep`, because there is nothing in CI that would have caught the reverse. D-19 calls this boundary "the single most important property of Detent"; verifying it by hand is not consistent with that.

The gap is currently latent rather than live: no adapter or fs module imports the kernel today. What is missing is the mechanism that keeps it that way.

## Evidence (verbatim from detent-prd-v2.md)

- ARCH-1: "*AC:* dependency-direction lint in CI — `kernel/**` imports no SDK types and no `sessions/**` internals beyond the backend interface; `sessions/**` imports no kernel state mutators; an audit test asserts every `machine.apply` call site's event derives from a validator or gate result."
- ARCH-1: "Mechanically: the kernel's only session-facing surface is the `SessionBackend` interface; session output enters the kernel exclusively through the §10 schema validators; no code path lets model output trigger a transition without a validator or gate result in between."
- D-19: "The layer boundary is a normative requirement (ARCH-1) with a CI dependency lint, not a stylistic preference | PRD review 2026-08-17 (pass 3); the single most important property of Detent"
- P2: "**The kernel trusts artifacts and exit codes, never prose.** No state transition occurs on an unverified model claim."
- P3: "**Project owns its tooling; Detent owns only bindings.** `.detent/` never contains project configuration (F-2)."

## Proposed change

**1. Zone every layer the diagram draws.** Amend ARCH-1's AC to read: "dependency-direction lint in CI — `kernel/**` imports no SDK types and no `sessions/**` internals beyond the backend interface; `sessions/**` and the verification adapter import no kernel state mutators and no transition table; every layer may import `schemas/**`, which sits below all of them; an audit test asserts every `machine.apply` call site's event derives from a validator or gate result."

**2. Say why schemas are exempt.** Append to ARCH-1: "`schemas/**` is below every layer by construction: it holds the persisted vocabulary — states, events, gate slots, artifact shapes — and imports nothing from above it. That is what makes it importable everywhere without weakening the direction."

**3. Tie the zone list to the diagram.** Append: "The zone list is the §3a diagram read as edges. Adding a layer to the diagram without adding its zone is an ARCH-1 defect."

## Acceptance criteria

1. ARCH-1's AC names a zone for every layer its own diagram draws, or states explicitly which layers are deliberately unzoned and why.
2. A source file under the verification adapter that imports a kernel state mutator fails CI, in the same way a kernel file importing the SDK already does.
3. The set of lint zones is derivable from the §3a diagram rather than being an independent list that can silently fall behind it.
4. The rule distinguishes importing a schema (allowed at every layer) from importing a kernel mutator or the transition table (allowed only in the kernel).

## Non-goals

- Does not change the layering itself — the diagram in §3a already says the adapter sits below the kernel; this is about enforcement, not design.
- Does not propose dependency-cruiser or any new tool; the existing eslint `no-restricted-imports` zones are sufficient (R-5).
- Does not touch the audit half of ARCH-1's AC (`machine.apply` call sites), which is a separate mechanism landing at T-054.
