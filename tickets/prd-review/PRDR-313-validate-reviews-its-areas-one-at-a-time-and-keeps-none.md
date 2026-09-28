---
id: PRDR-313
title: "VALIDATE reviews its areas one at a time, and a stop anywhere in a round loses every review the round paid for. C-2¹⁴ runs one spec_review reviewer per area, one after another, into one shared artifact, and holds what they find in memory until the round's writer runs. Tabachir's pack has 26 areas, and its first reviewer, the foundations, ran for more than half an hour, so one round would take most of a day. A stop at any point in that day would lose every finished review. The reviewers now run four at a time, as AUDIT's checks do (C-2¹⁶), each with its own artifact, and each review is kept as it lands under a digest of what its reviewer read"
state: DONE
severity: major
category: throughput
labels: ["prd-review", "specification-phase", "C-2¹⁴", "live-run", "spend"]
surface: ["src/init/batches.ts", "src/init/audit-claims.ts", "src/init/validate-kept.ts", "src/init/validate-round.ts", "src/init/validate.ts", "tests/init/validate-batch.test.ts", "tests/init/validate-writer.test.ts", "detent-prd-v3.md"]
prd_refs: ["C-2¹⁴", "C-2¹⁶", "C-2¹⁷", "X-1⁵", "SEC-3′"]
acceptance_criteria: ["A round's reviewers run up to four at once, the next starting as one ends. Each writes its own artifact, and each session may write only its own. The round's findings are merged in the areas' order whatever order the reviewers end in, so the writer and the record see what a sequential round showed them.", "A reviewer that fails lets the reviewers in flight end with their reviews kept, and then fails the phase as before.", "Each review is kept as it lands, under a digest of what its reviewer read: the round, its area, the foundations, its documents and their contents, the heuristic reports, the findings it verifies, the diff and the reviewer's prompt. A re-run of the round takes each kept review whose digest still holds, says how many, and reviews only the rest. A finished review is a unit of work (X-1⁵).", "The kept reviews are removed once the round is recorded. A kept file this build cannot read is not trusted, and its areas are reviewed again. No session can write it (SEC-3′).", "The batching helper AUDIT uses moves to its own module, and AUDIT's checks behave as before.", "The PRD records it as C-2²³, with amendment lines on C-2¹⁴.", "Falsifying tests: on a pack of seven areas, against HEAD, at most one reviewer is ever in flight; and a re-run after a reviewer fails reviews every area again."]
non_goals: ["Does NOT change what a reviewer reads, what it is told, or how its review is checked.", "Does NOT keep a round's writer's work: a stop during the writer leaves a pack the kept reviews no longer describe, and the digests say so.", "Does NOT change the number of reviewers at once for any other phase."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-284", "PRDR-304", "PRDR-305"]
depends_on: []
---

# PRDR-313 — VALIDATE reviews its areas one at a time, and keeps none of them

## Where this came from

The live test run on tabachir's disposable clone reached VALIDATE's first round at 12:22, after
PRDR-310 and PRDR-312 cleared its checker. The pack has 26 areas: the foundations (24 documents)
and 25 module PRDs, each named by its own area in the index. The first reviewer, the foundations,
was still reading at 12:53, 31 minutes in, and was the only session in flight. At that pace the
round's 26 reviews would take between eight and thirteen hours before its writer ran. Round 2
verifies the fixes and the ceiling is eight rounds, so validation could run for days.

`reviewArea` writes to one shared `review-artifact.json`. The round keeps its findings in an
array in memory and records nothing until the writer is done. A stop in hour seven would have
thrown away seven hours of reviews. The operator stopped the run at 12:54, losing the one review
in flight, rather than let it spend hours that a restart on a fixed build would discard.

## Problem

C-2¹⁴ says so in as many words: "One `spec_review` reviewer per area … one after another, the
foundations first." Nothing in a round needs the order. Each reviewer reads the foundations and
its own documents, and the findings are merged only after every reviewer has reported. It is the
shape PRDR-304 found in AUDIT's claim checks, with PRDR-305's defect beside it: work the round
paid for is kept nowhere a re-run can find it.

## Design

The round's reviews go through `reviewRound`, in a new `src/init/validate-kept.ts`:

- **Four at once.** `inBatches` moves from `audit-claims.ts` to `src/init/batches.ts`, unchanged,
  and the reviewers run through it with `VALIDATE_REVIEW_BATCH` = 4. Each writes
  `.detent/state/review-artifact-<area>.json`, numbered by the area's index. The results are held
  by task index and merged in the areas' order, so the merge, the writer's inputs and the record
  are what a sequential round produced.
- **Kept as they land.** `.detent/state/validate/reviews-kept.json` holds each finished review:
  its key, its round, its area and its findings as the check left them. The key digests what the
  reviewer read: the round; the area; the foundations and the documents, with their contents; the
  heuristic reports; the findings it verifies; the diff, with its contents; and the `spec_review`
  prompt's hash. A re-run takes each review whose key holds and says how many it took. The file
  goes once the round is recorded, and a file this build cannot parse is not trusted.
- **Out of every session's reach.** Code writes the kept file, and the structural floor keeps
  every session out of `.detent/state/` (SEC-3′). A kept review is a unit of work (X-1⁵), a
  progress mark for the no-progress breaker.

## Building it

- `src/init/batches.ts` (new): `inBatches`, moved from `audit-claims.ts` unchanged. AUDIT imports
  it from there.
- `src/init/validate-kept.ts` (new): `VALIDATE_REVIEW_BATCH`, the kept file's schema and path,
  `reviewRound` and `dropKeptReviews`.
- `src/init/validate-round.ts`: `reviewArtifactPath(root, area)`, and `reviewArea` takes the
  area's index to write under.
- `src/init/validate.ts`: a round's reviews go through `reviewRound`; the kept file is removed
  once the round's record is saved; the phase passes the `spec_review` prompt's hash.
- `tests/init/validate-batch.test.ts` (new), seven cases on a pack of seven areas, and
  `tests/init/validate-writer.test.ts`, whose reviewer's surface is now area 0's artifact.
- `detent-prd-v3.md`: C-2²³, with amendment lines on C-2¹⁴, C-2¹⁶, S-1″, D-28′ and C-4⁸, each of
  which said VALIDATE's reviewers run one after another or keep one artifact.

### Vetoable calls

1. **Four at once, as AUDIT's checks run.** A constant, not a config key, until a run-time
   outcome asks for another (D-33). Tabachir's 26 areas take seven batches' time instead of 26
   reviews'. Four sessions at once draw the account's usage four times as fast; a usage limit
   reaches them all, and each waits for the stated reset as a lone session does.
2. **Merged in the areas' order.** The writer's inputs and the findings' numbering are what a
   sequential round produced, so nothing after the reviews sees that they ran at once.
3. **The key is what the reviewer read, not the phase's key.** A kept review answers only for its
   round, its area, the same files with the same contents, the same findings to verify, the same
   diff and the same prompt. The round is in the key although no two rounds' tasks digest alike
   (M10): a round after the first carries the findings it verifies and the diff of the round
   before, and the first round's tasks carry neither. It stays for plainness.
4. **The file goes when the round's record is saved,** not when the phase completes. From then on
   the record carries the validation on (C-2¹⁴), and a kept review of a recorded round would
   answer nothing.
5. **A file this build cannot read is ignored, not refused.** Its reviews are done again: the
   spend is the price of not trusting it.
6. **A failed reviewer still fails the phase,** after the reviewers in flight end and are kept.
   C-2¹⁴'s one relaunch per review is unchanged.
7. **An artifact is numbered by its area's index, not named by the area.** Area names come from
   the index's free text, spaces and slashes included.
8. **The writer's work is not kept.** A stop during the writer runs it again, as before.

## Falsification

The seven cases ran against HEAD `b1faecb`:

    × never has more than four reviewers in flight …   → expected 1 to be 4
    × gives each reviewer its own artifact …            → expected 1 to be 7
    × fails the phase for a reviewer that failed …      → expected false to be true
    × reviews again an area whose documents moved …     → expected [ 'foundations', 'Area LND', …(5) ]
                                                          to deeply equal [ 'Area BRW', 'Area RTN', …(3) ]
    × reviews every area again when the kept file …     → ENOENT … reviews-kept.json
    ✓ reviews every area again when the reviewer's prompt is not the one …
    ✓ no session can write the kept reviews …

One reviewer was ever in flight, all seven wrote the same artifact, and nothing was kept, so a
re-run after the failure reviewed every area again. The two that pass hold on HEAD by
construction: HEAD keeps nothing, and the floor keeps sessions out of `.detent/state/`. They guard
the prompt in the key (M9) and the floor.

## Mutation battery

Each mutant was applied to snapshot copies of `validate-kept.ts`, `validate-round.ts` and
`validate.ts`, and restored from them. The runs covered the seven `validate` suites, 85 cases.

| Mutant | Result |
|---|---|
| M1 one reviewer at a time | killed |
| M2 five at once | killed |
| M3 merged in the order the reviews ended | killed |
| M4 one shared artifact | killed |
| M5 nothing kept | killed |
| M6 the key without the files' contents | killed |
| M7 the kept reviews never removed | killed |
| M8 the schema version not checked | killed |
| M9 the key without the prompt | killed, by the prompt case, added for it |
| M10 the key without the round | survived: equivalent, as vetoable call 3 says |
| M11 a kept review no unit of work | killed, by the progress-mark assertion, added for it |
| M12 a failed reviewer swallowed | killed |
| M13 no note of the kept reviews taken | killed |
| M14 the last area started first | killed |
| M15 every reviewer given area 0's artifact | killed |

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: 191 files, 2,191 passed and 2 skipped (2,193).
- `npm run plugin`: wrote nothing that changed.

## Recorded, not fixed

- **The live run's lost review.** The operator stopped tabachir's test run at 12:54 with the
  foundations review 31 minutes in. A session in flight when a run stops is lost, and its spend
  with it (S-4), so that review is on no ledger row.
- **A usage limit reaches the whole batch.** Four sessions at once meet the account's limit four
  times as fast as one, and each then waits for the reset on its own. The live run will show
  whether four is too many for one account; the size stays a constant until it does (D-33).
