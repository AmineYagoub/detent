---
id: PRDR-233
title: "A project that genuinely builds on install has only a run-wide environment switch, not a per-project record of which lifecycle scripts an operator approved"
state: OPEN
severity: minor
category: hardening
labels: ["prd-review", "SEC-5", "V-1⁵", "install", "operator", "design-panel"]
surface: ["src/adapter/discover/node.ts", "src/kernel/lifecycle.ts", "src/cli/verify-lifecycle.ts", "src/adapter/normalize.ts", "detent-prd-v3.md"]
prd_refs: ["V-1⁵", "V-1⁗", "SEC-5", "D-4", "N-6", "PRDR-232"]
acceptance_criteria: ["A project's declared lifecycle scripts are recorded with their bodies' hashes, and an operator approves them by name after seeing them — the approval is per project and per script body, so editing an approved script withdraws its approval until it is approved again.", "The install and the gates run with suppression lifted only for what is approved, and a work directory carrying an unapproved declared lifecycle script installs with suppression on and says so where the first red gate is read.", "The run-wide `DETENT_ALLOW_LIFECYCLE_SCRIPTS` switch V-1⁵ ships stays as the blunt instrument it is, and the finer verb supersedes it for projects that have one."]
non_goals: ["Does not weaken V-1⁵'s default: suppression stays on until an operator lifts it.", "Does not extend to pnpm, yarn or bun, whose script and plugin surfaces are unmeasured (see PRDR-234 if one is filed)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-232"]
depends_on: ["PRDR-232"]
---

# PRDR-233 — the blunt switch, and the finer one it stands in for

**Severity:** minor · **Category:** hardening · **Found by:** the PRDR-232 design panel, as the
half of its recommendation deliberately not shipped

## Problem

V-1⁵ suppresses a judged tree's lifecycle and `pre`/`post` scripts by default, which is right,
and gives the operator one run-wide switch to lift it. That switch is all-or-nothing: a project
that needs `prepare` to build itself gets either every declared script, including any a session
later adds, or none.

The panel's design carried a finer instrument: read what the manifest declares, hash each body,
let an operator approve by name after seeing it, and lift suppression for exactly those. An
edited body withdraws its own approval. That is worth building, and it was left out of PRDR-232
deliberately — it adds a CLI verb, a kernel module, a record and a notice path to a fix whose
security half was one line of environment, on a day when this subsystem had already been broken
twice. The default is safe without it; only the ergonomics of an unusual project are missing.

## Cost of not having it

Measured: the project gate-313 is building declares no lifecycle script, so the live run pays
nothing. A project that does build on install sees a red gate whose cause is not obvious, and
the operator's only recourse is a run-wide switch that also re-admits anything a session adds.

## What implementation changed

_(open)_
