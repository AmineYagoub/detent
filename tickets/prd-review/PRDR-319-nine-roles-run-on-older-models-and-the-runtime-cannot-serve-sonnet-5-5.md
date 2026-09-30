---
id: PRDR-319
title: "Nine roles run on older models, and the pinned runtime cannot serve Sonnet 5.5. S-5⁵ routes planner, plan_review, review, diagnose and informed_fix to claude-opus-5, and implement, blind_fix, review_fix and research to claude-sonnet-5. On 2026-09-30 the user decided that every role runs on the newest models, Opus 5.5 and Sonnet 5.5. Opus 5.5 costs 20% less per token than Opus 5 and 60% less per cache read, and ksar-cloud's 215 planning sessions would have cost 34% less at its prices. Sonnet 5.5 costs what Sonnet 5 does. The pinned SDK 0.3.280 bundles Claude Code 2.1.280, which names claude-opus-5-5 and not claude-sonnet-5-5, so the pin moves to 0.3.285, and a routed model the bundled runtime cannot serve is named before any session runs"
state: DONE
severity: major
category: capability
labels: ["prd-review", "cost-strategy", "S-5⁶", "S-5⁵", "S-5‴", "routing", "models", "sdk-pin", "user-decision"]
surface: ["src/schemas/roles.ts", "src/init/config.ts", "src/cli/doctor.ts", "src/cli/init.ts", "src/kernel/run.ts", "src/sessions/sdk.ts", "package.json", "package-lock.json", "tests/init/config-defaults.test.ts", "tests/init/plan-review-role.test.ts", "tests/init/audit-role.test.ts", "tests/cli/doctor.test.ts", "tests/sessions/pin-check.test.ts", "tests/sessions/model-fallback.test.ts", "tests/docs/prd-specification-phase.test.ts", "README.md", "detent-prd-v3.md"]
prd_refs: ["S-5′", "S-5″", "S-5‴", "S-5⁵", "S-4⁵", "D-35"]
acceptance_criteria: ["DEFAULT_MODEL_ROUTING routes planner, plan_review, review, diagnose and informed_fix to claude-opus-5-5, and implement, blind_fix, review_fix and research to claude-sonnet-5-5. audit, spec_write and spec_review stay on claude-opus-5-5. No default names claude-opus-5 or claude-sonnet-5.", "DEFAULT_EFFORT_ROUTING is unchanged: max for planner, plan_review, audit, spec_write and spec_review, and xhigh for the rest. The doc-block on which models serve xhigh and max is re-read from the new SDK's own declaration and names Sonnet 5.5.", "The agent-sdk pin moves to 0.3.285 in package.json, the lockfile and PINNED_AGENT_SDK. The ticket records that its bundled runtime, 2.1.285, names both claude-opus-5-5 and claude-sonnet-5-5, and that 2.1.280 names only the first.", "A table in src/schemas/roles.ts states the first bundled runtime that serves each model a default routes to. doctor fails a check, naming the role and the model, when a config routes a role to a model the runtime this Detent bundles does not serve. init and run say the same before their first session.", "An existing config's routing is not rewritten (S-5′). doctor, and init and run before their first session, name each role the config still routes to claude-opus-5 or claude-sonnet-5, the model that supersedes it, and the line of .detent/config.json that moves it.", "init's routing note lists the new defaults, and the README says which role runs on which model.", "A live smoke on the new pin runs one session on claude-opus-5-5 and one on claude-sonnet-5-5, each at xhigh, and records the model and the effort each settled at (S-4⁵). The ticket pastes both.", "Falsifying tests, against HEAD: the default routing names claude-opus-5 for five roles and claude-sonnet-5 for four; doctor passes a config that routes a role to claude-sonnet-5-5 on a runtime that does not serve it; and nothing names a superseded default in an existing config."]
non_goals: ["Does NOT change an effort level. Lowering one is PRDR-327's, behind the bar D-35 sets.", "Does NOT rewrite an existing config's routing, which S-5′ leaves as the config says (vetoable call 2).", "Does NOT change the claude_code pin, which S-5 checks against the CLI on PATH, not the runtime that serves a session.", "Does NOT touch the stopped tabachir test run's pin branch, which keeps the build it ran on."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-275", "PRDR-278", "PRDR-114", "PRDR-125", "PRDR-237", "PRDR-299", "PRDR-318", "PRDR-327"]
depends_on: ["PRDR-318"]
---

# PRDR-319 — every role on Opus 5.5 or Sonnet 5.5

## Where this came from

The cost plan (`docs/plan-cost-strategy.md` §3) found the Opus 5 roles paying Opus 5's prices. The
user then decided, on 2026-09-30, that every role runs on the newest models: "make sure we're using
latest models: opus 5.5, and the new sonnet 5.5".

## Problem

**The routing.** S-5⁵ puts three roles on Opus 5.5, five on Opus 5 and four on Sonnet 5:

| Role | Today | Price per million tokens: input, output, cache read, 1-hour cache write |
|---|---|---|
| `planner`, `plan_review`, `review`, `diagnose`, `informed_fix` | `claude-opus-5` | $5, $25, $0.50, $10 |
| `implement`, `blind_fix`, `review_fix`, `research` | `claude-sonnet-5` | $2, $10, $0.20, $4 |
| `audit`, `spec_write`, `spec_review` | `claude-opus-5-5` | $4, $20, $0.20, $8 |

Sonnet 5.5 is priced as Sonnet 5 is. At Opus 5.5's prices, ksar-cloud's 215 planning sessions
would have cost $748 instead of $1,128 at list prices: 34% less, mostly because cache reads were
34% of their cost and cost 60% less on Opus 5.5.

**The runtime.** A session is served by the Claude Code the SDK bundles, not the one on PATH
(S-5‴). The pinned 0.3.280 bundles 2.1.280. Its binary names `claude-opus-5-5` 41 times and
`claude-sonnet-5-5` not at all, and 2.1.281's does not name it either. 2.1.284's names it 24
times. So routing a role to Sonnet 5.5 today would reach a runtime that does not know the model.
What it would do then is not established: PRDR-114's fallback to the runtime default is one
possibility, and wrong thinking parameters or a wrong cost estimate are others. The SDK's latest
release is 0.3.285, bundling 2.1.285, published on 2026-09-29.

**Nothing names the gap.** `doctor` compares the pin to the installed SDK and the CLI on PATH to
its pin. Nothing compares a routed model to the runtime that must serve it.

## Design

- **The routing:**
  - `planner`, `plan_review`, `review`, `diagnose` and `informed_fix` move to `claude-opus-5-5`;
  - `implement`, `blind_fix`, `review_fix` and `research` move to `claude-sonnet-5-5`;
  - the three specification roles stay where they are.
- **The levels stay.** Both models recalibrated their effort levels, and Opus 5.5 thinks more per
  turn than Opus 5 at the same level. Keeping `max` and `xhigh` keeps at least today's thinking.
  PRDR-327 measures lower levels against D-35's bar.
- **The pin** moves to 0.3.285, in `package.json`, the lockfile and `PINNED_AGENT_SDK`.
- **Model and runtime.** A table in `src/schemas/roles.ts` gives the first bundled runtime that
  serves each model a default routes to: 2.1.280 for `claude-opus-5-5`, and the first build
  verified for `claude-sonnet-5-5` (2.1.284 on this machine). `doctor` fails when a config routes
  a role to a model the bundled runtime does not serve, and `init` and `run` say so before their
  first session. A model outside the table is not judged, since an operator may route to any model.
- **Existing configs are told.** S-5′ leaves a config's routing as it is, and a config cannot tell
  a chosen `claude-opus-5` from a defaulted one. `doctor`, and `init` and `run` before their first
  session, name each role still routed to a superseded default, its successor, and the line that
  moves it.
- **The PRD:** S-5⁶ amends S-5⁵'s routing and S-5‴'s pin.

## Building it

- `src/schemas/roles.ts`: the two defaults, the effort doc-block, and the runtime table.
- `src/init/config.ts`: `PINNED_AGENT_SDK`, and the routing note.
- `src/cli/doctor.ts`, `src/cli/init.ts`, `src/kernel/run.ts`: the model check, and the note on
  superseded defaults.
- `package.json` and `package-lock.json`: the pin. `npm ci` must pass on the new lockfile.
- The tests that pin the routing, and the PRD's S-5⁶. `tests/docs/prd-specification-phase.test.ts`
  reads S-5⁵'s table from the PRD, so it moves with it.

### Vetoable calls

1. **0.3.285, the latest, rather than 0.3.284**, the first release whose runtime was seen to name
   Sonnet 5.5. A day newer, and the one a new install gets.
2. **Existing configs are told, not rewritten.** The alternative moves every role still routed to
   `claude-opus-5` or `claude-sonnet-5`, overriding S-5′ for this one move. It would also move a
   role an operator chose to keep on Opus 5.
3. **The levels stay as they are.** Lower levels are PRDR-327's, behind the bar.
4. **`research` moves to Sonnet 5.5.** It stays a volume role on Sonnet, as S-5′ placed it.

5. **`doctor`'s superseded row informs and never fails.** A config's routing is its own (S-5′), so
   a role on `claude-opus-5` is reported with its successor and the line that moves it, and the row
   stays `ok`. An unserved model fails its row, since that session would run on another model.
6. **The runtime judged is the SDK manifest's `claudeCodeVersion`.** It is what serves every session
   (S-5‴), read without starting a process. An unreadable version fails `doctor`'s row, since
   nothing could be judged, and `init` and `run` say they could not judge it.
7. **`run` is handed the runtime by its driver.** ARCH-1 keeps the SDK's manifest out of the
   referee's reach, so `src/cli/run.ts` reads it and passes it as `RunOptions.runtime`. A fixture
   run passes none: its sessions run on no runtime. The superseded defaults are named either way.
8. **The v1→v2 migration seats the new roles on the new defaults.** It routes them "as `init` would
   route it", so a pre-3.1.1 config that routes no planner now gets `plan_review` on
   `claude-opus-5-5`, where it got `claude-opus-5`. One that routes its planner still gives the
   review the planner's seat (planning decision 9).
9. **The live smoke ran in `~/tabachir-detent-ab2`**, the authorized disposable clone, through
   Detent's own backend, not in any project. Its `.detent/` was copied first to
   `~/.detent-run-logs/ab2-detent-backup-2026-09-30`, and the two sessions' rows are in its ledger.
10. **Test configs that record `agent_sdk: "0.3.280"` stay.** They are a project's recorded pin,
    which `doctor` reports and never enforces (PRDR-254). The one test that compares it with the
    installed SDK now pins what `package.json` pins.

## Falsification, as filed

- The default routing names `claude-opus-5` for five roles and `claude-sonnet-5` for four.
- `doctor` passes a config that routes `implement` to `claude-sonnet-5-5` while the bundled
  runtime is 2.1.280.
- A config routing `review` to `claude-opus-5` draws no note.
## What changed

- `src/schemas/roles.ts`: the nine roles move to `claude-opus-5-5` and `claude-sonnet-5-5`;
  `FIRST_RUNTIME_SERVING`, `SUPERSEDED_MODELS`, `unservedRoutes` and `supersededRoutes`. Versions
  are compared as numbers, and a model named like an object's own key is read with `Object.hasOwn`.
  The effort doc-block says where the level support now comes from.
- `src/sessions/runtime.ts` (new): the SDK manifest, `version` and `claudeCodeVersion`, moved out of
  `doctor` with PRDR-096's resolution.
- `src/kernel/routing-advice.ts` (new): the notes `doctor`, `init` and `run` share, and the line in
  `.detent/config.json` a role's entry is on, looked for inside `model_routing`.
- `src/cli/doctor.ts`: the `routed-models` and `superseded-models` rows, and `runtimeVersion` as a
  seam.
- `src/cli/init.ts`, `src/kernel/run.ts`, `src/cli/run.ts`: the notes before the first session.
- `src/init/config.ts`: `PINNED_AGENT_SDK` is 0.3.285, and the routing note cites S-5⁶.
- `package.json`, `package-lock.json`: `@anthropic-ai/claude-agent-sdk` 0.3.285 and its nine
  platform packages, nothing else. `npm ci` passes on the new lockfile.
- `README.md`: a Models section, with the routing table a test reads back against the code.
- `detent-prd-v3.md`: S-5⁶'s build note, which states the routing in S-5⁵'s form.
- Tests: `tests/sessions/runtime.test.ts`, `tests/kernel/routing-advice.test.ts`,
  `tests/kernel/run-routing.test.ts`, `tests/cli/init-routing.test.ts` and
  `tests/cli/run-routing.test.ts` are new. `doctor.test.ts`, `config-defaults.test.ts`,
  `plan-review-role.test.ts` and `audit-role.test.ts` move to the new routing, and
  `prd-specification-phase.test.ts` reads "as the code has them" from S-5⁶. S-5⁵ keeps what
  PRDR-278 seated.

## The runtimes

- 0.3.280 bundles 2.1.280, whose binary names `claude-opus-5-5` 41 times and `claude-sonnet-5-5`
  never; 2.1.281's does not name it either; 2.1.284's names it 24 times.
- 0.3.285 bundles 2.1.285 (`npm view @anthropic-ai/claude-agent-sdk@0.3.285 claudeCodeVersion`),
  whose binary names `claude-opus-5-5` 53 times and `claude-sonnet-5-5` 35 times.
- 0.3.285's `sdk.d.ts` no longer says which model serves which level. Its runtime's
  `supportedModels()`, asked on this account, resolves `opus` to `claude-opus-5-5` and `sonnet` to
  `claude-sonnet-5-5`, each with `["low","medium","high","xhigh","max"]`.

## Live smoke

Run in `~/tabachir-detent-ab2` through `ClaudeCodeBackend` on the new pin, a `review` session asked
to read `README.md` once so the containment hook saw the level each turn ran at:

    sdk {"version":"0.3.285","runtime":"2.1.285"}
    claude-opus-5-5 {"ok":true,"telemetryParsed":true,"routedEffort":"xhigh","settledEffort":"xhigh","models":["claude-haiku-4-5-20251001","claude-opus-5-5"],"fallback":null,"turns":2,"costUsd":0.0285,"seconds":8}
    claude-sonnet-5-5 {"ok":true,"telemetryParsed":true,"routedEffort":"xhigh","settledEffort":"xhigh","models":["claude-haiku-4-5-20251001","claude-sonnet-5-5"],"fallback":null,"turns":2,"costUsd":0.0082,"seconds":3}
    smoke total $ 0.0367

Both served as routed, with no fallback, and settled at the level they were routed to.

## Falsification

Against HEAD `33fb4b0`, with 0.3.280 installed:

    × PRDR-114 init writes the model routing > covers every role, judgement on the stronger models and volume on Sonnet 5ms
    → expected 'claude-opus-5' to be 'claude-opus-5-5' // Object.is equality
    × PRDR-114 init writes the model routing > routes every role to Opus 5.5 or Sonnet 5.5, judgement on Opus and volume on Sonnet 2ms
    → expected { planner: 'claude-opus-5', …(11) } to deeply equal { planner: 'claude-opus-5-5', …(11) }
    × S-5⁶ the README states the default routing as the code has it > names every role once, with its model and its level 0ms
    → the README has a Models section: expected -1 to be greater than -1
    × PRDR-263 init writes the effort routing > never routes a role to a level its own model cannot serve 10ms
    → claude-opus-5 is a model whose effort support this test has not verified: expected undefined to be defined
    × S-5⁶ init names the routing's problems before its first session > names a model the runtime cannot serve, and each superseded default with the line that moves it 134ms
    → expected '' to contain 'implement → claude-sonnet-5-5'
    × S-5⁶ run names the routing's problems before its first session > names a model the runtime cannot serve and a superseded default, before the first session, and runs as routed 582ms
    → the unserved model, with the runtime: expected '' to contain 'implement → claude-sonnet-5-5'
    × S-5⁶ doctor judges each routed model against the bundled runtime > fails, naming the role, the model and the runtime, when the runtime predates the model 137ms
    → a model the bundled runtime does not serve is a failed check: expected undefined to be false // Object.is equality
    × S-5⁶ doctor judges each routed model against the bundled runtime > passes when the runtime serves every routed model, and leaves a model outside its table unjudged 135ms
    → expected undefined to be true // Object.is equality
    × S-5⁶ doctor judges each routed model against the bundled runtime > names each role routed to a superseded default, its successor and the line that moves it, without failing 134ms
    → a config keeps its own routing (S-5′), so this informs and does not fail: expected undefined to be true // Object.is equality
    Error: Cannot find module '../../src/sessions/runtime.js' imported from '/Users/workstation/detent/tests/sessions/runtime.test.ts'
    Tests  9 failed | 31 passed (40)

## Mutation battery

Each mutant was applied to snapshot copies of `roles.ts`, `routing-advice.ts`, `doctor.ts`,
`init.ts`, `run.ts` (kernel and CLI) and `config.ts`, nine suites were run (106 cases), and every
file was restored from its copy and checked with `cmp`.

| Mutant | Result |
|---|---|
| M1 `review` back on `claude-opus-5` | killed, 7 cases |
| M2 the table says 2.1.280 serves Sonnet 5.5 | killed, 5 |
| M3 versions compared as text | killed: 2.1.1000 reads as before 2.1.284 |
| M4 an unreadable runtime judged as serving everything | killed, 2 |
| M5 the table read without `Object.hasOwn` | killed: `constructor` reads as a model |
| M6 `routed-models` always ok | killed |
| M7 `superseded-models` fails | killed |
| M8 the line looked for from the file's top | killed: `effort_routing`'s line is named |
| M9 `run` does not say its notes | killed, 3 |
| M10 `init` does not say its notes | killed |
| M11 `PINNED_AGENT_SDK` back to 0.3.280 | killed |
| M12 the `run` CLI passes no runtime | killed |
| M13 the superseded note dropped | killed, 4 |

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: 198 files, 2,229 passed and 2 skipped (2,231).
- `npm run plugin`: wrote nothing that changed.
- `npm ci` on the new lockfile: passes, and installs 0.3.285 bundling 2.1.285.

## Recorded, not fixed

- **picomatch 4.0.3 has two high advisories** (GHSA-3v7f-55p6-f55p, GHSA-c2c7-rcm5-vvqj), which
  `npm audit` reported during the install. It predates this change, and picomatch backs the
  containment hook's globs, so it is a change of its own; it is offered as a separate task.
- **2.1.282 and 2.1.283 were not read.** The table's 2.1.284 is the first runtime found to serve
  Sonnet 5.5, and a runtime between is judged not to. No pinned Detent bundles one.
- **The stopped tabachir test run keeps its pin**, `pin/tabachir-test` at 0.3.280, as the non-goals
  say.
- **The first run on Opus 5.5 at the planner's `max` measures what it thinks.** Opus 5.5 thinks more
  per turn than Opus 5 at the same level, so planning's net cost on the new model is a run-time
  outcome to read from the ledger (D-33).
