---
id: PRDR-215
title: "Headless write sessions can spawn sub-agents: D-28's spawn denial is published for the plugin driver and never applied under the SDK"
state: OPEN
severity: major
category: defect
labels: ["prd-review", "D-28", "budgets", "containment", "sdk", "parity", "gate-313"]
surface: ["src/sessions/guard.ts", "src/sessions/sdk.ts", "src/kernel/hook-policy.ts", "src/plugin/hook.ts", "tests/sessions/guard.test.ts", "tests/sessions/sdk.test.ts", "detent-prd-v3.md"]
prd_refs: ["D-28", "D-21", "D-27", "P6", "S-2‴", "S-3", "X-1", "V-6", "N-6", "PRDR-065", "PRDR-122", "PRDR-180"]
acceptance_criteria: ["Under the headless driver, every session's PreToolUse hook denies `Task`, `Agent` and `TaskCreate` with D-28's reason, for every role, BEFORE the path judgement. Observed FIRST (V-6): `guardToolUse(\"Agent\", { prompt: \"…\" }, policy)` abstains today (no path), the platform grants the spawn without consulting `allowedTools`, and gate-313's review-fix sessions #2 and #3 each ran a `general-purpose` sub-agent — 20 assistant messages, 10–12 tool calls, ~420k input tokens — outside the session's `num_turns` and outside the S-3 surface's turn ceiling.", "One list, both drivers: the plugin hook's `deny_tools`, the driver policy's spawn entries and the headless hook read the SAME exported constant, and a test pins them equal.", "The denial's reason names the rule and the alternative — the session does the work itself; a billable session exists only through the metered path.", "A guard-level test proves the verdict does not depend on the role: implement, review_fix and review are all denied the spawn."]
non_goals: ["Does not meter sub-agents: they stay denied, not billed.", "Does not change the driver policy (D-27) or the plugin hook's file format.", "Does not decide whether a sub-agent's tokens were inside the parent's reported cost on gate-313 — the record cannot say, which is the point of D-28."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-213", "PRDR-180", "PRDR-122"]
depends_on: []
---

# PRDR-215 — a spend path the hook does not make unavoidable

**Severity:** major · **Category:** defect · **Found by:** gate-313's walking skeleton, take 2 —
the review-fix sessions' own artifacts

## Problem

D-28: *"the hook denies ambient billable tool use (a direct `Task` spawn, a direct gate-running
`Bash`) that would bypass the ledger."* The denial exists — `BILLABLE_SPAWN_TOOLS` in
`src/kernel/hook-policy.ts`, by every name the platform has shipped the spawn under — and it is
published in the claim policy the PLUGIN hook reads for the driver session. The headless
driver's hook is `buildPreToolUseHook`: it calls `guardToolUse`, which governs WHERE a mutation
lands and abstains on a call that names no path (S-2‴). A spawn names no path. The platform
grants the `Agent` tool without consulting `allowedTools`. So under the SDK, every write session
can spawn.

Two did. Review-fix #2 and #3 on `t-001-bootstrap` each launched a `general-purpose` sub-agent
to attempt the deletions they could not make themselves (PRDR-213). Each ran to twenty assistant
messages and a dozen tool calls, about 420k input tokens, and reported back. The parent's
`num_turns` — what `session_budget` bounds — never saw them. The ledger row is whatever the SDK
reported for the parent; whether the sub-agent is inside that number is not something the
record can say. The review-fix artifact describes it as a feature:

> A second agent (general-purpose subagent) independently attempted the same deletions with
> the same tools and hit identical blocks; see its report for the exact error transcript.

Three things D-28 promises were not true of those sessions: the counter was avoidable, the
spend was unattributable, and the surface was doubled.

## The shape

The headless hook denies the spawn tools before it judges paths, for every role, with D-28's
reason. The list is one exported constant that the plugin hook's `deny_tools`, the driver
policy and the headless hook all read, pinned equal by a test — one more place where what the two drivers enforce had drifted apart.

## What implementation changed

_(open)_
