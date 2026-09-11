---
id: PRDR-217
title: "A DONE ticket whose finalize crashed is never finalized: its work stays on an unmerged branch, its generation stays in flight, and the next run builds on a run branch without it"
state: DONE
severity: critical
category: defect
labels: ["prd-review", "finalize", "resume", "D-30", "B-2", "worktree", "gate-313"]
surface: ["src/kernel/referee-sweeps.ts", "src/kernel/referee.ts", "src/kernel/referee-context.ts", "tests/kernel/stranded-finalize.test.ts", "detent-prd-v3.md"]
prd_refs: ["D-30", "B-2", "B-2′", "B-5", "X-3", "P2", "V-6", "N-6", "PRDR-151", "PRDR-216"]
acceptance_criteria: ["At pool time, a DONE ticket whose last generation is still `in_flight` and whose worktree still exists is FINALIZED — merged into the run branch, its worktree removed, its generation closed as done — with a kernel note and a ticket-journal event saying the finalize was resumed. Observed FIRST (V-6): a fixture builds the crash's aftermath (DONE, generation in flight, `ticket/<id>` worktree with a commit, run branch behind) and runs — today the run exits 0 with the pool empty and the commit never reaches the run branch.", "A DONE ticket whose generation is CLOSED and whose worktree survives — B-2′'s merge-conflict shape, left for a human — is NOT touched by the sweep.", "The sweep runs under both drivers because it lives in `pool()`, next to the drift and outage sweeps.", "gate-313's bootstrap, stranded by PRDR-216, is merged by the first run after this lands — the live falsification."]
non_goals: ["Does not reopen DONE — X-3 offers no edge out, and the work was implemented, gated and reviewed.", "Does not retry a merge CONFLICT automatically; that stays the human's (B-2′).", "Does not cover non-worktree mode, where a crashed finalize leaves uncommitted changes in the operator's own tree and B-5's reset already judges them."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-216", "PRDR-151"]
depends_on: ["PRDR-216"]
---

# PRDR-217 — DONE, and nowhere

**Severity:** critical · **Category:** defect · **Found by:** gate-313's walking skeleton, take 3
— what PRDR-216's crash left behind

## Problem

`finalizeDone` runs after the DONE transition: it stages, commits, merges the ticket's worktree
into the run branch and removes it. PRDR-151 (B-2′) made a merge CONFLICT a breach the driver
routes to a human, closing the generation as done and leaving the branch for the human to
resolve. Any OTHER throw in finalize — PRDR-216's `git add` — escapes the driver's DONE handler
as exit 1 with the ticket DONE, its generation `in_flight`, its worktree and branch intact and
its work absent from the run branch.

Nothing recovers that. `pool()` heals stale claims, requeues drift-blocked and outage-struck
tickets, and skips DONE. The next run's tickets claim worktrees off a run branch that does not
have the bootstrap's scaffold, so every gate of every s01 ticket fails for want of a
`package.json` the plan says exists. On gate-313: the run branch sits at the seed commit
`e8227e6`; the bootstrap's four commits are on `ticket/t-001-bootstrap` at `f22c340`.

D-30 says resume is a referee property. This is the one DONE-side state a resume does not see.

## The shape

One more sweep in `pool()`, with the others: a DONE ticket whose last generation is still in
flight and whose worktree still exists is finalized — the same `finalizeDone`, which is
idempotent for the bootstrap's bindings and a no-op for a clean tree — then its generation is
closed as done, with a note and a journal event saying the finalize was resumed. A conflict
during that finalize breaches exactly as B-2′ says; a DONE ticket whose generation is already
closed is a human's, and the sweep leaves it alone.

## What implementation changed

**One more sweep in `pool()`.** `finalizeStranded` in `referee-sweeps.ts` runs after the
outage sweep, under both drivers. Its signal is exact — DONE with the last generation still
`in_flight` — and it takes the core's own `finalizeDone` and `closeGen` as callbacks, the way
the other sweeps take `commit`: the sweep decides nothing about integration; finalize does. A
standing worktree is registered as the ticket's work directory for the call (the crashed run's
registration died with it), finalized, unregistered; the generation closes as done; a kernel
note and a `finalize` journal event marked `resumed: true` say what happened. A throw from
finalize — B-2′'s conflict — closes the generation first and stands. In flight with no worktree
is the crash between merge and close: the record closes, nothing else moves. Non-worktree mode
returns at once (the ticket's non-goal).

**V-6, in order.** Observed on the tree as it was, on a fixture built as the crash's aftermath
(DONE, generation in flight, `ticket/t1` worktree with a commit, run branch behind): the run
exited 0 with an empty pool and the run branch's tree did not contain the commit. Then the
change; then merged, worktree gone, generation `done`, note and journal event present; and the
closed-generation shape untouched, before and after.

