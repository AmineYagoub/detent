---
id: PRDR-211
title: "A greenfield bootstrap cannot install the dependencies its own gates need: the 3.1.0 gate passed through a containment hole PRDR-122 closed, and gate-313's first ticket went NEEDS_HUMAN with a correct scaffold and no `node_modules`"
state: OPEN
severity: critical
category: gap
labels: ["prd-review", "gate", "bootstrap", "verification", "containment", "greenfield", "D-16"]
surface: ["src/kernel/referee-gate.ts", "src/adapter/run.ts", "src/adapter/normalize.ts", "src/init/plan-write.ts", "prompts/implement.md", "tests/kernel/referee-gate.test.ts", "tests/adapter/run.test.ts"]
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
