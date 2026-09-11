---
id: PRDR-225
title: "A falsification signal written by an earlier session outlives it and is consumed as the next implementer's: the referee clears the artifact before a launch, never the three signal files"
state: DONE
severity: major
category: defect
labels: ["prd-review", "X-4", "signals", "resume", "gate-313"]
surface: ["src/kernel/referee-session.ts", "tests/kernel/stale-signal.test.ts", "detent-prd-v3.md"]
prd_refs: ["X-4", "X-4‴", "X-8", "P2", "V-6", "N-6", "PRDR-072", "PRDR-212", "PRDR-224"]
acceptance_criteria: ["Before every launch the referee removes the signal files a session writes and the referee consumes — `falsified.json` and `surface_request.json` — exactly as PRDR-072 removes the stale artifact, so a signal read after a session is that session's or nobody's. The crash-resume skip (B-5) keeps them, as it keeps the artifact. Observed FIRST (V-6): a `falsified.json` present in a ticket's runs directory before an implement launch is consumed against a session that wrote no signal — the run reaches NEEDS_HUMAN with PREMISE_FALSIFIED. On gate-313, t-s01-004's generation 0 review-fix session wrote one (its stage never consumes it), it survived a requeue, and generation 1's implementer — which wrote nothing — was falsified against it.", "End to end (mock backend): a stale `falsified.json` left in the runs directory before the run does not falsify a fresh implement that builds green and writes no signal; the ticket reaches DONE with exit 0. Today the run exits 10.", "A signal the launching session DOES write is consumed exactly as before."]
non_goals: ["Does NOT clear `oversized.json`: it is cross-run evidence `src/init/sizing-evidence.ts` reads for a later PLAN of the same documents (X-4″), so it persists deliberately, and `consumeOversizedSignal` keeps it. Its own stale-consume on a requeued oversized ticket re-lands it at NEEDS_HUMAN, not a silent pass, and moving that evidence to the journal is its own change if wanted.", "Does not consume a falsification from a fix stage: X-3 admits it mid-implementation only, and that stays.", "Does not change the signal shapes (PRDR-212, PRDR-224)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-072", "PRDR-212", "PRDR-224"]
depends_on: []
---

# PRDR-225 — a signal with no author

**Severity:** major · **Category:** defect · **Found by:** gate-313, take 8 — t-s01-004's
generation 1, falsified three minutes in, having written nothing

## Problem

PRDR-072 removes a stale ARTIFACT before every launch, so an earlier round's `implement.json`
can never be read as the new session's. The three signal files a session may write —
`falsified.json`, `oversized.json`, `surface_request.json` — are not removed. They are read
after a session ends, and only some stages read them: a falsification is admitted mid-
implementation (X-3), so one written by a review-fix session is never consumed by that
session's stage and simply stays.

t-s01-004: the generation 0 review-fix session, facing the criterion PRDR-224 describes, wrote
`falsified.json` at 09:27 — the wrong stage, and not even the documented shape. Its rounds ran
out; the ticket went to a human; the operator requeued with guidance at 09:31. Generation 1's
implementer read the stale file, decided the branch already carried the work, wrote no signal
of its own, and ended at 09:40. The referee then found `falsified.json` and admitted
PREMISE_FALSIFIED against generation 1:

> falsified mid-implementation: premise falsified

Nobody had said so in that generation. Sessions are fresh (P1); their signals must be too.

## The shape

Remove the three signal files where the artifact is removed, before every launch. Then a signal
the referee reads is the session's own, or absent.

## What implementation changed

**Cleared at the artifact seam.** `SessionArm.launch` already removed a stale `artifact` before a
fresh launch (PRDR-072); it now removes `falsified.json` and `surface_request.json` in the same
place, after the B-5 crash-resume early return — so a crashed in-flight session keeps its
signal, and a fresh generation starts with none. `oversized.json` is left, with a comment saying
why: sizing-evidence reads it across runs (X-4″).

**Two blocks compacted** to stay under the file's 300-line ceiling: the counters update inlined
to one line, the clearing written as a one-line loop — 298 counted lines.

**V-6, in order.** Observed on the tree as it was: a `falsified.json` planted in a ticket's runs
directory before the run was consumed against a fresh implement that wrote no signal — exit 10,
NEEDS_HUMAN. Then the change; then that run reaches DONE, while a signal the launching session
does write still falsifies and is consumed and removed exactly as before.


## Audit

Cold re-read of the seam and the three signals. The clearing loop names `falsified.json` and
`surface_request.json` only; `oversized.json` is absent, as intended, and `consumeOversizedSignal`
still keeps it for sizing-evidence. The loop sits after the B-5 `unfinished` early return, so a
crashed in-flight session's signals survive with its artifact. Order across a session is
correct: launch clears any stale request, the session writes a fresh one if it hits the
boundary, and the post-session `handleSurfaceRequest`/`discardSurfaceRequest` consumes that one —
the launch clearing only removes a request no session in this generation made. No code change.
