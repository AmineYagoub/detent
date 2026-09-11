---
id: PRDR-237
title: "The effort a session actually ran at is never read, so a level the model silently downgraded is indistinguishable from one that took effect — the exact failure PRDR-197 named as its reason for mirroring the SDK's closed set"
state: DONE
severity: major
category: defect
labels: ["prd-review", "PRDR-197", "PRDR-235", "PRDR-114", "observability", "effort", "gate-313"]
surface: ["src/sessions/sdk.ts", "src/sessions/backend.ts", "src/kernel/referee-session.ts", "tests/sessions/sdk.test.ts", "detent-prd-v3.md"]
prd_refs: ["S-4", "S-4‴", "D-21", "V-6", "N-6", "PRDR-197", "PRDR-235", "PRDR-114"]
acceptance_criteria: ["A session whose routed effort was silently downgraded says so, the way a routed model that could not be served already does. Observed FIRST (V-6): `SessionResult` in `src/sessions/backend.ts` carries `modelFallback` and no effort counterpart; `isModelUnavailable`/`modelFallback` at `src/sessions/sdk.ts:310-325` detect the model case and `src/kernel/referee-session.ts:236` journals it with a ticket note, and no code path reads the effort the session settled on. `grep -n effort node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` shows the SDK publishes it at `:185-189` as `effort.level` on every tool-context hook input — 'Active effort level for the current turn ... after any silent downgrade for the selected model' — and Detent runs a PreToolUse hook on every tool call (`buildPreToolUseHook`, `src/sessions/sdk.ts:34`) that discards the field.", "The settled level is recorded on the session's journal entry, beside the routed level PRDR-235 records at `start`. A session that made no tool call observes nothing, and that is recorded as unobserved rather than as agreement.", "Proved by a test that fails on today's tree: a session whose hook input reports a level below the routed one surfaces the downgrade."]
non_goals: ["Does not refuse or retry a downgraded session — PRDR-114's model case runs on the fallback and says so, and effort is the weaker signal of the two.", "Does not read `CLAUDE_EFFORT` from a Bash subprocess: the hook input already carries the field in-process, and the containment hook must not grow a second job.", "Does not add an `effort` column to `ledgerRowSchema` (a `z.strictObject`) — PRDR-235 settled that the journal is the place.", "Does not change any routing or default."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-197", "PRDR-235", "PRDR-114"]
depends_on: ["PRDR-235"]
---

# PRDR-237 — the level that was asked for, and the level that ran

**Severity:** major · **Category:** defect · **Found by:** the first `max` session on gate-313
costing 2% more than the baseline mean, with no way to tell whether that meant anything

## Problem

PRDR-235 made the ROUTED effort visible: the run's config event names `effort_routing`, and each
session's `start` event names the level it was launched with. That closes half of what
`src/schemas/roles.ts:31-33` promises. The other half is the half that sentence is actually about:

> `xhigh` and `max` are not served by every model. **The SDK downgrades silently for a model that
> cannot serve one**, which is why a configured effort is recorded per session rather than assumed
> to have been honoured.

Recording what was *asked for* does not address a silent downgrade. Only reading what the model
*settled on* does.

The parallel with models is exact, and only one side of it is built. A routed model the runtime
cannot serve is detected (`src/sessions/sdk.ts:310-325`), carried on `SessionResult.modelFallback`,
journaled as `model_fallback` and noted on the ticket (`src/kernel/referee-session.ts:236`) — so
"which model ran" always has an answer. For effort there is no detector, no result field and no
event.

The SDK publishes the fact. `sdk.d.ts:185-189`:

> Reasoning effort applied to the current turn ... Present for hooks that fire within a tool-use
> context (PreToolUse, PostToolUse, Stop, SubagentStop, etc.) ... **Active effort level for the
> current turn ... after any silent downgrade for the selected model.**

Detent runs a `PreToolUse` hook on every tool call — D-21 containment, the one layer that sees
everything a session does. The hook input carries `effort.level` and the hook reads `tool_name` and
`tool_input` from it and drops the rest.

## Measured, on the live run

The first session ever launched at `effort_routing.implement: "max"`, against 21 baseline implement
sessions on the same model:

| | baseline (n=21) | max (n=1) |
|---|---|---|
| output tokens | 49,088 | 54,149 (+10%) |
| turns | 46.9 | 53 (+13%) |
| duration | 529s | 630s (+19%) |
| cost | $1.49 | $1.52 (+2%) |

A ten percent move in output tokens is not what a step from the SDK default to `max` should look
like, and there is no way from here to say whether that is a small real effect or no effect at all
because the level was downgraded. The ledger row records `models: [haiku-4-5, sonnet-5]`, which
answers the model question and not this one.

That is the whole cost of the gap: an experiment whose result cannot be attributed. PRDR-235 argued
an unmeasurable knob is not a knob, and then measured the request rather than the outcome.

## Scope

The hook already receives the field on every tool call. It reports the first level it sees through
a callback, `SessionResult` carries it, and the kernel journals it beside the routed level —
emitting the downgrade event only when the two disagree, exactly as `model_fallback` does.

A session that makes no tool call fires no `PreToolUse`, so nothing is observed. That is recorded
as unobserved, never as agreement: the failure this ticket exists to prevent is a missing signal
being read as a matching one.

## What implementation changed

**`src/sessions/sdk.ts`** — `buildPreToolUseHook` takes an optional `onEffort` and reports
`input.effort.level` the first time a tool call carries one. Once, because it is one fact about the
session rather than one per call, and a per-call callback would put work on the containment path.
`buildOptions` threads it through; `runOnce` holds the observed level and puts it on the result.

The observer cannot reach `decision` — it runs before the guard and writes only to a local. A test
asserts the deny path is unchanged with an observer attached, because a containment hook growing a
second job is exactly the kind of change that quietly weakens the first one.

**`src/sessions/backend.ts`** — `SessionResult.effort`, documented as the level after any silent
downgrade, with absent meaning UNOBSERVED.

**`src/kernel/referee-session.ts`** — the routed level is hoisted into `routedEffort` (used by the
`start` event S-4‴ added), and after the session an `effort_settled` event records `routed` against
`active`, with `"unobserved"` where no tool call reported one. When they disagree and a level was
actually routed, a ticket note says so — the same shape `model_fallback` has used since PRDR-114,
and like it, neither refusing nor retrying.

**`tests/sessions/effort-settled.test.ts`** — four tests, two observed failing first (V-6): the
level is reported from the hook input, and reported once across many calls. The other two are guard
rails that passed before and must keep passing — nothing is reported when the input carries no
effort, and a protected write is still denied while observing.

**What this does not yet answer:** whether gate-313's first `max` session was honoured. That session
ran before this landed, so its level is unrecorded and stays that way. The next one will say.
