---
id: PRDR-190
title: "init took SIGTERM six times across three days and wrote nothing on any of them, while a 185-line zsh script running beside it recorded every one to the second"
state: DONE
severity: major
category: gap
labels: ["prd-review", "found-by-live-run", "reliability", "observability"]
surface: ["src/cli/index.ts", "src/init/pipeline.ts", "src/init/session.ts", "tests/init/stages.test.ts"]
prd_refs: ["X-1‴", "C-8", "S-4", "PRDR-185", "PRDR-189"]
acceptance_criteria: ["SIGTERM, SIGINT and SIGHUP write a terminal record before the process leaves, naming the signal and what was in flight. This is the criterion that would have closed the whole investigation below in one log line.", "Every exit path of `init` writes that record — including the path where `main` RETURNS rather than throws, which today writes nothing at all.", "A SIGKILL cannot be caught, so the record must ALSO be inferable: a liveness marker updated as the run advances, letting a later reader distinguish `died while planning s09` from `exited cleanly after s09`.", "The record lands where a reader already looks — the run log, and the run lock for the marker — not in a third artifact nobody thinks to open. AMENDED on implementation: NOT the ledger, for the reason recorded below.", "The clock behind any of it is an injectable seam, as AGENTS.md requires."]
non_goals: ["Does not add a supervisor or auto-restart. That is a separate design question, and it is downstream of this one.", "Does not stop anyone running `killall node`. The machine is the operator's. The defect is that Detent cannot say what happened TO it."]
attempts: { fix: 0, hypothesis: 1, review: 0 }
links: ["PRDR-185", "PRDR-189", "PRDR-186"]
depends_on: []
---

# PRDR-190 — the run that left no note

**Severity:** major · **Category:** gap · **Found by:** the live gate run, six times before anyone
could say why

## Problem

Between 2026-09-06 and 2026-09-09 two long init runs — `detent-gate-311` and `detent-gate-312` —
died six times between them. Every death was `killall node`, typed in a terminal on the same
machine. `killall` sends SIGTERM; 128 + 15 = 143, and the shell history lines up with the recorded
exits to the second:

| `killall node` | recorded death |
|---|---|
| 2026-09-06 11:57:37 | gate-311 `rc=143` at **11:57:37** |
| 2026-09-06 19:01:51 | gate-311 `rc=143` at **19:01:51** |
| 2026-09-06 19:19:16 | gate-311 `rc=143` at **19:19:16** |
| 2026-09-08 18:55:33 | gate-312, silently |
| 2026-09-09 11:51:22 | gate-311 `rc=143` at **11:51:23**, and gate-312, silently |

The right-hand column comes entirely from `supervise-gate.sh` — an **185-line zsh script** wrapping
gate-311. It captured the exit status, named the signal, said what it would do about it, and
resumed. gate-312 had no such wrapper, and so recorded **nothing at all**: no terminal row, no log
line, no marker. Same tool, same machine, same signal, same second — and the difference between a
one-line answer and a full forensic session was a shell script somebody wrote in an afternoon.

## What the silence cost

Two conclusions were reached from the absence of evidence, and both were wrong:

- **The death was timed from the log's last write.** gate-312's final log line is timestamped
  11:37:25, so 11:37:25 was recorded as the moment of death. It was not — it was the last thing
  written. The process was alive at 11:36:58 and gone by 11:51:58, and the `killall` at 11:51:22
  sits inside that window. The intervening fourteen minutes were an ordinary revision session doing
  its work; because that session never finished, it produced no line and no ledger row, and its
  ordinary progress was read as a stall.
- **The 2026-09-08 death was blamed on source churn under a live `tsx`.** It was the `killall` at
  18:55:33. That mis-attribution stood for a day and sent the investigation into the wrong tree
  entirely — SDK session limits, upstream freeze bugs, OOM, jetsam, crash reports — none of which
  had anything to do with it.

A tool that cannot state its own cause of death does not merely fail to inform. It actively
produces false conclusions, because the shape of the silence gets read as evidence.

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

The `.catch` branch speaks. The `.then` branch is silent on every code it is handed. And **a signal
reaches neither** — there is no handler anywhere in `src/`, so a SIGTERM leaves through the default
disposition and the process is simply gone.

The same rule is already honoured one layer down: `runOnce` ends with
`const out = result ?? parseResultMessage({})`, so a *session* that yields no result is recorded as
the absent-telemetry case rather than vanishing. Applied to sessions, forgotten for the process that
runs them — the shape this repository's audit history keeps producing.

## The signal is the catchable one

An earlier draft of this ticket hedged toward the liveness marker on the assumption that an
unexplained death means SIGKILL. It does not. Every one of the six was **SIGTERM**, which a handler
catches. A dozen lines in the entry path would have written

```
init: killed by SIGTERM while planning s09 (8 slice(s) checkpointed; re-run to resume)
```

six times, and none of the last two days of forensics would have been necessary. That is why the
handler is now criterion 1. The marker stays as criterion 3 because SIGKILL and a hard power loss
remain real and uncatchable — but it is the belt, not the braces.

## The trap in the obvious fix

The natural home for a terminal record is the module-level `invoked` block above. That block runs
only when the file is the entry point, so **nothing can test it** — and an untested record stops
being written the first time someone refactors around it. This is the V-1‴ shape: a control that
exists, is believed, and verifies nothing.

The record must therefore be produced by a named, exported function that the entry point calls, and
the falsification must assert on **that production path** — not on a helper the entry point could
forget to invoke. Per the falsification rule the test is observed to FAIL first: send the production
path a SIGTERM mid-slice, assert the record exists and names both the signal and the slice.

## What was never broken

Worth recording, because six deaths in three days reads like an unreliable tool and the opposite is
true. Nothing in Detent failed here. The run lock released and broke cleanly under abnormal
termination every time (X-1‴). Every completed slice survived and was reused for $0 on resume (C-8,
now observed live under six separate signal deaths). The total loss across all of them was the
work in flight at the moment of the kill. The tool was being shot, not falling over — and the one
thing it could not do was say so.
