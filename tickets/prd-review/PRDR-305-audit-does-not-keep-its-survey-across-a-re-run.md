---
id: PRDR-305
title: "AUDIT does not keep its survey across a re-run. The phase is checkpointed only when it completes, so a run stopped during the claim checks, which take hours on a large document set, surveys again. A new survey words its claims afresh, so the briefs committed under the old wording's hashes answer none of them. The checked survey is now kept under the phase's key until AUDIT completes, and a re-run whose key has not moved checks its claims from where the stopped run left them"
state: DONE
severity: major
category: resumability
labels: ["prd-review", "specification-phase", "C-2¹¹", "C-8", "live-run", "resume"]
surface: ["src/init/audit.ts", "src/init/audit-survey.ts", "detent-prd-v3.md", "tests/init/audit-survey-kept.test.ts"]
prd_refs: ["C-2¹¹", "C-2¹⁶", "C-8", "X-1⁵", "SEC-3′", "D-19"]
acceptance_criteria: ["Once the survey is checked, AUDIT keeps it, with the phase's key, in `.detent/state/audit-survey-kept.json`. A re-run of AUDIT whose key has not moved launches no survey session and checks the kept survey's claims, so a claim already briefed answers from the cache and only the rest get sessions.", "A re-run whose key moved (a document or the code edited, the pack's kind, the stack markers, or the audit prompt changed) does not use the kept survey, and surveys again.", "A kept survey this build cannot read (not JSON, another schema version, a shape it does not know) is surveyed again, not trusted.", "The operator is told that the survey was kept from an earlier run, and how many claims it holds.", "When AUDIT completes, the kept survey is removed: the phase's checkpoint stands for it.", "A kept survey is a unit of work for the no-progress breaker, as a brief is (X-1⁵).", "No session can write the kept survey: it sits under `.detent/state/`, which the structural floor protects for every session but the one whose artifact a file is (SEC-3′).", "The PRD records it as C-2¹⁷, with an amendment line on C-2¹¹.", "Falsifying test: a first run whose claim check fails after the survey, and a second whose survey would word the claims differently. Against HEAD the second run surveys again and checks every claim anew. With the fix it launches no survey and checks only the claim the first run had not. The ticket records the failure against HEAD."]
non_goals: ["Does NOT keep a survey across a change to what AUDIT's key covers: an edited document is surveyed again, as it always was.", "Does NOT key the brief cache on anything but the claim and its subject (C-2¹¹).", "Does NOT keep a session that was in flight when the run stopped: its spend is lost with it, as any killed session's is (S-4)."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-281", "PRDR-304"]
depends_on: []
---

# PRDR-305 — AUDIT does not keep its survey across a re-run

## Where this came from

The tabachir test run, 2026-09-28. PRDR-304 made AUDIT check its claims four at a time, and the
run had to be stopped and relaunched on the new build to get it. The stop was timed to one second
after a brief landed, so no claim session was lost. The survey was: AUDIT writes its checkpoint only
when the phase completes, and the relaunch cleared the survey's artifact (D-19) and launched a new
survey, $9.10 and about half an hour on the `audit` role's routing. It also put the four briefs the
stopped run had paid for at risk. A brief is committed under the hash of its claim's words and
subject, and the new survey states its claims in words of its own.

## Problem

`auditStage` (`src/init/audit.ts`) launches the survey on every run of the phase. Nothing keeps a
survey that was checked, so a run that stops between the survey and the phase's end, from a signal,
a usage limit longer than init will wait, or a failed claim session, surveys again on the next
`init`. C-2¹¹ says a re-run "pays nothing for a claim already checked", which holds only when the
new survey words the claim exactly as the old one did. On tabachir the claim checks run for about
three and a half hours even in batches, so the window for a stop is most of the phase.

## Design

The checked survey (what stands, what was dropped and what went unread) is written by code to
`.detent/state/audit-survey-kept.json` with the key AUDIT's checkpoint is looked up by: the
documents' contents, the code, the pack's kind, the stack markers and the audit prompt's hash. A
run of AUDIT reads it first. Where the key matches, the survey is not launched, the operator is told
so, and the claims are checked from the kept survey, each already briefed claim answering from the
cache. Where the key does not match, or the file is not one this build reads, the survey runs as
before. The phase's completion removes the file, since its checkpoint stands for it from then on.

## Building it

`src/init/audit-survey.ts` owns the file: `keptSurveyPath`, `readKeptSurvey(root, key)`,
`keepSurvey(root, key, survey)` and `dropKeptSurvey(root)`. The record is the checked survey (what
stands, what was dropped, what went unread) with `schema_version` and the key, read through a
`z.strictObject` as SLICE reads its cut (`state/slicing.json`). A file that is not JSON, of another
schema version, of a shape the schema refuses, or kept under another key reads as `null`, and the
survey runs.

`auditStage` (`src/init/audit.ts`) now takes the key: `keptSurvey` returns the kept survey and says
so, and `surveyAnew` is the survey as it was, which then keeps what code checked and marks progress.
The claims are checked from whichever it got. Completion removes the file before the machine writes
the checkpoint. `auditPhase` computes the key with the function its digest uses, so the two cannot
differ.

The PRD records it as C-2¹⁷, with amendment lines on C-2¹¹ and C-2¹⁶ (below).

### Vetoable calls

1. **The phase's own key.** The kept survey is valid exactly where AUDIT's checkpoint would be. A
   narrower key (documents alone) would reuse a survey whose code or prompt had moved.
2. **The checked survey, not the session's artifact.** The session's file is cleared before each
   launch (D-19) and says nothing about which documents it read. The kept record is written by code
   after the check, so what is reused is what the phase had accepted.
3. **Removed at completion.** Kept, it would be harmless, since a moved key is ignored. Removed, its
   presence means one thing: an AUDIT in progress.
4. **A kept survey is a unit of work.** It survives a stop, as a brief does, so the no-progress
   breaker counts from it (X-1⁵).
5. **The survey is not re-checked on reuse.** The key covers the documents, so every passage it
   cites was checked against these words. A change to the checks themselves in a later Detent build
   is not in the key. The same holds for AUDIT's checkpoint and the briefs.
6. **The operator is told**, with the claim count, so a re-run that launches no survey reads as a
   choice and not a skipped step.
7. **No scrub.** `.detent/state/` is local and never committed (F-1), as the checkpoint beside it is.

## Falsification

Against HEAD (`bab115b`), in a `git archive` with the new test copied in:

```
× a re-run whose key has not moved launches no survey, and checks only the claims the stopped run had not
  → expected [ 'survey', 'verify_claim', …(1) ] to deeply equal [ 'verify_claim' ]
× a survey kept is a unit of work, so the first claim check starts from it (X-1⁵)
  → the survey's spend is behind the mark before any brief lands: expected 0 to be greater than 0
✓ a re-run whose key moved surveys again
× a kept survey this build cannot read is surveyed again, not trusted
  → ENOENT: no such file or directory, open '…/.detent/state/audit-survey-kept.json'
× is kept once the survey is checked, and removed when AUDIT completes
  → expected false to be true
✓ no session can write it: the structural floor keeps every session out of `.detent/state/` (SEC-3′)
```

HEAD surveys again on every run and checks both re-worded claims anew, the stopped run's brief
unread. The two that pass against HEAD guard the fix: a moved key must still re-survey, which is all
HEAD does, and the floor that keeps sessions out was already there. With the fix, all six pass, and
the four AUDIT suites pass 67 of 67.

## Mutation battery

Nine mutants of `src/init/audit.ts` and `src/init/audit-survey.ts`, each against the new test,
`tests/init/audit.test.ts` and `tests/init/audit-claims-batch.test.ts`, both files restored from
snapshot copies after each (byte-identical after the last):

| Mutant | Result |
|---|---|
| N1 the kept survey never read | killed: no survey on a re-run |
| N2 the key ignored | killed: a moved key surveys again |
| N3 any shape trusted | killed: the unreadable cases |
| N4 no progress mark on keeping | killed: the unit-of-work case |
| N5 never removed on completion | killed: removed when AUDIT completes |
| N6 never kept | killed: three cases |
| N7 a constant key | killed: a moved key surveys again |
| N8 no note | killed: the note assertion |
| N9 a file that is not JSON throws | killed: the unreadable cases |

9 of 9 killed. N8's first form, `void (…,)`, did not compile, so its first "kill" counted nothing; it
was re-run as a call that discards its argument and was killed by the note assertion.

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: 188 files, 2,163 passed and 2 skipped (2,165).
- `npm run plugin`: wrote nothing that changed.

## Found along the way

- **PRDR-304's own PRD entry overstated what a re-run keeps.** C-2¹⁶ said a batch that ends on a
  failure lets its checks commit their briefs "so a re-run pays for none of them again", and C-2¹¹
  said a re-run "pays nothing for a claim already checked". Both held only for a claim the new
  survey worded exactly as the old one did. Each carries an amendment line saying so. This is the
  doc-claim drift the project names: a load-bearing sentence stating a mechanism of which only half
  was built.

## Recorded, not fixed

- **A claim session in flight when a run stops is still lost**, with its spend: a session's ledger
  row is written when it ends (S-4). With the checks in batches that is up to four sessions
  (C-2¹⁶, D-28′). Timing a stop just after a brief lands keeps the loss to seconds.
