---
id: PRDR-232
title: "The referee runs `npm install` in a tree the session just wrote, executing that tree's lifecycle scripts outside the containment hook — and the lockfile it writes can flip the package manager and drift a ticket that changed nothing"
state: OPEN
severity: major
category: defect
labels: ["prd-review", "SEC-5", "V-1⁗", "containment", "install", "drift", "design-panel"]
surface: ["src/adapter/install.ts", "src/kernel/referee-gate.ts", "src/adapter/discover/index.ts", "tests/kernel/install-run.test.ts", "detent-prd-v3.md"]
prd_refs: ["SEC-5", "SEC-3", "V-1⁗", "V-4", "D-21", "S-2″", "R-7", "V-6", "N-6", "PRDR-211", "PRDR-230"]
acceptance_criteria: ["The referee's dependency install does not execute the work tree's own lifecycle scripts: the node ecosystem's install command carries `--ignore-scripts`, or an equivalent that provably does not run `prepare`, `postinstall`, `preinstall` or `prepublish` from the tree under judgement. Observed FIRST (V-6): `ECOSYSTEMS[0].install` is `npm install --no-audit --no-fund`, `ensureDependencies` runs it in `workDir` at `referee-gate.ts:142` on every gate evaluation, and none of those lifecycle names appears in `SCRIPT_RULES` in `src/adapter/discover/node.ts`, so no candidate and no config region exists for them and the drift check at line 123 cannot see them. A session granted `package.json` can therefore have arbitrary shell executed by the referee's own process, outside the `PreToolUse` containment hook that governs everything else it does.", "A ticket whose ecosystem is not npm does not acquire an npm lockfile from the referee's install: either the install is chosen by the discovered package manager (V-4/R-7) or it writes no lockfile the discovery would read. Observed FIRST: `PM_BY_LOCKFILE` in `src/adapter/discover/index.ts` puts `package-lock.json` first, so a `package-lock.json` written into a pnpm or yarn worktree flips the discovered package manager, changes every bound command's `resolved` string, and `checkBinding`'s command check — which runs for every status — drifts and blocks a ticket that changed nothing.", "Both are proved by a test that fails on today's tree: one where a manifest's `postinstall` writes a marker the install must not create, and one where a non-npm project's worktree is not given an npm lockfile by the referee."]
non_goals: ["Does not remove the install (V-1⁗ needs it: a greenfield bootstrap's gates cannot run without one).", "Does not sandbox the gate commands themselves, which are operator-approved by construction."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-211", "PRDR-230", "PRDR-231"]
depends_on: []
---

# PRDR-232 — arbitrary code, run by the referee, from the tree it is judging

**Severity:** major · **Category:** defect · **Found by:** the PRDR-230 design panel, verified
against the code by hand

## Problem

V-1⁗ has the referee install a work directory's declared dependencies before its gates run, so
a greenfield bootstrap can be verified at all. The node ecosystem's command is
`npm install --no-audit --no-fund`, run in the ticket's work directory — a tree the session has
just written — and `npm install` runs that tree's `preinstall`, `install`, `postinstall` and
`prepare` scripts.

Everything else a session does passes the D-21 containment hook: writes are bounded to its
surface, its shell is three git verbs. This path is not. A session whose surface includes
`package.json` — granted, as one did on gate-313 — can put any command in `postinstall` and the
referee will execute it, as its own child process, with the operator's environment. The drift
check cannot notice: it runs first (`referee-gate.ts:123` before `:142`), and those script names
are absent from `SCRIPT_RULES`, so there is no candidate, no config region, and nothing to
compare.

Second, smaller: the install writes `package-lock.json`. `PM_BY_LOCKFILE` reads that file first,
so in a pnpm or yarn project the referee's own install changes the discovered package manager,
which changes every bound command's `resolved` string, which `checkBinding`'s status-blind
command check reports as drift — blocking a ticket that touched nothing.

## The shape

Do not run the judged tree's lifecycle scripts. Pick the install by the discovered package
manager rather than assuming npm, or write no lockfile the discovery would then read.

## What implementation changed

_(open)_
