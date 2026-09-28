---
id: PRDR-312
title: "WRITE's archiving breaks the links that context documents hold, and no session may repoint them. WRITE moves the originals it rewrote into the pack to `archive/` and leaves context where it is. The checker reads context documents for relative links (PRDR-280's call 7), and VALIDATE's writer may write only the pack's paths. So a README's link to the PRD that WRITE moved is a blocking finding that no session can clear, and VALIDATE stops with AWAIT_INFO after undoing the round's fixes. On tabachir's live run, 80 links in 8 context documents went unfixed, and VALIDATE's writer, asked to fix them all, fixed none"
state: DONE
severity: major
category: correctness
labels: ["prd-review", "specification-phase", "C-2⁹", "C-2¹³", "live-run"]
surface: ["src/init/write.ts", "src/init/write-links.ts", "src/init/pack-check-refs.ts", "tests/init/write-links.test.ts", "detent-prd-v3.md"]
prd_refs: ["C-2⁹", "C-2¹³", "C-2¹⁰", "C-2¹⁴"]
acceptance_criteria: ["When WRITE moves an original to `archive/`, code repoints every relative link to it, in every document the checker reads, to the original's place under `archive/`. A link keeps its anchor and its form: relative stays relative, and a link from the root stays a link from the root.", "Links are read as the checker reads them: a link inside a fenced block or an inline code span is text and is left alone, and so is a link with a scheme. A link to a document rewritten in place still resolves, and is left alone.", "WRITE's note says how many links it repointed, and in how many documents. The conformance record's checker is read after the links are repointed.", "The PRD records the change as C-2²², with amendment lines on C-2⁹ and C-2¹³.", "Falsifying test: a raw set whose README and runbook link to the PRD and the roadmap that WRITE archives. Against HEAD the links still name the moved paths, and the checker the record holds is red with `link` findings. With the fix they name `archive/`, the look-alikes are unchanged, and the checker is green."]
non_goals: ["Does NOT let VALIDATE's writer edit context documents: a link that breaks other than by WRITE's move is the founder's to fix, and the checker still reports it.", "Does NOT repoint a link to a pack document that replaced an original: nothing records which pack document holds which original's content, and `archive/` keeps what the link pointed at.", "Does NOT repoint the links of a pack an earlier build wrote. The 3.1.1 line is unreleased, and the operator repointed the one such pack, tabachir's test clone, by hand."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-280", "PRDR-283", "PRDR-284", "PRDR-310"]
depends_on: []
---

# PRDR-312 — WRITE's archiving breaks the links that context documents hold

## Where this came from

This comes from the live test run on tabachir's disposable clone. At 12:04 WRITE wrote the pack.
It archived the originals it rewrote: `docs/prd/PRD.md` and fourteen `docs/decisions/*.md` files,
among others. It kept `README.md`, `docs/contributing/*.md`, `docs/decisions/README.md` and
`docs/decisions/template.md` as context. Then the checker read the pack red, with 98 blocking
findings. 80 of them were `link` findings in those context documents, each naming a file WRITE
had moved: "`docs/prd/PRD.md` resolves to docs/prd/PRD.md, which does not exist".

VALIDATE's checker writer was sent to fix all 98. Its first attempt, from 12:05 to 12:17, fixed the
17 `reference` findings and none of the 80 links. The `fix` task tells it to apply each fix "where
the pack's paths allow, `pack_paths`", and every broken link was in a document outside them. Its
relaunch could not do better. After a second red attempt, code undoes the round's fixes and
VALIDATE stops with AWAIT_INFO. The operator stopped the run at the relaunch and repointed the 80
links by hand, one line each, driven by the checker's own findings. The checker then read the pack
green.

## Problem

Three rules, each reasonable alone, meet here:

- C-2⁹: WRITE moves the originals it rewrote to `archive/`, and leaves context where it is, since
  archiving a README would move it out of the root.
- PRDR-280's vetoable call 7: context documents are read for links, and a broken link blocks.
- C-2¹⁴ and the `fix` task: VALIDATE's writer applies fixes within `pack_paths` only.

The move breaks the links, the checker blocks on them, and nobody but the founder may repair them.
Almost every project that starts from a PRD has a README that links to it. WRITE's own check does
not see the break. It runs the checker before the move, while the originals are still in place,
so their links still resolve. The first checker run that sees the break is the one that writes the
record, after the move.

## Design

Code moved the file, so code repoints the links to it. After WRITE archives the originals, a new
module, `src/init/write-links.ts`, reads every document the checker reads, as the checker reads
it. It uses the same link pattern, fenced blocks and inline code are blank, and links with a scheme
are skipped. Each link that resolves to a moved original is rewritten to the original's place under
`archive/`, keeping its anchor and its form. The checker for the record then runs on the repointed
documents. The repointed link keeps its meaning: it names the same text it named before the move.

## Building it

- `src/init/write-links.ts` (new): `repointLinks(root, documents, moved)` returns each document
  it changed, with how many links. A document is read with `readLines`, as the checker reads it,
  so front matter is skipped and fenced blocks are blank. Its text passes through `withoutCode`,
  and the checker's `LINK` pattern, with the `d` flag for the target's exact offset, finds the
  links. A target with a scheme is skipped. The rest resolve with the checker's `resolve` and
  `safeDecode`. Each edit replaces exactly the target's characters, applied right to left in a
  line, so every other byte and every line ending stays as it was.
- `src/init/pack-check-refs.ts`: `SCHEME` and `withoutCode` are exported. The repointing uses
  the checker's own pieces, so the two cannot read a link differently.
- `src/init/write.ts`: `apply` repoints after the originals are archived, and before the checker
  whose result the record holds. The operator is told with a note, and the phase's outputs gain
  `repointed`.
- `tests/init/write-links.test.ts`: the pipeline case, and three cases on `repointLinks` itself:
  CRLF endings, front matter, a percent-encoded target, an angle-bracket target and three links
  on one line; a document with nothing to repoint left byte for byte; and a link with a scheme
  never repointed, whatever the moves name.
- `detent-prd-v3.md`: C-2²², with amendment lines on C-2⁹ and C-2¹³.

### Vetoable calls

1. **Code repoints, not a session.** The move is code's, so the repair is too. It is
   deterministic and costs nothing.
2. **To `archive/`, not to the pack document that replaced the original.** Nothing records which
   pack document holds which original's content. `archive/` keeps what the link pointed at, and
   the founder can point it elsewhere.
3. **Every document the checker reads is repointed, the pack's own included.** A pack document
   the session wrote that links to an original it archived now reaches the archive, and does not
   fail the checker.
4. **Only WRITE's own moves are repointed, and only by WRITE.** VALIDATE is not given the
   repointing. On a founder's pack, a link to a file that is gone should be reported, not quietly
   pointed at an old copy.
5. **WRITE's outputs gain `repointed`,** so the checkpoint records which documents code edited.
   Nothing reads the field. The outputs are a 3.1.1 shape, extended within the line's one F-3
   event.

## Falsification

The pipeline case ran against HEAD `74b46ad`:

    AssertionError: expected '# Toolshed\n\nRead the [product requi…' to be '# Toolshed\n\nRead the [product requi…'

The README still named `PRD.md`, `docs/roadmap.md` and `/PRD.md`. With the record's check moved
first, the same run showed what the checker made of it:

    → expected [ …(5) ] to deeply equal []

These are five `link` findings, one for each link the fix repoints. The code span, the fenced
example and the `https:` link are not among them.

## Mutation battery

Each mutant was applied to snapshot copies of `write.ts` and `write-links.ts` and restored from
them. The runs covered `write-links`, `write` and `validate-writer`, 50 cases.

| Mutant | Result |
|---|---|
| M1 nothing repointed | killed |
| M2 code spans read as links | killed |
| M3 schemes not skipped | killed, once the scheme case was added; it had survived, since no real tree resolves a scheme to a moved path |
| M4 a link from the root made relative | killed |
| M5 an encoded target not re-encoded | killed |
| M6 a line's edits applied left to right | killed |
| M7 the line index off by one | killed |
| M8 the record's checker run before the repointing | killed |

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: 190 files, 2,184 passed and 2 skipped (2,186).
- `npm run plugin`: wrote nothing that changed.

## Recorded, not fixed

- **The live test run's pack was repointed by hand.** It was written before this build, and WRITE
  does not run again on a written pack (C-2¹³). The operator applied the same change, driven by
  the checker's own findings: 80 of 80 links in 8 documents, one line each. The changed documents
  and the checkpoints are backed up beside the run's log.
- **WRITE's check before the move is still blind to the break.** It runs the checker while the
  originals still stand, so their links resolve. The repointing makes what it saw true after the
  move, but a check that simulated the move would be the stricter design.
