---
id: PRDR-238
title: "A ticket stranded mid-ladder by a killed session can only be requeued after first descending the entire ladder to NEEDS_HUMAN — so the operator pays a blind fix, a research session and an informed fix to reach a state they could otherwise set directly"
state: DONE
severity: major
category: defect
labels: ["prd-review", "C-12", "X-3", "X-8", "B-5", "plumbing", "gate-313", "live-run"]
surface: ["src/kernel/machine.ts", "src/kernel/plumbing.ts", "tests/kernel/requeue-resumable.test.ts", "detent-prd-v3.md"]
prd_refs: ["C-12", "X-3", "X-8", "B-5", "B-5‴", "D-17", "R-3", "PRDR-078", "PRDR-079", "V-6", "N-6"]
acceptance_criteria: ["A human may requeue a ticket stranded in any UNFINISHED state, not only NEEDS_HUMAN and BLOCKED. Observed FIRST (V-6): `src/kernel/machine.ts:103,106` are the only `HUMAN_REQUEUE` rows in X-3's table, and `requeueTicket` at `src/kernel/plumbing.ts:158-163` refuses anything else with `requeue is admissible only from NEEDS_HUMAN or BLOCKED`. Run live against the halted gate-313 root: `detent requeue <root> t-s01-013` exited 2 with that message while the ticket sat IN_PROGRESS behind an unfinished `implement start` and an empty worktree.", "The C-12 claim guard is unchanged and still decides: a claim held by a LIVE process refuses, naming the pid, so a requeue can never yank a ticket out from under a running session. Only a verifiably dead owner on this host is breakable — `claimBreakable`, the predicate `unclaim` and the pool's self-heal already share (PRDR-079).", "APPROVED is NOT admissible: its diff passed the authoritative gate and a review, finalize is mechanical from there, and a requeue would discard verified work. DONE and READY are likewise excluded — one is merged, the other is already at the start.", "Proved by tests that fail on today's tree: a requeue from each newly admitted state opens generation N+1 with zeroed counters, and a requeue against a LIVE claim still refuses."]
non_goals: ["Does not change what a requeue DOES — X-8's freeze-N, open-N+1 with zeroed counters and the guidance recorded on the generation is unchanged.", "Does not relax the claim guard in any direction.", "Does not make the kernel requeue anything automatically: this is a human act with recorded consent, and a crashed session staying skipped (B-5) remains correct.", "Does not admit APPROVED or DONE.", "Does not touch `unclaim`, which releases a lock without a transition and remains the right verb for that."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-078", "PRDR-079", "PRDR-234"]
depends_on: []
---

# PRDR-238 — the only way out is down

**Severity:** major · **Category:** defect · **Found by:** a machine restart killing gate-313's take
15, stranding two tickets that could not be requeued

## Problem

B-5 skips a session that crashed: the budget was charged before the launch, so a killed session may
not silently relaunch. B-5‴ (PRDR-234) made that skip discharge properly, so it happens once rather
than forever. Both are right.

Neither addresses what the operator does next. A ticket whose implement session was killed sits in
IN_PROGRESS with an unfinished `start`. On resume the skip fires, the authoritative gate runs on a
tree nobody finished writing, goes red, and the ladder descends — blind fix, research, informed fix
— every step of it spending real sessions on an implementation that was never written, before the
ticket finally reaches NEEDS_HUMAN, where C-12's requeue becomes admissible.

The requeue is the remedy. It is unreachable until the ladder has finished failing.

```
$ detent requeue /Users/workstation/detent-gate-313 t-s01-013
requeue is admissible only from NEEDS_HUMAN or BLOCKED; t-s01-013 is IN_PROGRESS (X-3 offers no such row)
exit 2
```

That message is accurate. `src/kernel/machine.ts:103,106` are the only two `HUMAN_REQUEUE` rows in
the table, and the plumbing check above them mirrors the same pair. Neither was wrong when written —
PRDR-078 built these verbs for a halted ticket — but the set was never revisited once crash-resume
existed, and a crash does not leave a ticket halted. It leaves it mid-flight.

## Measured, on the live run

gate-313's take 15 launched at 20:21 and the machine was shut down at 20:43. Two tickets were
in flight:

```
t-s01-013   IN_PROGRESS   implement start 20:19:55, no end   worktree: empty
t-s01-014   IN_PROGRESS   implement start 20:21:25, no end   worktree: one uncommitted file
```

Neither has a commit. Both will meet a red gate on a near-empty tree and descend the full ladder
before either can be requeued: at this run's measured means that is a blind fix, a research session
and an informed fix per ticket — roughly $10-16 and an hour of wall clock — to arrive at a state a
human can already see is correct from the outside.

The cost is not the point. The shape is: the product's documented remedy for a stranded ticket is
gated behind the failure path it exists to short-circuit.

## Why the table, and not just the plumbing check

The plumbing refusal and the table agree today, and loosening only the former would produce a verb
that passes its own check and is then refused by `commitTransition` — a worse error than the honest
one above. So the rows are the change, and the plumbing check follows them.

What may be requeued is then a statement about the machine rather than about one CLI verb, and the
same widening reaches the referee's own `requeue` action (`referee.ts:312`), which mints the
identical event.

## What is admissible, and what is not

A human may restart the current attempt of a ticket that is **not finished**:

`DIAGNOSED`, `IN_PROGRESS`, `BLIND_FIX`, `RESEARCH`, `INFORMED_FIX`, `REVIEW_FIX`, `IN_REVIEW` —
joining the existing `NEEDS_HUMAN` and `BLOCKED`.

`APPROVED` is deliberately excluded. Its diff passed the authoritative gate and a review; finalize is
mechanical from there, and a requeue would throw away verified work on a keystroke. An operator who
wants that ticket re-examined has `approve` for re-verification, and X-8 is not the tool for
discarding a result the system already trusts. `DONE` is merged, and `READY` is already the state a
requeue produces.

The claim guard does not move. `guardClaim` already refuses a claim held by a live process, naming
the pid and the claim's age, and breaks only a verifiably dead owner on this host — the predicate
`unclaim` and the pool's crash-resume self-heal share (PRDR-079). A requeue can therefore never pull
a ticket out from under a running session, in any of the newly admitted states. That guard is what
makes widening the set safe, and it is why this is a table change rather than a new verb.

## What implementation changed

**`src/kernel/machine.ts`** — `REQUEUEABLE` is a new exported constant naming the nine states a
human may restart an attempt from, and the table's `HUMAN_REQUEUE` rows are generated from it rather
than written out. One definition, so the table and the plumbing check cannot drift.

`APPROVED` is absent by decision, not omission — the doc-block says why, because the next reader to
wonder "why not APPROVED" should find the answer where the list is rather than in this ticket.

**`src/kernel/plumbing.ts`** — `requeueTicket` tests `REQUEUEABLE.includes(ticket.state)` instead of
carrying its own copy of the NEEDS_HUMAN/BLOCKED pair, and its refusal message now names the whole
admissible set. `guardClaim` above it is untouched and still runs first.

**`tests/kernel/requeue-resumable.test.ts`** — twelve tests, seven observed failing first (V-6): one
per newly admitted state, each asserting generation N+1 opens with zeroed counters. The other five
are guard rails that passed before and must keep passing — NEEDS_HUMAN and BLOCKED still work,
APPROVED and DONE still refuse, and a requeue against a LIVE claim still refuses with the ticket
untouched. That last one is the fence that matters: it is the assertion that would catch this change
quietly becoming a way to yank a ticket out from under a running session.

**Not changed:** what a requeue does. X-8's freeze-N, open-N+1 with zeroed counters and the guidance
recorded on the generation is identical from every admitted state — only the set of states widened.
The referee's own `requeue` action (`referee.ts:312`) mints the same event and inherits the widening
without an edit.
