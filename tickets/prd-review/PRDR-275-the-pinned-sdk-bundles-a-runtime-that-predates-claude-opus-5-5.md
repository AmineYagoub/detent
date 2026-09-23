---
id: PRDR-275
title: "The pinned Agent SDK bundles Claude Code 2.1.258, which predates Claude Opus 5.5 — a project that routes a role to `claude-opus-5-5` hands an unknown model to a runtime with no entry for it, and the PRDR-114 fallback that would catch a refusal runs the runtime default instead, noted per session but raised nowhere"
state: DONE
severity: major
category: gap
labels: ["prd-review", "S-5", "runtime", "model-launch"]
surface: ["package.json", "package-lock.json", "src/init/config.ts", "detent-prd-v3.md", "tests/cli/doctor.test.ts", "tests/kernel/run-fixture.ts", "tests/kernel/run.test.ts", "tests/oracle/worstcase.test.ts", "tests/sessions/symbols.test.ts", "tests/init/config-defaults.test.ts"]
prd_refs: ["S-5", "S-5′", "SEC-2", "D-16", "N-7", "PRDR-095", "PRDR-114", "PRDR-237", "PRDR-254"]
acceptance_criteria: ["`package.json` pins `@anthropic-ai/claude-agent-sdk` at exactly `0.3.280`, the lockfile is regenerated from it, and `PINNED_AGENT_SDK` — the pin a fresh `init` writes — mirrors it. That is release-checklist item 6, and `tests/init/config-defaults.test.ts` already holds it by reading `package.json`.", "The runtime every session runs is one that serves the model. The installed SDK declares `claudeCodeVersion: 2.1.280`, and its bundled native binary names `claude-opus-5-5`. This is the evidence that failed against HEAD, re-run verbatim.", "Every fixture that stands for a config this Detent writes names the SDK this Detent installs. The `agent_sdk` literals move; the `claude_code` literals do not, because they stand for whatever CLI an operator has installed, which is not Detent's to choose — PRDR-254's split between the two pins.", "The PRD records the move the way it records every amendment: S-5′ keeps its history (PRDR-114 moved the pin to 0.3.258, as S-5′ still says the planner sat on Fable 5.1 until S-5″ moved it), and a new S-5‴ entry, placed after S-5″, states the new pin and why it is the SDK's pin that moves.", "All seven gates green on the new SDK. 0.3.258 and 0.3.280 were published three weeks apart, and `typecheck` is what detects an `Options` or hook-input shape that moved underneath `sdk.ts`.", "Live evidence, because the fixture suite runs no real session: one session through Detent's own backend, routed to `claude-opus-5-5` at effort `max`, reports the model that actually ran (PRDR-095's `models`), no `modelFallback`, and a settled effort of `max` (PRDR-237). `doctor --smoke` cannot supply this — it launches with `model: \"\"` and no effort, so it proves the runtime and the telemetry, not the routing.", "Falsifying evidence against HEAD `a698db2`, recorded below: SDK 0.3.258, `claudeCodeVersion` 2.1.258, and zero occurrences of `claude-opus-5-5` in the bundled binary against 47 of `claude-opus-5`."]
non_goals: ["Does NOT move `DEFAULT_MODEL_ROUTING` to Claude Opus 5.5. Both models the defaults name are served by 2.1.280 and Claude Opus 5 remains available; what a fresh `init` routes to is a decision about cost and quality that needs its own evidence, not a side effect of a runtime bump.", "Does NOT address D-35: S-5's `claude_code` pin is verified against the `claude` on PATH, while every session runs the SDK's bundled binary, because Detent never sets `pathToClaudeCodeExecutable`. Recorded in the run tracker and unchanged here.", "Does NOT certify the bump for a release. Release-checklist item 5 — the N-7 self-build, D-16 — re-runs on every S-5 backend upgrade before any tag, as PRDR-114 recorded for its own bump. This branch is not being released.", "Does NOT rewrite any project's `pinned.agent_sdk`. `ensureConfig` never rewrites an existing config, and PRDR-254 made that pin advisory: a project already initialised sees doctor's red, non-refusing row until its operator updates the file.", "Does NOT change how a session is launched. Detent passes `effort` and no thinking configuration (`sdk.ts:187`), which Claude Opus 5.5 accepts at every level; its four breaking changes — thinking cannot be disabled, forced `tool_choice`, preserved thinking, the computer toolset — touch no request Detent makes."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-114", "PRDR-254"]
depends_on: []
---

# PRDR-275 — the pinned SDK bundles a runtime that predates Claude Opus 5.5

## Where this came from

Claude Opus 5.5 (`claude-opus-5-5`) launched on 2026-09-22. The platform documentation's models
overview now opens with "start with Claude Opus 5.5 for most workloads" and lists Claude Opus 5
under legacy models, still available. Its request surface is Claude Opus 5's except for four
breaking changes, none of which Detent's sessions exercise: Detent sends `effort` and no thinking
configuration, forces no tool, rewrites no history, and uses no computer tool.

The ksar-cloud operator asked whether their routing could move from Claude Opus 5 to Claude Opus
5.5. The model's answer was yes; the runtime's was not. The Claude Code changelog adds the model in
**2.1.280** — "Added Claude Opus 5.5 (`claude-opus-5-5`), now the default Opus model".

## Why the SDK, and not the CLI

Detent never sets `pathToClaudeCodeExecutable`. When it is unset, the SDK resolves its own native
binary from the platform package and never consults PATH:

```js
let GE=u.pathToClaudeCodeExecutable;if(!GE){ … so.resolve(…) … if(!ia)throw Error(`Native CLI binary …
```

So the runtime a session gets is chosen by the `agent_sdk` pin, through the SDK's own
`claudeCodeVersion` — the PRD's S-5′ entry already says as much ("the agent-sdk pin moves to
0.3.258, whose bundled runtime serves the models the default names"). Upgrading the `claude` on
PATH changes nothing a session runs. That the S-5 `claude_code` check verifies the PATH binary
anyway is D-35, and out of scope here.

On the old runtime, `claude-opus-5-5` is a model with no entry: the thinking shape, the context
size, and the price table behind `cost_estimate_usd` would all come from whatever the runtime does
with a name it does not know. If the model were refused, PRDR-114's fallback would run the session
on the runtime default and note it — the run would continue on a model the operator did not route
to.

## Falsification against HEAD

```
$ git rev-parse --short HEAD
a698db2
$ node -p "require('@anthropic-ai/claude-agent-sdk/package.json').version"
0.3.258
$ node -p "require('@anthropic-ai/claude-agent-sdk/package.json').claudeCodeVersion"
2.1.258
$ grep -a -o 'claude-opus-5-5' node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude | wc -l
0
$ grep -a -o 'claude-opus-5"' node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude | wc -l    # control
47
```

SDK 0.3.280, published 2026-09-22, declares `claudeCodeVersion: 2.1.280`.

## What changed

- `package.json` pins `@anthropic-ai/claude-agent-sdk` at exactly `0.3.280`. The lockfile diff is
  the SDK and its eight platform packages and nothing else: no line outside that family moved.
- `PINNED_AGENT_SDK` mirrors it, so a fresh `init` writes the pin this Detent installs.
- The six `agent_sdk` fixture literals move with it. The `claude_code` literals beside them do
  not: they stand for an operator's CLI, which is not Detent's to choose.
- The PRD gains S-5‴ after S-5″. S-5′ keeps its history.

The same commands, on the fixed tree:

```
$ node -p "require('@anthropic-ai/claude-agent-sdk/package.json').version"
0.3.280
$ node -p "require('@anthropic-ai/claude-agent-sdk/package.json').claudeCodeVersion"
2.1.280
$ grep -a -o 'claude-opus-5-5' node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude | wc -l
41
```

## Mutation battery

Each mutant is the drift a careless bump leaves. Baseline 30/30 green on
`config-defaults.test.ts` + `doctor.test.ts`; every mutant restored from a snapshot.

| Mutant | Result |
|---|---|
| M1 `PINNED_AGENT_SDK` left at `0.3.258` — `init` writes a stale pin | KILLED (1 failed) |
| M2 the run fixture left at `0.3.258` — the fixture no longer mirrors the install | KILLED (3 failed) |
| M3 `package.json` moved to `0.3.281`, the constant not | KILLED (1 failed) |

## Live evidence

`doctor --smoke` against ksar-cloud, on the new runtime, with the operator's PATH CLI moved to
2.1.280 and the project's pins to `0.3.280` / `2.1.280`:

```
[ok] agent-sdk-pin: pinned 0.3.280 == installed 0.3.280
[ok] claude-code-pin: backend reports the pinned 2.1.280
[ok] smoke-session: smoke OK: telemetry parsed end-to-end (cost estimate $0.1225, 1 turns)
```

Its ledger row names `claude-opus-5-5[1m]` — the smoke launches with `model: ""`, so that is the
new runtime's DEFAULT, and it proves nothing about routing. The routing was proved separately:
one session through `buildLiveBackend`, S-5 checked first, model and effort read from the
project's own `review` route rather than restated:

```
routed:        { model: "claude-opus-5-5", effort: "max" }
ok:            true    telemetryParsed: true
ranOn:         ["claude-haiku-4-5-20251001", "claude-opus-5-5"]
modelFallback: null
settledEffort: "max"
turns: 2    costEstimateUsd: 0.0839    (recorded to the project ledger as `prdr275-probe`)
```

No fallback, and the level the turn settled at is the level that was routed — PRDR-237's signal,
read off the one tool call the probe made for exactly that purpose. The routed model reports
without the `[1m]` suffix the default carries; every routed Claude Opus 5 session in the same
ledger (213 of them) did the same, so that is how the runtime labels an explicit ID, not a change.

Seven gates green on the new SDK: 1393 tests across 133 files.
