---
id: PRDR-233
title: "A project that genuinely builds on install has only a run-wide environment switch, not a per-project record of which lifecycle scripts an operator approved"
state: DONE
severity: minor
category: hardening
labels: ["prd-review", "SEC-5", "V-1⁶", "install", "operator", "design-panel"]
surface: ["src/adapter/lifecycle.ts", "src/adapter/normalize.ts", "src/adapter/install.ts", "src/kernel/referee-gate.ts", "src/kernel/referee-stage.ts", "src/kernel/falsify.ts", "src/kernel/dossier.ts", "src/schemas/records.ts", "src/sessions/live.ts", "src/cli/verify-lifecycle.ts", "src/cli/verify.ts", "src/cli/index.ts", "README.md", "detent-prd-v3.md"]
prd_refs: ["V-1⁶", "V-1⁗", "SEC-5", "D-4", "N-6", "PRDR-232"]
acceptance_criteria: ["A project's declared lifecycle scripts are recorded with their bodies' hashes, and an operator approves them by name after seeing them — the approval is per project and per script body, so editing an approved script withdraws its approval until it is approved again.", "The install and the gates run with suppression lifted only for what is approved, and a work directory carrying an unapproved declared lifecycle script installs with suppression on and says so where the first red gate is read.", "The run-wide `DETENT_ALLOW_LIFECYCLE_SCRIPTS` switch V-1⁶ ships stays as the blunt instrument it is, and the finer verb supersedes it for projects that have one."]
non_goals: ["Does not weaken V-1⁶'s default: suppression stays on until an operator lifts it.", "Does not extend to pnpm, yarn or bun, whose script and plugin surfaces are unmeasured (see PRDR-234 if one is filed)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-232"]
depends_on: ["PRDR-232"]
---

# PRDR-233 — the blunt switch, and the finer one it stands in for

**Severity:** minor · **Category:** hardening · **Found by:** the PRDR-232 design panel, as the
half of its recommendation deliberately not shipped

## Problem

V-1⁶ suppresses a judged tree's lifecycle and `pre`/`post` scripts by default, which is right,
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

## Design

- **The record.** `.detent/state/lifecycle.jsonl`, append-only, one line per approval: package,
  script, body, SHA-256, who approved it and when. A torn last line costs only that line. An
  approval holds the body it hashed, so a script is approved, not approved, or edited since
  approved.
- **What is declared.** For each package (V-5′): the scripts of its manifest that `npm install`
  runs, in npm's order, and the `pre` and `post` of each bound gate whose command is
  `npm run <script>`.
- **What runs.** Suppression stays on (V-1⁶). Detent runs each approved script itself, as
  `npm run '<script>'` under the gate environment, where npm would have run it: an approved
  `preinstall` before the install and the rest after it, a gate's approved `pre` before the gate
  and its approved `post` after a green one. A red `pre` is the gate's red result. This holds on
  the referee's installs and gates, the Stop hook's scoped gate and its install, and the
  falsification probe.
- **The install's mark.** It gains a second line, `lifecycle <digest>`, a hash of what was
  approved to run with the install, so an approval given after an install installs again. The
  first line stays the timestamp the referee journals.
- **The note.** Where a declared script was not run, the first red gate's `last_failure.json`
  gains `lifecycle_not_run`, naming each script, why it did not run, and the verb that approves
  it. The dossier and its one-screen summary carry it. The Stop hook's scoped gate ends its tail
  with it, within the 1,500 bytes the hook keeps. The journal's install event gains `not_run`.
  npm only.
- **The switch.** The gate environment is now `gateEnv(root)`. For a project with an approval on
  record, `DETENT_ALLOW_LIFECYCLE_SCRIPTS` is superseded: suppression stays on and only the
  approved scripts run. For one without, it lifts suppression as V-1⁶ ships it.
- **The verb.** `detent verify lifecycle [root]` lists every declared script with its body, hash
  and status. `--approve <script>` (repeatable, with `--package <dir>` for a package's own) shows
  the bodies and records them, on a terminal after a [y/N] and off one only with `--yes`. It
  refuses a name the manifest does not declare as a lifecycle script and a package that is not
  the project's, and it says a script already approved as it stands is, without asking. It is
  plumbing, listed in the usage and the README.
- **The PRD:** a V-1⁷ paragraph after V-1⁶, which now names V-1⁷ as the per-project,
  per-script approval.

### Vetoable calls

1. **The module is `src/adapter/lifecycle.ts`, not the planned `src/kernel/lifecycle.ts`.** It
   knows npm's script names and builds `npm run` commands, and N-1 keeps stack knowledge out of
   the kernel: a test refuses `npm ` in `src/kernel`. The kernel reaches it through
   `siblingsOf`, `npmGateScripts` and `notRunNoteFor`.
2. **Detent runs an approved script by name, rather than lifting suppression for it.** npm has
   no per-script lift: `npm_config_ignore_scripts` is all or nothing. `npm run '<script>'` under
   suppression runs that body and none of its own `pre` or `post`.
3. **A record exists from the first approval.** Until then a project has no record, and the
   switch keeps V-1⁶'s reading. A project whose operator approved one script has taken the finer
   verb, and the switch lifts nothing there.
4. **Binding execution at `init` and `verify sync` keeps the switch's run-wide reading.** It
   runs each candidate command once to learn whether it is runnable, and it does not read the
   record.
5. **npm only, and only the project's own scripts.** pnpm, yarn and bun are unmeasured (the
   non-goal). A dependency's own install scripts stay suppressed: approving the project's scripts
   approves nothing a dependency brings.
6. **`dependencies` counts as an install script.** npm runs it after an install that changed
   `node_modules`.
7. **The dossier schema gains an optional field,** `lifecycle_not_run`, so the note reaches the
   operator where a stuck ticket is read. It is optional, so earlier dossiers stay valid.
8. **Approving off a terminal needs `--yes`.** An approval lets a run execute a body, which is a
   human decision. A script piping into the verb has to say it accepts that.

Added while building:

9. **The fix stage's repro runs under `gateEnv(root)` too,** so it reads the switch as the gates
   do. No test holds it (see below).

## Falsification (verification protocol, item 1)

A probe of four cases, one per acceptance criterion's visible effect, run in a worktree at HEAD
(`a745af5`, PRDR-332's fix), without this ticket's changes:

```
× PRDR-233 falsification probe > A: detent verify lifecycle --approve <script> --yes records the approval
  → Unknown option '--approve'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- "--approve"
× PRDR-233 falsification probe > B: the Stop gate's install runs an approved postinstall
  → expected false to be true // Object.is equality
× PRDR-233 falsification probe > C: a run reaches DONE when its test needs an approved pretest
  → expected 'NEEDS_HUMAN' to be 'DONE' // Object.is equality
× PRDR-233 falsification probe > D: a red gate's record names the declared scripts Detent did not run
  → expected '' to contain 'pretest (not approved)'
Tests  4 failed (4)
```

The same probe on the fix: 4 passed. The probe was a scratch file; the cases live on in the
suites below.

## Mutation battery

Each mutant was applied to a snapshot copy of its file, then the six PRDR-233 test files were
run (38 cases), and the file was restored from its copy and checked with `cmp`. Thirty-seven
mutants across eight files. The first battery killed 36. R5 survived: no case needed the
referee's gate itself to read the switch, because the switch case's script ran at install time.
The added case, "the run-wide switch lifts the gate's own suppression too, where no record
exists", kills it, re-run against the mutant.

| Mutant | File | Killed by |
|---|---|---|
| L1 an edited body counts as approved | `adapter/lifecycle.ts` | `adapter/lifecycle` |
| L2 no gate siblings are declared | `adapter/lifecycle.ts` | `adapter/lifecycle` |
| L3 `preinstall` runs after the install | `adapter/lifecycle.ts` | `adapter/lifecycle`, `adapter/install-lifecycle` |
| L4 the digest is always empty | `adapter/lifecycle.ts` | `adapter/lifecycle`, `adapter/install-lifecycle` |
| L5 `post` runs after a red gate | `adapter/lifecycle.ts` | `adapter/lifecycle` |
| L6 a red `pre` does not stop the gate | `adapter/lifecycle.ts` | `adapter/lifecycle` |
| L7 no gate has siblings | `adapter/lifecycle.ts` | `kernel/lifecycle-run`, `sessions/live-lifecycle` |
| L8 the note is never given | `adapter/lifecycle.ts` | `adapter/lifecycle`, `kernel/lifecycle-run`, `sessions/live-lifecycle` |
| L9 a script name is not quoted | `adapter/lifecycle.ts` | `adapter/lifecycle`, `adapter/install-lifecycle` |
| L10 an approval is not per package | `adapter/lifecycle.ts` | `adapter/lifecycle` |
| N1 the record does not supersede the switch | `adapter/normalize.ts` | all four run-level files |
| I1 an approval since the install does not install again | `adapter/install.ts` | `adapter/install-lifecycle` |
| I2 the after-scripts do not run | `adapter/install.ts` | `adapter/install-lifecycle` |
| I3 the before-scripts do not run | `adapter/install.ts` | `adapter/install-lifecycle` |
| I4 a failed after-script is ignored | `adapter/install.ts` | `adapter/install-lifecycle` |
| I5 the mark read is the whole file | `adapter/install.ts` | `adapter/install-lifecycle` |
| I6 the mark keeps no digest | `adapter/install.ts` | `adapter/install-lifecycle` |
| I7 the install ignores the approvals | `adapter/install.ts` | `adapter/install-lifecycle` |
| R1 the referee's gate runs no siblings | `kernel/referee-gate.ts` | `kernel/lifecycle-run` |
| R2 the red gate's record has no note | `kernel/referee-gate.ts` | `kernel/lifecycle-run` |
| R3 the referee's install has no approvals | `kernel/referee-gate.ts` | `kernel/lifecycle-run` |
| R4 the referee's install ignores the switch | `kernel/referee-gate.ts` | `kernel/lifecycle-run` |
| R5 the referee's gate ignores the switch | `kernel/referee-gate.ts` | `kernel/lifecycle-run` (the added case) |
| V1 the Stop gate's install has no approvals | `sessions/live.ts` | `sessions/live-lifecycle` |
| V2 the Stop gate runs no siblings | `sessions/live.ts` | `sessions/live-lifecycle` |
| V3 the Stop gate's tail has no note | `sessions/live.ts` | `sessions/live-lifecycle` |
| V4 the Stop gate ignores the switch | `sessions/live.ts` | `sessions/live-lifecycle` |
| V5 the backend passes no binding | `sessions/live.ts` | `sessions/live-lifecycle` |
| V6 the note overflows the kept tail | `sessions/live.ts` | `sessions/live-lifecycle` |
| F1 the probe runs no siblings | `kernel/falsify.ts` | `kernel/lifecycle-run` |
| F2 the probe ignores the switch | `kernel/falsify.ts` | `kernel/lifecycle-run` |
| C1 approval without consent | `cli/verify-lifecycle.ts` | `cli/verify-lifecycle` |
| C2 off a terminal without `--yes` | `cli/verify-lifecycle.ts` | `cli/verify-lifecycle` |
| C3 an undeclared name is accepted | `cli/verify-lifecycle.ts` | `cli/verify-lifecycle` |
| C4 an approved body is recorded again | `cli/verify-lifecycle.ts` | `cli/verify-lifecycle` |
| D1 the dossier has no note | `kernel/dossier.ts` | `kernel/lifecycle-run` |
| D2 the summary has no note | `kernel/dossier.ts` | `kernel/lifecycle-run` |

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: not run for this ticket. On 2026-10-02 the user asked for the full suite to run
  once, after the last ticket of the batch, and the batch's closing commit records it. The suites
  nearest the change ran instead (see the commit).

## What changed

- `src/adapter/lifecycle.ts` (new): the declared scripts, the record and its statuses, what the
  install runs before and after itself, a gate's approved siblings and how they run around it,
  and the note.
- `src/adapter/normalize.ts`: `gateEnv(root)`, the gate environment with the record superseding
  the switch. `CI_ENV` stays, for binding execution.
- `src/adapter/install.ts`: the install runs the approved scripts before and after itself, a
  failed one fails the install, the outcome names what was not run, and the mark records what
  was approved to run with it.
- `src/kernel/referee-gate.ts`: the referee's install and gates run under `gateEnv`, with the
  approvals and each gate's approved siblings. The first red gate's record carries the note, and
  the journal's install event carries `not_run`.
- `src/kernel/falsify.ts`, `src/kernel/referee-stage.ts`: the falsification probe runs the
  approved siblings under `gateEnv`, and the repro runs under `gateEnv`.
- `src/sessions/live.ts`: the Stop hook's scoped gate installs with the approvals, runs the
  bound gate's approved siblings, and ends a red tail with the note.
- `src/kernel/dossier.ts`, `src/schemas/records.ts`: the dossier and its summary carry the note.
- `src/cli/verify-lifecycle.ts` (new), `src/cli/verify.ts`, `src/cli/index.ts`: the verb.
- `README.md`, `detent-prd-v3.md`: the verb in the plumbing list; V-1⁷.
- Tests (new): `tests/adapter/lifecycle.test.ts`, `tests/adapter/install-lifecycle.test.ts`,
  `tests/kernel/lifecycle-run.test.ts`, `tests/sessions/live-lifecycle.test.ts`,
  `tests/cli/verify-lifecycle.test.ts`. `tests/docs/golden-path.test.ts` declares the verb's
  [y/N] prompt. `tests/sessions/live-scoped-gate.test.ts` calls `scopedGate` with its new options.

## Recorded, not fixed

- **The repro's environment is untested.** `executeRepro` runs under `gateEnv(root)` (call 9),
  and no case fails if it goes back to the switch alone.
- **The Stop hook's scoped gate reads the root's approvals only.** It gates the root package, as
  before, so a package's own approved siblings run on the referee's gates and not there.
