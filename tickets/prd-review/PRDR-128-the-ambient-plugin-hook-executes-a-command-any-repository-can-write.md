---
id: PRDR-128
title: "The ambient plugin hook runs a shell command read from repository content, in every session of every user who installed the plugin, with no run in flight and nothing to authenticate it"
state: DONE
severity: major
category: security
labels: ["prd-review", "found-by-audit", "user-raised"]
surface: ["src/plugin/hook.ts", "src/kernel/hook-policy.ts", "src/fs/layout.ts", "tests/plugin/hostile.test.ts", "detent-prd-v3.md"]
prd_refs: ["D-21", "D-27", "D-27′", "SEC-6", "P2"]
acceptance_criteria: ["The plugin hook no longer executes `gate_cmd`. Nothing in `src/` has ever written a non-null one — `refreshRunRefeed` hard-codes `null` and `tests/referee/hook-policy.test.ts:91` asserts it — so the execution path had no producer and served only an attacker.", "A `stage.json` whose `expires_at_ms` is absent is treated as EXPIRED, not as eternal: an absent expiry is the permissive reading and it is refused.", "The run re-feed, which is what the file legitimately carries, keeps working unchanged.", "A hostile-repo test plants a `stage.json` whose `gate_cmd` would write a sentinel, drives the SHIPPED `hooks/dist/detent-hook.cjs`, and asserts the sentinel does not exist.", "The tests that exercised the `gate_cmd` path are removed with it, and the removal is recorded — they were exercising a shape production cannot produce, which is why the path looked legitimate."]
non_goals: ["Does not close the TOCTOU window between the hook's decision and the command it authorises.", "Does not change the PreToolUse half of the hook, which is deny-only and already fails closed on an unparseable file.", "Does not remove the Stop gate. It is a real accelerant (P2); what changes is that it authenticates its input."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-104", "PRDR-122", "PRDR-127"]
depends_on: []
---

# PRDR-128 — the hook trusts a file the repository can write

**Severity:** major · **Category:** security · **Found by:** the production-readiness audit of
7 September 2026 · **Reproduced:** yes

## What happens

`hooks/hooks.json` registers the bundled hook on `PreToolUse` **and `Stop`, with no matcher**.
It therefore runs in every Claude Code session of anyone who installed the plugin, in any
directory, whether or not Detent is in use.

`src/plugin/hook.ts:158-168` executes the Stop gate:

```ts
const result = spawnSync(command, { shell: true, cwd, ... });
```

`command` is `gate_cmd`, read at `:184` from `<cwd>/.detent/stage.json` — ordinary repository
content, committed like any other file. And `expired()` (`:78-80`) is:

```ts
return typeof doc?.expires_at_ms === "number" && nowMs > doc.expires_at_ms;
```

An **absent** `expires_at_ms` is therefore not expired. A planted file never lapses.

Reproduced: with only `.detent/stage.json` present — no `.detent/config.json`, no plan, no
approval, no run in flight — and a synthetic Stop payload piped to the shipped
`hooks/dist/detent-hook.cjs`, the command executed as the operator. Exit 0, no output.

**Cloning a hostile repository and opening a session in it is sufficient.**

## Why the module's own defence does not hold

`src/plugin/hook.ts:35-40` argues this widens nothing, because a repository could achieve the
same through its own settings-file hooks. That equivalence is false in the one way that
matters: project-scope hooks are gated behind Claude Code's own trust prompt, which the user
answers. This path has no prompt and no prior consent — it fires at the first session end in
the directory.

It is also the exact inverse of the property SEC-6 claims. SEC-6 says a settings file may only
*narrow* what Detent may do, never widen it. Here a repository file causes execution that
would not otherwise happen at all.

## Amended after investigation: there is nothing to authenticate

This ticket was filed proposing three conditions — a live expiry, a run nonce, and equality
with a bound `resolved` command. Investigating the producer side changed the answer.

**No code in `src/` has ever written a non-null `gate_cmd`.** The only writer of this file is
`refreshRunRefeed` (`hook-policy.ts:74-83`), which hard-codes `gate_cmd: null`, and
`tests/referee/hook-policy.test.ts:91` asserts exactly that. The comment at
`hook-policy.ts:68` gestures at *"the worker-style red/green stop gate is a different producer
of the same file shape"* — that producer does not exist.

So the executable path is not a feature with a security hole. It is an attack surface with no
user. Authenticating it would be building a lock for a door nobody walks through.

The fix is therefore to **remove `gate_cmd` execution from the plugin hook**, and to harden the
expiry so a planted file cannot linger. The run re-feed — the thing the file actually carries
— is untouched. Nothing is lost: the hook's own header already says the stop gate is *"an
accelerant, never the authority — the referee re-runs the full gate after session end (P2)"*,
and on this path it has never once run.

What made it look legitimate is worth recording, because it is this codebase's recurring
pattern: `tests/plugin/hook.test.ts:188-210` exercise the `gate_cmd` path with hand-written
stage files, so a reader sees four passing tests around an execution path production cannot
reach. They go with it.

