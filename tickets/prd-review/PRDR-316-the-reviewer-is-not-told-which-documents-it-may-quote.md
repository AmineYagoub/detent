---
id: PRDR-316
title: "VALIDATE's reviewer is not told which documents it may quote, and code refuses a review for quoting a context document. C-2¹⁴'s check keeps a finding only when every place it quotes is in one of the pack's documents, but the spec_review prompt never says so, and the reviewer is not given the list of them. Pack documents link to the README and the contributing guides, and the prompt says to read any document a passage leads to. On tabachir's test run one review quoted 13 passages in 8 context documents, and the whole review was refused and relaunched. The reviewer is now given `pack`, the documents it may quote, and told that a document outside it is context: read, never quoted, and a finding against the pack names it in `why`"
state: DONE
severity: minor
category: spend
labels: ["prd-review", "specification-phase", "C-2¹⁴", "live-run", "prompt"]
surface: ["prompts/spec_review.md", "prompts/manifest.json", "src/init/validate-round.ts", "tests/init/validate-writer.test.ts", "detent-prd-v3.md"]
prd_refs: ["C-2¹⁴", "C-2²³", "C-2⁹"]
acceptance_criteria: ["Each reviewer is given `pack`: the pack's documents a finding may quote, the ones code checks its places against.", "The spec_review prompt says a finding quotes only documents in `pack`; that a document outside it is context, which the reviewer may read where a passage leads it and never quotes; and that where the pack disagrees with a context document and the pack should change, the finding quotes the pack's passage and names the context document in `why`.", "The PRD records it as C-2²⁶, with an amendment line on C-2¹⁴.", "Falsifying test: against HEAD, a reviewer's inputs carry no `pack`, and the prompt does not name the rule code enforces."]
non_goals: ["Does NOT let a finding quote a context document: C-2¹⁴ never reviews one, and VALIDATE's writer cannot change one.", "Does NOT change the prompt the live test run's pin carries: a new prompt moves every kept review's key, and the run's round 1 would review again."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-284", "PRDR-312", "PRDR-313", "PRDR-315"]
depends_on: []
---

# PRDR-316 — The reviewer is not told which documents it may quote

## Where this came from

On tabachir's test run, VALIDATE round 1 reviewed the area "The open-source project: licences,
openness, contributions, governance, the name, community and the repository files". Its first
artifact was refused:

    docs/contributing/commits.md:102 is not in one of the pack's documents;
    docs/contributing/releases.md:47 … :73 … :74 …; CONTRIBUTING.md:33 …;
    docs/contributing/commits.md:128 …; docs/contributing/workflow.md:176 … :188 … :191 …;
    docs/decisions/template.md:1 …; docs/decisions/README.md:5 …;
    docs/contributing/versioning.md:12 is not in one of the pack's documents

That was 13 places in 8 context documents, beside one quote a line off, which PRDR-315 now
moves. The area is about the repository's files, and its PRD links to the contributing guides
WRITE kept as context (C-2⁹). The relaunch is a whole review again.

## Problem

`checkReview` refuses a place outside `given.pack`, the reviewable pack documents, as C-2¹⁴
says: "Every passage a finding quotes must be in one of the pack's documents". The prompt tells
the reviewer to "read any other document of the pack a passage leads you to", and that "code
checks each quote against the document … and refuses one that is not there". It never says a
quote from outside the pack is refused, and the reviewer is not given the list, so it cannot
tell `docs/contributing/commits.md`, context, from `docs/decisions/0003-….md`, an ADR. It is
the gap PRDR-312 found for the writer: code enforces a rule the session is never told.

## Design

- **`pack` in the reviewer's inputs**: the pack's reviewable documents, the list `checkReview`
  checks places against.
- **The prompt**: a finding quotes only documents in `pack`. Any other document is context,
  such as a README, a contributing guide or a decision template. The reviewer reads it where a
  passage leads, never reviews it and never quotes it. Where a pack document disagrees with one
  and the pack is what should change, the finding quotes the pack's passage and names the
  context document in `why`.
- **The kept review's key is unchanged.** A pack document added or removed moves the index, a
  foundation every reviewer reads, so every key moves with it; and a module PRD no code
  registers is an area of its own.
- **The live run keeps its prompt.** Its pin carries the prompts its AUDIT ran on, and a new
  `spec_review` prompt would move every kept review's key.

## Building it

- `src/init/validate-round.ts`: `reviewArea` gives the reviewer `pack`.
- `prompts/spec_review.md`: the rule, beside the sentence that says code checks each quote; the
  manifest re-hashed.
- `tests/init/validate-writer.test.ts`: two cases.
- `detent-prd-v3.md`: C-2²⁶, with an amendment line on C-2¹⁴.

### Vetoable calls

1. **Told, not allowed.** Letting a finding quote a context document would review what C-2¹⁴
   never reviews, and hand the writer a fix it cannot make: its surface is the pack's paths.
2. **The pack's side quoted, the context named in `why`.** A disagreement with a context
   document is a finding only when the pack should change; where the context is wrong, it is
   the founder's to fix, as PRDR-312 left a broken link that WRITE did not break.
3. **The list is given, not described.** "The pack's paths" would ask the reviewer to match
   globs; `pack` is the exact list code checks against.
4. **The kept review's key is unchanged.** A pack document added or removed moves the index,
   which every reviewer reads as a foundation, so every key moves with it.
5. **The live run's pin keeps its prompt.** Its round 1 has reviews kept under the old prompt's
   hash, and this prompt would review all 26 areas again.

## Falsification

The two cases ran against HEAD `c31f84b`:

    × gives each reviewer `pack`, the documents its places are checked against …
        → expected undefined to deeply equal [ 'docs/founder-decisions.md', …(3) ]
    × tells the reviewer to quote only `pack`, and what to do with a context document
        → expected 'You are the Spec Review agent (read-o…' to match /A finding quotes only documents in `…/u

## Mutation battery

Each mutant was applied to snapshot copies of `validate-round.ts`, `prompts/spec_review.md` and
the manifest, the prompt mutants re-hashed so the prompt set still loads, and restored from them.
The runs covered four suites, 43 cases.

| Mutant | Result |
|---|---|
| M1 no `pack` given | killed |
| M2 a context document in `pack` | killed |
| M3 the rule not stated | killed |
| M4 context not said to be unquoted | killed |
| M5 no word on a disagreement with context | killed |

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: 193 files, 2,206 passed and 2 skipped (2,208).
- `npm run plugin`: wrote nothing that changed.

## Recorded, not fixed

- **The live test run reviews on the old prompt.** Its pin carries the prompts its AUDIT ran on,
  so its reviewers are not told, and a review that quotes a contributing guide is still relaunched
  there.
