---
id: PRDR-211
title: "A greenfield bootstrap cannot install the dependencies its own gates need: the 3.1.0 gate passed through a containment hole PRDR-122 closed, and gate-313's first ticket went NEEDS_HUMAN with a correct scaffold and no `node_modules`"
state: DONE
severity: critical
category: gap
labels: ["prd-review", "gate", "bootstrap", "verification", "containment", "greenfield", "D-16"]
surface: ["src/adapter/install.ts", "src/kernel/referee-gate.ts", "src/kernel/referee-context.ts", "src/kernel/referee.ts", "src/kernel/run.ts", "src/sessions/guard.ts", "src/sessions/sdk.ts", "src/sessions/live.ts", "src/init/plan-write.ts", "tests/adapter/install.test.ts", "tests/kernel/install-run.test.ts", "tests/sessions/sdk.test.ts", "detent-prd-v3.md"]
prd_refs: ["C-4", "V-1", "V-1‴", "S-2‴", "S-3", "SEC-2", "SEC-3", "D-16", "N-7", "B-2″", "V-6", "N-6", "PRDR-122", "PRDR-145b"]
acceptance_criteria: ["Before a bound gate runs in a work directory whose `package.json` declares dependencies and whose `node_modules` is absent or older than the lockfile, the adapter installs them — `npm ci` when a lockfile exists, `npm install` when it does not — in that directory, with the install's exit and tail recorded in the ticket journal as its own record, never folded into the gate's. Observed FIRST on gate-313's bootstrap worktree: `npm test` fails for want of `vitest` (V-6).", "The install is the ADAPTER's, not the session's: the implement surface is unchanged (`Read, Grep, Glob, Edit, Write, Bash(git add:*), Bash(git commit:*)`) and S-2‴'s abstention stands. A test pins that a session's `Bash(npm install)` is still refused.", "A lockfile the install creates is part of the ticket's change set: on a worktree ticket it is staged and committed by finalize with the rest (B-2″), so the next ticket's install is `npm ci` against it. Asserted on the fixture repository.", "An install that fails is a red gate outcome with the install's own tail as evidence — not a session crash, not a drift halt — and the ladder sees it as it sees any red.", "The bootstrap ticket's criteria say what the session can and cannot do: it writes the manifest and the configuration; the referee installs; the gates then run. The implement prompt stops telling the session to run the gate command itself.", "The self-build harness on a clean machine reaches the bootstrap's GATE_GREEN with no human step — the D-16 criterion this ticket exists for."]
non_goals: ["Does not grant the session `npm`. A session that can run a package manager can run anything a dependency's lifecycle script asks, out of reach of the hook; the referee running the same install is one process the operator chose, logged, once per work directory.", "Does not cover ecosystems beyond Node in this ticket. The self-build is Node; the mechanism — detect a manifest, install from its lockfile before the gate — is named so the second ecosystem is a table row, not a redesign.", "Does not touch what a gate IS (V-1): a bound command that runs in the work directory. This is what has to be true before it can."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-122", "PRDR-145b", "PRDR-212"]
depends_on: []
---

# PRDR-211 — the ground the walking skeleton cannot lay

**Severity:** critical · **Category:** gap · **Found by:** gate-313's first ticket, and then the
last green gate's lockfile

## Problem

C-4 has Detent construct the bootstrap ticket in greenfield: create the scaffolding and the native
verification tooling; every bound gate runs and exits 0. On gate-313 the implement session did
the first half — `package.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `src/`,
`tests/`, a `.gitignore` — and could not do the second, because its Bash is two verbs:

```ts
return [...WRITE_TOOLS, "Bash(git add:*)", "Bash(git commit:*)"];   // guard.ts:358, S-3
```

`npm install` is refused. Without `node_modules`, `npm test` is `vitest: command not found`, and
no scaffold on earth makes that gate green. The session concluded — wrongly, but from real
denials — that the ticket was unimplementable, wrote the falsified signal, then finished the
scaffold and retracted in the same file (PRDR-212). The referee admitted PREMISE_FALSIFIED, the
ticket went NEEDS_HUMAN, `run` exited 10 with nothing else READY. One session, 83 turns, $2.65,
and the walking skeleton cannot start.

## How the last gate passed

`detent-n7-310` reached 67/67 DONE for 3.1.0. Its bootstrap commit `e722d3f` ADDS a
`package-lock.json` with 257 `sha512` integrity entries — a file only `npm` writes. The session
ran `npm install`. It could, because at 3.1.0 the guard answered a tool call naming no path with
`allow`:

```ts
if (target === null) return { decision: "allow", reason: "no path in tool input" };   // v3.1.0 guard.ts:75
```

and the hook forwarded that as `permissionDecision: allow`, which is terminal in the SDK's order —
so the allowlist was never consulted, and a Bash call with no path was any Bash call. PRDR-122
(S-2‴, `b1ad4ab`, after 3.1.0) named that exactly — "`allow` was overriding the allowlist" — and
made the guard abstain. Correct, and it closed the only route a greenfield bootstrap had to its
dependencies. The 3.1.0 gate was green through a hole; the 3.1.1 gate is the first to run without
it, and it stopped at ticket one.

## The shape

The session writes the manifest; the referee installs what the manifest declares; the gate runs.
Installing is a property of executing the gate (V-1: a candidate that will not execute), not of
implementing the ticket, so it belongs to the adapter that runs gates in the work directory:
`npm ci` against a lockfile, `npm install` without one, recorded in the ticket journal as its own
record with its own tail. The lockfile it produces is part of the change set finalize commits
(B-2″ stages the whole set on a worktree ticket), so every later ticket installs from a lockfile.
The implement surface does not change by one verb — a session that can run a package manager can
run whatever a dependency's install script asks, past the hook; the referee running the same
command is one process the operator chose, logged, once per work directory.

The prompt then stops saying "run the scoped gate command you were given as you work" to a session
that cannot, which is where PRDR-212's misreading began.

## How it is tested

V-6 order, on the fixture repository with a manifest and no `node_modules`: the gate observed red
for want of the test runner; then the install record, the green gate, the committed lockfile, and
the session's `Bash(npm install)` still refused. Then the harness on this machine, from the
bootstrap to GATE_GREEN, with no hand on the keyboard.

## What implementation changed

**`src/adapter/install.ts`.** An ecosystem table — Node, for now: `package.json`,
`package-lock.json`, `node_modules`, the mark `node_modules/.package-lock.json` that npm writes
when an install completes, and the command. `installNeeded` says why an install is due (no mark;
manifest newer; lockfile newer) or `null`; `ensureDependencies` runs the command through whatever
runner it is handed — the gate runner, so the install has the gate's timeout, environment and
tail — and touches the mark afterwards so it is the newest thing in the tree.

**`npm install`, not `npm ci`.** The ticket's first criterion said `ci` with a lockfile. `ci`
refuses a lockfile out of step with the manifest, and that is the ordinary case here: a ticket
adds a dependency by editing `package.json` and cannot touch the lockfile. `install` resolves
against the lockfile it has and updates it; finalize commits the result. The criterion is
corrected by this record.

**The referee installs before it judges.** `GateArm.evaluateGate` calls `ensureDependencies` after
the drift check and before the first slot, records an `install` event in the ticket journal —
`ok`, ecosystem, command, exit, duration, the reason it was due, the tail on failure — and turns a
failed install into a red gate through the same `recordFailure` and `gateRed` a failing slot uses,
so `last_failure.json` carries the install's tail and the ladder sees an ordinary red.

**What the referee installed never reaches the branch.** `finalizeDone` stages the change set
with the ecosystem's directory excluded (`git add -A -- . ':!node_modules'`), so a scaffold
without a `.gitignore` cannot commit `node_modules`; the lockfile is staged with everything else.

**The Stop hook ran in the wrong directory.** `buildLiveBackend` ran the scoped gate in the
ROOT; since B-2″ the session works in a worktree. On gate-313 that was `npm test` in a root with
no `package.json` — the ENOENT the session misread as proof the gate runner had npm. The hook
now receives the session's `cwd`, runs the same install there first, then the gate.

**The bootstrap ticket says so.** Its description now tells the session that Detent installs
what the manifest declares before every gate run and that the package manager is not among its
tools. The rest of what the session is told is PRDR-212's.

**A seam nobody forwarded — caught the way it should be.** `ecosystems` was added to
`RunOptions` and `CoreOptions` and read by the context; `run()` forwards an explicit list of
options to the core and did not include it. Every unit test passed. The end-to-end test through
`run` did not: `expected 10 to be +0`, the ticket still red for want of the install — PRDR-141's
shape, unreachable by construction, found because the test asserted on the production entry
point (V-6).

**V-6, in order.** Observed on the tree as it was: the end-to-end ticket exits 10 with
`last_failure.json` naming `make test`, not an install; the Stop hook's runner receives
`undefined` for a directory; the adapter module does not exist. Then the change; then 8 of 8 in
the new files and the suite.

## Next

The runner clone moves to this commit, the bootstrap is requeued, and the walking skeleton runs
again — the D-16 criterion this ticket exists for, on the machine that found it.

## Audit

Read cold after the close, with three live checks.

- **The mark was npm's, and npm does not always write it.** `npm install` on a manifest that
  declares nothing writes `package-lock.json` and NO `node_modules` at all — checked in a
  temporary directory: exit 0, no `node_modules/.package-lock.json`. The freshness rule would
  have found the mark absent on every gate and installed on every gate, ~2 s and a journal record
  each time, on exactly the manifest a bootstrap starts from. The mark is now Detent's own file,
  `node_modules/.detent-installed`, written by the adapter after any successful install, inside
  the install directory so it leaves with it and is excluded from the change set with it. A test
  pins it with a "package manager" that succeeds and creates nothing.
- **The finalize pathspec does what it claims.** In a temporary repository, `git add -A -- .
  ':!node_modules'` staged a deletion, an addition and a new `package-lock.json`, and left
  `node_modules/` untracked.
- **The V-6 probe needs no install of its own.** `falsify.ts` reverts the source half of the
  diff and re-runs the gate in the same work directory, where the install already happened.
- **The install runs with the environment gates run with** — `runGate` merges the operator's
  `process.env` — as every gate always has. SEC-4 bounds sessions, not gates; nothing here widens
  it, and nothing here narrows it either. Recorded, not changed.
- **Every worktree ticket installs once.** A fresh checkout has no `node_modules`, so each ticket
  pays one `npm install` before its first gate — seconds with npm's cache warm. Accepted; a shared
  cache is an optimisation for a gate that shows it matters.
- **The Stop hook swallows an install failure.** It is advisory — the referee's own evaluation
  records the failure as a red gate with the tail. Accepted.

## Audit, second — from the gate

The ticket's own claim was *"recorded in the ticket journal as its own record"*, and the gate
showed a green bootstrap whose journal held one failed install and no successful one.

- **What happened.** The blind-fix session changed `zod` to `^4.0.0`; its Stop hook then ran
  the scoped gate in the worktree, which installs first (PRDR-211's own change) — and that
  install, the one that mattered, succeeded there. The referee's evaluation found the mark
  fresh, installed nothing, and journaled nothing. The Stop hook cannot journal: the run holds
  the journal and it is single-writer (F-1).
- **The fix.** The adapter's mark carries the install's timestamp. The referee reads it before
  the gate: a mark it did not write itself is journaled once per ticket and mark as an install
  `by: "session"`, with the timestamp — observed first as a green gate whose journal carried no
  install (V-6), then pinned by a session that writes the mark in its own work directory, as the
  Stop hook does.
- **A session that commits its install directory.** finalize's exclusion protects finalize's
  commit; a session running `git add -A` in a scaffold with no `.gitignore` would commit
  `node_modules` itself. gate-313's bootstrap wrote the ignore, as a competent scaffold does, and
  a committed `node_modules` is the review's `scope` finding to make. Recorded, not guarded.
