---
id: PRDR-332
title: "V-1⁶ says every gate and the install run under the gate runner's environment, which suppresses a judged tree's lifecycle scripts and a gate script's `pre` and `post` siblings. The Stop hook's scoped gate does not. `detent run` builds its backend with `buildLiveBackend`, whose scoped gate runs `sh -c <gate>` through `execFile` with Detent's own environment, so `npm run test` in a session's worktree runs the `pretest` and `posttest` that session wrote, as Detent's own child, when the session tries to stop. PRDR-232 added the suppression to the install call beside it and missed this one. The scoped gate will run through the adapter's gate runner, under `CI_ENV`, like every other gate"
state: DONE
severity: major
category: security
labels: ["prd-review", "containment", "SEC-5", "V-1⁶", "doc-claim-drift", "stop-gate"]
surface: ["src/sessions/live.ts", "tests/sessions/live-scoped-gate.test.ts", "detent-prd-v3.md"]
prd_refs: ["V-1⁶", "SEC-5", "S-2", "D-21", "V-4", "X-1"]
acceptance_criteria: ["The scoped gate of the backend `buildLiveBackend` builds, which the SDK backend's Stop hook runs, runs the bound command under the gate runner's environment, `CI_ENV`. In a work directory whose manifest declares `pretest`, `test` and `posttest`, `npm run test` run by it runs `test` and neither sibling.", "It runs through the adapter's gate runner, with X-1's gate timeout, so a gate that outlives its timeout is killed with its whole process group, as every other gate is.", "What it decides does not change: a green gate lets the session end, and a red one blocks it with the gate's tail.", "V-1⁶'s paragraph in the PRD says that the Stop hook's scoped gate runs under the same environment, and that until PRDR-332 it ran under Detent's own.", "Falsifying test, against HEAD: the scoped gate run on such a work directory creates the `pretest` and `posttest` markers."]
non_goals: ["Does NOT change the plugin hook's Stop path, which runs no gate since PRDR-149.", "Does NOT approve any script. Approving a project's lifecycle scripts one body at a time is PRDR-233.", "Does NOT change which command the scoped gate runs, nor where: the root package's bound `test`, in the session's work directory (PRDR-211, V-5′)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-232", "PRDR-211", "PRDR-149", "PRDR-233"]
depends_on: ["PRDR-232"]
---

# PRDR-332 — the Stop hook's scoped gate runs under Detent's own environment

## Where this came from

On 2026-10-02, while building PRDR-233, the call sites that run a gate or an install were read to
see where an approved script would run. The referee's gates (`referee-gate.ts`), the
falsification probe (`falsify.ts`) and the diagnose stage's repro (`referee-stage.ts`) all pass
`CI_ENV`. The Stop hook's scoped gate, in `src/sessions/live.ts`, does not.

## Problem

- **What the PRD says.** V-1⁶: "Suppression therefore rides the ENVIRONMENT —
  `npm_config_ignore_scripts` in the gate runner's `CI_ENV`", because `npm run <gate>` runs that
  script's `pre` and `post` siblings "on EVERY gate evaluation". PRDR-232's record says `CI_ENV`
  is "the environment every gate and the install run under".
- **What the code does.** `buildLiveBackend` gives the SDK backend a `runScopedGate`. It installs
  under `CI_ENV`, then runs the gate through a private `runGate(command, cwd)` that calls
  `execFile("sh", ["-c", command], { cwd, timeout, maxBuffer })` with no `env`. The child gets
  Detent's own environment: no `npm_config_ignore_scripts`, no `CI=1`.
- **Who reaches it.** `detent run` builds its backend with `buildLiveBackend` (`src/cli/run.ts`),
  and so does the N-7 self-build. Every implement or fix session that tries to end runs the root
  package's bound `test` in its worktree through that closure (`stopGate`, `buildStopHook`).
- **Probed on 2026-10-02**, on the closure `buildLiveBackend` registers, in a directory whose
  `package.json` declares `pretest: touch PRETEST`, `test: touch TESTRAN` and
  `posttest: touch POSTTEST`:

```
green: true
PRETEST ran
TESTRAN ran
POSTTEST ran
```

- **What it lets a session do.** A session whose surface holds `package.json` writes any command
  into `pretest`, then ends. Detent's own process runs it, with the operator's environment, before
  the referee's gates run. That is the hop PRDR-232 closed for the referee's gates, open on the
  path every working session takes. The drift check cannot see it: `pretest` binds no gate.
- **A second difference.** `execFile`'s timeout kills the shell alone. A test runner's workers
  keep the pipes open, so a gate that outlives its timeout holds the Stop hook until they end. The
  adapter's runner kills the whole process group.

## Design

- The scoped gate runs through the adapter's `runGate`, under `CI_ENV`, with X-1's gate timeout,
  the same runner, environment and timeout as its install. Green is the runner's green. The tail
  is the last 1,500 bytes of its output, as before.
- The function is named and exported (`scopedGate`), and `buildLiveBackend` passes it. The test
  reaches it through the backend `buildLiveBackend` builds, so it holds the wiring `detent run`
  uses as well as the function.
- **The PRD:** V-1⁶ gains a sentence: the Stop hook's scoped gate runs under the same environment,
  and ran under Detent's own until PRDR-332.

### Vetoable calls

1. **The adapter's runner, not `execFile` with an `env`.** Passing `CI_ENV` to `execFile` would
   close the hop alone. The adapter's runner also kills a timed-out gate's process group, and it
   is the runner every other gate uses.
2. **Major, like PRDR-232.** It is the same hop, on the path every implement and fix session
   takes.

Added while building:

3. **`scopedGate` takes a timeout.** The backend passes none, so the gate keeps X-1's default.
   The parameter exists so a test can show a timed-out gate's process group killed in a second
   rather than in minutes.
4. **A test that the install still runs no lifecycle script.** The install's suppression was
   PRDR-232's and did not change, but its code moved into `scopedGate`, so the scoped gate's
   install is held through the backend too.

## Falsification (verification protocol, item 1)

The sibling case should fail against HEAD, and the decision case should pass there. Run against
HEAD (`a13d99e`, this ticket's filing), with `src/sessions/live.ts` unchanged:

```
× PRDR-332 the Stop hook's scoped gate runs under the gate runner's environment (V-1⁶) > runs the bound script and neither of its pre and post siblings
  → PRETEST — the tree's own script ran in Detent's process: expected true to be false
✓ PRDR-332 the Stop hook's scoped gate runs under the gate runner's environment (V-1⁶) > decides as before: a red gate is not green, and its tail is the gate's own output
Tests  1 failed | 1 passed (2)
```

The timeout case and the install case were written after the fix: the first calls `scopedGate`,
which HEAD does not have, and the second holds what HEAD already did.

## Mutation battery

Each mutant was applied to a snapshot copy of `src/sessions/live.ts`, then
`tests/sessions/live-scoped-gate.test.ts` was run, and the file was restored from its copy and
checked with `cmp`. All seven were killed:

| Mutant | Killed by |
|---|---|
| the gate run with no `env` | the sibling case |
| the gate's suppression lifted | the sibling case |
| the install run with no `env` | the install case |
| green always | the decision case and the timeout case |
| the tail dropped | the decision case |
| the gate's timeout ignored | the timeout case |
| the backend wired to the old `execFile` gate | the sibling case and the install case |

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: not run for this ticket. On 2026-10-02 the user asked for the full suite to run
  once, after the last ticket of the batch, and the batch's closing commit records it. The suites
  nearest the change ran instead: `tests/sessions/`, `tests/adapter/install.test.ts`,
  `tests/oracle/pin-parity.test.ts` and `tests/cli/doctor.test.ts`, 20 files, 256 passed.

## What changed

- `src/sessions/live.ts`: `scopedGate` (new, exported) installs and runs the gate through the
  adapter's `runGate`, under `CI_ENV`, with X-1's gate timeout, and returns the runner's green and
  the last 1,500 bytes of its output. `buildLiveBackend` passes it as `runScopedGate`. The private
  `execFile` runner is gone.
- `detent-prd-v3.md`: V-1⁶ says the Stop hook's scoped gate runs under the same environment and
  through the same runner, and ran under Detent's own until PRDR-332.
- `tests/sessions/live-scoped-gate.test.ts` (new): four cases. Through the backend
  `buildLiveBackend` builds: the bound script runs and its siblings do not; the install runs no
  lifecycle script; a red gate is not green and keeps its tail. Through `scopedGate`: a gate that
  outlives a one-second timeout is killed with its process group.

## Recorded, not fixed

- **The test reaches the backend's private `config`.** It casts the backend to read the closure
  `detent run` registers, rather than testing a copy of it. The cast is not checked: if the
  backend's shape changes, the tests fail at run time, since there is no closure to call.
