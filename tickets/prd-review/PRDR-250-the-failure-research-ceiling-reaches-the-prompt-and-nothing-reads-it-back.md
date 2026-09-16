---
id: PRDR-250
title: "`failure_research_tool_calls` is interpolated into the research prompt and never read back, so the ceiling bounds nothing and its enforcement site is a module that only forwards it"
state: DONE
severity: major
category: gap
labels: ["prd-review", "found-by-audit", "budgets", "X-1", "research"]
surface: ["src/kernel/stages/research.ts", "src/kernel/referee-stage.ts", "src/kernel/referee-session.ts", "src/kernel/budgets.ts", "tests/kernel/stages.test.ts"]
prd_refs: ["X-1", "X-6", "C-3a", "P6"]
acceptance_criteria: ["A failure-research session whose OBSERVED turn count exceeds `failure_research_tool_calls` ends the stage RESEARCH_DRY, and its brief is neither returned nor written to the env-keyed cache.", "A session at or under the ceiling is unaffected, and a cache hit still skips the session entirely without consulting the ceiling.", "`SessionArm.launch` returns the observed turn count so the stage can read it; a launch suppressed by the crash skip reports zero.", "`ENFORCEMENT_SITES` names a module that actually reads the count back, and the oracle test that greps the named module for the key still passes.", "A test drives `researchStage` with an over-ceiling launch and fails on today's tree."]
non_goals: ["Does NOT refuse the ninth call mid-session, which is what the implementation plan's AC says; see 'What this does not do' — the mechanism that would is forbidden by PRDR-106.", "Does not bound the tokens that over-budget session already spent; it bounds whether its brief is trusted and cached.", "Does not change the cache, the key, or the version_facts contradiction rule (X-6).", "Does not touch `planning_research_tool_calls`, which init already enforces across sessions by the same proxy."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-106", "PRDR-053", "PRDR-191"]
depends_on: []
---

# PRDR-250 — a ceiling the prompt was asked to respect

## Problem

`researchStage` passes `tool_call_ceiling: deps.toolCallCeiling` into the session inputs
and then never looks at it again. `deps.launch` returns `Promise<void>`, so no count comes
back, and nothing compares anything to the ceiling. A research session may make any number
of calls and its brief is accepted, returned and written to the env-keyed cache on exactly
the same terms as one that stayed inside its budget.

This is not a ceiling the PRD left advisory. `schemas/budgets.ts` declares
`failure_research_tool_calls: { scope: "research-session", breachTarget: "RESEARCH_DRY",
default: 8 }`, the v2 table gives it `RESEARCH_DRY → NEEDS_HUMAN`, and the implementation
plan's AC reads: *"`failure_research_tool_calls` ceiling of 8 enforced — the 9th call is
refused and the session ends RESEARCH_DRY rather than running unbounded."*

`ENFORCEMENT_SITES` names `kernel/referee-stage` as the enforcer. That module reads the
number and hands it to the stage, which hands it to a prompt. The map's own contract —
"every X-1 key must appear: a ceiling with no enforcer is a budget that routes nowhere,
which P6 forbids" — is satisfied by the key APPEARING in the named module, which is why
this read as closed. The oracle test behind it greps the named module for the key with
comments stripped; forwarding a value satisfies that grep exactly as bounding it would.

## What this does not do, and why

It does not refuse the ninth call. The only mechanism that could is a per-session turn
ceiling, and `src/sessions/sdk.ts` records why that is not available:

> X-1″ (PRDR-106): sessions carry no turn ceiling any more, so a throw here is a crash —
> transport death, or the doctor probe's own one-turn bound — never a budget event.

Setting `maxTurns` for research sessions would make an over-budget research session
indistinguishable from a transport death at the one seam that classifies crashes, and
PRDR-053's crash accounting is built on that distinction. Buying literal compliance with
the plan's wording at the cost of that seam is the wrong trade, so this ticket bounds the
OUTCOME instead: an over-budget brief is not trusted and not cached. The plan's AC is
therefore still not literally met, and that is recorded here rather than papered over.

## Design

Turns are the proxy, which is not a new decision — init's sibling ceiling already works
this way and says so at `src/init/pipeline.ts`:

> Turns are the observable proxy for tool calls the backend reports; S-4's telemetry has
> no per-call counter, so a turn is one call's worth of budget. The ceiling is enforced
> either way (C-3a).

So `SessionArm.launch` returns the observed turn count, `ResearchDeps.launch` returns it
through, and the stage routes `researchDry` when it exceeds the ceiling — before the brief
is parsed, returned, or cached. A launch suppressed by B-5's crash skip returns zero,
because no session ran.

`ENFORCEMENT_SITES` moves to `kernel/stages/research`, which is now the module that reads
the count back rather than the one that forwards it.

## Falsification (verification protocol, item 1)

`tests/kernel/stages.test.ts`, run against `9b35f86`:

```
× an over-ceiling research session is RESEARCH_DRY, and its brief is not cached
  → a session past its ceiling is dry, however good its brief looks:
    expected 'RESEARCH_VALID' to be 'RESEARCH_DRY'
✓ a research session inside its ceiling is unaffected
```

The second case passed before the fix as well as after: it is the control, and it is what
stops the refusal being bought by making every research session dry.

## The oracle refused the first attempt, correctly

Moving `ENFORCEMENT_SITES` to `kernel/stages/research` failed
`tests/oracle/budgets.test.ts`:

```
kernel/stages/research is named as enforcing failure_research_tool_calls
but never mentions it outside a comment
```

That check strips comments (PRDR-172) AND string literals (PRDR-179) before matching, and
its own doc-block describes the posture it was refusing here exactly: `planning_research_tool_calls`
once "survived only via a template literal in an error string, while the enforcement beside
it read a handed-in number". `researchStage` took `toolCallCeiling: number` — a handed-in
number — so naming it as the enforcer would have been the same claim the oracle exists to
reject.

So the dependency is now `budgets: Pick<Budgets, "failure_research_tool_calls">` and the
stage reads the key itself. The module named as enforcing the ceiling is the module that
reads it.

## What changed

`SessionArm.launch` returns `result.turns` (zero when B-5's crash skip suppressed the
launch); `ResearchDeps.launch` returns it through; `researchStage` compares it to the
ceiling it now reads from `budgets` and returns `researchDry` before the brief is parsed,
returned, or written to the env-keyed cache. `ENFORCEMENT_SITES` moved from
`kernel/referee-stage` to `kernel/stages/research`.

The four other `sessions.launch` callers ignore the new return value and are unchanged.
