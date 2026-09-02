---
id: PRDR-114
title: "Detent has no opinion about models: an un-routed run bills every role at the runtime default, and a routed model the runtime cannot serve crashes the session"
state: DONE
severity: major
category: decision
labels: ["prd-review", "user-raised", "found-by-execution"]
surface: ["src/schemas/roles.ts", "src/init/config.ts", "src/cli/init.ts", "src/sessions/sdk.ts", "src/sessions/backend.ts", "src/kernel/referee-session.ts", "package.json", "detent-prd-v3.md"]
prd_refs: ["S-5", "F-1", "S-4", "D-6"]
acceptance_criteria: ["`init` writes a `model_routing` covering every role, typed over the role set; the routing is announced at init and an existing config is never rewritten.", "A routed model the runtime cannot serve falls back to the runtime default for that session with `modelFallback` on the result, once per model per run — later launches skip straight to the fallback — and the referee notes and journals it per session.", "A genuine crash is never mistaken for an unavailable model: the predicate requires a refused session with no work behind it and the runtime's own wording.", "The agent-sdk pin is 0.3.258 in package.json, `init`'s pin, and the fixtures; the bundled runtime serves `claude-fable-5-1`."]
non_goals: ["Does not measure the routing. The next D-16 gate runs on it and is compared to 3.1.0 (59/67 first-generation, $598); the numbers decide whether the split stays.", "Does not route per ticket. Routing is per role, as F-1 wrote it.", "Does not touch an existing project's routing — including the 3.1.0 evidence repo."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-095", "PRDR-096", "PRDR-106"]
depends_on: []
---

# PRDR-114 — `init` writes a model routing, and an unavailable model falls back

**Severity:** major · **Category:** decision · **Raised by:** the user, asking what the
default model for every role was · **Found by:** probing it

## The measurement

`init` wrote `model_routing: {}` and every role launched with no model, so every role ran on
the runtime's default. Probed on this machine: `claude-opus-4-8[1m]`, the Opus tier with
the 1M context, alongside the runtime's own Haiku helper. The 3.1.0 gate cost $598 because
its config routed everything to Sonnet 5; on the defaults it would have been roughly
$1,500, with 78% of that in the implement role.

Probing the three current models through Detent's own backend:

```
claude-opus-5     ok
claude-sonnet-5   ok
claude-fable-5-1  400: Claude Code 2.1.191 does not support this model; 2.1.251 or later
```

The pinned agent-sdk 0.3.191 bundles runtime 2.1.191. And the failure was a crashed session
— which under PRDR-090 would have counted toward an outage streak, three of them halting
the run for a configuration fact.

## The decision

Judgement on the stronger models, volume on Sonnet. The planner is 2% of spend and the
source of the gate's most expensive defects — dropped `non_goals`, missing edges, a ticket
sized for three, sixty-six tickets that never wired the CLI — so it gets Fable 5.1. Review
is 13% of spend at 3–19 turns a session and was the actor that caught the unwired CLI and
the "written but never wired" pattern, so it, the hypothesis, and the informed attempt get
Opus 5 — and D-6 gains something: the work is judged by a different model than wrote it.
Implement is 78% of spend and this gate's evidence does not say its capability was the
bottleneck (59 of 67 first-generation), so it and the other volume roles stay on Sonnet 5.
The next gate measures this; it is a default, not a finding.

## Resolution

`DEFAULT_MODEL_ROUTING` in `src/schemas/roles.ts`, typed over `ROLE_IDS`; `ensureConfig`
writes it and `init` announces it. `ClaudeCodeBackend.run` recognises the runtime's
"does not support this model" on a refused, work-free session, falls back to the runtime
default for that session, remembers the model for the run, and returns `modelFallback`;
the referee notes and journals it. The pin moves to 0.3.258 (runtime 2.1.258).

## Amendment — the routing did not reach the planner

Init sessions hard-coded `model: ""`: `model_routing.planner` (and `research`, for planning
research) was dead on the only path that launches a planner, before this ticket and after
its first commit. `PipelineDeps.modelRouting` now flows from the config `init` just wrote
into every init session launch through one shared deps builder, and a test asserts every
planner session carries the routed model.
