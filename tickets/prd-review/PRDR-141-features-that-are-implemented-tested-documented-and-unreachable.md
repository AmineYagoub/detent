---
id: PRDR-141
title: "Five features were implemented, tested, documented — and had no caller a user could reach"
state: DONE
severity: critical
category: gap
labels: ["prd-review", "found-by-audit", "dead-control", "recovered"]
surface: ["src/cli/index.ts", "src/cli/doctor.ts", "src/cli/verify.ts", "src/adapter/discover/index.ts", "src/init/consent.ts", "src/init/allowlist.ts"]
prd_refs: ["V-3", "S-5", "R-10", "V-1‴"]
acceptance_criteria: ["`detent verify sync` routes in VERBS, with a TTY consent and a refusal off a terminal.", "`doctor`'s main passes deps, so the S-5 pin check and the R-10 smoke session actually run on the path a user invokes.", "`preferOrchestrator` has a caller, so `discover()` promotes a monorepo's root command and `workspaceNotice` prints.", "`proposeConfigWrite` has the traversal guard `layout.ts` and `paths.ts` both have.", "The entry point decides liveness; the backend's presence is the signal."]
non_goals: ["Does not wire the consent engine itself; its latent defects are fixed regardless of when it is."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-148", "PRDR-181", "PRDR-192"]
depends_on: []
---

# PRDR-141 — implemented, tested, documented, unreachable

**Severity:** critical · **Category:** gap · **Found by:** the phase-4 audit (`ccdc501`)

> **Recovered 2026-09-09 (PRDR-192).** Filed as an empty file — the filename carried the
> title and nothing else was ever written. Its reasoning survived in the commit that created
> it, and this body is that account. Fields the original never recorded are derived from
> evidence, not invented.

## Problem

- **`detent verify sync`** is the only sanctioned V-3 recovery, and `adapter/drift.ts` tells
  operators to run it to clear a halt. It was **absent from VERBS the whole time**, so every
  drift-blocked ticket sat behind an instruction that answered "unknown command".
- **`doctor`'s main passed no deps**, so `deps.backend` was always `undefined` on the only path
  a user can invoke, and both the S-5 pin check and the R-10 smoke session pushed `ok: true`
  unconditionally — while the CLI advertised "one live smoke session". Every test injected a
  backend, so the suite exercised only branches `main` cannot reach.
- **`preferOrchestrator` had no caller**, so `discover()` never promoted a monorepo's root
  command and `workspaceNotice` never printed.
- Two latent defects in the unwired consent engine: `proposeConfigWrite` had no traversal
  guard where `layout.ts` and `paths.ts` both do, and the allowlist admitted
  `npm install ../../evil`, which runs a local package's lifecycle scripts.

## The rule this ran under

PRDR-148's: **wiring a dead control exposes every latent defect in it at once.** Checking each
against what the system now does *before* connecting it immediately found `doctor` keyed on
`ANTHROPIC_API_KEY` — stale since PRDR-140 broadened the transports to three — and then that
`hasLiveBackendAuth` falls through to probing the live CLI, so an injected environment cannot
make it answer no.
