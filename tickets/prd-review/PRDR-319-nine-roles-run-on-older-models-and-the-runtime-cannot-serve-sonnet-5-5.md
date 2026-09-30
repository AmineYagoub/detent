---
id: PRDR-319
title: "Nine roles run on older models, and the pinned runtime cannot serve Sonnet 5.5. S-5⁵ routes planner, plan_review, review, diagnose and informed_fix to claude-opus-5, and implement, blind_fix, review_fix and research to claude-sonnet-5. On 2026-09-30 the user decided that every role runs on the newest models, Opus 5.5 and Sonnet 5.5. Opus 5.5 costs 20% less per token than Opus 5 and 60% less per cache read, and ksar-cloud's 215 planning sessions would have cost 34% less at its prices. Sonnet 5.5 costs what Sonnet 5 does. The pinned SDK 0.3.280 bundles Claude Code 2.1.280, which names claude-opus-5-5 and not claude-sonnet-5-5, so the pin moves to 0.3.285, and a routed model the bundled runtime cannot serve is named before any session runs"
state: OPEN
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

## Falsification (to run against HEAD when this is built)

- The default routing names `claude-opus-5` for five roles and `claude-sonnet-5` for four.
- `doctor` passes a config that routes `implement` to `claude-sonnet-5-5` while the bundled
  runtime is 2.1.280.
- A config routing `review` to `claude-opus-5` draws no note.
