---
id: PRDR-290
title: "ANALYZE turns a validated pack back into prose: a 24K-character summary that SLICE and PLAN must re-read, and a greenfield stack chosen by a model where the founder's decision log should hold it. The operator's decision: the phase is removed, `greenfield` stays code's, the stack becomes a DECIDE decision the pack carries, and the pack's parse replaces the summary"
state: DONE
severity: major
category: capability
labels: ["prd-review", "planning-redesign", "operator-decision", "D-10", "F-3"]
surface: ["src/init/analyze.ts", "src/init/greenfield.ts", "src/init/pipeline.ts", "src/init/machine.ts", "src/init/bind.ts", "src/init/slice.ts", "src/init/plan.ts", "src/init/plan-slices.ts", "src/init/plan-write.ts", "src/init/present.ts", "src/schemas/init.ts", "src/init/decide.ts", "src/kernel/budgets.ts", "prompts/planner.md", "prompts/manifest.json", "README.md", "skills/init/SKILL.md", "detent-prd-v3.md", "tests/init/stages.test.ts", "tests/init/decide-plan.test.ts", "tests/init/fold-analyze.test.ts"]
prd_refs: ["D-10", "D-10′", "D-10″", "C-3", "C-3′", "C-3‴", "C-3b", "C-8⁵", "C-2¹¹", "C-2¹²", "C-2¹³", "C-2¹⁴", "F-3", "F-4", "PRDR-115", "PRDR-278", "PRDR-282"]
acceptance_criteria: ["`INIT_PHASES` no longer holds ANALYZE. Checkpoints written under the old list are read under F-3's rule, and an `init` resumed from an ANALYZE checkpoint re-runs from DECIDE and says why.", "`greenfield` is computed by code from the stack markers, as `isGreenfield` does now, and reaches DETERMINE_VERIFICATION, SLICE and PLAN without a model session.", "In greenfield, DECIDE records the stack as a decision (asked when C-3″ applies, a vetoable `X-n` otherwise) in a structured entry: the language, the toolchain, the documented gate command for each slot, and the scaffold files. DETERMINE_VERIFICATION binds from that entry, and documented commands remain the bindings (PRDR-115).", "A greenfield pack with no stack entry fails the checker (PRDR-279's schema), and the failure names the missing entry.", "D-10's order names DECIDE where it named ANALYZE, and keeps its reason: nothing binds before a stack exists.", "SLICE and PLAN receive the checker's parse of the pack instead of `analysis`, and no phase reads `outputs.ANALYZE`.", "`--replan` enters at DETERMINE_VERIFICATION where it entered at ANALYZE (`REPLAN_FROM`), and never re-runs the specification phase (C-8⁵, PRDR-278)."]
non_goals: ["Does NOT change how an existing project's stack is found: it is still read from the repository.", "Does NOT move ANALYZE's questions anywhere new; DECIDE already owns them (PRDR-282).", "Does NOT delete the research engine; AUDIT reuses it (PRDR-298)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-282", "PRDR-115"]
depends_on: ["PRDR-278", "PRDR-282"]
---

# PRDR-290 — ANALYZE folds into DECIDE

## Where this came from

The planning audit of 2026-09-26 (`docs/planning-phase-audit-2026-09-26.md`), and the operator's
decision 5 in `docs/plan-planning-redesign.md`.

## Problem

ANALYZE hands later phases three things (`src/init/pipeline.ts:249-325`):
- `greenfield`, which code already computes (`isGreenfield`, `src/init/analyze.ts:45`);
- in greenfield, the stack with its scaffold files, which `bind.ts` turns into bindings;
- `analysis`, a prose summary of about 24K characters that SLICE and PLAN re-read.

Once the specification phase exists, the pack holds all of it in a better form. The stack is a
decision, and the founder's decision log is where decisions live. The summary is a model's
paraphrase of documents a checker has already parsed.

## Design

The redesign plan's §3. D-10's reason for putting analysis before verification survives: the stack
still exists before DETERMINE_VERIFICATION, because DECIDE precedes it.

## From PRDR-282

DECIDE records the stack (C-2¹²): a structured entry, `language`, `toolchain`, `scaffold_files`
and `gates` by slot, written to the log's `## Stack` and the root package's `## Packages` rows and
carried in DECIDE's outputs as `stack`. Until this ticket, it reaches the bindings through
ANALYZE: the session is handed `decided_stack`, and `withDecidedStack` in `src/init/analyze.ts`
writes the entry over the stack the session chose. Removing ANALYZE removes that override, the
`decided_stack` input and `stackInstruction`'s decided branch; DETERMINE_VERIFICATION then binds
from the entry directly. `test_single` is in the entry and not in an analysis's `verification`,
so binding from the entry gains it.

## From PRDR-283

WRITE hands the planning phases their documents and stack markers (C-2¹³): `planningDocs` in
`src/init/decide.ts` returns WRITE's `docs`, the decision log among them, and `planningMarkers` in
`src/init/write.ts` returns WRITE's `stack_markers`; ANALYZE and DETERMINE_VERIFICATION read the
markers through it. With ANALYZE removed, DETERMINE_VERIFICATION keeps reading them there, or from
whatever phase hands on after VALIDATE (PRDR-284). A planning digest that reads DISCOVER's outputs
instead breaks C-8″'s scan: after WRITE's move DISCOVER re-runs, the scan cannot read its outputs,
and every re-init reads as a re-plan. The planning suites leave WRITE out (`planningPipeline` in
`tests/init/plan-fixture.ts`, and `initThrough`'s `all` in `tests/init/decide-fixture.ts`) and
plan from raw documents; once SLICE and PLAN read the checker's parse, their fixtures need packs.


## From PRDR-284

VALIDATE hands the planning phases the pack (C-2¹⁴). Its outputs carry what WRITE's did: `docs`,
the log among them, `stack_markers`, and the log's decisions and defaults. They also carry
`validated`, `rounds`, `risks` and `pack`, which is the checker's parse of the pack as VALIDATE
left it (`parsePack` in `src/init/pack-parse.ts`). `planningDocs`, `planningMarkers`, ANALYZE's
digest and PRESENT's `logged` each read VALIDATE's outputs first. Nothing reads `pack`, and the
`finished` doc-block in `src/init/validate.ts` says so; that doc-block becomes false the day SLICE
and PLAN read the parse.

The parse sits whole in VALIDATE's checkpoint, and on a pack of ksarjs's size (2,024
requirements, 1,144 criteria) that checkpoint is large. A reader may prefer to re-parse the
handed documents instead, since the parse is deterministic and VALIDATE's key already names every
byte it reads. The planning suites leave VALIDATE out as they leave WRITE out (`planningPipeline`,
and `initThrough`'s `all`).

## Building it

What building it settled. Each is recorded in the PRD as D-10″ and is open to the operator's veto:

1. **Planning is handed the parse's stack entry, not the whole parse.** The sixth criterion says
   SLICE and PLAN receive the checker's parse in place of `analysis`. They receive the part of
   `analysis` the pack's documents do not already give them: the stack entry. The parse's
   requirements, milestones and codes reach SLICE as PRDR-291's seed and PLAN as C-4⁵'s records
   (PRDR-292). Handing the whole parse to every session before either reads it would put every
   requirement and criterion into every draft's inputs, 2,024 and 1,144 on the largest pack
   Detent has checked. The doc-blocks in `pack-parse.ts` and `validate.ts` say which phases read
   what.
2. **Where VALIDATE hands no parse, the log.** VALIDATE hands none when there is no conformance
   record, as when `plan_docs` narrows a raw set and WRITE writes nothing. The entry is then read
   from the decision log on disk, by the parser the checker uses. It is never read from DECIDE's
   outputs: C-8″'s scan skips the standalone phases, so a planning key that read them would be
   computed from something the scan cannot see. A parse that will not read fails the phase and
   says to delete VALIDATE's checkpoint. Planning as if a new project had no stack would be the
   quiet failure.
3. **`greenfield` is read where the markers are handed on**: VALIDATE's, WRITE's or DISCOVER's,
   the latest that ran (`planningMarkers`, PRDR-283). HEAD read ANALYZE's flag, so a
   DETERMINE_VERIFICATION run with no outputs bound an existing project; it now binds a new one.
   The one harness that ran it bare, `tests/init/vacuous-gate.test.ts`, now hands it DISCOVER's
   markers, as the pipeline does.
4. **The bindings.** The entry's gates bind when they name `test`: each slot the log names,
   `test_single` among them. Otherwise the language table applies, as V-1′'s fallback did. A new
   project whose log records no stack stops DETERMINE_VERIFICATION with AWAIT_SETUP_CONSENT, item
   `stack`, naming `## Stack`. `INTERRUPT_PHASE` gives the phase setup consent and binding choice
   only, and a stack is what setting up needs. This replaces ANALYZE's failure of the phase on a
   greenfield analysis with no stack. The stop for an entry with no known command names
   `## Packages` in the log, where it named the planning documents.
5. **An older state.** `RETIRED`, in `src/init/machine.ts`, lists each phase this build dropped,
   the phase that took over its job, and the files it left. While `.detent/state/ANALYZE.json`
   exists, `init` says why and runs DECIDE whatever DECIDE's own checkpoint says. It removes the
   checkpoint and `analysis.json` once DECIDE completes. DECIDE stands off the chain, so the
   phases after it are looked up as usual and re-run only where their keys moved, and a DECIDE
   with nothing open runs no session. A deferral keeps the files and the message. There is no
   migration step: states at schema version 2 written before this build hold the checkpoint too,
   and F-3″'s migration never runs on them, so a step would miss the states most likely to exist.
6. **`--replan` enters at DETERMINE_VERIFICATION.** `forceFrom` matches a handler by name, so the
   machine suites that drive `--replan` probe with DETERMINE_VERIFICATION where they probed with
   ANALYZE, and the others probe with SLICE.
7. **Questions and research.** SLICE is handed no `open_questions`, since nothing is asked before
   it. A draft is still handed what the slices before it asked, and PRESENT reads no ANALYZE
   source. Planning research has no caller. `plan-research.ts` stays, with the tests that drive it
   directly, until PRDR-298 deletes it. The test of the pipeline's call site, PRDR-264's D-17
   suite, goes with the call site. X-1's site map names `init/audit` for
   `planning_research_tool_calls`, the one site that still reads it.
8. **The bootstrap** says "The decision log settles the stack, as X-n: language, on toolchain."
   where it credited ANALYZE. It already provided the entry's scaffold files, through ANALYZE's
   override (PRDR-282).
9. **The planner prompt** names three stages. In greenfield it says the stack is decided, and to
   plan on the entry and choose nothing about it. The assumptions clause and the sentence asking
   for planning research go.
10. **`PlanDeps.stack` is typed `WriteDeps["stack"]`**, since PLAN hands its deps to the writer.
    `plan.ts` sits at the 300-line limit, and a separate import would pass it.
11. **The mark is D-10″ (3.1.1)**, placed after D-10′ as X-3″ follows X-3′. Notes point to it
    from D-10′, C-3‴, C-8⁵, C-2¹¹, C-2¹², C-2¹³ and C-2¹⁴. C-8's AC, inherited from v2, names
    ANALYZE; D-10″ restates it in terms of the keys.

## Falsification (verification protocol, item 1)

The final test files were copied into a `git archive` of HEAD `00bf4c5` in the scratchpad and run
there, against HEAD's own fixtures, so the working tree was not touched. The files are the new
suite, `tests/init/fold-analyze.test.ts`, and the rewritten `tests/init/decide-plan.test.ts`. A
`diff -r` against a fresh archive shows the copy's `src/`, `prompts/` and `skills/` unchanged. The
new suite had first been run in the working tree before any source changed, with the same result
on its first twelve tests.

The new suite fails 13 of its 15 tests, each on what it tests:
- the phase list holds ANALYZE, and the prompt names four stages;
- on a conforming pack:
  - ANALYZE runs;
  - SLICE is handed `analysis` and no `stack`;
  - `test_single` does not bind;
  - the bootstrap credits ANALYZE;
- an existing project's SLICE is handed no `stack` key;
- nothing reads the parse, so an unreadable one plans on;
- a new project with no stack is asked for `test`;
- `--replan` enters at ANALYZE;
- ANALYZE's leftover checkpoint:
  - `init` says nothing, reuses DECIDE and removes nothing;
  - without WRITE in the pipeline, the stale checkpoint re-runs ANALYZE and four phases after it;
  - on a deferral, `init` says nothing either.

Two pass, as they should, both checks on what stays. At HEAD the README, the skill and
`INIT_PHASES` agreed on twelve phases, and the checker's stack rule is PRDR-279's and PRDR-280's.

The rewritten `decide-plan.test.ts` fails 6 of its 12 tests at HEAD, each an expectation ANALYZE's
removal moves:
- SLICE runs after DECIDE where ANALYZE did;
- SLICE and PLAN are handed the entry in a new project, and `stack: null` in an existing one;
- the reuse list has no ANALYZE.

Six pass. One is the new veto case: at HEAD ANALYZE re-ran on the edited log and
DETERMINE_VERIFICATION after it, so a veto re-bound there too. It stays because it is what kills
a DETERMINE_VERIFICATION key that forgets the entry (P05 below).

```
 ❯ tests/init/fold-analyze.test.ts (15 tests | 13 failed)
   × … > holds eleven phases, DECIDE before DETERMINE_VERIFICATION, and no ANALYZE
     → expected [ 'INIT_FS', 'DISCOVER', …(10) ] to deeply equal [ Array(11) ]
   ✓ … > is the list the README and the init skill give, in order, with its count in words
   × … > names three stages and, in greenfield, has the planner plan on the entry and choose nothing about it
     → expected 'You are the Planner (init pipeline; r…' to contain 'You serve THREE stages'
   × … > launches no session but SLICE's, PLAN's and the reviews', and greenfield reaches DETERMINE_VERIFICATION, SLICE and PLAN from code
     → expected [ Array(11) ] to not include 'ANALYZE'
   × … > hands SLICE and PLAN the stack entry the decision log records, and no analysis
     → expected { stage: 'SLICE', …(7) } to have property "stack" with value { decision: 'X-2', …(4) }
   × … > binds the entry's documented commands, test_single among them, where an analysis had five slots (PRDR-115)
     → expected [ [ 'test', 'pnpm test', …(1) ], …(1) ] to deeply equal [ [ 'test', 'pnpm test', …(1) ], …(2) ]
   × … > makes the bootstrap provide the entry's scaffold files, and says which decision settled the stack
     → expected 'Create the project scaffolding and es…' not to contain 'ANALYZE'
   × … > still reads an existing project's stack from the repository, and gives SLICE and PLAN none
     → expected { stage: 'SLICE', …(7) } to have property "stack" with value null
   × … > fails on a parse that will not read, rather than planning as if the project had no stack
     → promise resolved "{ exitCode: 2, …(8) }" instead of rejecting
   × … > stops DETERMINE_VERIFICATION for the stack, and names where the log records it
     → the stack, where a stack with no gate command asks for `test`: expected [ 'test' ] to deeply equal [ 'stack' ]
   × … > re-runs DETERMINE_VERIFICATION and every phase after it, and nothing of the specification phase
     → expected 'ANALYZE' to be 'DETERMINE_VERIFICATION' // Object.is equality
   × … > re-runs from DECIDE and says why, reads nothing the checkpoint holds, and retires it
     → the init says why: expected undefined to be defined
   × … > re-runs DECIDE whatever its own checkpoint says, and re-plans nothing where DECIDE moves no key, since it stands off the chain
     → no phase after DECIDE is forced: WRITE, which restarts the chain, is not in this pipeline: expected [ 'ANALYZE', …(4) ] to deeply equal [ 'DECIDE' ]
   × … > keeps the checkpoint while DECIDE does not complete, and says why again on the next init
     → expected undefined to be defined
   ✓ … > fails the checker, and the finding names the entry
 ❯ tests/init/decide-plan.test.ts (12 tests | 6 failed)
   ✓ … > shows each X-n with its reason, and names a planning question the log answers instead of asking it
   ✓ … > keeps a question the log does not answer, and lists no defaults when the log holds none
   ✓ … > hands the log to SLICE and to each slice's draft, whatever documents the slice names
   ✓ … > leaves a slice that names no documents to plan from every document, the log among them
   × … > replays a veto from DECIDE, never from AUDIT, and re-plans every slice until C-2⁸ narrows it
     → expected [ 'DECIDE', 'ANALYZE' ] to deeply equal [ 'DECIDE', 'SLICE' ]
   × … > hands SLICE and PLAN the entry, read from the log where WRITE wrote no pack, and the bindings follow it
     → expected undefined to deeply equal { language: 'TypeScript', …(4) }
   ✓ … > re-binds when a veto edits the entry's gate command in the log
   × … > hands SLICE and PLAN no stack, though the log records one, and binds what it discovers
     → expected { stage: 'SLICE', …(7) } to have property "stack" with value null
   × … > re-plans nothing when a code edit re-runs AUDIT and the items it leaves open are the same, in other words
     → expected [ 'INIT_FS', 'DISCOVER', …(6) ] to deeply equal [ 'INIT_FS', 'DISCOVER', …(5) ]
   ✓ … > re-runs DECIDE for an item whose key moved, and re-plans nothing when the log already settles it
   × … > re-plans when a new item is settled into the log
     → expected [ 'AUDIT', 'DECIDE', 'ANALYZE' ] to deeply equal [ 'AUDIT', 'DECIDE', 'SLICE' ]
   × … > refuses the re-plan a new entry would start while a ticket is in flight, and keeps what DECIDE recorded (C-8″)
     → expected 'ANALYZE' to be 'SLICE' // Object.is equality
 Test Files  2 failed (2)
      Tests  19 failed | 8 passed (27)
```

## Mutation battery (verification protocol, item 2)

The battery ran 29 mutants, one defect each, against the new suite and the suites beside it:
- the planning phases', against `decide-plan.test.ts`;
- the bindings', against `backhalf.test.ts` and `greenfield-bindings.test.ts`;
- the bootstrap's, against `plan-write.test.ts`;
- `isGreenfield`'s, against `stages.test.ts`;
- the site map's, against `tests/oracle/budgets.test.ts`.

A prompt mutant had its manifest rehashed, so the hash check could not kill it before the content
check did. Each file was restored from a snapshot, never by `git checkout`, and checked byte for
byte. The mutants covered:
- ANALYZE put back in `INIT_PHASES`, and `isGreenfield` never true.
- **The entry:**
  - handed to an existing project;
  - not read from the log where there is no parse;
  - read from the log where there is one;
  - an unreadable parse taken for no parse;
  - left out of DETERMINE_VERIFICATION's key and of SLICE's;
  - withheld from SLICE and from PLAN's drafts.
- **The bootstrap:** no scaffold file resolved, none provided, and no decision named.
- **The bindings:**
  - a missing stack asking for `test`, as at HEAD;
  - `test_single` dropped;
  - the documented gates ignored;
  - each stop's message without the section it names.
- **The machine:**
  - `--replan` entering at SLICE;
  - the retired checkpoint unsaid;
  - DECIDE not forced;
  - the chain forced after DECIDE;
  - the files kept, and the files removed before DECIDE completes.
- **The rest:**
  - the site map naming the pipeline;
  - the prompt without its greenfield sentence, and with the research sentence back;
  - the README and the skill counting twelve phases.

The first pass killed 26. Three survived:
- **M04**, the chain forced to replay after the DECIDE that takes over, was a gap. Every
  retired-checkpoint case ran a pipeline where WRITE follows DECIDE, and WRITE restarts the chain,
  so nothing could see the phases after DECIDE forced. The case whose DECIDE runs no session now
  runs the whole pipeline less WRITE and VALIDATE, and asserts that only DECIDE executes and that
  no planning session runs.
- **P03**, the entry read from the log on disk even where VALIDATE handed a parse, is equivalent.
  VALIDATE's parse is of the pack as VALIDATE left it, and nothing after it writes the log. A later
  edit moves the conformance record, so the next `init` re-validates and hands on a new parse. The
  parse and the log therefore never disagree where planning runs. The parse is read because it is
  what C-2¹⁴ hands on, and reading it is what refuses an unreadable one (P04).
- **P06**, the entry left out of SLICE's key, is equivalent. The decision log is among every
  planning document set (C-2¹²), so an edit to the entry moves SLICE's key through the documents'
  contents. The same holds for PLAN's key, which chains from SLICE's, and for each slice's cache
  key, which hashes the slice's documents, the log among them. The entry stays in all three: a key
  covers what its phase reads (P9).

The second pass ran M04, P03 and P06 against the new suite and `decide-plan.test.ts`. It killed
M04, and P03 and P06 survived again, as the equivalents they are. Every other mutant is killed: 26
in the first pass, and M04 in the second.

## What changed

- **`src/init/analyze.ts`**: deleted.
- **`src/init/greenfield.ts`** (new): `isGreenfield`.
- **`src/schemas/init.ts`**: ANALYZE is out of `INIT_PHASES`, and `analysisSchema` and
  `Analysis` are gone.
- **`src/init/pipeline.ts`**: ANALYZE's handler is gone, and `planningPack` and `planningStack`
  are new. DETERMINE_VERIFICATION, SLICE and PLAN key on and are handed `greenfield` and the entry.
- **`src/init/machine.ts`**: `REPLAN_FROM` is DETERMINE_VERIFICATION, and `RETIRED` handles the
  checkpoint an older build left.
- **`src/init/bind.ts`**: binds from the entry, stops for a missing stack, and names
  `## Packages` where it asks for a command.
- **`src/init/slice.ts`, `plan.ts`, `plan-slices.ts`, `plan-whole.ts`, `plan-write.ts`**: `stack`
  where `analysis` was. SLICE takes no `open_questions`, and the bootstrap reads the entry.
- **`src/init/present.ts`**: ANALYZE's questions are not read.
- **`src/init/decide.ts`**: `decidedStack` is gone.
- **`src/kernel/budgets.ts`**: the site map.
- **`src/init/audit.ts`, `write.ts`, `validate.ts`, `pack-parse.ts`, `session.ts`,
  `plan-research.ts`, `src/cli/init.ts`, `src/kernel/migrate.ts`, `scripts/self-build.ts`**:
  imports and doc-blocks.
- **`prompts/planner.md`**; `prompts/manifest.json` is regenerated.
- **`README.md`, `skills/init/SKILL.md`**: eleven phases, and what DETERMINE_VERIFICATION binds
  in a new project.
- **`detent-prd-v3.md`**: D-10″, and seven notes pointing to it.
- **`tests/oracle/parity.map.ts`**: the note on greenfield; `tests/oracle/PARITY.md` is
  regenerated.
- **PRDR-291, PRDR-292, PRDR-295 and PRDR-298**: a "From PRDR-290" section each.
- **Tests:**
  - `tests/init/fold-analyze.test.ts` (new, 15 tests): the phase list and its documents; the
    prompt; planning on a conforming pack and on an existing project; an unreadable parse; a
    missing stack; `--replan`; ANALYZE's leftover checkpoint; and the checker's stack rule.
  - `tests/init/decide-plan.test.ts`: the greenfield and existing-project cases rewritten, a veto
    of the entry added, and `withDecidedStack`'s two unit tests removed with it.
  - `tests/init/plan-fixture.ts` and `slicing-fixture.ts`: `ANALYSIS` gives way to `STACK`, and a
    scripted planner refuses an artifact it was not scripted for.
  - Moved off ANALYZE, each keeping its subject: `backhalf`, `bind-toolchain`, `config-defaults`,
    `contracts`, `greenfield-bindings`, `init-routing`, the four machine suites,
    `open-questions`, `plan-cache`, `plan-critic-sampling`, `plan-quality`, `plan-review-retry`,
    `plan-whole`, `plan-write`, `research-share`, `reset-hour`, `sizing-evidence`, `slicing`,
    `slicing-scale`, `stages`, `vacuous-gate`, `validate-plan` and `write-plan` under
    `tests/init/`, and `tests/cli/init.test.ts` and `tests/kernel/run.test.ts`.
  - Removed with their subject:
    - `stages.test.ts`'s five `analyzeStage` cases, and its case for research answering
      ANALYZE's question;
    - `research-batch.test.ts`'s case for research switched off, since ANALYZE printed that note.
      Its other two cases call `planResearch` directly;
    - `research-contract.test.ts`'s D-17 suite of four, whose call site is gone.

## Recorded, not fixed

- **P03 and P06 are equivalent mutants**, as the battery says. The keys that name the entry
  beside the log cost a hash, and keep the rule that a key covers what its phase reads.
- **`plan-research.ts` has no caller** in `src/`, and its tests drive it directly. PRDR-298
  deletes it, and its "From PRDR-290" section lists the tests that go with it.
- **Under `plan_docs`, a raw set has no parse.** Planning reads the entry from the log, and SLICE
  plans from the documents as before. PRDR-291's seed has nothing to seed from there, which its
  "From PRDR-290" section records.
- **No live run has planned on the entry.** The sessions are scripted, and the prompt's new
  sentence is pinned by a lock on its words.
- **The dated records stay as written.** The PRD's entries that name ANALYZE describe the code of
  their day, and the ones whose mechanism moved carry a note pointing to D-10″.
