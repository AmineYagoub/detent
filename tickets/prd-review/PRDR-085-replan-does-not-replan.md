---
id: PRDR-085
title: "--replan does not replan, and leaves orphans when it does"
state: DONE
severity: major
category: consistency
labels: ["prd-review", "user-raised", "found-by-execution"]
surface: ["src/init/machine.ts", "src/init/plan.ts"]
prd_refs: ["C-8", "C-4", "A-1", "P9"]
acceptance_criteria:
  - "`--replan` re-derives every planning phase (ANALYZE onward) regardless of checkpoint digests."
  - "Tickets the new plan does not name are removed; DONE tickets are never removed and never re-planned back to READY."
  - "A replan while any ticket is claimed or mid-ladder is refused by name, before any session launches."
  - "The refusal reads tickets defensively — an unparseable ticket file is not evidence of a live session and must not crash the guard."
non_goals:
  - "Does NOT reset `.detent/`: the ledger is the cumulative spend record that makes the cap un-restartable-around, `transitions.jsonl` is the audit log, `config.json` is the user's own settings, and `runs/` plus DONE tickets are the record of work that exists in the code."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-082", "PRDR-081"]
depends_on: []
---

# PRDR-085 — `--replan` does not replan, and leaves orphans when it does

**Severity:** major · **Category:** consistency · **Found by:** the user, watching two
`--replan` invocations produce a byte-identical plan and asking whether the flag should
simply reset `.detent/`.

## Problem

`--replan` only lifted C-8's guard against regenerating an approved plan; every phase
then consulted its own digest and reused whatever had not drifted. So the flag said
"replan" and frequently planned nothing — the first live use returned the same 32
tickets, and PRDR-082 (the prompt missing from the digest) was only half the reason.
Even with digests correct, a user asking for a fresh plan gets one only by coincidence.

The complementary half is worse: **nothing removed tickets the new plan no longer
contains.** Replanning 32 tickets into 15 left the other 17 on disk as READY and
claimable, so `run` would build work no approved plan asked for.

The proposed cure — reset `.detent/` — would take four things with it that are not the
plan: `ledger.jsonl` (spend is cumulative across restarts *so that restarting cannot
buy more budget* — deleting it silently refills the cap), `transitions.jsonl` (the audit
log, the product's own ground-truth claim), `config.json` (the user's budgets, protected
globs, risk globs, routing), and `runs/` plus every DONE ticket — which matters most,
because the documented workflow is planning increment by increment, so replanning a
project with completed work is the normal case, not the exception.

## Resolution

Force, do not reset. `--replan` marks the pipeline replaying from ANALYZE, so every
model-driven planning phase re-derives whatever its digest says; INIT_FS and DISCOVER
are cheap scans whose own digests already catch new files. PLAN then reconciles: a
drafted id that is already DONE is preserved untouched and announced (its code is
committed; a redraft would send a session to rebuild it), and any ticket the new plan
does not name is removed. A replan while a ticket is claimed or mid-ladder is refused
by name before any session launches, because re-deriving under a running session pulls
the ground out from under it. The guard reads tickets defensively: an unparseable file
is a problem for the phase that consumes it, not a crash in the safety check.
