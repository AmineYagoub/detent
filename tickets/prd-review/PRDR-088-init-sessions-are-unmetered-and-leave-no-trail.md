---
id: PRDR-088
title: "Init sessions are unmetered and leave no diagnostic trail — the run cap does not bound them"
state: DONE
severity: major
category: gap
labels: ["prd-review", "found-by-execution"]
surface: ["src/init/session.ts", "src/init/pipeline.ts"]
prd_refs: ["P6", "X-1", "S-4", "B-5", "C-3a", "D-25"]
acceptance_criteria:
  - "Every init session (ANALYZE, PLAN, REVIEW_PLAN, planning research) writes a ledger row with the fields S-4 pins: cost estimate, tokens, turns, and the crash flag."
  - "`run_spend_usd` bounds init spend as it bounds run spend — cumulative across invocations, so repeated re-derivations cannot spend past the ceiling unnoticed."
  - "A failed init phase leaves a diagnostic record naming the role, the turns taken, and the backend's tail — enough to distinguish a turn-ceiling exhaustion from a refused session from an invalid artifact."
  - "`detent report` accounts for init spend rather than presenting a run total that omits it."
non_goals:
  - "Does not put init sessions under X-1's per-ticket/generation counters: those are scoped to a ticket and have no meaning during init."
  - "Does not add a new artifact schema; the ledger row and the existing per-stage journal shape already carry what is needed."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-083", "PRDR-081"]
depends_on: []
---

# PRDR-088 — init sessions are unmetered and leave no diagnostic trail

**Severity:** major · **Category:** gap · **Found by:** a live `PLAN` that failed with
`PLAN produced no draft artifact` and left nothing whatsoever to diagnose it with.

## Problem

`src/init/` contains no reference to the ledger. The session launcher says why, in its
own doc-block: *"init has no ticket, no per-generation counters, and no gates between
stages — so there is nothing to charge and nothing to re-verify."*

The first clause is true; **"nothing to charge" is false.** ANALYZE, PLAN, REVIEW_PLAN
and planning research are real billable model sessions. On the project that surfaced
this, init ran several full re-derivations at roughly a dollar to three apiece — none of
it recorded. Two consequences follow, and the first is not an observability concern at
all:

1. **P6 has a hole.** "Every loop has a counter; every counter has a ceiling" — init
   spend passes through no counter, so `run_spend_usd` does not bound it. A project can
   re-plan repeatedly and spend past its declared ceiling without a single ledger row.
   PRDR-083 made that ceiling a silent default, which widens the hole rather than
   narrowing it: the figure is now often unstated *and* unenforced for this path.
   `detent report` presents a run total that omits init entirely.

2. **A failed init phase is undiagnosable.** Worker sessions leave a ledger row (cost,
   tokens, turns, `partial: "crash"`) and a per-stage journal (`start`/`end`, `ok`).
   Init sessions leave neither, and `.detent/logs/` stays empty. When PLAN produced no
   artifact against a 27-document specification, the honest answer to "why" was a
   hypothesis — turn-ceiling exhaustion against an output that large — that could not be
   confirmed, because turn-ceiling exhaustion, a refused session, and a session that
   wrote invalid JSON are indistinguishable from outside. The failure was routed around
   by scoping the input (PRDR-086), never understood.

## Resolution

Meter and journal the init path with the machinery that already exists. Every
`launchInitSession` records an S-4 ledger row against the run's ledger, and the spend
launch gate consults it as the run loop does (D-25's bounded overshoot applies
unchanged). Each phase writes its session start and end, carrying turns, `ok`, and the
crash flag, so a failed phase names what happened rather than only what is missing. No
new schema: the ledger row and the per-stage journal shape both exist and both fit.

Incidental, found while reading: the same doc-block still says the planner "runs in plan
mode with no write tools", which S-1′ (PRDR-067) replaced with default mode plus one
scoped write rule. Correct it with this work.

## Implementation note

Landed with the machinery that already existed, as the resolution proposed: every
`launchInitSession` opens the run journal, passes `SpendLedger.assertLaunchAllowed()`
before the backend call, records an S-4 row against ticket `init`, and journals
`start`/`end` carrying `ok`, `turns`, `cost`, the crash flag and the backend's tail.
`run_spend_usd` now bounds init exactly as it bounds run spend — cumulative across
invocations, so repeated re-derivations cannot spend past the ceiling unnoticed — and a
failed phase names its turn count, which is what distinguishes ceiling exhaustion from a
refused session. The stale doc-block claiming plan mode and "nothing to charge" is
corrected in place.
