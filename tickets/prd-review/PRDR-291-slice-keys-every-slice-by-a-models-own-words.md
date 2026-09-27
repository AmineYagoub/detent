---
id: PRDR-291
title: "SLICE asks a model to re-derive the pack's structure from prose, then keys every slice by that model's own words: the same documents drew estimates of 308 and 554 tickets, 1 of 24 slice titles survived between two runs, and a single edit likely re-plans every slice. SLICE is seeded by code from milestones and module codes, a slice is its requirement ids, and an edited requirement re-plans only its own slice"
state: DONE
severity: major
category: capability
labels: ["prd-review", "planning-redesign", "operator-decision", "C-8‴", "reproducibility"]
surface: ["src/init/slice.ts", "src/init/slice-seed.ts", "src/init/slice-key.ts", "src/init/plan-slices.ts", "src/init/plan.ts", "src/init/pipeline.ts", "src/init/machine.ts", "src/init/pack-check-refs.ts", "src/schemas/init.ts", "prompts/planner.md", "prompts/manifest.json", "README.md", "skills/init/SKILL.md", "detent-prd-v3.md", "tests/init/slice-seed.test.ts", "tests/init/seed-fixture.ts", "tests/init/slicing-fixture.ts", "tests/init/plan-cache.test.ts", "tests/init/fold-analyze.test.ts", "tests/init/write-plan.test.ts", "tests/init/validate-plan.test.ts"]
prd_refs: ["C-2‴", "C-2⁵", "C-2⁵′", "C-2″", "C-2⁗", "C-2⁸", "C-2¹²", "C-2¹³", "C-2¹⁴", "C-2¹⁵", "C-3⁗", "C-4⁵", "C-8", "C-8′", "C-8‴", "C-8⁵", "D-10″", "N-5′", "F-4", "P9", "PRDR-117", "PRDR-118", "PRDR-278", "PRDR-280", "PRDR-290"]
acceptance_criteria: ["Code builds the seed from the checker's parse: requirement ids grouped by milestone, then by module code, with each group's criteria count.", "One slice session orders and groups the seed. Code refuses its artifact unless every requirement id lands in exactly one slice, the slices respect milestone order, and no slice names an id the pack does not define. A refusal gets the one relaunch every strict artifact gets.", "A slice's cache key is its sorted requirement ids, the content hash of each requirement with its criteria and the decisions, facts and catalogue entries it cites, the stack, the bindings, the session budget and the prompt hash (C-2⁸, PRDR-278). The slice's title and goal are not in it. A test edits one requirement's text and asserts that only its slice re-plans, and every other slice's cache is reused.", "SLICE is reused while the pack's set of requirement ids and milestones is unchanged, and its other inputs (the baseline, the band, the prompt) are too; the criteria counts guide the grouping and do not key it (C-2⁸). An added requirement is placed by a slice session that may only add, to an existing slice or a new one, and existing slices keep their ids and members. A removed requirement re-plans its slice. Tests cover both.", "The slicer estimates no ticket count. The announcement states the session formula for the slice count (the redesign plan's §10).", "`tests/init/plan-cache.test.ts` no longer holds SLICE's output constant to pass: its reuse test drives a real re-slice."]
non_goals: ["Does NOT make the walking skeleton a rule: which increment goes first stays the model's judgement.", "Does NOT change `--replan` (C-8′); it still re-derives every slice."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-117", "PRDR-118", "PRDR-286"]
depends_on: ["PRDR-278", "PRDR-280"]
---

# PRDR-291 — SLICE seeded by the pack, keyed by requirement ids

## Where this came from

The planning audit of 2026-09-26:
- SLICE's estimate for identical documents was 554 tickets on 5 Sep and 308 on 16 Sep;
- 1 of 24 slice titles matched between runs 4 and 6;
- the walking-skeleton slice produced between 19 and 41 tickets across six runs.

## Problem

`sliceKey` hashes the whole slice object, the model's prose included
(`src/init/plan-slices.ts:156-162`), and any document edit re-runs SLICE
(`src/init/pipeline.ts:271-282`). Unless SLICE writes byte-identical JSON again, every slice misses
its cache. Yet `present.ts` tells the operator that only the slices whose inputs changed are
re-planned. The cache test passes because it holds SLICE's output constant.

The specification phase's scoped re-plan (PRDR-286) needs this to work.

## Design

The redesign plan's §4. With a pack, the structure SLICE re-derived from prose is already data:
requirement ids, milestones and module codes. Code builds the seed, the model makes the one
judgement code cannot, and identity rests on the ids.

## From PRDR-282

Every slice reads the decision log (C-2¹²): `groundSlices` in `src/init/slice.ts` adds it to
each slice that names its own documents, and a slice with none plans from every document, the
log among them. So a veto, which edits one row, re-plans every slice. Keying a slice by its
requirement ids would let a veto re-plan only the slices whose requirements the edited entry
settles, which is what C-3⁗ promises.

## From PRDR-290

ANALYZE is gone (D-10″). SLICE is handed `greenfield` and, in greenfield, `stack`, the entry the
decision log records, where it was handed `analysis`; it is handed no `open_questions`. The parse
this ticket seeds from is VALIDATE's `pack` output: `planningPack` in `src/init/pipeline.ts` reads
it, fails the phase when it will not read, and returns null where VALIDATE handed none. VALIDATE
hands none when there is no conformance record, as when `plan_docs` narrows a raw document set and
WRITE writes nothing (C-2¹³). That path has no parse to seed from, and what SLICE does there is
this ticket's to decide. SLICE's digest and each slice's cache key already read the entry
(`planningStack` in `src/init/pipeline.ts`, `sliceKey` in `src/init/plan-slices.ts`).

`tests/init/plan-cache.test.ts`'s C-8‴ case held ANALYZE's prose drift. It now pins that an edit to
one slice's document re-plans that slice alone, with SLICE's output still held constant, so the
last criterion above is still this ticket's.

## Building it

What building it settled. Each is recorded in the PRD as C-2¹⁵ and is open to the operator's veto:

1. **The seed is built from VALIDATE's parse** (C-2¹⁴), and nothing reads the documents again
   for it. It holds each live
   requirement: not withdrawn, and in a document planning reads, so `plan_docs` narrows it (C-2″).
   Groups are by milestone in order, then by module code in the order the index registers the
   codes. Each group carries its module's area, its ids in document order and the criteria count
   the first criterion asks for, and each milestone carries its title.
2. **The seeded session is handed no stack.** It is handed the seed, the documents planning reads,
   the production baseline and the band. The stack keys every slice PLAN drafts, and PLAN plans on
   it; the cut is a judgement about increments, and the decision log among the documents records
   the stack for a session that needs it. Where there is no parse, SLICE is handed the stack as
   C-2‴ built it.
3. **Milestone order**, the second criterion's words, is read as: no slice holds a requirement of
   an earlier milestone than one a slice before it holds. A slice may span a milestone boundary,
   and never go back across one. The stricter reading, one milestone to a slice, would force a
   boundary at every milestone even where the band says the two halves belong together.
4. **A refusal names each defect**, and an id the seed does not hold is named with the reason: the
   pack does not define it, it is withdrawn, or it is in a document planning does not read. The
   relaunch is handed `refusedAttemptInput`, which says its content was refused, and not
   `previousAttemptInput`, which says the content was sound to keep.
5. **Each slice's documents are code's** on a pack: the module PRDs that hold its requirements and
   their criteria, and every document planning reads that is not a module PRD, the decision log
   among them (C-2¹²). Another module's PRD is left out, even where a requirement of the slice
   names a requirement there. The seeded skeleton has no `docs`. C-4⁵'s records (PRDR-292) replace
   the documents altogether.
6. **"SLICE is reused" is the cut, not the checkpoint.** SLICE runs again whenever a phase before it
   on the chain does, and on a pack every edit re-runs VALIDATE. What the fourth criterion asks to
   be reused is therefore the cut on record, `.detent/state/slicing.json`: SLICE runs, no session
   runs, and every slice keeps its id and members. It is a file of its own because P9 lets no
   stale checkpoint be read. It holds the basis the cut was made under (the baseline setting, the
   baseline's digest, the band and the planner prompt's hash) and each id with the milestone it
   had.
7. **What moved since the cut on record:**
   - an id no longer live leaves its slice;
   - an id whose milestone moved leaves its slice too, and the session that may only add places it
     again, so milestone order is checked on the result;
   - a slice left with neither requirements nor baseline items goes, and so do the edges to it;
   - a record under another basis, or one that keeps no slice, is cut again whole;
   - `--replan` removes the record with the slice caches, so it still re-derives every slice
     (C-8′, the second non-goal).
8. **The session that may only add** writes its own artifact, `slice-additions.json`. It holds
   `placed` entries, each naming an existing slice, and `new_slices`, each with an id no slice
   has, `after` (the slice it follows; null puts it first) and at least one requirement. The shape
   has no field to move, rename or remove anything, and it is strict. Code refuses:
   - a placement of an id a slice already holds, of an id it was not shown, or into a slice that
     does not exist;
   - a new slice under an id a slice has, or after a slice that does not exist;
   - any merged cut the slices schema refuses, such as one with an edge to a later slice, or that
     the second criterion's checks refuse.

   It is shown the slices in order, each with its milestones, and a seed of the ids to place and
   nothing else.
9. **SLICE's key** on a pack is the sorted live ids with their milestones, and the basis. The
   documents' text is not in it, nor the criteria counts (the fourth criterion), nor the stack.
10. **Without a parse**, SLICE cuts the documents as they are, as C-2‴ built it. That covers where
    WRITE wrote no pack (C-2¹³), the path the "From PRDR-290" section left to this ticket, and
    where the documents planning reads hold no live requirement. The session is handed the stack
    and names each slice's documents. SLICE keys on the documents' contents and the stack, and
    keeps no record.
11. **A slice's cache key** holds more than the third criterion lists:
    - each requirement's kind, level and tags beside its text;
    - each criterion's own milestone, requirement ids and tags;
    - the defaults the requirement cites, beside the decisions;
    - the baseline items the slice carries, each with what it is verified by. C-2⁸'s list left
      them out, and PLAN drafts from them (C-2⁗);
    - greenfield and the baseline setting.

    Citations are read as the checker reads them: `D-n` and `X-n`; `facts §N.M`, a section `§N` and
    a range between two; and a catalogue entry by the checker's own phrasings
    (`catalogueEntriesUsed`, new in `src/init/pack-check-refs.ts`). The parse keeps a catalogue
    entry's id and line and not its row, so the row is read from `catalogues.md` by its line. A
    requirement's place in its file is not in the key.
12. **No estimate, and the formula as built.** The fifth criterion names the redesign plan's §10,
    N-5′'s `1 + 2N + R + C`. That formula describes planning once C-4⁶ and A-1⁷ are built, and
    announcing it now would state a mechanism that is not built. The announcement counts the
    sessions PLAN runs after SLICE's own:
    - N slices take at least `4N + 1`: a draft and three review reads per slice, and one
      whole-plan review;
    - each revision round a slice review asks for adds four;
    - where the whole-plan review faults C slices, their redrafts and one more whole-plan review
      add `C + 1`;
    - one slice takes `4 + 4R`.

    When C-4⁶ and A-1⁷ are built, the announcement's part of N-5′'s formula is `2N + R + C`.
13. **The prompt stays `prompts/planner.md`.** The surface named `prompts/slice.md`, but splitting
    the planner prompt is PRDR-292's fifth criterion, and this ticket rewrote the `At SLICE`
    paragraph where it stands: the seed, the session that may only add, and documents cut as they
    are. Until the split, an edit to PLAN's or the review's part of the prompt re-cuts the product,
    as it re-plans every slice.
14. **The mark is C-2¹⁵ (3.1.1)**, after C-2¹⁴. Notes point to it from C-2⁸, C-2‴, C-2⁵′, C-8‴,
    C-3⁗, C-2¹², D-10″, N-5′ and C-8⁵.

## Falsification (verification protocol, item 1)

The final test files were copied into a `git archive` of HEAD `256c069` in the scratchpad and run
there, against HEAD's source, so the working tree was not touched. The copy is every test file that
differs from HEAD: the two new ones and fifteen changed ones. A `diff -r` against a fresh archive
shows the copy's `src/`, `prompts/` and `skills/` unchanged. The run takes the new suite,
`tests/init/plan-cache.test.ts` and `tests/init/fold-analyze.test.ts`.

The new suite fails 47 of its 48 tests, each on what it tests:
- SLICE is handed no seed, on `plan_docs` either, and its announcement states no formula;
- each slice plans from the documents the model listed, another module's PRD among them;
- nothing refuses a cut:
  - a cut that loses, repeats or invents an id, places a withdrawn one or breaks milestone order
    is planned;
  - a cut that is bad twice fails nothing;
- `cutIssue` and the skeletons do not exist, and the prompt says nothing of a seed;
- every edit runs SLICE's session again: a requirement, a veto, the stack's entry, each kind of
  citation, a withdrawn requirement and an empty slice;
- a re-cut in new words re-plans every slice, and so do a moved baseline item and a changed
  verification;
- an added requirement is cut again with the rest, by no session that may only add, and nothing
  refuses what such a session writes;
- no record is kept, so nothing says a cut stands or is cut again.

The one that passes is `--replan`'s, which re-derived every slice at HEAD and still does (the second
non-goal).

`plan-cache.test.ts` fails 2 of its 5 tests: the reuse test and the C-8‴ case, both of which
re-plan `s01` when SLICE rewords it. `fold-analyze.test.ts` fails 1 of its 15: SLICE is handed no
seed.

```
   × plan-cache > C-8 inside PLAN: an unchanged slice is reused from its cache when another slice's documents move, though SLICE re-cut the product in new words; --replan re-plans every slice
     → expected [ 'SLICE', 'PLAN:s01', …(8) ] to deeply equal [ 'SLICE', 'PLAN:s02', …(4) ]
   × slice-seed > hands the slice session the live requirement ids by milestone, then by module code, each group with its criteria count
     → expected undefined to deeply equal [ { milestone: 'M0', …(2) }, …(1) ]
   × slice-seed > plans each slice from the module PRDs its requirements live in and the pack's shared documents, never another module's
     → expected [ 'README.md', …(8) ] to not include 'docs/prd/02-checkout.md'
   × fold-analyze > hands PLAN the stack entry the decision log records, SLICE the seed, and neither an analysis
     → expected { stage: 'SLICE', …(7) } to have property "seed"
   × slice-seed > plans a slice from the PRD of a criterion that tests its requirements, though another module's PRD holds it
     → expected [ 'README.md', …(8) ] to not include 'docs/prd/02-checkout.md'
   × slice-seed > refuses a slicing that leaves an id in no slice, and relaunches the session once with the reason
     → expected [ 'SLICE' ] to deeply equal [ 'SLICE', 'SLICE' ]
   × plan-cache > C-8‴: an edit to one slice's document re-plans that slice alone
     → expected [ 'PLAN:s01', 'PLAN:s02' ] to deeply equal [ 'PLAN:s02' ]
   × slice-seed > refuses a slicing that places an id in two slices, and relaunches the session once with the reason
     → expected [ 'SLICE' ] to deeply equal [ 'SLICE', 'SLICE' ]
   × slice-seed > refuses a slicing that names an id the seed does not hold, and relaunches the session once with the reason
     → expected [ 'SLICE' ] to deeply equal [ 'SLICE', 'SLICE' ]
   × slice-seed > refuses a slicing that places a withdrawn requirement, and relaunches the session once with the reason
     → expected [ 'SLICE' ] to deeply equal [ 'SLICE', 'SLICE' ]
   × slice-seed > refuses a slicing that breaks milestone order, and relaunches the session once with the reason
     → expected [ 'SLICE' ] to deeply equal [ 'SLICE', 'SLICE' ]
   × slice-seed > lets a slice span a milestone boundary, and never go back across one, however many milestones the pack has
     → Cannot find module '../../src/init/slice-seed.js'
   × slice-seed > fails SLICE when the relaunch is refused too, rather than planning an incomplete product
     → promise resolved "{ exitCode: 2, …(7) }" instead of rejecting
   × slice-seed > seeds only the requirements of the documents plan_docs narrows planning to (C-2″)
     → expected undefined to deeply equal [ { milestone: 'M1', …(2) } ]
   × slice-seed > cuts the documents as they are where those planning reads hold no live requirement of the pack (C-2‴)
     → expected 'the documents are a conforming pack: …' to contain 'hold no live requirement of the pack'
   × slice-seed > shows each session a skeleton its own schema accepts, and none asks for a ticket estimate
     → Cannot find module '../../src/init/slice-seed.js'
   × slice-seed > announces the session formula for the slice count, and estimates no ticket count
     → expected 'the documents are a conforming pack: …' to contain '3 slices take at least 13 planner ses…'
   × slice-seed > re-plans only the slice whose requirement an edit changes, and no session re-slices
     → the pack's ids and milestones are unchanged: expected [ 'SLICE' ] to deeply equal []
   × slice-seed > keys no slice by its title or goal: a re-slice in new words that cuts the same ids re-plans nothing
     → the same ids in new words: expected [ 'PLAN:s01', 'PLAN:s02', 'PLAN:s03' ] to deeply equal []
   × slice-seed > re-plans only the slices whose requirements cite the entry a veto edits
     → expected [ 'SLICE' ] to deeply equal []
   × slice-seed > re-plans every slice when a veto edits the stack's entry, which every slice plans on (C-3⁗)
     → the entry is not the slicer's: expected [ 'SLICE' ] to deeply equal []
   × slice-seed > tells the slicer to place each seed id once in milestone order, and a session shown `slices` to add alone
     → expected 'At SLICE: cut the WHOLE document set …' to contain 'When `seed` is in your inputs'
   × slice-seed > re-plans only the slices whose requirements cite a criterion an edit changes
     → expected [ 'SLICE' ] to deeply equal []
   × slice-seed > re-plans only the slices whose requirements cite a default an edit changes
     → expected [ 'SLICE' ] to deeply equal []
   × slice-seed > re-plans only the slices whose requirements cite a fact an edit changes
     → expected [ 'SLICE' ] to deeply equal []
   × slice-seed > re-plans only the slices whose requirements cite a fact by its section an edit changes
     → expected [ 'SLICE' ] to deeply equal []
   × slice-seed > re-plans only the slices whose requirements cite a catalogue entry an edit changes
     → expected [ 'SLICE' ] to deeply equal []
   × slice-seed > re-plans only the slices whose requirements cite a criterion another module's PRD holds an edit changes
     → expected [ 'SLICE' ] to deeply equal []
   × slice-seed > re-plans only the slices whose requirements cite a route a criterion names by its path alone an edit changes
     → expected [ 'SLICE' ] to deeply equal []
   × slice-seed > re-plans only the slices whose requirements cite a route only a criterion uses an edit changes
     → expected [ 'SLICE' ] to deeply equal []
   × slice-seed > keys a slice by the baseline items it carries: a re-cut that moves one re-plans the two slices it moved between
     → expected [ 'PLAN:s01', 'PLAN:s02', 'PLAN:s03' ] to deeply equal [ 'PLAN:s01', 'PLAN:s02' ]
   × slice-seed > keys a slice by what each baseline item it carries is verified by
     → expected [ 'PLAN:s01', 'PLAN:s02', 'PLAN:s03' ] to deeply equal [ 'PLAN:s02' ]
   × slice-seed > places an added requirement by a session that may only add, and re-plans only the slice it joins
     → expected [ 'SLICE' ] to deeply equal [ 'SLICE:add' ]
   × slice-seed > gives an added requirement a new slice where the session opens one, and plans that slice alone
     → expected [ 'PLAN:s01', 'PLAN:s02', 'PLAN:s03' ] to deeply equal [ 'PLAN:s04' ]
   × slice-seed > refuses a session that may only add when it moves what is already placed, and relaunches it once with the reason
     → expected [ 'SLICE' ] to deeply equal [ 'SLICE:add', 'SLICE:add' ]
   × slice-seed > refuses a session that may only add when it places an id it was not shown, and relaunches it once with the reason
     → expected [ 'SLICE' ] to deeply equal [ 'SLICE:add', 'SLICE:add' ]
   × slice-seed > refuses a session that may only add when it leaves out an id it was shown, and relaunches it once with the reason
     → expected [ 'SLICE' ] to deeply equal [ 'SLICE:add', 'SLICE:add' ]
   × slice-seed > refuses a session that may only add when it places an id in a slice that does not exist, and relaunches it once with the reason
     → expected [ 'SLICE' ] to deeply equal [ 'SLICE:add', 'SLICE:add' ]
   × slice-seed > refuses a session that may only add when it opens a slice under an id a slice has, and relaunches it once with the reason
     → expected [ 'SLICE' ] to deeply equal [ 'SLICE:add', 'SLICE:add' ]
   × slice-seed > refuses a session that may only add when it opens a slice after one that does not exist, and relaunches it once with the reason
     → expected [ 'SLICE' ] to deeply equal [ 'SLICE:add', 'SLICE:add' ]
   × slice-seed > refuses a session that may only add when it opens a slice that depends on a later one, and relaunches it once with the reason
     → expected [ 'SLICE' ] to deeply equal [ 'SLICE:add', 'SLICE:add' ]
   × slice-seed > refuses a session that may only add when it breaks milestone order, and relaunches it once with the reason
     → expected [ 'SLICE' ] to deeply equal [ 'SLICE:add', 'SLICE:add' ]
   × slice-seed > refuses a session that may only add when it opens a slice with no requirement, and relaunches it once with the reason
     → expected [ 'SLICE' ] to deeply equal [ 'SLICE:add', 'SLICE:add' ]
   × slice-seed > refuses a session that may only add when it writes a field its shape does not have, and relaunches it once with the reason
     → expected [ 'SLICE' ] to deeply equal [ 'SLICE:add', 'SLICE:add' ]
   × slice-seed > fails SLICE when the relaunch of a session that may only add is refused too
     → promise resolved "{ exitCode: 2, …(7) }" instead of rejecting
   × slice-seed > re-plans the slice a withdrawn requirement leaves, and runs no session
     → expected [ 'SLICE' ] to deeply equal []
   × slice-seed > drops a slice the pack leaves with nothing to plan, and the edges to it
     → expected [ 'SLICE' ] to deeply equal []
   × slice-seed > re-places a requirement whose milestone moves through the session that may only add
     → expected [ 'SLICE' ] to deeply equal [ 'SLICE:add' ]
   × slice-seed > cuts the product again where no slice on record keeps a requirement the pack still holds
     → expected 'the documents are a conforming pack: …' to contain 'no slice on record keeps a requiremen…'
   × slice-seed > cuts the product again, and plans every slice again, when the planner prompt moves (C-4⁵ is not built)
     → expected 'sliced the documents into 3 increment…' to contain 'the baseline, the band or the prompt …'
 Test Files  3 failed (3)
      Tests  50 failed | 18 passed (68)
```

## Mutation battery (verification protocol, item 2)

The battery ran 77 mutants, one defect each, against the new suite. Where a mutant reaches them, it
also ran against `plan-cache.test.ts`, `fold-analyze.test.ts`, `decide-plan.test.ts` and
`slicing.test.ts`. A prompt mutant had its manifest rehashed, so the hash check could not kill it
before the content check did. Each file was restored from a snapshot, never by `git checkout`, and
checked byte for byte. The mutants covered:
- **The seed:** a withdrawn requirement placed; `plan_docs` ignored; milestones last first; codes
  out of the index's order; no criteria counts.
- **What a cut is refused for:**
  - an unknown id, an id in two slices and a left-out id accepted;
  - milestone order unchecked;
  - two slices of one milestone refused;
  - the high mark never rising;
  - a slice's first id taken for its lowest, or for its highest.
- **The session that may only add:**
  - not named: a move, an id it was not shown, a placement into no slice, a new slice under a taken
    id or after no slice;
  - a new slice put before the one it follows;
  - placed ids dropped;
  - the merged cut's shape and checks skipped;
  - the relaunch told nothing;
  - the whole seed shown, and no milestones.
- **The cut on record:**
  - a milestone move kept, and an id that left kept;
  - an empty slice kept, and the edges to it;
  - nothing ever added;
  - the record never read, never written, kept under another basis, or added to where it keeps no
    slice;
  - `--replan` keeping it.
- **SLICE:**
  - what joined never placed;
  - a slice's documents the model's on a pack, every module PRD in every slice, or a criterion's
    PRD left out;
  - the formula without the draft;
  - a seeded cut unchecked;
  - an empty seed cut;
  - the documents' SLICE handed no stack, and the seeded one handed it;
  - a refused cut called sound.
- **A slice's key:**
  - the title in it;
  - no criteria, decisions, defaults, facts, catalogue entries, baseline items, stack or
    requirement text;
  - a catalogue entry by its id alone, and baseline items by id alone;
  - citations read from the requirement alone;
  - without a parse, every document keying every slice;
  - the parse never read;
  - a section `§N` read as its first fact, and its end taken for its start.
- **The pipeline:** SLICE's key without the ids or the basis; the basis without the prompt, the
  baseline or the band; PLAN and SLICE handed no parse; SLICE handed no basis.
- **The rest:**
  - no catalogue entry used, and a route matched by its id alone;
  - the additions shape not strict, and a new slice allowed no requirement;
  - an estimate required again;
  - the prompt without its seed sentence or its add-only sentence, or with the estimate back.

The first pass killed 74. Three survived:
- **L06**, a criterion's PRD left out of its slice's documents, was a gap. Every criterion in the
  fixture lives in its own requirement's PRD. A checkout criterion now tests a catalog requirement,
  and the catalog slice plans from the checkout PRD. An edit to that criterion re-plans the catalog
  slice alone.
- **R02**, a route matched by its id alone, was a gap. Every route use in the fixture writes the
  method. A criterion now names the route by its path alone, and an edit to the route's row
  re-plans its slice.
- **P01**, SLICE's key without the ids, is equivalent. The ids come from VALIDATE's outputs, and
  SLICE runs again whenever a phase before it does, so its own key sees them move only alongside
  such a run. The ids stay in the key, which covers what the phase reads (P9).

Between the passes, the announcement's formula was corrected. The first pass's formula left out
the second whole-plan review that follows the redrafts. The second pass ran L06, R02 and P01, L07
again for the new sentence, and F01, a lone slice announced with a whole-plan review. It killed
L06, R02, L07 and F01. P01 survived again, as the equivalent it is. Every other mutant is killed:
74 in the first pass, and 4 in the second.

## What changed

- **`src/init/slice-seed.ts`** (new):
  - the seed (`placement`, `seedOf`);
  - what code refuses of a cut (`cutIssue`) and of a session that may only add (`withAdditions`);
  - the two sessions' skeletons;
  - the cut on record (`readSlicing`, `writeSlicing`, `sinceRecord`, `milestonesOf`).
- **`src/init/slice-key.ts`** (new): `sliceKey`, moved out of `plan-slices.ts`, keyed by the
  records on a pack (`recordsOf`).
- **`src/init/slice.ts`**: `sliceStage` seeds from the parse, keeps the cut on record, runs the
  session that may only add, and gives each slice its documents on a pack. Without a parse it cuts
  the documents as they are. `planningSessions` states the formula, and `wholeProduct` is PLAN's
  fallback slice.
- **`src/init/pack-check-refs.ts`**: `catalogueEntriesUsed`.
- **`src/init/pipeline.ts`**: SLICE's key and its basis (`sliceBasis`). SLICE and PLAN are handed
  the parse, and SLICE launches with the artifact path each session writes.
- **`src/init/plan.ts`**: `pack` in `PlanDeps`, and the fallback slice from `wholeProduct`.
- **`src/init/plan-slices.ts`**: `sliceKey` moved out.
- **`src/init/machine.ts`**: `slicingRecordPath`; `--replan` removes the record.
- **`src/schemas/init.ts`**:
  - `expected_tickets` is gone;
  - `sliceAdditionsSchema` is new;
  - the doc-block on `sliceSchema` says where code checks that every id lands in exactly one slice.
- **`prompts/planner.md`**: the `At SLICE` paragraph. `prompts/manifest.json` is regenerated.
- **`README.md`, `skills/init/SKILL.md`**: SLICE on a pack.
- **`detent-prd-v3.md`**: C-2¹⁵, and notes on C-2⁸, C-2‴, C-2⁵′, C-8‴, C-3⁗, C-2¹², D-10″, N-5′
  and C-8⁵.
- **PRDR-286, PRDR-292, PRDR-293 and PRDR-294**: a "From PRDR-291" section each.
- **Tests:**
  - `tests/init/slice-seed.test.ts` (new, 48 tests):
    - the seed;
    - each slice's documents;
    - each refusal of a cut, and of a session that may only add;
    - milestone order over three milestones;
    - `plan_docs`, and a pack whose planning documents hold no live requirement;
    - the skeletons, the prompt and the announcement;
    - what an edit re-plans: a requirement, a veto, the stack's entry, each kind of citation, a
      baseline item and what it is verified by;
    - an added, a withdrawn and a moved requirement;
    - a slice left empty, a record that keeps no slice, the prompt moving, and `--replan`.
  - `tests/init/seed-fixture.ts` (new): the pack fixture with a scripted planner that serves both
    SLICE artifacts, each draft and every review, and logs which it served.
  - `tests/init/slicing-fixture.ts`:
    - `reworded`, `seedIds` and `oneSlice`;
    - a scripted slicing that may be a function of the take;
    - the session that may only add.
  - `tests/init/plan-cache.test.ts`: the reuse test drives a real re-slice in new words, the sixth
    criterion. So does the C-8‴ case.
  - `tests/init/fold-analyze.test.ts`: on a pack SLICE is handed the seed and no stack.
  - `tests/init/write-plan.test.ts` and `validate-plan.test.ts`: their slices come from the seed.
  - `tests/init/decide-plan.test.ts`: a title that named C-2⁸ as unbuilt.
  - `expected_tickets` is gone from the fixtures of these suites:
    - `backhalf`, `config-defaults`, `contracts`, `plan-fixture`, `plan-write`, `slicing`,
      `slicing-scale`, `stages`, `validate-plan` and `write-plan`, under `tests/init/`;
    - `tests/scripts/plan-corpus.test.ts`.

## Recorded, not fixed

- **Until C-4⁵, a PLAN session reads whole documents and its key reads records.** An edit to text
  no record holds re-plans nothing. That covers prose around a requirement, an entry no requirement
  cites, a design document and an ADR. At HEAD such an edit re-planned every slice that listed the
  document. Keying those documents' contents into every slice would re-plan every slice on every
  veto, which is the defect this ticket fixes. PRDR-292 closes the gap by handing PLAN the records
  alone, and its "From PRDR-291" section says it must land before a release carries this ticket.
  `main` is held at v3.1.0, and the ksar evaluation is paused until the redesign is built.
- **P01 is equivalent**, as the battery says. The ids stay in SLICE's key because a key covers
  what its phase reads (P9).
- **The whole-plan review re-runs on a re-cut in new words.** Its key hashes the slices whole,
  since the review reads them. On a pack that happens only when the band, the baseline or the
  prompt moves. PRDR-293 deletes the review, and its "From PRDR-291" section says so.
- **A slice's documents leave out another module's PRD**, even where one of its requirements names
  a requirement there. The draft sees what earlier slices planned through `plan_index`. C-4⁵ hands
  PLAN the records of its own slice and an index of what the slices it depends on provide, and
  neither includes another module's text.
- **No live run has sliced from a seed.** The sessions are scripted. The prompt's new paragraph is
  pinned by a lock on its words, and what the scripted sessions write is refused or accepted by
  the code a live session meets.
- **A baseline item's definition is keyed by value.** A test mutates `PRODUCTION_BASELINE` in
  place, since the baseline is code, and restores it in a `finally`.
