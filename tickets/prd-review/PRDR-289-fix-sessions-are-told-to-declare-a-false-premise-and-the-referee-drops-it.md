---
id: PRDR-289
title: "The three fix prompts tell a session how to declare a criterion it cannot meet as specified, and the referee never reads the signal: X-3 admits PREMISE_FALSIFIED from IN_PROGRESS alone, so a fix session's `falsified.json` is written, ignored and deleted at the next launch, and `blind_fix.md` says both. The operator decided on 2026-09-26 that implement and fix sessions may all declare a false premise: X-3 gains a row from each fix state, and the referee reads the signal after each"
state: DONE
severity: major
category: defect
labels: ["prd-review", "specification-phase", "operator-decision", "X-3", "X-4", "doc-claim-drift"]
surface: ["src/kernel/driver.ts", "src/kernel/machine.ts", "src/kernel/referee-session.ts", "src/kernel/referee.ts", "prompts/blind_fix.md", "prompts/informed_fix.md", "prompts/manifest.json", "prompts/review_fix.md", "detent-prd-v3.md", "skills/run/SKILL.md", "tests/kernel/fix-falsification.test.ts", "tests/plugin/parity.test.ts", "tests/plugin/skill-driver.ts"]
prd_refs: ["X-3", "X-3′", "X-3″", "X-4", "X-4′", "X-4″", "X-4‴", "X-4⁶", "D-13", "ARCH-2", "PRDR-225", "PRDR-278"]
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

## Building it

What building it settled. Each is recorded in the PRD as X-3″ and is open to the operator's veto:

1. **The referee reads the signal after every attempt.** `attempt` launches a session in the four
   states alone, IN_PROGRESS and the three fixes, so the read of `falsified.json` needs no
   condition. `oversized.json` is still read after IN_PROGRESS alone (a non-goal).
2. **Both drivers transition with a fix session's `falsified_ref` before any gate**, as after
   IN_PROGRESS. The headless driver's four cases became one, and D-13's escalate reason stays
   with the informed fix's red gate. The run skill says the same in its fix bullets, and the
   scripted model driver, which implements the skill, does it (ARCH-2). The skill's IN_PROGRESS
   bullet had its sentences out of order: the note about landing on `READY` sat inside the
   sentence that calls `gate`. It is rewritten, and the `READY` note follows the list, since a
   `falsified_ref` from any of the four states can land there.
3. **The note keeps its words.** The referee's note still begins "falsified mid-implementation:",
   for a fix session too. X-4⁶ (PRDR-277) selects a ticket whose last note begins so, and tickets
   on disk carry it; a fix session continues the implementation. So a fix session's false
   premise is re-tested after a toolchain install, as an implementer's is.
4. **The prompts.** Each fix prompt now gives the signal's three shapes, `note`, `missing` and
   `retracted`, and tells the session to end once it writes one.
   - `blind_fix.md` calls a failure record that contradicts the hypothesis a false premise. It
     said to write that in the commit message, because the referee did not read the signal.
   - `review_fix.md` calls a finding that can be fixed only by breaking a criterion one.
   - `informed_fix.md` keeps its instruction for a brief whose `what_would_falsify` holds: record
     it in the commit message and stop. That is the brief's premise, not the ticket's, and the red
     gate that follows goes to a human (D-13).
5. **The worst case does not move.** `maxPossibleSessions` computes 24 for a bug and 19 for a
   feature, with the six rows and without them. It was measured before the rows landed, and the new
   suite pins it on a copy of the table with the rows taken out. A fix session's false premise
   spends a hypothesis as an implementer's does, and the rungs it has spent stay spent, so no path
   grows. The `sessions` default stays 28.
6. **The mark is X-3″ (3.1.1)**, the next X-3 mark. X-3′ points to it.

## Falsification (verification protocol, item 1)

The final test files were copied into a `git archive` of HEAD `da3cbd9` in the scratchpad and run
there, so the working tree was not touched. The files are the new suite, `parity.test.ts`, and the
scripted driver `skill-driver.ts`. `git diff` against `da3cbd9` shows the copy's `src/`, `prompts/`
and `skills/` unchanged. The suite had first been run in the working tree before any source
changed, with the same result on its first twelve tests. The prompt check, the X-4⁶ assertion, the
worst-case check and the D-13 test came later, and this run covers them.

16 of the 25 tests fail, each on what it tests:
- **The table:** an illegal transition, IN_PROGRESS the one state that admits either event, and
  no fix-state row for the worst-case check to take away.
- **The prompts:** `blind_fix.md` has no `missing`.
- **The runs:**
  - after the blind fix, research and the informed fix launched;
  - after the informed fix, GATE_RED where PREMISE_FALSIFIED belongs;
  - after the review fix, a ticket closed DONE on a premise its fixer had said was false;
  - on a bug, the ladder run out where diagnosis belongs;
  - `waits_on` empty;
  - a path nobody builds closed DONE;
  - no withdrawal on the record.
- **Both drivers:** at HEAD neither admits the signal, and the skill's fix bullets never name
  `falsified_ref`.

Nine pass, as they should. Three are the new suite's checks on what stays: the oversized signal,
PRDR-225's clearing, and D-13's note. The other six are the parity tests that were there before.

```
 ❯ tests/kernel/fix-falsification.test.ts (15 tests | 12 failed) 11854ms
   × … > PREMISE_FALSIFIED has IN_PROGRESS's outcome from each fix state, for a feature and for a bug 4ms
     → illegal transition: BLIND_FIX --PREMISE_FALSIFIED-->
   × … > DEPENDENCY_DISCOVERED returns the ticket to the pool from each fix state, as from IN_PROGRESS (X-4′) 1ms
     → illegal transition: BLIND_FIX --DEPENDENCY_DISCOVERED-->
   × … > no other state admits either, and the oversized signal stays IN_PROGRESS's alone 3ms
     → expected [ 'IN_PROGRESS' ] to deeply equal [ 'IN_PROGRESS', 'BLIND_FIX', …(2) ]
   × … > X-1's worst case does not move: 24 for a bug and 19 for a feature, with the six rows and without them 1ms
     → BLIND_FIX PREMISE_FALSIFIED: expected false to be true // Object.is equality
   × … > each gives the signal's three shapes and says to end the session, and none says X-3 admits it only mid-implementation 3ms
     → blind_fix: "missing": expected 'You are the Blind-Fix agent — ONE att…' to contain '"missing"'
   × … > BLIND_FIX: a feature's false premise goes to a human at once, and the ladder spends nothing more 1049ms
     → expected [ 'implement', 'blind_fix', …(2) ] to deeply equal [ 'implement', 'blind_fix' ]
   × … > INFORMED_FIX: the false premise is admitted, not D-13's red edge 1018ms
     → expected { from: 'INFORMED_FIX', …(2) } to deeply equal { from: 'INFORMED_FIX', …(2) }
   × … > REVIEW_FIX: a finding that shows the criterion wrong reaches a human, not the next review 1487ms
     → expected +0 to be 10 // Object.is equality
   × … > BLIND_FIX on a bug: the ticket returns to diagnosis with a hypothesis spent, and a corrected diagnosis runs to DONE 1056ms
     → expected 10 to be +0 // Object.is equality
   × … > X-4′: a blind fix that names a sibling's path waits for the sibling, then runs to DONE 1677ms
     → expected [] to deeply equal [ 't-b' ]
   × … > X-4′: a review fix that names a path nobody builds is a human's, and the note says which path 1192ms
     → expected +0 to be 10 // Object.is equality
   × … > X-4‴: an informed fix that retracts its signal goes on, and the withdrawal is on the record 1174ms
     → expected [ Array(1) ] to include 'falsification withdrawn by the sessio…'
   ✓ … > X-4″: an oversized signal a fix session writes is not read (a non-goal)  1062ms
   ✓ … > PRDR-225: a signal a reviewer left is cleared when the review fix launches, so it never speaks for that session  1314ms
   ✓ … > D-13: the informed fix's red gate says the ladder cannot reopen, and no other gate says it  814ms
 ❯ tests/plugin/parity.test.ts (10 tests | 4 failed) 15726ms
   × … > BLIND_FIX: both drivers admit PREMISE_FALSIFIED, and their journals are byte-identical 1600ms
     → the model driver transitioned with the signal's ref: expected { Object (at, ticket, ...) } to match object { from: 'BLIND_FIX', …(1) }
   × … > INFORMED_FIX: both drivers admit PREMISE_FALSIFIED, and their journals are byte-identical 1606ms
     → the model driver transitioned with the signal's ref: expected { Object (at, ticket, ...) } to match object { from: 'INFORMED_FIX', …(1) }
   × … > REVIEW_FIX: both drivers admit PREMISE_FALSIFIED, and their journals are byte-identical 3612ms
     → the model driver transitioned with the signal's ref: expected { Object (at, ticket, ...) } to match object { from: 'REVIEW_FIX', …(1) }
   × … > the skill's fix bullets transition with `falsified_ref` before they gate 2ms
     → BLIND_FIX: expected '`BLIND_FIX`, `REVIEW_FIX` — `attempt`…' to contain 'falsified_ref'
 Test Files  2 failed (2)
      Tests  16 failed | 9 passed (25)
```

## Mutation battery (verification protocol, item 2)

The battery ran 32 mutants, one defect each. Each ran against the new suite and the suites beside
it:
- the machine's, against the oracle's state and worst-case suites;
- the drivers' and the skill's, against `parity.test.ts`;
- the clearing's, against `stale-signal.test.ts`;
- the prompts', against `prompts.test.ts`.

A prompt mutant had its manifest rehashed, so the hash check could not kill it before the content
check did. Each file was restored from a snapshot, never by `git checkout`, and checked byte for
byte. After the battery the ten files matched their snapshots, and `prompts:check` passed. The
mutants covered:
- **The machine:** each of the six rows removed, each premise row sent to a human outright, and a
  dependency row sent to a human. Also PREMISE_FALSIFIED from IN_REVIEW, and TICKET_OVERSIZED from
  BLIND_FIX, added.
- **The referee:**
  - the read after IN_PROGRESS alone, as at HEAD;
  - the read after every state but one fix state, for each in turn;
  - the oversized signal read after every attempt;
  - a fix session's `missing` dropped.
- **The headless driver:** a fix state's ref ignored, as at HEAD, and REVIEW_FIX's alone. D-13's
  reason lost, and D-13's reason given to every gate.
- **The scripted driver and the skill:** each fix case, and each fix bullet, as at HEAD.
- **PRDR-225's clearing** of `falsified.json`.
- **The prompts:** `missing`, the retraction, the end of the session and X-3′ each removed, and
  `blind_fix.md`'s old sentence put back.

The first pass killed 31. One survived: **D03**, D-13's reason given to every gate. No test said
where that note may appear, so every red gate could have written "informed fix failed — the ladder
cannot reopen (D-13)" among the ticket's notes. D02, the reason lost, was killed only by the lock on
the literal's text. Merging the driver's four cases put both in reach. A test now runs the ladder
out and finds the note exactly once, and the informed fix's falsification finds none.

The second pass ran D02, D03 and M11 against the new suite alone:
- **D02** and **D03**, so that the literal's lock could not kill them first;
- **M11**, review admitted to falsify, so that the worst-case pin could not. That pin killed M11
  in the first pass, since a false premise from IN_REVIEW raises the computed worst case. Keeping
  review read-only keeps it at 24.

It killed all three.

Every mutant is killed: 31 in the first pass, and D03 in the second. The worst-case check came
after both passes, and a test added later can only kill more.

## What changed

- **`src/kernel/machine.ts`**: six rows, PREMISE_FALSIFIED and DEPENDENCY_DISCOVERED from
  BLIND_FIX, INFORMED_FIX and REVIEW_FIX, with IN_PROGRESS's guard and target.
- **`src/kernel/referee.ts`**: `attempt` reads `falsified.json` after every session it launches,
  and `oversized.json` after IN_PROGRESS alone.
- **`src/kernel/driver.ts`**: the four attempt states share one case. A signal ref is transitioned
  with before any gate, and D-13's reason goes with the informed fix's gate alone.
- **`src/kernel/referee-session.ts`**: PRDR-225's comment no longer says a review fix's signal is
  never read.
- **`skills/run/SKILL.md`**: the fix bullets transition with `falsified_ref`, the IN_PROGRESS
  bullet reads in order, and the `READY` note follows the list.
- **`prompts/blind_fix.md`, `prompts/informed_fix.md`, `prompts/review_fix.md`**: the signal's
  three shapes and the end of the session; `prompts/manifest.json` is regenerated.
- **`detent-prd-v3.md`**: X-3″, and X-3′'s pointer to it.
- **Tests:**
  - `tests/kernel/fix-falsification.test.ts` (new):
    - the table's six rows, the states that admit neither event, and X-1's worst case with the
      rows and without them;
    - the fix prompts;
    - each fix state through a run, and a bug's return to diagnosis;
    - `missing` resolved and unresolved, and a retraction;
    - what stays: the oversized signal, PRDR-225's clearing, and D-13's note.
  - `tests/plugin/skill-driver.ts`: the fix cases transition with `falsified_ref`.
  - `tests/plugin/parity.test.ts`: both drivers on each fix state, and the skill's words.

## Recorded, not fixed

- **No live model has run the new bullets.** The run skill's fix bullets are proven by the
  scripted driver that implements them and by a lock on their words. A real model executing the
  skill is T-124's live half, as for every other bullet.
- **A brief whose falsifying condition holds still reaches the human by D-13's red edge.** Its
  contradiction is in a commit message, not in the note and dossier a human reads first. It is the
  brief's premise and not the ticket's, so `informed_fix.md` keeps its instruction.
- **The dated records stay as written.** `docs/plan-specification-phase.md` §2, decision 12, says
  the referee drops a fix session's signal "today", and `docs/implementation-plan.md`'s T-043
  entry says the signal is consumed only mid-implementation. Each describes the code of its day.
