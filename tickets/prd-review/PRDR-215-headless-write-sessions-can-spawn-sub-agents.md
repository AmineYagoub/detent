---
id: PRDR-215
title: "Headless write sessions can spawn sub-agents: D-28's spawn denial is published for the plugin driver and never applied under the SDK"
state: DONE
severity: major
category: defect
labels: ["prd-review", "D-28", "budgets", "containment", "sdk", "parity", "gate-313"]
surface: ["src/fs/hook-files.ts", "src/sessions/guard.ts", "src/kernel/hook-policy.ts", "src/plugin/hook.ts", "hooks/dist/detent-hook.cjs", "tests/sessions/guard.test.ts", "tests/sessions/sdk.test.ts", "tests/plugin/hook.test.ts", "tests/referee/hook-policy.test.ts", "detent-prd-v3.md"]
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

**One list, in the guard.** `SPAWN_TOOLS = ["Task", "Agent", "TaskCreate"]` is exported from
`src/sessions/guard.ts`, where the decision lives. `guardToolUse` refuses those names FIRST —
before the `git rm` reading and before any path — with D-28's reason: the tool would spawn a
billable session outside the ledger; a session does its own work. The role does not enter the
decision, so write, read-only and init sessions are all covered by the same line; task reads and
controls (`TaskOutput`, `TaskStop`) name no path and abstain as before.

**Both drivers read it.** `hook-policy.ts` no longer keeps its own copy: the claim policy it
publishes for the plugin driver's session file carries `SPAWN_TOOLS`. The plugin hook's driver
rule spreads the same constant into `DRIVER_DENIED_TOOLS` (which had `Task` and `Agent` and
lacked `TaskCreate`), and its worker path — `guardToolUse` in a third skin — denies the spawn
with no `deny_tools` in the file at all. The bundle is regenerated. `sdk.ts` needed no change:
its hook already calls the guard.

**V-6, in order.** Observed on the tree as it was: `SPAWN_TOOLS` did not exist; `Agent` under
a write policy and under a read-only artifact policy abstained where `deny` was expected; the SDK
hook returned no decision for an `Agent` call; over the bundle, a worker policy was silent on
`Agent` and `TaskCreate`, and a driver policy whose file listed only `Task` was silent on
`TaskCreate`. Then the change; then the guard, SDK, plugin and hook-policy suites green — the
hook-policy test now asserts the published list IS the guard's constant — and the full suite
green.


## Audit

The close commit went in with `lint` RED — the gate loop printed the colour and did not stop
the chain, which is the auditor's own defect and is fixed in the loop. What lint refused was
the placement: `hook-policy.ts` importing `SPAWN_TOOLS` from `src/sessions/guard.ts` breaks
ARCH-1 (`src/kernel/**` may import only the SessionBackend interface from `src/sessions`). The
list now lives in `src/fs/hook-files.ts` — the dependency-free module the plugin bundle, the
kernel and the guard may all import, next to the hook filenames it belongs with — and the guard
re-exports it so readers of the decision still find it there. The kernel's policy and the plugin
hook import it from that home. Also checked: the plugin hook's silence on an ABSENT or EXPIRED
policy is unchanged and right — outside a Detent attempt the ambient hook has no opinion, and a
spawn there is the user's own; and gate-313's sub-agent transcripts carry no hook denial, so
whatever refused the sub-agent's own `git rm` and `rm` was the platform, not Detent — one more
reason the spawn itself is refused rather than its consequences.
