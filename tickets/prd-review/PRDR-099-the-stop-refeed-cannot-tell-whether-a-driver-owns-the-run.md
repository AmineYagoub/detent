---
id: PRDR-099
title: "The Stop refeed cannot tell whether a driver already owns the run, so it tells bystander sessions to take over one that is running"
state: DONE
severity: minor
category: gap
labels: ["prd-review", "found-by-execution"]
surface: ["src/fs/hook-files.ts", "src/kernel/hook-policy.ts", "src/kernel/referee-context.ts", "src/kernel/tickets/mutations.ts", "src/cli/referee.ts", "src/plugin/hook.ts", "hooks/dist/detent-hook.cjs", "detent-prd-v3.md"]
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

## Where it stood when built (2026-10-02)

PRDR-104 had since stopped the headless driver from publishing the hook files, which closed the
case this ticket was found in: a CLI `detent run` nudging the operator's chat session. What
remained is the plugin path, where the referee is an MCP server of the session that drives the
run. A second session opened in the same root read that session's `stage.json` and was told to
drive a loop another session owned. PRDR-104 recorded it as its residual.

Two facts about the plugin path were measured first, with a scratch plugin under Claude Code
2.1.280, since the blocker above was that nobody had looked:

- A plugin's MCP server and its Stop hook command are both children of the session's Claude
  process. Both carry `CLAUDE_CODE_SESSION_ID`, and it equals the Stop payload's `session_id`.
  The plugin launches the referee through `tsx`, which runs it in a child process, so the
  referee's parent is `tsx` and its grandparent is Claude.
- `/clear` gives the conversation a new session id and keeps the MCP server. After it, the Stop
  payload carries the new id while the server's environment still holds the old one. The Claude
  process is the same.

## Design

- **The record.** `stage.json` gains `driver`: the referee's owner, pid and host, a claim's
  currency (PRDR-079), and what ties it to the session it serves: `session_id`, the id Claude
  Code started it under, and `parents`, the two pids it runs under, nearest first.
- **The writer.** `RefereeContext` builds the record from its worker, its own pid and host, and
  what the composition root read at start (`servedSession` in `src/cli/referee.ts`):
  `CLAUDE_CODE_SESSION_ID`, its parent, and its parent's parent from `ps`.
- **The reader.** The Stop hook asks `addressed` before it nudges:
  1. no driver, a malformed one, or one tied to no session: nudge as before;
  2. a driver verifiably gone on this host: nudge, since the run is the next session's to
     resume (AC 4);
  3. the payload's session id is the driver's: nudge (AC 2);
  4. the hook's parent, the session's Claude process, is among the driver's parents: nudge, which
     keeps a `/clear`ed driver nudged;
  5. otherwise silence: a session beside a run another session drives (AC 1).
- **Liveness, shared.** `pidAlive` and `claimBreakable` move from `src/kernel/tickets/mutations.ts`
  to `src/fs/hook-files.ts`, and `mutations.ts` re-exports both, so their callers are unchanged.
  The hook bundle may import `hook-files.ts` and not the kernel (ARCH-1).
- **The PRD:** D-27‴, after D-27″.

### Vetoable calls

1. **The session id first, the process second.** The id is exact for as long as the
   conversation lasts. A `/clear` changes it and keeps the server, measured; the process check
   covers that case.
2. **Two parents, and no further.** The referee's parent is the plugin's launcher and the one
   above is Claude. A session that started this session's Claude from its own shell is further
   up, and must not match. If a launcher ever adds a layer, the process check misses, and the
   session id still holds everywhere but after a `/clear`.
3. **Missing evidence nudges as before.** AC 2 calls silencing the driver a regression, so a file
   with no driver, a malformed one, or one tied to no session is answered as T-120 always did.
4. **A driver on another host is never broken, and a stranger session is told nothing.** A pid's
   liveness is honest only on its own machine, as for a claim.
5. **`ps` runs once, when the referee starts, in the composition root.** Not in the hook, which
   runs on every Stop, and not in the kernel, which knows no platform.
6. **The liveness predicate moved rather than being copied.** AC 3 asks for the claim's own
   currency, and `hook-files.ts` is the one module both the kernel and the bundle may import.
7. **The hook's parent is `process.ppid`.** Claude Code runs the hook command `node …` as its
   direct child, measured. `CLAUDE_PID` in the hook's environment names the same process, but it
   is not documented, and an MCP server inherits a stale one.

Added while building:

8. **A case for PRDR-079's EPERM rule.** The battery found no test anywhere held it (signal 0 to
   a process this user may not signal throws EPERM, and the process is alive). The Stop hook now
   relies on it, so one case does.

## Falsification (verification protocol, item 1)

The new cases, run in a worktree at HEAD (`9d88978`, PRDR-233), without this ticket's changes:

```
× D-27‴ the referee reads the session it serves (PRDR-099) > records the session id Claude Code gave it, and its parent and the process above that
  → (0 , servedSession) is not a function
× D-27‴ the referee reads the session it serves (PRDR-099) > records no session id where none was given, and the parent alone where the one above cannot be read
  → (0 , servedSession) is not a function
× D-27‴ the referee reads the session it serves (PRDR-099) > reads the process above its parent from the operating system
  → (0 , servedSession) is not a function
× D-27‴ the re-feed reaches the session that drives the run (PRDR-099) > tells a session opened beside a run another session drives nothing
  → expected { …(2) } to deeply equal { out: '', code: +0 }
× D-27‴ the re-feed reaches the session that drives the run (PRDR-099) > does not break a driver on another host, whose pid says nothing here
  → expected { …(2) } to deeply equal { out: '', code: +0 }
× D-27‴ the stage file names the run's driver (PRDR-099) > in a claim's currency, with the session the referee serves
  → expected undefined to deeply equal { owner: 'w1', pid: 29307, …(3) }
× D-27‴ the stage file names the run's driver (PRDR-099) > with no session tie when the composition root gave none
  → expected undefined to deeply equal { owner: 'w1', pid: 29307, …(1) }
```

The four cases that hold T-120 passed at HEAD, as they should, since HEAD nudged every session:
the driving session nudged once, a `/clear`ed driver, a gone driver, and a file that tells no
sessions apart. The bundle's staleness case also failed there. That was the worktree's doing: its
`node_modules` was a link to this checkout's, so the render's paths differed. The transport case
and the EPERM case were written after this run.

## Live check

The shipped bundle as a real Stop hook, and `servedSession` in an MCP server launched through the
plugin's `tsx`, writing `stage.json` with the real `refreshRunRefeed`, under `claude -p` 2.1.280.
Session A drove; session B was opened in the same root with the hook alone. The user's own plugins
were left out (`--setting-sources project`), so the installed 3.0.1 hook did not also answer:

| Stop | What tells it apart | The hook said |
|---|---|---|
| A, first turn | A's session id, recorded | block, then silence on the next stop |
| B, while A lived | neither | silence; B ended after one turn |
| A, after a `/clear` | a new id; Claude pid 31845 among the parents `[31857, 31845]` | block |
| B, after A exited | A's referee gone on this host | block, then silence |

A first run left the user's plugins loaded, and showed the defect itself: while the new hook said
nothing to B, the installed 3.0.1 hook told B to continue the loop, and B spent five turns looking
for a referee it did not have. The two runs cost about $0.25.

## Mutation battery

Each mutant was applied to a snapshot copy of its file; a mutant of `src/plugin/hook.ts` or
`src/fs/hook-files.ts` rebuilt the bundle, since the hook cases run the bundle. Then
`tests/plugin/hook.test.ts`, `tests/referee/hook-policy.test.ts`, `tests/referee/transport.test.ts`,
`tests/cli/referee-session.test.ts`, `tests/cli/unclaim.test.ts`,
`tests/kernel/claim-self-heal.test.ts` and `tests/kernel/plumbing.test.ts` ran, and the file and
the bundle were restored from their copies and checked with `cmp`. The first pass killed 20 of 21.
F2 survived, and the EPERM case (call 8) kills it, re-run against the mutant.

| Mutant | Killed by |
|---|---|
| H1 every session is addressed | the bystander case, the other-host case |
| H2 a gone driver is not broken | the gone-driver case |
| H3 the session id is not compared | the driving-session case |
| H4 the parents are not compared | the `/clear` case |
| H5 a driver tied to no session is silenced | the nothing-to-tell case |
| H6 a malformed driver is silenced | the nothing-to-tell case |
| H7 the driver's host is ignored | the other-host case |
| H8 the Stop decision does not ask | the bystander case, the other-host case |
| H9 the hook compares its own pid | the `/clear` case |
| H10 a file with no driver is silenced | the T-120 re-feed cases |
| F1 a claim on another host is breakable | the other-host case, and PRDR-079's own |
| F2 EPERM reads as death | the EPERM case (added) |
| P1 the driver is not written | the record cases, the transport case |
| C1 the served session is dropped | the record case, the transport case |
| C2 the driver is not passed | the record cases, the transport case |
| C3 the driver's pid is its parent's | the record cases |
| R1 the session id is not read | the session-tie case, the transport case |
| R2 the grandparent is dropped | the session-tie cases, the transport case |
| R3 `ps` is never read | the session-tie case, the transport case |
| R4 `main` records no session | the transport case |
| R5 the referee asks after its own parent | the session-tie cases, the transport case |

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: not run for this ticket. On 2026-10-02 the user asked for the full suite to run
  once, after the last ticket of the batch, and the batch's closing commit records it. The suites
  nearest the change ran instead (see the commit).

## What changed

- `src/fs/hook-files.ts`: `claimBreakable` and `pidAlive`, moved here from
  `src/kernel/tickets/mutations.ts`, which re-exports them; `StageDriver`, the record.
- `src/kernel/hook-policy.ts`: `refreshRunRefeed` writes `driver` when given one.
- `src/kernel/referee-context.ts`: `CoreOptions.servedSession`; the context's `driver` record,
  passed to every re-feed refresh.
- `src/cli/referee.ts`: `servedSession`, read once at start and passed to the core.
- `src/plugin/hook.ts`, `hooks/dist/detent-hook.cjs`: the Stop decision asks `addressed`.
- `detent-prd-v3.md`: D-27‴.
- Tests: `tests/plugin/hook.test.ts` (seven cases over the bundle),
  `tests/referee/hook-policy.test.ts` (two), `tests/referee/transport.test.ts` (one, the real
  referee spawned through `tsx`), `tests/cli/referee-session.test.ts` (new, three).

## Recorded, not fixed

- **The PreToolUse side still reads the driving session's policy.** A second session opened in a
  plugin-driven run's root is denied its edits by `active_surface.json` while a claim is in
  flight, the residual PRDR-104's amendment found on the headless path and that path's fix did
  not reach. This ticket's non-goals leave PreToolUse alone. The same `driver` record could
  answer it, since a PreToolUse payload carries `session_id` too.
- **The installed plugin is still 3.0.1.** The fix reaches a session only once the plugin is
  rebuilt and reinstalled from this line, as the first live run showed.
