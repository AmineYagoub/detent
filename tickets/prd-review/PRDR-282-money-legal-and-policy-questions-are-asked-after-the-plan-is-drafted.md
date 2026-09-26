---
id: PRDR-282
title: "C-3′ asks every question once, at PRESENT, after the whole plan is drafted on assumptions. For a decision counted in money or contracts, every slice resting on it is drafted, reviewed and cached before the founder sees it. DECIDE asks those questions once, early, on a TTY; settles every other gap as a vetoable default; and, off a TTY, takes every recommended answer"
state: DONE
severity: major
category: capability
labels: ["prd-review", "specification-phase", "operator-decision", "C-3′", "C-3″", "AWAIT_INFO", "headless"]
surface: ["src/init/decide.ts", "src/init/decide-items.ts", "src/init/decide-log.ts", "src/init/decide-notes.ts", "src/init/replan-guard.ts", "src/init/machine.ts", "src/init/pipeline.ts", "src/init/analyze.ts", "src/init/slice.ts", "src/init/present.ts", "src/init/audit.ts", "src/init/retry.ts", "src/schemas/decide.ts", "src/schemas/init.ts", "src/schemas/roles.ts", "src/sessions/guard.ts", "src/kernel/migrate.ts", "src/cli/decide.ts", "src/cli/init.ts", "prompts/spec_write.md", "prompts/manifest.json", "detent-prd-v3.md", "README.md", "skills/init/SKILL.md", "tests/init/decide.test.ts", "tests/init/decide-plan.test.ts", "tests/init/decide-items.test.ts", "tests/init/decide-log.test.ts", "tests/init/decide-fixture.ts", "tests/init/machine-keyed.test.ts", "tests/cli/decide.test.ts", "tests/cli/init-decide-tty.test.ts"]
prd_refs: ["C-2⁶", "C-2⁷", "C-2¹¹", "C-2¹²", "C-3′", "C-3″", "C-3‴", "C-3⁗", "C-5", "C-7", "C-8", "C-8″", "C-8‴", "C-8⁵", "C-14′", "D-10′", "D-26", "F-3″", "S-1″", "S-1‴", "S-5⁵", "X-1⁵", "PRDR-119", "PRDR-166", "PRDR-207", "PRDR-278", "PRDR-281"]
acceptance_criteria: ["DECIDE reads AUDIT's checkpoint and sorts every open item. A C-3″ (PRDR-119) question is asked. Everything else is settled as a vetoable default `X-n`, with its value and its reason.", "On a TTY the questions come in screens of at most four. Each lists its recommended option first, and each option states its consequence. The answers are written to `docs/founder-decisions.md` as `D-n` entries with the question, the answer and the reason.", "The stop raises AWAIT_INFO at DECIDE. The interrupt set stays C-5's five, and `INTERRUPT_PHASE` records every phase AWAIT_INFO may be raised at.", "Off a TTY, DECIDE never stops. It takes every recommended answer, logs each as a vetoable `X-n`, and says so in `init`'s output (decision 9).", "A question the decision log already answers is never asked, in any words (C-3‴, PRDR-207).", "An answer changes the decision log, and the next `detent init` replays from DECIDE forward and never re-runs AUDIT (C-8).", "PRESENT lists every `X-n` with C-3′'s assumptions. A veto is an edit to the log: it replays DECIDE forward, and only the slices whose inputs changed are re-planned.", "In greenfield, DECIDE also records the stack, as PRDR-290 specifies, since ANALYZE is folded into it.", "DECIDE's session runs as the `spec_write` role, reading and writing the pack (decision 15), routed to `claude-opus-5-5` at `max` (decision 14). The role joins PRDR-281's `schema_version` event."]
non_goals: ["Does NOT add an interrupt. A sixth would be a new decision class, which C-14′ makes a major-version decision.", "Does NOT ask engineering questions. Anything a competent engineer could settle is settled and recorded (C-3″).", "Does NOT write the pack; WRITE does (PRDR-283)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-117", "PRDR-119", "PRDR-207", "PRDR-281", "PRDR-283", "PRDR-284", "PRDR-290", "PRDR-291", "PRDR-298"]
depends_on: ["PRDR-278", "PRDR-281"]
---

# PRDR-282 — DECIDE

## Where this came from

The ksarjs founder decisions came after the audit and before any writing: 68 decisions (D1–D66,
D32a and D52a), asked in rounds of at most four with the recommended option first, and 35
vetoable defaults (X1–X35), each recorded in `founder-decisions.md` with its reason. Nothing was
written on a guess about money or law.

## Problem

C-3′ asks every question once, at PRESENT, after the whole plan is drafted on assumptions. That
is right for a question an assumption can carry cheaply. It is wrong for one whose answer is
counted in money or contracts (C-3″, PRDR-119). Every slice resting on that assumption is
drafted, reviewed and cached before the founder sees it, and an overturned answer re-plans every
slice whose inputs it touched (C-8).

## Design

The plan's §6. The stop raises AWAIT_INFO at DECIDE, so the five interrupts stay closed (C-5)
and C-14′'s freeze holds. The answers land in the decision log, where the next `detent init`
reads them (PRDR-166), and the replay starts at DECIDE. Off a TTY, the recommended answers are
taken and logged as vetoable (decision 9). PRESENT then treats them exactly as it treats C-3′'s
assumptions.

## From PRDR-281

AUDIT is built (C-2¹¹), and three things in it are DECIDE's to change when DECIDE lands:

- **The checkpoint.** DECIDE reads `.detent/state/AUDIT.json`'s outputs: `ran`, and when it is
  true `contradictions`, `gaps`, `drift`, `claims` (each with `verdict`, `source`, `correction` and
  `checked`), `dropped`, `unread` and `research`. A claim with `checked: false` was never checked,
  and reads as unverified.
- **The digest.** AUDIT is a standalone phase: running it replays nothing after it, so a phase that
  reads its outputs names them in its own digest. DECIDE's digest must cover AUDIT's outputs, or a
  re-run AUDIT leaves DECIDE's checkpoint standing.
- **The note.** `auditNotes` in `src/init/audit.ts` says "No phase reads them yet; planning goes on
  from the documents as written", and its doc-block says nothing reads the checkpoint. Both become
  false the day DECIDE reads it.

## Building it

What building it settled, each recorded in the PRD as C-2¹² and open to the operator's veto:

1. **The prompt is `prompts/spec_write.md`,** not the `prompts/decide.md` this ticket's surface
   named. Prompts are per role (`loadPromptSet` reads `prompts/<role>.md` for each role id), and
   decision 15 gives DECIDE, WRITE and VALIDATE's fixes one role, told its task by its inputs as
   AUDIT's two tasks are. The prompt has one task, `decide`; WRITE's and VALIDATE's join it when
   they are built.
2. **Code writes the log.** The session writes an artifact of questions, defaults and cited
   entries, each naming the items it settles by the ids its inputs gave them. Code checks it and
   writes the log in the pack's grammar (C-2⁷), so every row it adds is one the checker reads,
   and no row the founder wrote is touched. S-1‴ declares the log, the pack's paths and
   `archive/` as `spec_write`'s to write. Nothing grants that yet, and DECIDE needs none of it:
   its session keeps S-1″'s one artifact.
3. **Asked inline on a terminal; AWAIT_INFO when answered later.** This is C-7's pattern: a
   terminal is asked in place, and the interrupt is what `init` returns when the decision is not
   made there. Off a terminal, decision 9 takes the recommended answers, so AWAIT_INFO at DECIDE
   comes only from a founder who chose to answer later. The plugin's path has no terminal, so it
   takes the defaults, which PRESENT lists for veto.
4. **`INTERRUPT_PHASE` is the rule.** The third criterion asks that it record every phase
   AWAIT_INFO may be raised at. It now lists phases per interrupt, and the machine refuses an
   interrupt raised at a phase its list does not name, so the record cannot drift from what
   runs. PRDR-166's note, that the document set is unchanged, is now PRESENT's alone.
5. **DISCOVER no longer lists the log.** DECIDE writes it, and in DISCOVER's listing its first
   write would have replayed DISCOVER, and every phase after it, on the next `init`. The planning
   phases add it to what they read themselves, from disk (`planningDocs`).
6. **DECIDE is keyed after it runs.** It writes the log its digest reads. Keyed before, its own
   write would re-run it, and everything after it, on every later `init`. The machine gains
   `keyedAfterRun`: the checkpoint is keyed by the digest taken after the phase runs.
7. **DECIDE stands off the chain, keyed by the items.** The first build put DECIDE on C-8's chain
   with a digest over AUDIT's outputs, as PRDR-281's note asked. Review of that build found the
   flaw: a code edit re-runs AUDIT by design, a re-run survey never repeats its words, and the
   chain would then have re-planned the product for every code edit, which is what C-2¹¹ made
   AUDIT standalone to prevent. DECIDE is now standalone beside AUDIT, and its digest covers the
   keys of the items AUDIT left open, not AUDIT's words. A re-run DECIDE re-plans only through
   the log, which the planning phases read in their own digests.
8. **The in-flight refusal is asked twice.** With DECIDE off the chain, a phase can change what
   planning reads during the run, which C-8″'s scan before the run cannot see. The refusal is now
   asked again as each phase on the chain up to PLAN is about to run, and it reports what ran
   before it. The guard moved to `src/init/replan-guard.ts`, which keeps `machine.ts` within its
   300 lines.
9. **The record.** `.detent/state/decide-record.json` maps each item DECIDE sorted, by a content
   key, to the entry that settled it. A run whose items are all still settled by entries the log
   holds runs no session: an answer or a veto edits an entry and leaves it standing. It also
   keeps the last session's checked artifact with the key of its inputs, so questions deferred
   on a terminal are asked again without a session while those inputs stand.
10. **Item keys** are made of what a second survey of the same documents most likely repeats: a
    contradiction's quoted passages; a drift finding's passage and the code it checked; a claim's
    hash, verdict and correction. A gap, often a silence, has only its topic, which a survey can
    reword. A reworded gap costs one DECIDE session, which cites the entry that settled it, and
    nothing re-plans. Every place one claim is relied on is one item.
11. **Strict, then repaired**, as AUDIT's survey is: the first attempt is refused for anything
    wrong, so the relaunch hears all of it, and the second keeps what stands. An item it leaves
    unsorted is said, and planning goes on from the documents as written for it.
12. **A question the log answers** is refused in C-3‴'s words (`similarQuestions`), and its items
    are cited as settled by the entry that answers it, so they are not left unsorted.
13. **The stack.** Only the stack's settler carries a stack entry: a default, or a question whose
    every option carries one, and which takes no answer in the founder's own words. It is written
    as `## Stack` and the root package's `## Packages` rows, only for slots the log does not
    already declare, and never when the log has a `## Stack`. Until PRDR-290 removes ANALYZE, the
    entry reaches the bindings through it: code writes the entry over the stack ANALYZE's session
    chose, keeping what the session wrote only where it wrote the decided language, since a
    session that chose another stack wrote its commands for that one. `test_single` stays in the
    log and out of the analysis, whose schema has no such slot.
14. **Every slice reads the log,** whatever documents the slice names, since a row there wins over
    the documents it settles. A slice that names none plans from every document, the log among
    them. So a veto re-plans every slice until PRDR-291 keys slices by requirement ids.
15. **PRESENT lists every `X-n` the log holds**, the founder's own included, each with its reason,
    and names each planning question the log's decisions already answer rather than asking it.
16. **Reasons.** An answered question's `D-n` gives the chosen option's consequence as its reason,
    or says the answer is the founder's own. A recommended answer taken off a terminal becomes an
    `X-n` whose reason quotes the question, cites decision 9 and gives the consequence.
17. **Packs.** On a conforming pack DECIDE runs no session: its log is the founder's record
    already. On a changed pack it runs none either, and says that WRITE and VALIDATE, which would
    apply and check the change, are not built.
18. **`refusedAttemptInput`** moved from `audit.ts` to `retry.ts`, shared by AUDIT and DECIDE: both
    refuse an artifact for what it says, not only for its shape.

## Falsification (verification protocol, item 1)

The new test files and the machine and AUDIT suites whose pins moved, run against HEAD `843aff1`
in a copy made with `git archive`, so the working tree was not touched. `init-decide-tty.test.ts`
was written after this run; the battery below shows it biting.

```
 ❯ tests/init/machine-keyed.test.ts (8 tests | 7 failed)
   × … a phase keyed after it runs > is reused on the next init though it wrote what its digest reads, and so is every phase after it
     → expected [ 'INIT_FS', 'DISCOVER', …(2) ] to deeply equal [ 'INIT_FS', 'DISCOVER', …(3) ]
   × … re-runs, and replays what follows, when anyone else edits what its digest reads
     → expected [] to deeply equal [ 'DECIDE', 'ANALYZE', 'PLAN' ]
   × … without the flag is keyed before it runs, as every other phase is, and its own write re-runs it
   × … an interrupt is raised only where INTERRUPT_PHASE lists it > refuses AWAIT_INFO from a phase it does not list, as a defect in the build
     → promise resolved "{ exitCode: 2, …(7) }" instead of rejecting
   × … stops at DECIDE for AWAIT_INFO, checkpoints nothing for it, and adds PRDR-166's note to PRESENT's alone
     → expected 'READY' to be 'DECIDE'
   ✓ … still says so at PRESENT when DISCOVER was reused (PRDR-166)
   × … a re-plan a standalone phase starts is refused while a ticket is in flight > stops before the first phase on the chain that would run, and says what ran before it
     → expected +0 to be 2
   × … lets it through when nothing is in flight
 ❯ tests/init/machine.test.ts (19 tests | 2 failed)
   × T-060 C-5: the interrupt set is closed > exactly five interrupts, each anchored to the phase that may raise it
   × T-060 C-5: the interrupt set is closed > the phase order is C-4.1's, as C-2⁶ amends it
 ❯ tests/init/audit.test.ts (31 tests | 1 failed)
   × PRDR-281: what re-runs AUDIT > does not re-run for a decision log DECIDE writes, and neither does DISCOVER
     → expected [ 'INIT_FS', 'AUDIT' ] to include 'DISCOVER'
 FAIL  tests/cli/decide.test.ts        Error: Cannot find module '../../src/cli/decide.js'
 FAIL  tests/init/decide-items.test.ts Error: Cannot find module '../../src/init/decide-items.js'
 FAIL  tests/init/decide-log.test.ts   Error: Cannot find module '../../src/init/decide-log.js'
 FAIL  tests/init/decide-plan.test.ts  Error: Cannot find module '../../src/init/decide-log.js'
 FAIL  tests/init/decide.test.ts       Error: Cannot find module '../../src/init/decide-log.js'
      Tests  10 failed | 48 passed (58)
```

At HEAD DECIDE is not a phase, so the machine never runs a handler for it, and the machine
tests fail on that before they reach the key. A probe at HEAD with the same writer in ANALYZE's
slot isolates the key itself:

```
   × at HEAD a phase that writes the file its digest reads re-runs itself and what follows on the next init
AssertionError: keyed after it runs, nothing re-runs: expected [ 'ANALYZE', 'PLAN' ] to deeply equal []
```

What each says:
- **The DECIDE suites do not load.** The modules they drive do not exist, and that is the defect:
  nothing reads AUDIT's checkpoint, nothing asks a money question before planning, nothing
  writes a vetoable default, and PRESENT lists no default. The battery below shows each of their
  tests biting.
- **`machine-keyed.test.ts`:** a phase that writes what its digest reads re-runs itself, and every
  phase after it, on every `init`. `INTERRUPT_PHASE` is a comment: an interrupt from any phase is
  accepted. Nothing refuses a re-plan that a phase before planning starts during the run. The one
  passing test is the control: PRDR-166's note at PRESENT, which HEAD already gives.
- **`machine.test.ts`:** there is no DECIDE phase, and `INTERRUPT_PHASE` maps each interrupt to one
  phase.
- **`audit.test.ts`:** at HEAD DISCOVER lists the decision log, so DECIDE's first write would
  replay DISCOVER and every phase after it.

## Mutation battery (verification protocol, item 2)

54 mutants, one defect each, run against the new test files and the machine, standalone-phase,
AUDIT and AUDIT-role suites. Each file was restored from a snapshot copy, never by
`git checkout`, and its hash checked. All 54 are killed, in one run of 53 and one of the 54th,
added when AUDIT's note gained its test. They cover:
- the machine: a phase keyed after it runs keyed before it, or its key not carried on the chain;
  an interrupt accepted from a phase `INTERRUPT_PHASE` does not list; PRDR-166's note added
  outside PRESENT; the in-loop refusal not asked, asked of a standalone phase, or reporting
  nothing that ran before it;
- the phase: DECIDE on the chain; keyed before it runs; keyed by AUDIT's outputs instead of the
  items' keys; the log out of its key; every item sorted again whatever the record says; the
  draft never reused, or reused after the log changed; the second option taken as the
  recommendation; "later" not honoured; screens of five; no progress mark; the record not
  updated; the planning phases not handed the log, the decided stack or the defaults;
- the checks by code: an item settled twice; a question the log answers accepted; a stack on a
  question whose options do not all carry one; a confirmed claim made an item; a gap's key not
  normalized; a contradiction keyed by more than its quotes;
- the log: a bar in a cell not escaped; a heading inside a fence read as one; an id numbered
  over the highest; a second stack written; a gate the root package declares written again; the
  answer not in bold; CRLF lost;
- the pipeline: DISCOVER listing the log, or reading it as a document; ANALYZE not handed the
  decided stack; a slice not handed the log, or a slice that names no documents handed only the
  log; PRESENT not listing the defaults, or asking a question the log answers;
- ANALYZE: the decided stack not written over the session's; another language's stack kept;
  `test_single` let into the analysis; an existing project given a decided stack;
- the terminal: an empty line read as the recommendation; words taken for a question that settles
  the stack; a number out of range taken; `detent init` on a terminal not given the asker;
- the role and the schemas: the migration not routing `spec_write`; `spec_write` given more than
  the read tools; AWAIT_INFO refused at DECIDE; AUDIT's note not saying that DECIDE reads it.

## What changed

- **`src/init/decide.ts`** (new): the phase.
  - `decidePhase`: standalone, keyed after it runs, and keyed by the open items' keys, the log,
    the prompt, the stack markers and the pack's kind. On a pack it runs no session and says why;
    on a raw document set it runs `decideStage` in one journal, as the `spec_write` role.
  - `decideStage`: the open items, the record, the draft, the session with one relaunch, the
    terminal's screens, the log, the record again, the notes and the progress mark.
  - `planningDocs` and `decidedStack`, what the planning phases take from DECIDE;
    `decideSkeleton`; `decideArtifactPath`, cleared before each launch (D-19); `readDecideRecord`;
    `SCREEN`, `DecideAsk`, `AskedQuestion` and `DecideAnswer`.
- **`src/init/decide-items.ts`** (new): `openItems`, the items and their keys, and `checkDecide`,
  the checks code makes of the sorting.
- **`src/init/decide-log.ts`** (new): `readDecisionLog`, `appendToDecisionLog` and `nextId`, the
  log read and extended in the pack's grammar, fences and CRLF respected.
- **`src/init/decide-notes.ts`** (new): what DECIDE says, and the AWAIT_INFO message.
- **`src/schemas/decide.ts`** (new): the artifact, the stack entry and the record.
- **`src/init/replan-guard.ts`** (new): `inFlightTickets` and `wouldReplan`, moved out of
  `machine.ts`, with `replansAt` and `replanRefusal` for the second ask.
- **`src/init/machine.ts`**: `PhaseHandler.keyedAfterRun`; an interrupt checked against
  `INTERRUPT_PHASE`; PRDR-166's note for PRESENT only; the in-flight refusal asked again in the
  loop.
- **`src/init/pipeline.ts`**: DECIDE after AUDIT; `askDecisions`; DISCOVER's listing and
  documents without the log; ANALYZE, SLICE and PLAN reading `planningDocs`; ANALYZE handed the
  decided stack.
- **`src/init/analyze.ts`**: `withDecidedStack`, the `decided_stack` input and its instruction.
- **`src/init/slice.ts`**: `groundSlices` adds the log to every slice that names documents.
- **`src/init/present.ts`**: the defaults and the questions the log answers.
- **`src/init/audit.ts`**: its note and doc-block say DECIDE reads the findings;
  `refusedAttemptInput` moved to **`src/init/retry.ts`**.
- **The role:** `spec_write` in `src/schemas/roles.ts`, routed to `claude-opus-5-5` at `max`, and
  not read-only; the read tools in `src/sessions/guard.ts`; its routing in the v1→v2 migration
  (`src/kernel/migrate.ts`); `prompts/spec_write.md` (new) and `prompts/manifest.json`. `agents/`
  and the hook bundle do not change: `spec_write` is an init role, which the plugin does not
  vendor.
- **`src/schemas/init.ts`**: DECIDE in `INIT_PHASES`, and `INTERRUPT_PHASE` as lists.
- **`src/cli/decide.ts`** (new): `makeTtyDecisions`, `renderScreen` and `readReply`;
  **`src/cli/init.ts`** passes the asker behind its TTY gate.
- **Docs:** `detent-prd-v3.md` C-2¹², with pointers on C-2⁶, C-2¹¹, C-3⁗, D-10′, S-1″, S-1‴,
  C-8″ and C-8‴; the README and `skills/init/SKILL.md` name the ten phases, say what DECIDE does,
  and give AWAIT_INFO both of its phases.
- **Other tickets:** PRDR-283, PRDR-284, PRDR-290, PRDR-291 and PRDR-298 each gain a "From
  PRDR-282" section naming what they inherit.
- **Tests:**
  - new: `tests/init/decide.test.ts`, `decide-plan.test.ts`, `decide-items.test.ts`,
    `decide-log.test.ts` and `machine-keyed.test.ts`; `tests/cli/decide.test.ts` and
    `tests/cli/init-decide-tty.test.ts`, which drives `detent init` on a terminal with the
    production asker; `tests/init/decide-fixture.ts`;
  - `tests/init/plan-fixture.ts`: `decideDefaults`, a DECIDE session that settles every item by
    one default, which the greenfield pipeline tests route `spec_write` to, since the stack is
    open there;
  - pins moved: the phase order and `INTERRUPT_PHASE` (`machine.test.ts`, `backhalf.test.ts`), the
    role ids (`prompts.test.ts`), the effort routing (`config-defaults.test.ts`), the migrated
    routing (`audit-role.test.ts`, `migrate.test.ts`), the init skill's phases and decisions and
    the prompt-transport inventory (`golden-path.test.ts`), PRDR-166's note (`machine.test.ts`),
    and what re-runs AUDIT (`audit.test.ts`).

## Recorded, not fixed

- **A veto re-plans every slice.** Every slice reads the log, so an edit to one row moves every
  slice's inputs. C-3⁗ promises that only the slices whose inputs changed are re-planned, which is
  true here only because every slice's inputs change. Keying slices by requirement ids, which is
  PRDR-291's, would narrow it.
- **The plugin cannot ask.** A plugin session has no terminal, so DECIDE takes the recommended
  answers there (decision 9), and the model cannot relay the founder's answers as it relays an
  approval flag. The founder vetoes in the log. A flag or a file the model writes would be a new
  surface, and C-14′ freezes it.
- **"In any words" holds as far as C-3‴'s measure reaches.** Code refuses a question whose words
  are near a decision's (`similarQuestions`, PRDR-207's token overlap). A question reworded past
  that measure is caught only by the session, which is given the log's entries and told never to
  ask what they answer. The fifth criterion is met by the two together, not by code alone.
- **A founder's log in another shape is half read.** Code reads every id in the first column of
  `## Decisions` and `## Defaults`, so the session may cite a `D1` or an `X1` as settling an item.
  The grammar's parser refuses those rows, though, so C-3‴'s check and PRESENT's defaults do not
  see them. Making a founder's log a pack is WRITE's (PRDR-283), which is not built.
- **A terminal may be asked while a ticket is in flight.** A code edit re-runs AUDIT; a new item
  re-runs DECIDE, which asks; the re-plan the answer starts is then refused, with the answer kept
  in the log. Refusing DECIDE itself would cost the answer, and it spends nothing on planning.
- **Development states at `schema_version` 2 from `843aff1` lack `spec_write`'s routing.** The
  v1→v2 migration ran on them before the role existed, and the event is unreleased, so it was
  extended in place rather than given a second step. Such a state runs `spec_write` on the
  runtime's default model and effort until its config routes it; only checkouts between
  `843aff1` and this commit are affected.
- **An unsorted item reaches only `init`'s output,** not PRESENT. It is rare, since it means two
  sessions in a row left it out, and it is said by id with its summary.
- **Each phase's spend beside planning's, in PRESENT and `detent status`** (C-2⁶, decision 16), is
  built for neither AUDIT nor DECIDE. Both are on the ledger against ticket `init`, as every init
  session is.
- **The gap key is the survey's word.** A reworded gap costs one DECIDE session, which cites the
  entry that settled it, and re-plans nothing.

