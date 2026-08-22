---
id: PRDR-079
title: "The pool self-heals dead-owner claims — crash-resume without hand surgery"
state: DONE
severity: minor
category: consistency
labels: ["prd-review", "found-by-execution", "user-request"]
surface: ["src/kernel/referee.ts", "src/kernel/referee-context.ts", "src/kernel/tickets/mutations.ts", "src/kernel/plumbing.ts"]
prd_refs: ["C-9", "C-12", "D-30", "R-3"]
acceptance_criteria:
  - "pool() releases claims on RESUMABLE-state tickets whose holder is verifiably dead — readable claim, recorded host matches this host, owner pid not alive — recording each break as a kernel note; the ticket rejoins the resume pool in the same pass."
  - "A live owner's claim, a foreign-host claim, and an unreadable claim all stand, and their tickets stay hidden from the pool exactly as before."
  - "One breakability predicate (claimBreakable) serves the pool, unclaim, and approve/requeue's guard, so every breaker answers identically."
  - "Claims now record their host; legacy claims without one keep the single-machine assumption PRDR-078 recorded."
non_goals:
  - "No liveness beyond pid+host: leases/heartbeats are a different design; the honest boundary is stated instead."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-078", "PRDR-045"]
depends_on: []
---

# PRDR-079 — the pool self-heals dead-owner claims

**Severity:** minor · **Category:** consistency · **Found by:** the recorded
follow-up of PRDR-078, promoted by the user.

## Problem

D-30 promises that an abandoned attempt "resumes as a C-9 crash (stale claim,
resumable pool)" — but the pool skipped every claimed ticket, stale or not,
and the verbs that CAN break stale claims are legal only from human-gated
states. The promise held only after an operator deleted the claim file by
hand: three times across the N-7 self-build and the field series.

## Resolution

`pool()` heals before it lists: for each RESUMABLE-state ticket whose claim
is readable, recorded on THIS host, and held by a pid that is not alive, the
claim releases and the break lands as a kernel note; the ticket rejoins the
pool in the same pass. Anything less certain — live pid, foreign host,
unreadable file — stands, and the ticket stays hidden, preserving the
oracle's never-spin rule. Claims gain a `host` field so pid liveness is only
ever trusted on the machine that can check it (closing the cross-machine
hole PRDR-078 recorded); one shared `claimBreakable` predicate now serves
the pool, `unclaim`, and approve/requeue, so no two breakers can disagree.
D-30's sentence is finally true without an operator standing next to it.

## Amendment (CI, the first red on main)

Both liveness probes treated EVERY signal-0 failure as death. EPERM means the
opposite — the process exists and you may not signal it (pid 1 on a CI runner
answers exactly this) — so privileged live processes read as stale to every
breaker. One shared `pidAlive` now answers EPERM as alive and serves the
context default and the plumbing guard alike.
