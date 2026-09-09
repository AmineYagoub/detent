---
id: PRDR-099
title: "The Stop refeed cannot tell whether a driver already owns the run, so it tells bystander sessions to take over one that is running"
state: READY
severity: minor
category: gap
labels: ["prd-review", "found-by-execution"]
surface: ["src/kernel/hook-policy.ts", "src/plugin/hook.ts"]
prd_refs: ["T-120", "C-9", "P2"]
acceptance_criteria: ["The Stop refeed fires only when a session ending is one that should pick the loop up — not when a live driver already owns it.", "The plugin path keeps T-120's loop persistence intact: a model driving the loop itself still gets its single deterministic nudge. A fix that silences that is a regression, not a fix.", "Ownership is decided from recorded evidence rather than inferred: claims already record `owner` and `pid` and test liveness (PRDR-079), and the refeed should use the same currency rather than a second, weaker notion.", "A driver killed mid-run still leaves the pool recoverable — the case the refeed exists for must keep working."]
non_goals: ["Does not remove the refeed. T-120's loop persistence is the point, and a run interrupted mid-flight genuinely should nudge whoever can resume it.", "Does not touch `expires_at_ms`, which already works: stale files from killed drivers are inert, verified against four leftovers aged 15-57 hours.", "Does not change the PreToolUse containment path, which is unaffected."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-079"]
depends_on: []
---

# PRDR-099 — the Stop refeed cannot tell whether a driver owns the run

**Severity:** minor · **Category:** gap · **Found by:** execution — it fired twice at an
operator session during the N-7 gate

## Problem

`refreshRunRefeed` writes `.detent/stage.json` while the pool is non-empty or a claim is
in flight, and `decideStop` blocks any session that ends while that file is live:

> "Detent run in flight: tickets are still claimable or claimed. Continue the loop — call
> the referee's `next` tool and proceed with the next legal move."

That is correct for the plugin path, where the model IS the driver. It is wrong for a
session that merely LAUNCHED a driver. During this gate the file was written by a CLI
`detent run` process (pids 1267/1283/1284, one claim held, work committing normally) and
the nudge was delivered to the operator's chat session, which owns nothing.

Complied with, it would put a second worker on a repo a live driver already owns —
claim contention on a run that was $29 into its cap with committed work on its branch.
It only stayed harmless because the referee MCP server was not connected in that session,
so the `next` tool it names did not exist to call.

## What is NOT wrong

Worth recording, because both were checked and neither is the defect:

- **Staleness is handled.** Four leftover `stage.json` files from killed drivers, aged
  15–57 hours, were all correctly inert: `expired()` treats a past `expires_at_ms` as an
  absent file.
- **The gate's own file was live and truthful.** It said a run was in flight because one
  was. The hook reported the world accurately; it just addressed the wrong actor.

## Why this is filed rather than fixed

The obvious fix — record the driver's pid and suppress the refeed while it lives — cannot
be validated here. `refreshRunRefeed` has exactly one producer, the kernel's driver loop,
which serves both the CLI path and the plugin path. Under the plugin path the referee MCP
server would hold that pid and stay alive for the whole session, so suppressing on
liveness would silence T-120's nudge entirely and turn a working feature off.

Distinguishing the two paths needs the plugin path exercised, and it has never been
exercisable. That was originally recorded as `plugin:detent:referee` failing to connect
(`CONNECTION_CLOSED`), which is what the client reports but not what happens.

## The real blocker (established 2026-09-09)

`CONNECTION_CLOSED` is not a transport fault. The referee server starts, refuses, and
exits — and the client renders a clean refusal as a dropped connection. Probed directly:

```
$ tsx src/cli/referee.ts --root /Users/workstation/detent
no config at /Users/workstation/detent/.detent/config.json — run `detent init` first

$ tsx src/cli/referee.ts --root <an initialized root>
no approved plan — run `detent init` and approve it first (C-9)
```

**The Detent repository has never been `detent init`'d against itself.** The server was
reporting that accurately for as long as anyone has looked at it, into a channel where the
message was never read — the same shape as PRDR-190, a correct message delivered where
nobody was listening. Nothing needs repairing in the server or the plugin manifest.

So the precondition chain for fixing this ticket is:

1. an initialized root **with an approved plan** (C-9) — the referee refuses without one;
2. a `detent run` on it, so the driver loop writes `stage.json` at all;
3. a plugin session in that root whose Stop hook fires.

None of the three is satisfied today, which is why every attempt to reach the plugin path
has ended at step 0. `detent-gate-312` will satisfy (1) when its plan reaches PRESENT and
is approved; that is the first moment this ticket is workable rather than guessable, and
picking it up before then produces a fix nobody can run.

Note also that the installed plugin is **3.0.1** (`~/.claude/plugins/cache/detent/detent/3.0.1/`)
against a local 3.1.1 line. A connected referee would serve old code until that is
reinstalled, so a fix verified against the cached plugin proves nothing about this tree.

## Still present, re-verified 2026-09-09

The defect has not drifted or been fixed incidentally. `refreshRunRefeed`
([`src/kernel/hook-policy.ts`](../../src/kernel/hook-policy.ts)) writes exactly
`schema_version`, `stage`, `gate_cmd`, `run_refeed` and `expires_at_ms` — **no `owner`,
no `pid`** — and neither that writer nor `decideStop` in
[`src/plugin/hook.ts`](../../src/plugin/hook.ts) mentions either word. `decideStop` still
blocks on `run_refeed !== "" && !stop_hook_active` alone, and the trigger is still
`pool.length > 0 || any claimed` at `referee.ts:154`. Acceptance criterion 3 asks for the
claim's own currency (`owner`, `pid`, liveness — PRDR-079); the stage file carries none of
it, so there is nothing for a fix to read yet.
