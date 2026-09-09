---
id: PRDR-190
title: "init vanished mid-plan twice and wrote nothing on either occasion — no terminal row, no signal handler, no liveness marker, so the cause is not merely unknown but unknowable"
state: OPEN
severity: major
category: gap
labels: ["prd-review", "found-by-live-run", "reliability", "observability"]
surface: ["src/cli/index.ts", "src/init/pipeline.ts", "src/init/session.ts", "tests/init/stages.test.ts"]
prd_refs: ["X-1‴", "C-8", "S-4", "PRDR-185", "PRDR-189"]
acceptance_criteria: ["Every exit path of `init` writes a terminal record naming what was in flight and why it stopped — including the path where `main` RETURNS rather than throws, which today writes nothing at all.", "SIGTERM, SIGINT and SIGHUP write that record before the process leaves.", "A SIGKILL cannot be caught, so the record must also be INFERABLE: a liveness marker updated as the run advances, letting a later reader distinguish `died while planning s09` from `exited cleanly after s09`.", "The record lands where a reader already looks — the run log and the ledger — not in a third place nobody thinks to open.", "The clock behind any of it is an injectable seam, as AGENTS.md requires."]
non_goals: ["Does not add a supervisor or auto-restart. Deciding whether a dead run should come back by itself is a separate design question, and it is downstream of this one: nothing can sensibly decide to restart while the reason for stopping is unrecorded.", "Does not diagnose the two deaths. Their cause is gone. This ticket buys the evidence for the third."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-185", "PRDR-189", "PRDR-186"]
depends_on: []
---

# PRDR-190 — the run that left no note

**Severity:** major · **Category:** gap · **Found by:** the live gate run, twice, three hours apart in wall-clock terms and a day apart in fact

## Problem

On 2026-09-09 at 11:37:25 the gate-312 init run ended. Its log's final line is an ordinary
progress line:

```
  s09 review: 6 finding(s) — coherence, dependency, coverage, dependency, sizing, dependency
```

terminated by a newline, and then nothing. No `init failed`. No stack. No further ledger row.
The whole process tree — npm, tsx, worker — was gone. The run had been alive 3h01m and had eight
slices checkpointed behind it.

Every place a cause could have been recorded was empty:

| checked | found |
|---|---|
| stderr (redirected to the same log) | nothing — so not an uncaught throw |
| `~/Library/Logs/DiagnosticReports` | nothing since Sep 4, unrelated |
| kernel / Jetsam kill in the system log | nothing |
| memory pressure at the time of reading | 5.7 GB free, **zero swap** — not an OOM |
| npm's own output | nothing; the wrapper printed no error either |
| log truncation | none; the file ends on a clean newline |

This was the second occurrence. The first, on 2026-09-08 at roughly 18:53, was attributed to source
being mutated under a live `tsx` during unrelated work. That attribution is now weaker: the second
death happened during a stretch when nothing wrote to `src/` at all. **Two deaths, one plausible
external cause, one with none, and no evidence surviving either.**

## The defect is the silence, not the death

Processes die. Detent already accepts that: C-8 checkpoints each slice precisely so a death is
survivable, and it worked — the restart reused all eight slices for $0 and lost only the ~$5 of s09
in flight. The money was never the problem.

The problem is that the run sat dead for fifteen minutes before anyone noticed, and that the cause
is now unrecoverable. Detent had a great deal to say about the run right up to the last second and
nothing whatsoever to say about its ending. A tool that plans a 230-ticket product across five
hours unattended has to be able to state its own cause of death; otherwise every one of these costs
a full forensic session and yields, as this one did, no answer.

## Where it is missing

[`src/cli/index.ts:68`](../../src/cli/index.ts):

```ts
main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exit(1);
  });
```

The `.catch` branch speaks. **The `.then` branch is silent on every code it is handed** — a normal
return and an abnormal one are indistinguishable in the log, because neither writes a line. And a
process taken by a signal reaches neither branch, so it writes nothing by construction.

Note also that the same absence is handled correctly one layer down: `runOnce` ends with
`const out = result ?? parseResultMessage({})` — a *session* that produces no result is recorded as
the absent-telemetry case rather than vanishing. The rule was applied to sessions and forgotten for
the process that runs them, which is the shape this repository's audit history keeps producing.

## The trap in the obvious fix

The natural place to put a terminal record is the `invoked` block above. That block is module-level
and runs only when the file is the entry point, so **nothing can test it** — and an untested record
is one that stops being written the first time someone refactors around it. This is the V-1‴ shape:
a control that exists, is believed, and verifies nothing.

The record must therefore be produced by a named, exported function that the entry point calls, and
the falsification must assert on **that production path** — not on a helper the entry point could
forget to invoke. Per the falsification rule the test is observed to FAIL first: kill a run
mid-slice, assert the terminal record exists and names the slice that was in flight.

## Why the marker, and not only the handler

Signal handlers cover SIGTERM, SIGINT and SIGHUP. They cannot cover SIGKILL, and SIGKILL is exactly
what an unexplained death looks like from the outside. So the handler alone would have produced no
more evidence today than we have now. A liveness marker updated as the run advances —
written where the ledger already is, and stale by construction once the process is gone — is what
makes the difference between *"we know nothing"* and *"it died while planning s09"*. Both halves,
or the ticket does not close.
