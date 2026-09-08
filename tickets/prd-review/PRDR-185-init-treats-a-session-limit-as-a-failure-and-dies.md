---
id: PRDR-185
title: "A session limit kills `detent init` outright — the init pipeline has no outage handling, while the run loop has had it since PRDR-112"
state: OPEN
severity: major
category: gap
labels: ["prd-review", "found-by-live-run", "arch-2", "reliability"]
surface: ["src/init/session.ts", "src/init/machine.ts", "src/cli/init.ts"]
prd_refs: ["PRDR-112", "ARCH-2", "C-8"]
acceptance_criteria: ["A backend outage during `init` — a session limit, a transient refusal — is backed off and retried rather than ending the command, on the same terms `kernel/driver.ts` already applies to the run loop.", "Consecutive outages with no phase completing between them halt with a message naming the wait, so a genuinely unavailable backend does not spin.", "The operator is told what is being waited for and until when, because a session limit names its own reset time."]
non_goals: ["Does not make `init` resumable in a new way — checkpoints already survive, and a resumed run correctly reuses every completed phase (C-8, observed).", "Does not retry a session that FAILED. An outage is not a failure; only the transport is at fault."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-112", "PRDR-090"]
depends_on: []
---

# PRDR-185 — the run loop waits out an outage; init does not

**Severity:** major · **Category:** gap · **Found by:** the live gate run

## Problem

Two hours and $30 into a planning run, on the second of fifteen slices:

```
init failed: planner session failed: Claude Code returned an error result:
You've hit your session limit · resets 12:20pm (Africa/Algiers)
```

A session limit is the most ordinary interruption on a subscription plan, and it is an **outage**,
not a failure: nothing about the work was wrong, the transport was briefly unavailable. The kernel
run loop has known this since PRDR-112 — `driver.ts` counts outages, backs off, and halts only on
consecutive outages with no completed ticket between them. `grep` for `SessionRefusal`, `outage` or
`backoff` across `src/init/**` returns nothing.

So `detent run` waits and continues; `detent init` dies. ARCH-2's shape again — a control on one
driver and not the other — and this one has been papered over out-of-product by a supervisor shell
script whose own header calls itself advisory, exactly the criticism `run-lock.ts` makes of the
`pgrep` it replaced.

## What is NOT wrong

Nothing was lost. The lock released cleanly through its `finally` for the second time under
abnormal termination, every checkpoint survived, and the resume correctly reused the completed
slice — `s01 …: reused — nothing it read has changed (C-8)`. The cost of the gap is an operator
who must notice, wait, and restart by hand, on a command that runs for hours.
