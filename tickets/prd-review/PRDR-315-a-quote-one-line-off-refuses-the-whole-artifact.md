---
id: PRDR-315
title: "A quote one line from where it says refuses a whole review, or a whole survey, and costs a relaunch of the session. Code checks each passage a VALIDATE reviewer or an AUDIT survey quotes at the exact line named, and refuses the artifact when the line is wrong, even when the quote is word for word in the document one line away. On tabachir's test run, two of the first four reviews were refused this way, one naming line 11 for a requirement on line 10 and one line 57 for a decision on line 58: each relaunch is a whole Opus session re-reading its area, some half an hour. Code now moves a passage whose quote starts on exactly one line of its document to that line, and says so; only a quote found nowhere, or on more than one line, is refused"
state: DONE
severity: major
category: spend
labels: ["prd-review", "specification-phase", "C-2¹¹", "C-2¹⁴", "live-run"]
surface: ["src/init/audit-passages.ts", "src/init/audit-survey.ts", "src/init/audit.ts", "src/init/validate-checks.ts", "src/init/validate-round.ts", "tests/init/passage-lines.test.ts", "tests/init/audit.test.ts", "tests/init/audit-checks.test.ts", "tests/init/audit-triage.test.ts", "tests/init/validate-checks.test.ts", "tests/init/validate-writer.test.ts", "detent-prd-v3.md"]
prd_refs: ["C-2¹¹", "C-2¹⁴"]
acceptance_criteria: ["A passage whose quote is not at the line it names, and starts on exactly one line of its document, whitespace aside, stands at that line: the finding, claim or gap keeps it with the line corrected, and the artifact is not refused for it.", "A quote that starts on no line of its document, or on more than one line other than the one named, is refused as before, since the reviewer's meaning cannot be told.", "The operator is told, once per artifact, which places moved and where.", "VALIDATE's reviews and AUDIT's survey are checked the same way. A kept survey's shape does not change.", "The PRD records it as C-2²⁵, with amendment lines on C-2¹¹ and C-2¹⁴.", "Falsifying tests: against HEAD, a review whose one finding quotes a requirement one line off is refused and relaunched, and a survey claim one line off is dropped on its second attempt."]
non_goals: ["Does NOT accept a quote that is not in the document word for word, whitespace aside.", "Does NOT move a place to another document, even one that holds the quote.", "Does NOT change what a passage must be in: a context document's quote is still refused by VALIDATE."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-281", "PRDR-284"]
depends_on: []
---

# PRDR-315 — A quote one line off refuses the whole artifact

## Where this came from

On tabachir's test run, VALIDATE round 1's first four reviewers were in flight from 13:14. By
13:48 two of their artifacts had been refused and relaunched:

- "The principles, and what Tabachir never does": `docs/prd/10-term-export.md:11 does not hold
  "[M2] The app MUST fill only the unlocked cells of the school's grade workbook"`. The line is
  10, `- **EXP-F-002** [M2] The app MUST fill only the unlocked cells …`. The file has no CR, no
  BOM and no Unicode line separator: the reviewer counted one line too many.
- "The open-source project …": `docs/founder-decisions.md:57 does not hold "The web app runs on its
  own origin, app.tabachir.dz, and keeps it for good after launch."`. It is on line 58, the X-47
  row, one line too few. That review also quoted context documents, which PRDR-316 takes up.

Each relaunch is a whole `spec_review` session, Opus at max effort, re-reading its area, some
half an hour and about ten dollars on this run. The quotes were word for word in the document.

## Problem

`passageAt` answers whether the quote starts on the line named. `checkReview` (C-2¹⁴) refuses the
review for any place where it does not, and `checkSurvey` (C-2¹¹) does the same for AUDIT's
survey. On the second attempt, a finding or claim still placed wrong is dropped, so a real,
correctly quoted defect can be lost for a line number.

The check exists to catch quotes a document does not hold: "a model can quote a sentence no
document contains, or put a real one on the wrong line" (C-2¹¹). A quote that is in the document
word for word, on exactly one line, is not invented, and its line can be found without asking
the session.

## Design

- **`lineOf`** in `audit-passages.ts`: the line a passage's quote starts on. That is the line it
  names, when it holds the quote there, or else the one line of its document that does,
  whitespace aside. It is null when no line does, or more than one does, since a quote found
  twice cannot say which it meant. `passageAt` keeps its meaning and shares the matching.
- **VALIDATE** (`checkReview`): a place whose quote `lineOf` finds on another line stands there.
  The kept finding carries the corrected line, which the writer, the record and the next round
  see. Only a quote found nowhere, or found twice, is an issue.
- **AUDIT** (`checkSurvey`): the same for each passage of a contradiction, a gap, a drift finding
  or a claim. The kept survey carries the corrected lines, with its shape unchanged.
- **The operator is told** once per artifact which places moved, `file:from → to`.

## Building it

- `src/init/audit-passages.ts`: `lineOf`, and the matching `passageAt` did, shared as `startsOn`;
  `moveOf` and `movedNote` for the operator. `checkSurvey` keeps each item with its passages at
  the lines `lineOf` finds, and lists the moves.
- `src/init/validate-checks.ts`: `checkReview` does the same for a finding's places, and returns
  `moved`, for kept findings only.
- `src/init/validate-round.ts` and `src/init/audit.ts`: one note per artifact that moved a place.
- `src/init/audit-survey.ts`: a kept survey read back moved nothing.
- `tests/init/passage-lines.test.ts` (new), and a case in `tests/init/audit.test.ts`. Two tests
  that put a real quote on the wrong line to reach the refusal now quote a sentence the document
  does not hold: `validate-writer.test.ts`'s relaunch case and `validate-checks.test.ts`'s
  refusal case, whose quotes code would now find.
- `detent-prd-v3.md`: C-2²⁵, with amendment lines on C-2¹¹ and C-2¹⁴.

### Vetoable calls

1. **Anywhere in the document, not within a few lines.** A quote on exactly one line is
   unambiguous however far the line named was from it; a window would refuse a reviewer who
   misread a table's row number by twenty.
2. **The line named wins when it holds the quote,** even where another line holds it too, so a
   quote placed right is never called ambiguous.
3. **Two other lines that hold it refuse it.** Which was meant cannot be told, and a writer
   fixing the wrong one would change a sentence the finding did not mean.
4. **Only its own document.** A passage is never moved to another file, even one that holds
   the quote.
5. **Moves are said, not refused, and not counted as issues:** the relaunch they cost was the
   defect.
6. **AUDIT and VALIDATE alike.** Both check through `passageAt`, and the survey's relaunch is a
   whole survey again.

## Falsification

The new cases ran against HEAD `9e83284`:

    × keeps a finding one line off at the line that holds its quote, relaunches nothing …
        → no review relaunched: expected [ { task: 'review', round: 1, …(8) } ] to deeply equal []
    × moves a quote on one other line to it, and lists the move
        → expected [ Array(1) ] to deeply equal []
    × refuses a quote that two other lines hold …        → expected undefined to deeply equal []
    × lists no move for a finding it drops …             → expected undefined to deeply equal []
    × PRDR-315: keeps a claim one line off at the line that holds its quote, relaunches no survey …
        → one survey, not relaunched: expected [ { role: 'audit', …(9) }, …(1) ] to have a length of 1 but got 2

On HEAD a review quoting a requirement one line off was refused and relaunched, and so was a
survey quoting a claim one line off. The second and third unit cases fail on the `moved` list
HEAD does not have; their refusals hold on HEAD.

## Mutation battery

Each mutant was applied to snapshot copies of `audit-passages.ts`, `validate-checks.ts`,
`validate-round.ts` and `audit.ts`, and restored from them. The runs covered seven suites, 115
cases.

| Mutant | Result |
|---|---|
| M1 no search past the line named | killed |
| M2 the first of several lines taken | killed |
| M3 the line named not preferred | killed |
| M4 a moved place keeps its old line (VALIDATE) | killed |
| M5 no moves listed (VALIDATE) | killed |
| M6 moves listed for a dropped finding | killed |
| M7 no note of the moves (VALIDATE) | killed |
| M8 AUDIT does not search | killed |
| M9 AUDIT keeps the old line | killed |
| M10 no note of the moves (AUDIT) | killed |
| M11 AUDIT searches a document it was not given | killed |
| M12 VALIDATE searches outside the pack | killed |

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: 193 files, 2,204 passed and 2 skipped (2,206).
- `npm run plugin`: wrote nothing that changed.

## Recorded, not fixed

- **The live test run's reviews in flight when this landed** were relaunched under the old
  check; the relaunches' spend is on the ledger.
- **A quote that is not word for word is still refused,** a curly quote for a straight one
  included. Whitespace is the only thing the match forgives.
