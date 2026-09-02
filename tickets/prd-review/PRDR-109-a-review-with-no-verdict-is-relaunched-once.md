---
id: PRDR-109
title: "A reviewer that writes no usable verdict is escalated as a budget breach when a second session would have written it"
state: READY
severity: major
category: correctness
labels: ["prd-review", "user-raised", "found-by-execution"]
surface: ["src/kernel/referee-stage.ts", "src/kernel/worstcase.ts", "detent-prd-v3.md"]
prd_refs: ["A-5", "S-4", "X-1", "D-6"]
acceptance_criteria: ["A review whose artifact is absent or invalid is relaunched exactly once, with a kernel note saying so, before it becomes a breach.", "The relaunch passes the same launch gates as any session — spend ceiling, net session ceiling — and is metered on the ledger.", "The worst-case session figure charges the possible relaunch for every review entry, so the net `sessions` ceiling still bounds a generation.", "A reviewer that fails twice still breaches, and the breach names the relaunch."]
non_goals: ["Does not touch the reviewer's schema or the strictness of A-5 — an invalid verdict is still refused, just retried once first.", "Does not retry implement or fix sessions; those leave a tree the gates judge (PRDR-053). A review leaves nothing but its verdict."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-072", "PRDR-107", "PRDR-108", "PRDR-110"]
depends_on: []
---

# PRDR-109 — a review with no verdict is relaunched once

**Severity:** major · **Category:** correctness · **Raised by:** the user · **Found by:**
six `BUDGET_BREACH: review produced no artifact` rows on the certification gate

## The measurement

Six of the gate's 29 human stops were a reviewer session that ended without a usable
verdict: four during a backend outage, two that billed normally and wrote nothing. The
kernel treats that as `BUDGET_BREACH → NEEDS_HUMAN`. Every one was requeued with "not a
finding against this ticket" and reviewed cleanly on the next launch.

There is nothing for a human to decide here. The tree is unchanged; the verdict is missing.

## Resolution

`review()` in the referee's stage arm relaunches the review once when the outcome is a
breaker, notes it, and only then throws. The relaunch goes through `sessions.launch` and
so through D-25's spend gate and the net session ceiling, and lands on the ledger like any
session. `maxPossibleSessions` charges every `IN_REVIEW` entry one extra launch so the
computed worst case — and therefore the `sessions` validation at config load — stays honest.
