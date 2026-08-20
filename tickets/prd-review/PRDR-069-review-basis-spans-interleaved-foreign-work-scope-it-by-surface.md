---
id: PRDR-069
title: "The review basis spans interleaved foreign work — scope it by the ticket's surface"
state: DONE
severity: major
category: consistency
labels: ["prd-review", "found-by-execution"]
surface: ["src/kernel/referee-context.ts", "src/kernel/referee-stage.ts"]
prd_refs: ["SEC-3", "D-6", "D-20", "B-5", "C-9"]
acceptance_criteria:
  - "The reviewer's diff input contains the ticket's committed work from the claim base (the eleventh-firing guarantee stands)."
  - "The reviewer's diff input excludes commits other tickets finalized between the claim base and HEAD."
  - "The scoping mechanism is the ticket's declared surface — the same ownership contract the D-21 hook enforces on writes — not a new bookkeeping file."
non_goals:
  - "Does not change the session-input diff (uncommitted working-tree state shown to fix sessions) — that view answers a different question."
  - "Does not re-record or mutate claim bases; surviving resume stays the design (a ticket's review spans its whole arc)."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-068"]
depends_on: []
---

# PRDR-069 — the review basis spans interleaved foreign work; scope it by surface

**Severity:** major · **Category:** consistency · **Found by:** T-140's live run — the
firing after the eleventh-firing claim-base fix proved that fix incomplete.

## Problem

The claim base (HEAD at first acquire, persisted so resumes and later generations judge
the whole ticket) fixed the empty-diff review. But a run that stops and resumes
interleaves tickets: t-102's base was recorded at t-101's finalize, the process died,
and on resume t-104 and t-105 ran to DONE **above that base**. `git diff <base>` then
handed the reviewer 4,695 lines across 48 files — t-102's work buried under two foreign
tickets' finalized commits. The reviewer accurately called the foreign work untraceable
to the ticket; the REVIEW_FIX session was SEC-3-denied touching it (correctly — it
wasn't the ticket's surface); re-review saw the same span; NEEDS_HUMAN. Every layer
behaved; the basis was wrong.

## Resolution

SEC-3 already says the reviewer sees only "diff + criteria + rules" — and *diff* means
the **ticket's** diff. The plan's surfaces are disjoint by construction (D-20) and the
D-21 hook confines writes to them, so the surface pathspec is the exact ownership
filter: the review basis is now `git diff <claim_base> -- :(glob)<surface…>`. The span
still covers the ticket's whole arc (committed work, every generation); foreign
finalizes fall outside its surface and out of the diff. No PRD text change — the v2
SEC-3 sentence already states the contract this restores.
