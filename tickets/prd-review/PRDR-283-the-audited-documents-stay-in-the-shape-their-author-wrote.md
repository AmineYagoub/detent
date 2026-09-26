---
id: PRDR-283
title: "An audited and decided document set is still in the shape its author wrote: requirements without ids, criteria without values, decisions in prose. WRITE produces the pack in the fixed schema, moves the originals to `archive/`, and hands the pack, not the originals, to what follows"
state: DONE
severity: major
category: capability
labels: ["prd-review", "specification-phase", "operator-decision", "S-1′", "containment"]
surface: ["src/init/write.ts", "src/init/write-checks.ts", "src/init/write-tree.ts", "src/schemas/write.ts", "src/schemas/pack.ts", "src/init/pack.ts", "src/init/machine.ts", "src/init/replan-guard.ts", "src/init/pipeline.ts", "src/init/decide.ts", "src/init/audit.ts", "src/init/present.ts", "src/init/session.ts", "src/sessions/guard.ts", "src/init/discover-docs.ts", "src/kernel/migrate.ts", "src/schemas/init.ts", "src/init/decide-log.ts", "src/init/audit-claims.ts", "prompts/spec_write.md", "prompts/manifest.json", "detent-prd-v3.md", "README.md", "skills/init/SKILL.md", "tests/init/write.test.ts", "tests/init/write-plan.test.ts", "tests/init/write-checks.test.ts", "tests/init/machine-restart.test.ts", "tests/init/pack-written.test.ts", "tests/init/write-fixture.ts", "tests/init/plan-fixture.ts", "tests/init/decide-fixture.ts", "tests/init/pack-fixture.ts", "tests/init/machine.test.ts", "tests/kernel/migrate.test.ts"]
prd_refs: ["C-2‴", "C-2⁗", "C-2⁶", "C-2⁷", "C-2⁹", "C-2¹⁰", "C-2¹²", "C-2¹³", "C-8", "C-8″", "C-8‴", "C-8⁵", "D-10′", "F-3″", "F-4", "S-1′", "S-1″", "S-1‴", "S-5⁵", "X-1⁵", "PRDR-086", "PRDR-166", "PRDR-278", "PRDR-279", "PRDR-282", "PRDR-300"]
acceptance_criteria: ["WRITE reads the documents, AUDIT's checkpoint and the decision log, and writes the pack in PRDR-279's schema. Every decision and default the pack relies on is cited by id where it is used.", "The originals WRITE rewrote into the pack move to `archive/`, which no discovery glob reaches. Nothing is deleted. A document that is context in C-2⁹'s layout, a README or a runbook, stays where it is (PRDR-279).", "The pack states nothing unbuilt in the present indicative. Requirements use MUST and SHOULD.", "The planning phases read the pack: what DISCOVER's recorded patterns (PRDR-166) find once WRITE is done, the decision log among them, with the stack markers and the log's entries, which WRITE hands on whether it wrote or not. No phase runs twice under one name (F-4). Refined on 2026-09-26: VALIDATE's last step, which discovers the pack with those patterns and hands the checker's parse of it to the planning phases (PRDR-290), moved to PRDR-284, since VALIDATE is not built; until it is, WRITE makes the handoff.", "WRITE's session writes only the pack's paths. The containment hook enforces this, and the write surface is declared, as an implement session's is. Refined on 2026-09-26: `archive/` is code's, which moves each original there once it has checked the pack, so no session can overwrite what `archive/` holds (C-2¹³).", "A completed WRITE is a progress mark for the no-progress breaker (X-1⁵).", "A test drives WRITE with a stub session and asserts the move, the pack's shape, and that the next DISCOVER finds only the pack and its context documents.", "WRITE's session runs as the `spec_write` role (decision 15), routed to `claude-opus-5-5` at `max` (decision 14)."]
non_goals: ["Does NOT validate; VALIDATE does (PRDR-284).", "Does NOT rewrite a conforming pack (decision 6).", "Does NOT touch the project's code."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-279", "PRDR-282", "PRDR-284", "PRDR-290"]
depends_on: ["PRDR-279", "PRDR-282"]
---

# PRDR-283 — WRITE, and handing the pack to planning

## Where this came from

The ksarjs writing step turned an audited PRD and 68 decisions into 13 module PRDs, design
documents, ADRs and a facts file. It moved the original PRD to `archive/ksar-PRD-original.md`,
so nothing would plan from it. The brief that drove it is kept as `~/ksar-spec-tools/prd-brief.md`.

## Problem

After AUDIT and DECIDE, the documents are still in their author's shape. PLAN can only trace
what has an id, and review can only check a criterion that states values.

## Design

The plan's §3 and §4. Checkpoints are keyed by phase name (F-4), so DISCOVER cannot run a second
time. VALIDATE hands the planning phases the checker's parse of the pack, discovered with
DISCOVER's own recorded patterns, and a later `init` finds the conforming pack at DISCOVER.

WRITE is the first `init` session that writes documents. S-1′ gives `init` sessions a read-only
surface plus one write rule, so the pack's paths become a declared write surface, enforced by
the hook.

## From PRDR-282

DECIDE is built (C-2¹²), and four things in it are WRITE's to extend or change:

- **The role.** `spec_write` exists, on `prompts/spec_write.md`, with one task, `decide`, told by
  its inputs. WRITE adds its own task to that prompt. `toolsForRole` in `src/sessions/guard.ts`
  gives the role the read tools only, since DECIDE's session writes its artifact alone. Building
  the surface S-1‴ declares for the role (the log, the pack's paths and `archive/`) is WRITE's.
- **The log.** DECIDE's rows sit under `### Asked at DECIDE` and `### Settled at DECIDE` headings
  in each section of `docs/founder-decisions.md`, in the pack's grammar; code writes them, and a
  founder's rows are never rewritten. A founder's log whose ids are not `D-n`/`X-n` is read only
  by its raw ids: the grammar's parser refuses such rows, so C-3‴'s check and PRESENT's defaults
  do not see them. Making it a pack is WRITE's.
- **DISCOVER does not list the log**, and the planning phases add it themselves
  (`planningDocs` in `src/init/decide.ts`). WRITE's move of the originals to `archive/` must leave
  the log where it is.
- **The note.** On a changed pack, DECIDE says "Applying its change is WRITE's and checking it
  VALIDATE's, and this build has neither" (`decidePhase`). That becomes false the day WRITE lands.

## Building it

What building it settled, each recorded in the PRD as C-2¹³ and open to the operator's veto:

1. **Code moves the originals, and the session's surface leaves out `archive/`.** The fifth
   criterion gives the session the pack's paths and `archive/`. It gets the pack's paths alone,
   declared as its write surface beside its artifact, with Edit and Write and no Bash. Code moves
   each original the session rewrote to `archive/` once it has checked the pack, so no session can
   overwrite what `archive/` holds, and an original leaves its path only once its copy is there.
   S-1‴ is narrowed, and C-2¹³ says so.
2. **The artifact places the originals; code reads the rest by their bytes.** The session lists
   each original that is not at one of the pack's paths once: in `archive` if it rewrote it, in
   `context` if it stays. An original at the pack's paths is rewritten in place or left as it is,
   and code tells which against a snapshot taken before the session, archiving the original bytes
   of one it rewrote.
3. **A planning document is never context, and one the layout cannot hold never stays.** "A
   planning document by its name" is any C-2 discovery family but README's, read on the file's
   base name. A name inside `docs/research/`, `docs/design/`, `docs/adr/` or `docs/prd/` that the
   layout does not hold (C-2⁹) would leave the pack red wherever it stood, so it is archived.
4. **Strict, then repaired**, as AUDIT's survey and DECIDE are. The first attempt is refused for
   anything wrong: the lists, the log, a cite owed, no requirement, a blocking checker finding.
   The second keeps what stands: code archives a planning document or an unplaceable one the
   session kept, leaves where it is, as context, an original the session did not place, says each
   cite still owed, and records a red checker as red. Each decision code makes is said.
5. **Three failures fail the phase**: no requirement after the second attempt, no usable artifact
   after it, and a failed session. Each puts the pack's paths back as they were, the log among
   them, and archives nothing. There is then no pack to plan from, and planning the originals as
   if WRITE had not run would hide that.
6. **The log is append-only for WRITE.** The session may add `X-n` defaults, numbered from
   `next_default`, for what the documents leave open that DECIDE was not shown, and nothing else:
   no decision, since only the founder answers; no row or line changed; the stack as DECIDE left
   it. A rewrite that breaks this is undone, the log restored as DECIDE left it, before a relaunch
   too. The defaults WRITE adds reach PRESENT, listed and vetoable beside DECIDE's.
7. **What the pack must cite:** every entry DECIDE's record maps an open finding to, and every
   default the session added, by id, in the pack's own documents: not the log, which holds every
   entry by definition, and not a context document. An id is matched whole and as written, so
   `X-1` is not found in `X-10`, and a founder's id is escaped.
8. **The checker judges the pack as it will stand**, without the originals code will archive: an
   id only an archived original names refuses nothing.
9. **The record gains `validated`, required.** WRITE writes it `false`; VALIDATE is what will write
   `true`. A record that did not say would be read as whichever a reader guessed, so one without
   it is refused, and F-3″'s v1→v2 migration writes `true` into a v1 record, which could only have
   meant its pack was validated. The migration is extended in place, since the event is unreleased
   (PRDR-300).
10. **`written`, a fourth kind of pack.** Without it, the next `init` found WRITE's output in the
    pack's shape, classified it raw, and ran AUDIT, DECIDE and WRITE over it. DISCOVER calls a pack
    whose record is not validated `written`, whatever changed in it since, with what the checker
    blocks on in it now; AUDIT, DECIDE and WRITE run no session on it, and each says why.
11. **WRITE restarts C-8's chain.** On the chain, the move re-ran DISCOVER on the next `init`, and
    DISCOVER's re-run re-planned a product nothing had changed. The machine gains `restartsChain`:
    the phase is keyed by its own digest alone, looked up while earlier phases replay, and the
    phases after it chain from its key. WRITE is keyed after it runs, as DECIDE is. Its digest
    reads the disk alone, and never the prompt: once the pack is written a new prompt writes
    nothing, and a key that named it would re-plan every written pack on an upgrade.
12. **The in-flight guard walks past a miss.** C-8″'s scan resumes at a phase that restarts the
    chain when its key stands, since the phases between cannot be read after a miss (P9). The
    second ask is not made before a phase ahead of WRITE, whose re-run replays nothing past it,
    and is made before WRITE runs.
13. **The handoff is WRITE's in this build.** The fourth criterion gives it to VALIDATE's last
    step, which is not built. WRITE hands on what DISCOVER's patterns find once it is done, the log
    among them, with the stack markers and the log's entries, whether it wrote or not, and the
    planning phases read them (`planningDocs`, `planningMarkers`, PRESENT). The markers travel
    through WRITE because after DISCOVER's re-run the scan cannot read DISCOVER's outputs, and a
    planning digest that read them would make every re-init look like a re-plan. The criterion's
    VALIDATE half, the checker's parse of the pack discovered with DISCOVER's patterns, moves to
    PRDR-284, with the parse's reader PRDR-290.
14. **WRITE writes nothing on a conforming pack** (decision 6), **on a changed or a written pack**
    (VALIDATE's, not built), **or on a set `plan_docs` narrows:** a pack is written from the whole
    set, and archiving part of it would leave a mixed tree. Each case is said, and planning reads
    the documents as they are.
15. **One role, two tasks.** `prompts/spec_write.md` gains the `write` task beside `decide`, as
    `prompts/audit.md` holds two. DECIDE's session keeps its artifact alone: only a launch that
    declares a surface gets Edit and Write (`InitSessionRequest.surface`).
16. **`spec_write` is not stop-gated. Found here.** The live backend binds the project's test
    command as the stop gate of every role outside `READ_ONLY_STAGES`, and `spec_write` has been
    outside it since PRDR-282: a re-init of a bound project whose tests are red told DECIDE's
    session, which cannot touch code, that it could not end. `DOCUMENT_STAGES` exempts it.
    `READ_ONLY_STAGES` was not the place: `toolsForRole` reads it for the read tools.
17. **The planning suites leave WRITE out.** The seventeen suites that plan from their fixtures'
    raw documents, and DECIDE's planning suite, run the pipeline without WRITE
    (`planningPipeline`), which is the path planning takes wherever WRITE writes nothing. What the
    planning phases read from WRITE is `write-plan.test.ts`'s.
18. **The third criterion is met by the schema and the instruction together.** MUST and SHOULD are
    the schema's, which blocks. "Nothing unbuilt in the present indicative" is the session's
    instruction and the checker's heuristic, which reports and never blocks (C-2¹⁰); nothing
    refuses a pack for it.

## Falsification (verification protocol, item 1)

The new test files and `migrate.test.ts`, whose pin moved, were run against HEAD `ecbe314` in a copy
made with `git archive`, so the working tree was not touched. The final test files were copied
in after the battery below, so the tests it added are in this run. `write.test.ts` cannot load
at HEAD. Its one test that reads only HEAD's modules, the stop gate's, ran there as a probe file
of its own.

```
 ❯ tests/init/probe-stop-gate.test.ts (1 test | 1 failed)
   × is never stopped by the product's gate, since it writes documents and not code
     → expected 'block' to be 'allow' // Object.is equality
 ❯ tests/init/pack-written.test.ts (5 tests | 5 failed)
   × … the record says whether the pack was validated > carries validated, as WRITE writes it and as VALIDATE will, and refuses a record that does not say
     → expected undefined to be false // Object.is equality
   × … DISCOVER calls a pack nothing has validated written > whatever its record's checker said, and counts what the checker blocks on in it now
     → docs/conformance.json is invalid: <root>: Unrecognized key: "validated"
   × … stays written after an edit, which VALIDATE's first run checks with the rest, and counts a break it makes
     → docs/conformance.json is invalid: <root>: Unrecognized key: "validated"
   × … is a kind DISCOVER's checkpoint holds (F-3)
     → expected false to be true // Object.is equality
   × … says so at DISCOVER: written by WRITE, not validated, and what the checker blocks on
     → Cannot read properties of undefined (reading 'length')
 ❯ tests/init/machine-restart.test.ts (7 tests | 7 failed)
   × … is looked up while an earlier phase replays, and the phases after it are reused when its key stands
     → expected [ 'INIT_FS', 'DISCOVER', …(2) ] to deeply equal [ Array(5) ]
   × … without the flag, DISCOVER's re-run replays it and every phase after it
     → the defect this flag exists for: the move re-planned the product: expected [] to deeply equal [ Array(4) ]
   × … re-runs when its checkpoint is gone, and the phases after it are reused when the key it leaves is the one they chained from
     → ENOENT: no such file or directory, lstat '…/.detent/state/WRITE.json'
   × … replays every phase after it when the pack it keys by is edited
     → expected [ 'DISCOVER', 'ANALYZE', 'PLAN' ] to deeply equal [ 'WRITE', 'ANALYZE', 'PLAN' ]
   × … leaves a --replan to re-derive from ANALYZE, which comes after it (C-8′)
     → expected [ 'INIT_FS', 'DISCOVER' ] to deeply equal [ 'INIT_FS', 'DISCOVER', 'WRITE' ]
   × … asks again before it runs, when a phase off the chain moved what it reads since the scan (C-8″)
     → expected +0 to be 2 // Object.is equality
   × … is passed by the in-flight scan: a drift before it under a key that stands is no re-plan (C-8″)
     → expected [] to deeply equal [ 'DISCOVER' ]
 ❯ tests/init/write-plan.test.ts (6 tests | 6 failed)
   × … hands ANALYZE and SLICE the pack and its context documents, never an original it archived
     → expected [ 'PRD.md', 'README.md', …(2) ] to deeply equal [ 'README.md', …(4) ]
   × … re-plans nothing on the next init, though DISCOVER finds the pack where the originals were
     → expected [] to deeply equal [ 'DISCOVER', 'AUDIT', 'DECIDE' ]
   × … re-runs WRITE without a session for an edit to the pack, and replays the planning phases from it
     → ENOENT: no such file or directory, open '…/docs/prd/01-lending.md'
   × … re-runs WRITE, and the planning after it, for a stack marker added since, which WRITE hands on
     → expected [ 'DISCOVER', 'AUDIT', 'DECIDE', …(5) ] to deeply equal ArrayContaining{…}
   × … lets the next init through while a ticket is in flight: DISCOVER's re-run re-plans nothing, and the scan sees it (C-8″)
     → expected [] to deeply equal [ 'DISCOVER', 'AUDIT', 'DECIDE' ]
   × … presents a default WRITE added to the log beside DECIDE's, vetoable like them (C-3⁗)
     → expected 'Plan ready for approval.\n\nVerificat…' to contain 'Defaults (4)'
 ❯ tests/kernel/migrate.test.ts (23 tests | 1 failed)
   × … carries a conformance record where there is no `.detent/`, and creates none
     → expected { schema_version: 2, …(1) } to deeply equal { schema_version: 2, …(2) }   (- "validated": true)
   ✓ … PRDR-283: keeps what an older record already says about its validation
 FAIL  tests/init/write-checks.test.ts Error: Cannot find module '../../src/init/write-checks.js'
 FAIL  tests/init/write.test.ts        Error: Cannot find module '../../src/schemas/write.js'
      Tests  20 failed | 22 passed (42)
```

What each says:
- **The WRITE suites do not load.** The modules they drive do not exist, and that is the defect:
  nothing writes the pack, nothing archives an original, and the documents reach planning in
  their author's shape. The battery below shows each of their tests biting.
- **The probe:** at HEAD the stop gate runs the project's test command when a `spec_write`
  session ends, and blocks it on red. DECIDE's session, which cannot touch code, could not end on
  a bound project whose tests are red (building call 16).
- **`pack-written.test.ts`:** the record has no `validated`, and a record that says it is
  refused. There is no `written` kind either, so a pack WRITE wrote would be read as a raw set,
  and AUDIT, DECIDE and WRITE would run over it.
- **`machine-restart.test.ts`:** at HEAD WRITE is not one of `INIT_PHASES`, so the machine never
  runs a handler for it, and every test fails on that before it reaches the restart. The
  `--replan` test's log, `ANALYZE` then `PLAN`, already holds at HEAD: it pins `--replan`'s
  behaviour, and fails there only because WRITE is not among the phases reused. Mutants 1 to 11
  below falsify the restart itself, with WRITE a phase. Each puts one part of the machine or the
  scan back as HEAD has it, and each fails these tests.
- **`write-plan.test.ts`:** the planning phases read the originals (`PRD.md` among what ANALYZE
  is handed). Nothing is written or archived, and PRESENT lists no default WRITE added.
- **`migrate.test.ts`:** a v1 record is carried to v2 without `validated`, which the v2 schema
  then refuses. The PRDR-283 test that passes pins the migration against overwriting what a
  record already says. HEAD's migration writes no `validated` at all, so the test passes there;
  mutant 85 shows it biting.

## Mutation battery (verification protocol, item 2)

97 mutants, one defect each, run against 12 files: the five new test files, and the migration,
DECIDE, AUDIT, machine, keyed-machine, DECIDE-planning and pack suites. Each file was restored
from a snapshot copy, never by `git checkout`, and its hash checked. The first run killed 90.
Seven survived. Six were real gaps, and the tests grew to cover each; re-run, all six are
killed:
- **10 and 11**, the scan never predicting a re-plan at PLAN, or never missing: the in-flight
  test's refusal also comes from the second ask, so it could not tell which ask refused. It now
  asserts that nothing was looked up before the refusal.
- **28**, the missing requirement not said to the relaunch: the test asserted only the failure,
  and now asserts what the relaunch is told.
- **39**, the artifact not cleared before a launch: a new test has the first attempt's artifact
  refused and the relaunch write none. That must fail, not read the first attempt's.
- **46**, WRITE's note on a written pack lost: a new test edits the pack WRITE wrote, and asserts
  what WRITE says when it re-runs over it.
- **68**, a cite matched after a word character: the test now asserts that `TX-1` is not a cite of
  `X-1`.

The seventh, **47**, was equivalent. WRITE's phase filtered the decision log out of DISCOVER's
documents, which never list it (C-2¹², PRDR-282), so no test could see the filter. It is
removed, and `WriteStageDeps.documents` now says why the log is never among the originals. A new
test covers the path the filter seemed to guard: after a failed WRITE, the next `init` runs WRITE
alone, from the same originals, and archives nothing of DECIDE's log. 96 of the 97 are killed.
The code of the 97th is gone.

The mutants cover:
- **the machine:** a restart keyed on the chain, not looked up while earlier phases replay, or
  not ending the replay when it is reused or runs; the second ask made without regard to a
  restart;
- **the in-flight scan:** `replansAt` asking past PLAN, or at the restart itself; the scan keying
  a restart on the chain, stopping at the first miss, never re-planning at PLAN, or never missing;
- **the phase:**
  - `plan_docs` not skipped, or an empty one narrowing;
  - the digest without the markers, the contents or `plan_docs`;
  - the handoff without the log, unsorted, or without the markers or the defaults;
  - always strict, or strict only on two issues;
  - no requirement not fatal, or not said;
  - the log not restored;
  - added defaults or settling entries never owed;
  - the checks reading archived originals;
  - the checker's, the log's, the lists' or the cites' issues dropped;
  - the record saying validated;
  - the owing, list and red-checker notes dropped;
  - no progress mark; no rollback; the artifact not cleared;
  - `settled_by`, the claims or the pack's paths not given, or the next default a `D`;
  - no surface declared;
  - the conforming and written notes lost;
- **the checks:**
  - a path the layout does not hold not movable; a README a planning name;
  - each list issue not refused: twice, not given, the log, planning context, archived and
    rewritten, unlisted;
  - a planning document kept as context; a rewrite not archived; a dropped pack document, or a
    context document listed in archive, left in place; the unlisted note dropped;
  - the line check never failing; a changed row, an added decision or a stack change not
    refused; the line issue added on top of the row issues;
  - a cite in the log or in a context document counted; the cite unbounded before or after; the
    id unescaped;
  - a refused requirement not held; the heuristic refusing;
- **the tree:** new directories, new files or changed files kept on rollback; `archive/`
  overwritten; a rewritten document archived as rewritten; the originals not snapshot;
- **the record and the migration:** an unvalidated record never called written; the blocking
  count never counted, or unsaid; the record always validated, or allowed not to say; `blocking`
  optional; the migration overwriting `validated`, or dropping the transform;
- **the session and the gate:** no Edit or Write for a surface; the surface not in the policy;
  `spec_write` stop-gated;
- **the planning phases:**
  - PRESENT reading DECIDE's log; WRITE unregistered;
  - ANALYZE's or DETERMINE_VERIFICATION's digest reading DISCOVER's markers;
  - `planningDocs` or `planningMarkers` ignoring WRITE's;
  - DECIDE's and AUDIT's notes on a written pack lost.

## What changed

- **`src/init/write.ts`** (new): the phase.
  - `writePhase`: restarts the chain, keyed after it runs, by `writeDigest`, from the disk alone.
    On a pack, or a set `plan_docs` narrows, it writes nothing and says why; on a raw document set
    it runs `writeStage` in one journal, as the `spec_write` role, with the pack's paths as the
    session's surface.
  - `writeStage`: the snapshot, the session with one relaunch, `evaluate`'s checks, the rollback
    on failure, and `apply`: the archive, the record, the notes and the progress mark.
  - `handoff`, what the phases after WRITE read, and `planningMarkers`; `writeSkeleton` and
    `writeArtifactPath`, cleared before each launch (D-19).
- **`src/init/write-checks.ts`** (new): `resolveLists`, the artifact's lists and where each
  original goes; `logIssues`; `citeIssues`; `holdsRequirement`; `checkerIssues`.
- **`src/init/write-tree.ts`** (new): `snapshot`, `rollback`, `changedSince`, `restoreFile`,
  `packPathFiles` and `archiveOriginal`, which never overwrites `archive/`.
- **`src/schemas/write.ts`** (new): the artifact.
- **`src/schemas/pack.ts`**: `PACK_PATHS`; the record's `validated`; the `written` status.
- **`src/init/pack.ts`**: `RecordParts.validated`; `classifyPack` and `packNote` for `written`.
- **`src/init/machine.ts`**: `PhaseHandler.restartsChain`, and the loop that honours it.
- **`src/init/replan-guard.ts`**: `wouldReplan` walks past a miss to a phase that restarts the
  chain; `replansAt` takes the handlers.
- **`src/init/pipeline.ts`**: WRITE after DECIDE; ANALYZE and DETERMINE_VERIFICATION read the
  markers through `planningMarkers`; DISCOVER's doc-block.
- **`src/init/decide.ts`**: `planningDocs` reads WRITE's documents first; DECIDE's notes on a
  written and a changed pack. **`src/init/audit.ts`**: its note on a written pack.
- **`src/init/present.ts`**: the log's entries as WRITE left them.
- **`src/init/session.ts`**: `InitSessionRequest.surface`. **`src/sessions/guard.ts`**:
  `DOCUMENT_STAGES`, and `toolsForRole`'s doc-block.
- **`src/init/discover-docs.ts`**: `docPatternsFor`, moved from `pipeline.ts`, and
  `PLANNING_NAMES`. **`src/kernel/migrate.ts`**: `validated` in the v1→v2 entry.
- **`src/schemas/init.ts`**: WRITE in `INIT_PHASES`.
- **Doc-blocks made true:** `decide-log.ts`'s `LogView.ids`, `audit-claims.ts`'s `checkClaims`,
  `audit.ts`'s header, `session.ts`'s S-1′ comment, `machine.ts`'s header and `REPLAN_FROM`.
- **The prompt:** `prompts/spec_write.md` gains the `write` task; `prompts/manifest.json`.
- **Docs:** `detent-prd-v3.md` C-2¹³, with pointers on C-2⁶, C-2⁷, C-2⁹, C-2¹², S-1″, S-1‴, C-8‴
  and C-8″; the README and `skills/init/SKILL.md` name the eleven phases and say what WRITE does.
- **Other tickets:** PRDR-284 and PRDR-290 each gain a "From PRDR-283" section, and PRDR-284 the
  fourth criterion's VALIDATE half.
- **Tests:**
  - new: `tests/init/write.test.ts`, `write-plan.test.ts`, `write-checks.test.ts`,
    `machine-restart.test.ts` and `pack-written.test.ts`; `tests/init/write-fixture.ts`;
  - `tests/init/plan-fixture.ts`: `planningPipeline`, which the seventeen planning suites now
    build; `decide-fixture.ts`'s `initThrough` leaves WRITE out with `all`;
  - pins moved: the phase order (`machine.test.ts`), the record's `validated` (`pack-fixture.ts`,
    `pack.test.ts`, `audit.test.ts`, `decide.test.ts`, `migrate.test.ts`), DECIDE's changed-pack
    note (`decide.test.ts`), the role's tools (`decide-items.test.ts`), and a v1 record migrated
    (`migrate.test.ts`, with one new test).

## Recorded, not fixed

- **A red checker blocks nothing until VALIDATE is built.** C-2⁷ says a red checker blocks every
  phase after VALIDATE; with no VALIDATE, the pack reaches planning, its record says red, and
  DISCOVER says the blocking count at every `init`.
- **An edit to a written pack is neither audited nor validated.** AUDIT, DECIDE and WRITE skip a
  written pack, and VALIDATE, whose first run checks all of it, is not built. DISCOVER names a
  written pack's date and blocking count, not what changed in it.
- **One session writes the whole pack.** ksarjs's pack is 13 module PRDs, design documents, ADRs
  and a facts file. Whether one session writes a pack that size inside its turns is untested; a
  pack written module by module is not built.
- **A founder's log in another shape stays as it is.** WRITE only adds defaults to it, so rows the
  grammar refuses leave the checker red, which VALIDATE fixes first (C-2⁶).
- **Rows added under `## Packages` are not refused.** The log check reads the ids of
  `## Decisions` and `## Defaults`, the stack and every line the log held, not where an added line
  goes. A decision and a stack are refused; a package row passes.
- **`plan_docs` keeps a project raw.** A set it narrows is never written, so such a project
  plans from its documents as written until `plan_docs` is dropped.
- **The planning suites plan raw documents.** They leave WRITE out (building call 17), and
  `write-plan.test.ts` holds what planning reads from WRITE; once planning reads the checker's
  parse (PRDR-290), their fixtures need packs.
- **A fifth copy of the artifact reader.** `readWritten` repeats what `readSurvey`, `readDecide`,
  the claim reader and planning research's reader each do. Sharing one reader is a change to four
  built phases, not this ticket's.
- **Each phase's spend beside planning's** (C-2⁶, decision 16) is built for none of AUDIT, DECIDE
  and WRITE. All three are on the ledger against ticket `init`, as every init session is.
