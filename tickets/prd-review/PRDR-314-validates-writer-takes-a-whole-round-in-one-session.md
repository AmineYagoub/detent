---
id: PRDR-314
title: "VALIDATE's writer takes a whole round's findings in one session, and one fix that turns the checker red undoes them all. C-2¹⁴ gives one spec_write session every finding of the round. On tabachir's test clone the first two of 26 reviews reported 23 findings each, about 2 KB apiece, so round 1 would hand one writer some 600 findings, over a megabyte of input before it reads a document. And after its second attempt, a single fix that leaves the checker red undoes every fix of the round. The writer now takes the round's findings in batches of at most 20, one session after another, each checked, relaunched and undone on its own"
state: DONE
severity: major
category: throughput
labels: ["prd-review", "specification-phase", "C-2¹⁴", "live-run", "quality"]
surface: ["src/init/validate-fix.ts", "src/init/validate-round.ts", "src/init/validate.ts", "tests/init/validate-fix-batch.test.ts", "detent-prd-v3.md"]
prd_refs: ["C-2¹⁴", "C-2²³", "X-1⁵"]
acceptance_criteria: ["A round's findings, in the order the round numbers them, go to the writer in batches of at most `VALIDATE_FIX_BATCH` (20), as few batches as that allows and as even as can be, one session after another. Each batch's session is given only its batch, and runs on the pack as the batch before left it.", "Each batch is checked as C-2¹⁴ checks the writer: the decision log, the defaults it adds, a requirement standing and the checker green. A batch's first attempt with anything wrong is relaunched with the list. After its second, a batch that leaves the checker red or no requirement has its own fixes undone and its own findings left `undone`, and the batches after it go on.", "An account unusable twice, or a writer session that fails, puts the pack back as it was when the round's writer began, every batch's fixes undone, and fails the phase as before. The round's kept reviews (C-2²³) still answer a re-run, since nothing they read has moved.", "The round records the documents changed since its writer began, and one diff of them against that point, for the next round's reviewers. A batch that stands is a unit of work (X-1⁵).", "The operator is told how many batches the writer takes, and each batch's notes name it.", "The checker's writer before any round is unchanged: one session over the checker's findings.", "The PRD records it as C-2²⁴, with amendment lines on C-2¹⁴.", "Falsifying tests: on a pack of seven areas whose reviewers report 24 findings, against HEAD, one writer session is given all 24; a fix that turns the checker red undoes every fix of the round; and no failure puts back fixes a session already made."]
non_goals: ["Does NOT run batches at once: two writers editing one document would lose each other's edits.", "Does NOT batch the checker's writer before any round: every batch would read the checker red on the findings the others hold, so none could be judged alone.", "Does NOT keep a writer batch's work across a stop: a stop during the writer runs it again, on the reviews the round kept."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-284", "PRDR-313"]
depends_on: []
---

# PRDR-314 — VALIDATE's writer takes a whole round's findings in one session

## Where this came from

The live test run on tabachir's disposable clone relaunched at 13:14 on PRDR-313's build, and
VALIDATE's round 1 began reviewing its 26 areas four at a time. The first two reviews landed at
13:48 and 13:53: the foundations with 23 findings (3 blockers, 14 majors, 6 minors), and
"Builds, releases, signing and versions" with 23 (13 majors, 10 minors). Both are kept in
`.detent/state/validate/reviews-kept.json`, which held 90,953 bytes for the 46, about 2 KB a
finding.

At that rate the round's 26 reviews report some 600 findings, and C-2¹⁴'s one writer session is
given all of them at once: over a megabyte of findings in its inputs before it reads the first
document it must change, then some 600 edits across the pack in one session.

## Problem

`fixFindings` launches one `spec_write` session with `findings: [...findings]`. Two things follow
at this size:

- **One session carries the whole round.** Whatever it does not reach, it declines or leaves
  unaccounted, and code declines those, so the round ends with its findings open and the next
  round reviews them again.
- **One red fix undoes the round.** After the writer's second attempt, a checker still red on its
  fixes, or a pack holding no requirement, undoes every fix of the round (C-2¹⁴). One fix out of
  600 that drops an acceptance criterion's line would throw away the other 599.

Neither needs one session. The findings are independent edits, each with its exact fix, and each
batch of them can be checked the way the whole round is.

## Design

- **Batches.** The round's merged findings keep the order their ids give them, which is the
  areas' order (C-2²³). They are cut into as few batches of at most `VALIDATE_FIX_BATCH` = 20 as
  that allows, as even as can be: 24 findings are two batches of 12, and 600 are thirty of 20.
- **One after another.** Each batch is one writer session, given only its batch, on the pack as
  the batch before it left it: two writers at once could each lose the other's edits to a shared
  document.
- **Each batch checked alone.** A batch is checked exactly as the round's writer was: the log
  guard, the defaults it adds cited, a requirement standing, the checker green. It is relaunched
  once with the list. After its second attempt, a red checker or a pack with no requirement
  undoes that batch alone, its findings left `undone`, and the next batch starts from the pack as
  it was before it. Every batch starts green: the round does, and a batch either leaves the pack
  green or is undone.
- **Failure.** An account unusable twice, or a session that fails, undoes every batch of the
  round and fails the phase, as a failed writer does now. The pack is then as the kept reviews
  read it, so a re-run takes them all (C-2²³) and runs the writer again.
- **The round's record.** `changed` is what changed since the round's writer began; the diff the
  next round verifies is taken against that point, so it holds every batch that stood.
- **The checker's writer** before any round stays one session. Its batches could not be judged
  alone: each would read the checker red on the findings the others hold.

## Building it

- `src/init/validate-fix.ts` (new): `VALIDATE_FIX_BATCH`, `fixBatches`, which cuts the round, and
  `fixFindings`, which runs the batches under the round's snapshot, writes the round's diff and
  says how many batches it takes.
- `src/init/validate-round.ts`: the one session and its checks become `fixBatch`, which undoes
  its own fixes when they fail the checks, and returns its outcomes, the documents it changed
  and whether it stood. `diffPath` and the diff move to `validate-fix.ts`.
- `src/init/validate.ts`: the round's findings go to the writer in batches; the checker's go as
  one.
- `tests/init/validate-fix-batch.test.ts` (new), on the seven-area pack of PRDR-313's tests.
- `detent-prd-v3.md`: C-2²⁴, with amendment lines on C-2¹⁴.

### Vetoable calls

1. **Twenty findings to a session.** About 40 KB of findings, and a session's worth of edits:
   tabachir's 600 would be thirty sessions. A constant, not a config key, until a run-time
   outcome asks for another (D-33).
2. **Cut in the round's order, not grouped by document.** The order is the areas' (C-2²³), so a
   batch holds one or two areas' findings. Grouping by the document a fix lands in would need that
   document, which a finding states only in the free text of its `fix`.
3. **Even batches.** 24 findings are two batches of 12, not 20 and 4.
4. **One after another, never at once.** Two writers editing one document lose each other's
   edits, and a fix may land in the foundations, which every area shares.
5. **A red batch is undone alone,** and the next starts from the pack as it was before it, so
   every batch starts green and is judged on its own fixes.
6. **A failure undoes the whole round,** not the batch. The phase fails, as a failed writer
   did, and the pack is then as the kept reviews read it, so a re-run reviews nothing again.
   Keeping the batches that stood would move documents and cost those areas' reviews again.
7. **The checker's writer before any round stays one session.** A batch of the checker's
   findings would read the checker red on the findings the other batches hold, so it could not
   be judged alone.
8. **A batch that stands is a unit of work** (X-1⁵), as a kept review is.
9. **A round of one batch reads as before.** The batch count is said, and a batch's notes name
   it, only when there is more than one.

## Falsification

The first four cases ran against HEAD `746e509`:

    × gives the writer the round's 24 findings as two batches of 12 …
        → expected [ [ 'R1-1', 'R1-2', 'R1-3', …(21) ] ] to deeply equal [ …(2) ]
    × undoes only a batch whose fixes leave the checker red …
        → the second batch relaunched once with the checker's words:
          expected [ [ 'R1-1', 'R1-2', 'R1-3', …(21) ] ] to deeply equal [ …(3) ]
    × hands the next round one diff of every batch that stood …
        → expected 'diff --git a/before/docs/prd/01-lendi…' to contain 'Fixed in call 1.'
    × fails the phase for an account unusable twice …
        → promise resolved "{ exitCode: +0, …(6) }" instead of rejecting

One writer session was given all 24 findings. Its one fix that dropped a criterion undid every
fix of the round, and a writer that could not account for them never failed. The fifth case, the
checker's writer as one session over more than twenty findings, holds on HEAD by construction and
guards the non-goal (M10).

## Mutation battery

Each mutant was applied to snapshot copies of `validate-fix.ts`, `validate-round.ts` and
`validate.ts`, and restored from them. The runs covered the eight `validate` suites, 90 cases.

| Mutant | Result |
|---|---|
| M1 one batch for all 24 | killed |
| M2 batches filled first, not even | killed |
| M3 the batches last first | killed |
| M4 a failure puts nothing back | killed |
| M5 a red batch undoes the round | killed |
| M6 `changed` read from the last batch | killed |
| M7 the diff taken from the last batch's start | killed |
| M8 no note of the batches | killed |
| M9 a batch that stands no unit of work | killed |
| M10 the checker's writer batched | killed |
| M11 a red batch's findings left as its writer said | killed |
| M12 a red batch not undone | killed |

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: 192 files, 2,196 passed and 2 skipped (2,198).
- `npm run plugin`: wrote nothing that changed.

## Recorded, not fixed

- **The writer is the round's slowest part now.** Thirty sessions one after another is hours on
  tabachir. Batches whose fixes land in different documents could run at once, but only a
  finding's free-text `fix` says where it lands.
- **The checker's writer is still one session.** A very large red checker would meet the same
  limit. PRDR-312 removed the largest cause seen, the links WRITE's archiving broke.
- **A stop during the writer keeps the batches that stood, unrecorded.** A kill runs no
  rollback. The re-run reviews again the areas whose documents those batches moved (C-2²³), and
  runs the writer again for the round.
