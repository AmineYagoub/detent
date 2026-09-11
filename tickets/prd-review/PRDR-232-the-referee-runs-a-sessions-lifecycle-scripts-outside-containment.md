---
id: PRDR-232
title: "The referee runs `npm install` in a tree the session just wrote, executing that tree's lifecycle scripts outside the containment hook — and the lockfile it writes can flip the package manager and drift a ticket that changed nothing"
state: DONE
severity: major
category: defect
labels: ["prd-review", "SEC-5", "V-1⁗", "containment", "install", "drift", "design-panel"]
surface: ["src/adapter/install.ts", "src/adapter/normalize.ts", "src/kernel/referee-gate.ts", "src/sessions/live.ts", "tests/adapter/install.test.ts", "detent-prd-v3.md"]
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

## Measured, before implementing

The package-manager half, reproduced by hand on a scratch project carrying `package.json` and
`pnpm-lock.yaml` and nothing else:

```
discovery before the install: pm: pnpm   test candidate: "test"
$ npm install --no-audit --no-fund        (the referee's own command, run in the work directory)
lockfiles now: package-lock.json pnpm-lock.yaml
discovery after  the install: pm: npm    resolved command: npm run test
```

The stored binding would read `pnpm run test`; the discovered command is now `npm run test`;
`checkBinding` compares exactly those two, for every status, before anything else. A ticket that
changed nothing is blocked, and the thing that changed the project was Detent.

The lifecycle half needs no measurement beyond the code: `ECOSYSTEMS[0].install` is
`npm install --no-audit --no-fund`, `ensureDependencies` runs it in `workDir`, and npm runs a
manifest's `preinstall`/`install`/`postinstall`/`prepare` unless told otherwise. Worth recording
for the fix's cost: the project gate-313 is building declares `test`, `lint`, `typecheck` and
`build` and no lifecycle script at all, so suppressing them costs that run nothing.

## The shape

Do not run the judged tree's lifecycle scripts. Pick the install by the discovered package
manager rather than assuming npm, or write no lockfile the discovery would then read.

## What implementation changed

**Suppression rides the environment.** `suppressionEnv(approved)` in `src/adapter/normalize.ts`
yields `npm_config_ignore_scripts`, and `CI_ENV` — the environment every gate and the install
run under — carries it. That closes both hops at once: the install's lifecycle scripts and a
bound script's `pre`/`post` siblings. No bound command and no config region moves, which is why
it is safe to land while a run is in flight. `lifecycleApproved()` reads
`DETENT_ALLOW_LIFECYCLE_SCRIPTS` from the referee's own environment, so an operator can lift it
for a project that genuinely builds on install and a session cannot.

**The npm row is npm's.** `Ecosystem` gains an optional `pms`; the node row declares
`["npm", null]` — npm and greenfield, which C-4's provisional table makes npm's. A row whose
package managers exclude the discovered one installs nothing, and the outcome's reason names the
manager it saw. `ensureDependencies` takes the package manager; the referee passes the
discovery it already performs for the drift check, and the init backend passes the root's.

**V-6, in order.** Observed on the tree as it was, with real npm: a manifest declaring
`preinstall`, `install`, `postinstall` and `prepare` had all four executed by the referee's own
install — `PRE — the tree's own script ran under the referee` — and `npm run test` executed the
tree's `pretest` and `posttest`; `CI_ENV` carried no suppression; and a project with only
`pnpm-lock.yaml` was given an npm install and an npm lockfile. Then the change; then none of the
four markers is created, the bound script still runs while its siblings do not, the pnpm project
gets no install and a reason naming pnpm, and greenfield and npm projects install exactly as
V-1⁗ requires.

