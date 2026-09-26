---
id: PRDR-289
title: "The three fix prompts tell a session how to declare a criterion it cannot meet as specified, and the referee never reads the signal: X-3 admits PREMISE_FALSIFIED from IN_PROGRESS alone, so a fix session's `falsified.json` is written, ignored and deleted at the next launch, and `blind_fix.md` says both. The operator decided on 2026-09-26 that implement and fix sessions may all declare a false premise: X-3 gains a row from each fix state, and the referee reads the signal after each"
state: OPEN
severity: major
category: defect
labels: ["prd-review", "specification-phase", "operator-decision", "X-3", "X-4", "doc-claim-drift"]
surface: ["src/kernel/machine.ts", "src/kernel/referee.ts", "prompts/blind_fix.md", "prompts/informed_fix.md", "prompts/review_fix.md", "prompts/manifest.json", "tests/kernel/fix-falsification.test.ts"]
prd_refs: ["X-3", "X-4", "X-4′", "X-4″", "X-4‴", "PRDR-225", "PRDR-278"]
acceptance_criteria: ["X-3's table admits PREMISE_FALSIFIED from BLIND_FIX, INFORMED_FIX and REVIEW_FIX, each with the outcome IN_PROGRESS's row has, and DEPENDENCY_DISCOVERED from the same three, as X-3′ (PRDR-278) records it. No state or event is added.", "The referee reads `falsified.json` after a session in any of those four states, and treats `missing` (X-4′) and a retraction (X-4‴) exactly as it does after IN_PROGRESS.", "The three fix prompts describe the signal the referee now reads, and `blind_fix.md` no longer says that X-3 admits it only mid-implementation. Their hashes in `prompts/manifest.json` change with them.", "PRDR-225's clearing stays: every launch still removes a signal an earlier session left, so a stale one never impersonates this session.", "Falsifying test: a session in each fix state writes `falsified.json`. Against HEAD the referee never reads it and the ticket goes on as if nothing were written; fixed, PREMISE_FALSIFIED is admitted with IN_PROGRESS's outcome. The ticket records the failure against HEAD."]
non_goals: ["Does NOT let review, diagnose or research declare a false premise. They stay read-only (decision 12).", "Does NOT extend X-4″'s oversized signal to the fix states.", "Does NOT carry an amendment in the signal; PRDR-286 adds that."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-225", "PRDR-278", "PRDR-286"]
depends_on: ["PRDR-278"]
---

# PRDR-289 — fix sessions may declare a false premise

## Where this came from

On 2026-09-26 the specification plan's open questions were put to the operator. Asked which
sessions may file an amendment during `run`, the operator chose implement and the three fix
roles (decision 12, `docs/plan-specification-phase.md` §2). Checking what that choice changes
found that the prompts and the referee already disagree:
- `prompts/blind_fix.md`, `prompts/informed_fix.md` and `prompts/review_fix.md` each tell the
  session that "a criterion that cannot be met as specified" is a `{"note": "<why>"}` at
  `falsified_out` (X-4).
- The referee reads that file only when the state is IN_PROGRESS: `consumeFalsifiedSignal` has
  one call site, inside `if (state === "IN_PROGRESS")` in `src/kernel/referee.ts`. The machine
  has one PREMISE_FALSIFIED row, from IN_PROGRESS (`src/kernel/machine.ts:94`), as v2's X-3 table
  does (`detent-prd-v2.md:194`).
- The PRD says the same, in PRDR-225's entry: the signal is consumed only after an IN_PROGRESS
  session, because X-3 admits a falsification mid-implementation alone.
- `blind_fix.md` says both: it gives the signal's shape, and it says X-3 admits the signal only
  mid-implementation.
- It has happened live. In gate-313, t-s01-004's review-fix wrote `falsified.json`, at a stage
  that never reads one (PRDR-225).

## Problem

A fix session that finds its criterion cannot be met as specified does what its prompt says, and
nothing happens. The signal is ignored and then deleted at the next launch, and the ticket goes on
as if nothing had been written, reaching the operator only if its attempts run out. With the
specification phase the same signal carries amendments (PRDR-286). A criterion that a review
shows to be wrong goes to `review_fix`, so today that amendment would dead-end the same way.

## Design

Decision 12. X-3 gains three rows, BLIND_FIX, INFORMED_FIX and REVIEW_FIX on PREMISE_FALSIFIED,
each with IN_PROGRESS's outcome, and the referee reads the signal after all four states. Review,
diagnose and research stay read-only. PRDR-278 records the X-3 amendment first (N-6).
