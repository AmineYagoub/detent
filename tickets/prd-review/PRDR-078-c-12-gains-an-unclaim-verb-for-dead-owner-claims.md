---
id: PRDR-078
title: "C-12 gains an unclaim verb — dead-owner claims on in-flight tickets had no remedy but hand surgery"
state: DONE
severity: minor
category: consistency
labels: ["prd-review", "found-by-execution", "user-request"]
surface: ["src/kernel/plumbing.ts", "src/cli/plumbing.ts", "src/cli/index.ts", "README.md"]
prd_refs: ["C-12", "C-9", "X-3", "R-3", "C-14"]
acceptance_criteria:
  - "`detent unclaim <id>` releases a claim whose owner is verifiably dead, recording the break as an attributed ticket note; a live owner refuses naming the pid and claim age; an unreadable claim stays held-by-someone (R-3)."
  - "`detent unclaim --stale` sweeps every claim in the run, releasing dead owners and reporting the rest."
  - "No state transition occurs — releasing a lock is not an X-3 move; approve/requeue keep their existing stale-breaking inside their own legality windows."
  - "The verb joins the documented plumbing list (README, usage, docs-lock) without touching the two-command porcelain (C-14: plumbing is explicitly outside the freeze)."
non_goals:
  - "No automatic claim-breaking inside `run`'s acquire path — self-healing resume is a kernel-behavior change deserving its own deliberation; recorded here as the follow-up candidate."
  - "No cross-machine liveness: claims carry pid but not host; pid-liveness is honest only on one machine, and that limitation stands recorded."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-045"]
depends_on: []
---

# PRDR-078 — C-12 gains an unclaim verb

**Severity:** minor · **Category:** consistency · **Found by:** three hand
surgeries across the N-7 self-build and the field series; raised as a feature
by the user.

## Problem

T-055 already breaks stale claims — but only inside `approve` and `requeue`,
whose X-3 legality admits NEEDS_HUMAN and BLOCKED alone. The common crash
shape is different: a run dies holding a claim on an IN-FLIGHT ticket
(IN_PROGRESS, REVIEW_FIX…), and on resume the pool's acquire hits the
exclusive-create lock and skips the ticket. No verb could touch it; the
operator deleted `.detent/claims/<id>.claim` by hand, three times in two days
of live running.

## Resolution

`detent unclaim [root] <id>` and `detent unclaim [root] --stale`, reusing the
same C-12 guard the other verbs trust: a live owner refuses with pid and
claim age; a verifiably dead owner's claim releases with an attributed ticket
note; an unreadable claim file remains held-by-someone, exactly as R-3's
atomicity note requires. Releasing a lock transitions nothing, so the verb is
legal in every state — which is the point. Recorded follow-up: teaching
`run`'s own acquire to break verifiably dead claims would remove the manual
step from crash-resume entirely; that changes kernel behavior and gets its
own ticket.
