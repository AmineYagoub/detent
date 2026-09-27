---
id: PRDR-296
title: "PRESENT gave the operator 457 held findings, a revision headline that summed 16 of 24 slices, and a 457-KB advice file, yet never showed the decisions the plan rests on. PRESENT now shows the plan, the decision log with every vetoable default, the checks that still fail, the spec defects planning found, the majors left as risks, and what planning cost; it refuses approval while a check fails or a spec defect is open"
state: DONE
severity: major
category: capability
labels: ["prd-review", "planning-redesign", "operator-decision", "C-7", "presentation"]
surface: ["src/init/present.ts", "src/init/present-advice.ts", "src/init/machine.ts", "src/cli/init.ts", "src/cli/approve.ts", "tests/init/present.test.ts"]
prd_refs: ["C-3′", "C-7", "C-7′", "D-24", "PRDR-166", "PRDR-196", "PRDR-255", "PRDR-278", "PRDR-282"]
acceptance_criteria: ["PRESENT shows: the slices, tickets and milestones; every `D-n` and every `X-n` in the decision log, the `X-n` marked vetoable; the checks that still fail; the spec defects planning found; the review majors left after revision, as risks; and what each specification phase and planning cost, with no cap (the specification plan's decision 16).", "It refuses approval while a check fails or a spec defect is open, raising AWAIT_INFO with each item.", "The revision and churn lines, the advice file and the question list are gone.", "The presentation is printed once, off a TTY as on one. Today it is printed three times.", "The persisted presentation that `run` replays (PRDR-255) is the same text, byte for byte."]
non_goals: ["Does NOT change C-7's dual exit or the approval record."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-255", "PRDR-282"]
depends_on: ["PRDR-293", "PRDR-294", "PRDR-282"]
---

# PRDR-296 — PRESENT rebuilt

## Where this came from

The planning audit of 2026-09-26, §2. ksar-cloud's presentation listed 457 held findings. Its
revision headline, "89 resolved, 9 survived, 82 introduced", summed slices s09–s24 only. Its advice
file ran to 457 KB. Nothing in it named the defaults the plan had assumed.

## Problem

A presentation nobody can read is not an approval gate. What the operator must decide is short: the
defaults they may veto, anything still proven wrong, and what the pack failed to settle. That is
what PRESENT should show.

## Design

The redesign plan's §9.

## From PRDR-292

PRESENT lists the spec defects planning found. Each shows the slice that reported it, its kind,
each passage's record id, quote and `file:line`, and the defect. While one is open, PRESENT raises
AWAIT_INFO with one item per defect before approval is offered, and its first line says the plan
is not approvable. `presentation.json` counts them in `spec_defects`, and `detent run`'s deferred
approval refuses while the count is not zero.

So the first criterion's "the spec defects planning found" is built, and so is the second
criterion's refusal while a spec defect is open. The refusal while a check fails is PRDR-293's.

## From PRDR-294

Each slice's review is read once (C-4⁸), and PRESENT's part of it is built in
`src/init/present-review.ts`:
- Each blocker and major a slice's read found is listed as a risk, with its slice, ticket, grade,
  tag and fix, blockers first. Each bought one revision that no review read, so none is known to
  be answered, and the first criterion's "the review majors left after revision" is built as every
  blocker and major sent to a revision. PLAN outputs them as `review_risks`, and each slice no
  review read, with why, as `unreviewed`.
- The minors are counted and not listed: each is recorded in PLAN's `review_findings` and reaches
  the sessions that run its ticket. The repairs code made to a draft (A-1″) are listed, since each
  is a decision code made for the operator.
- The revision and churn lines, the held-finding labels and the advice file are gone, with
  `present-advice.ts`, so the third criterion holds but for the question list.

## Building it

C-7″ is built, but for its mixed builds, and the PRD records it as C-7‴. `src/init/present.ts`
renders the presentation and decides who shows it. `src/init/present-plan.ts` lists the slices and
the tickets with their milestones, `src/init/present-spec.ts` renders the decision log, and
`src/init/phase-spend.ts` sums `init`'s ledger rows by phase. It reads them through
`src/kernel/ledger-rows.ts`, where X-1's reader now returns the rows `readRecordedSpend` sums.
Every `init` session's ledger row names the phase that launched it: `sessionDeps` takes the phase,
and `SpendLedger.record` writes it. The question list is gone from PRESENT, with
`answerInstruction`, `mergeSimilar`, `PresentQuestion`, `planQuestionSchema` and
`presentation.json`'s `blocking`.

The acceptance criteria, as built:
1. **What PRESENT shows.**
   - *Slices, tickets and milestones.* The slices come first, in order, however many there are,
     each with the milestones of the requirements SLICE assigned it. Each ticket shows the
     milestone of what it delivers: the earliest of its requirements', as A-1⁷'s milestone check
     reads it (`requirementMilestones`, now exported from `plan-checks.ts`). The bootstrap
     delivers none and shows none.
   - *The decision log.* `Decisions (n)` lists every `D-n` with its question and its answer, then
     `Defaults (n), each vetoable` lists every `X-n` with its value and its reason. Both are read
     from the phase that left the log, as the defaults were.
   - *What still fails, the spec defects, the review's risks.* Built by PRDR-293, PRDR-292 and
     PRDR-294, and unchanged.
   - *The cost.* `What `init` has spent on this root, by phase — reported, and nothing stops for
     it`: AUDIT, DECIDE, WRITE and VALIDATE apiece, SLICE and PLAN as planning, any other phase by
     its name, the rows that name none as earlier, and the total, each in dollars with its sessions.
   `tests/init/present-rebuilt.test.ts` pins each on the seeded pack, and a case in
   `tests/init/validate-plan.test.ts` runs the whole pipeline and pins the phase on every session's
   row and every specification phase's line.
2. **Refused while a check fails or a spec defect is open.** Built by PRDR-292 and PRDR-293 and
   unchanged; their suites pass. A new case shows the refusal prints nothing and asks nothing
   before it.
3. **Gone.** The revision and churn lines and the advice file went with PRDR-294. The question list
   goes here: PRESENT reads no stage's `questions`, lists no `Open questions` and no
   `Not asked again`, and raises no AWAIT_INFO for a blocking question. `presentation.json` holds
   no `blocking`, and `run`'s refusal on it is gone.
4. **Printed once.** It was printed three times: `presentStage` printed it, the machine copied the
   interrupt's message into the run's `messages`, and `cli/init.ts` printed the messages and then
   the interrupt. Now `presentStage` prints it only where it asks and has a printer, before the
   question, and the answer's interrupt does not repeat it. Anywhere else the interrupt carries
   it. The machine no longer copies an interrupt's message. `tests/cli/init-present-once.test.ts`
   drives `detent init` over the conforming pack and counts one copy off a terminal, one on a
   terminal when the answer is later, and one when it is yes.
5. **The persisted text is the printed text.** The same test takes `presentation.json`'s text and
   finds it exactly once in `detent init`'s stdout and once in `detent run`'s.

### Vetoable calls

1. **The cost is per root, cumulative.** The ledger has no mark that says which planning a row
   belongs to, so PRESENT sums every `init` row on the root, re-plans and resumed runs included,
   and says "on this root". Scoping it to the plan presented would need that mark.
2. **The phase is a string on the row, not the phase enum.** A row outlives the build that wrote
   it, and a phase a later build renames must not make X-1's reader refuse the file.
3. **A row that names no phase is counted apart, as earlier,** rather than guessed from its role:
   `spec_write` serves DECIDE, WRITE and VALIDATE.
4. **Every specification phase and planning is listed, at zero too,** so a pack that needed no
   specification session shows it. A phase a later build names is listed by that name, before the
   earlier rows.
5. **Four decimals,** as `doctor` and the no-progress breaker print a session's cost.
6. **A ticket's milestone is its earliest; a slice's are all of its requirements'.** The first is
   how A-1⁷'s milestone check reads a ticket, and a slice may span milestones.
7. **A decision shows its question and its answer, not its reason.** It is the founder's; what the
   operator needs is what was decided. A default keeps its `because`, since it is the plan's own
   call.
8. **Only a default is marked vetoable.** A `D-n` is changed the same way, by editing its row, and
   its block says so, but it is the founder's answer and not a call the plan made.
9. **Who prints.** Where approval is asked and there is a printer, the presentation is printed
   before the question; anywhere else the interrupt carries it. On the plugin's path the relayed
   `--approve`, `--decline` or `--defer` is the asker, so the plan is printed before the answer
   takes effect.
10. **PRDR-166's note is kept, for an amendment.** PRESENT's AWAIT_INFO is now a spec defect or a
    failing check, each answered by an amendment, so the note says an amendment written to a new
    file was not read. The instruction that listed DISCOVER's globs is deleted: a defect or a
    failure names its own place.
11. **No migration step, and both counts required.** `presentation.json` came with PRDR-255 on this
    line, so no released build wrote one. A record an earlier build of the line wrote carries
    `blocking`, and `run` refuses it as it refuses any record it cannot read, pointing to
    `detent init`. `spec_defects` and `check_failures` lose their defaults, since a record without
    them was written before them, and so with `blocking`.
12. **The question machinery PRESENT alone used goes here.** `mergeSimilar`, `PresentQuestion` and
    `planQuestionSchema` had no other reader. `similarQuestions`, which DECIDE uses, stays for
    PRDR-298.
13. **`detent status` shows no cost yet.** That is PRDR-297's last criterion, and its ticket now
    names what it can read.
14. **Slices before tickets,** since a slice is the unit the operator reads a plan in, and each
    slice line counts its tickets in words.

## Falsification (verification protocol, item 1)

The final test files were copied into a `git archive` of HEAD `88a1462` in the scratchpad and run
there, against HEAD's source, so the working tree was not touched. The copy holds every test file
that differs from HEAD: two new suites and eleven changed ones. `git diff` in the copy shows its
`src/`, `prompts/`, `skills/` and `scripts/` as HEAD's.

Run together, the thirteen files fail 24 of 165 tests at HEAD:
- **The two new suites fail 17 of 19.** `present-rebuilt.test.ts`'s first spend case cannot import
  `phase-spend.ts`, which HEAD lacks. Every other case fails on what it tests: no `Decisions (n)`,
  and no decisions read from the log; no `Slices (n)` block, and no milestone on a slice or a
  ticket; `planner@undefined` where the row should name SLICE; a ledger row that names its phase
  refused; the stages' outputs still carrying `questions`; a record without `blocking` refused; the
  presentation printed where nothing asks, and while a spec defect holds approval, and repeated in
  the answer's interrupt; the interrupt's message copied into the run's messages; and the binding
  table put out of line by a package's label. `init-present-once.test.ts` counts the presentation
  three times in `init`'s stdout, off a terminal and when the answer is later.
- **Seven cases in the changed suites fail on the same defects.** `validate-plan`'s rows name no
  phase (`audit@undefined`). `run-approval` offers approval from a record that carries `blocking`.
  `machine-keyed`'s PRDR-166 note still asks for an answer. `slicing` finds no slices block.
  `decide-plan` finds no `Defaults (3), each vetoable` and no decisions, in two cases. `backhalf`'s
  T-068 case finds the presentation printed where nothing asks.

The two new cases that pass at HEAD are guards. Approval at the prompt printed it once at HEAD
too, since no interrupt followed, and an asker with nothing to print on left it in the interrupt,
where it stays. The five changed suites that pass at HEAD lost their question cases or a comment:
`open-questions`, `stages`, `present`, `vacuous-gate` and `init-decide-tty`.

```
 × on a terminal, deferred at the prompt: shown before the question, and not again after it
   → expected 3 to be 1
 × lists every D-n with its answer and every X-n as vetoable, from the log the specification phase left
   → expected 'Plan ready for approval.\n\nVerificat…' to contain 'Decisions (1)'
 × names the phase on every init session's row, and lists each phase's sessions
   → expected [ 'audit@undefined', …(4) ] to deeply equal [ 'audit@AUDIT', …(7) ]
 × a presentation an earlier build wrote, which counts questions, is refused, and the operator is sent to `detent init`
   → nothing is offered from a record this build cannot read: expected 1 to be +0
 Test Files  8 failed | 5 passed (13)
      Tests  24 failed | 141 passed (165)
```

## Mutation battery (verification protocol, item 2)

The battery ran 50 mutants, one defect each, against the two new suites and, where a mutant
reaches them, `present`, `run-approval`, `decide-plan`, `backhalf`, `vacuous-gate`, `slicing`,
`machine`, `machine-keyed`, `validate-plan`, `ledger`, `jsonl-recover`, `x1-counting`,
`no-progress-breaker` and `package-gates`. Each file was restored from a snapshot, never by
`git checkout`, and checked byte for byte after every mutant; at the end all 17 files matched the
snapshot directory. The mutants covered:
- **Who prints:** the presentation printed without an asker, never printed, or printed before the
  refusals; the answer's interrupt repeating it, or no interrupt carrying it; an asker without a
  printer counted as shown; the decision log or the spend block dropped.
- **The plan's lines:** a plan of one slice not listed; a ticket showing its latest milestone, or
  none; a slice showing none; milestones unsorted.
- **The decision log:** the defaults not marked vetoable; a decision shown without its answer, or
  kept without one; the decisions read from DECIDE whatever phase left the log; a decision keeping
  every field its row has.
- **The spend:** SLICE not counted as planning; every ticket's rows counted; the rows that name no
  phase counted as planning, or not last; a block where no session ran; the earlier row
  unexplained; a total counting phases, not sessions; two decimals.
- **The ledger:** a row dropping its phase; the spend summing nothing; a torn line recovering
  nothing; a well-formed object that is not a row skipped; the row's schema refusing `phase`.
- **The record:** `presentation.json` taking `blocking`; either count defaulted.
- **The phases:** a launch recording no phase; the session's deps carrying none; AUDIT, DECIDE,
  WRITE, VALIDATE, SLICE, PLAN's draft and PLAN's review each tagged as another phase; PRESENT
  given no spend.
- **The machine:** an interrupt's message copied into the messages; PRDR-166's note asking for an
  answer.
- **The binding table:** either column a fixed width; a package with no gate not measured.

First pass: 48 killed, 2 survived. PI3 (a decision keeping every field) was killed by a
transform error in the mutant, not by a test.
- **R3** and **R4** (`spec_defects` or `check_failures` defaulted to zero) survived because the
  test dropped both counts at once, and the one still required refused the record. It now drops
  each by itself.

Second pass, with PI3 as a valid mutant: PI3, R3 and R4, 3 killed. So all 50 are killed.

## Gates

`lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check` and `test` all
pass: 2129 tests passed and 2 skipped, across 179 files. `npm run plugin` builds, and leaves
`agents/` and `hooks/dist/` as they were.

## Found along the way

- **The binding table misaligned a package's rows.** `bindingTable` padded a gate's name to 12
  characters and its command to 34, so `dashboard:test`, at 14, and any longer command pushed their
  rows out of line. Each column is as wide as its longest entry now, a package with no gate
  included.
- **The moved ledger reader said the spend ceiling is enforced.** Its refusal of a well-formed
  object that is not a row said "the spend ceiling is enforced against this file", which has been
  false since PRDR-265. It says what the file is read for now.
- **`tests/cli/init-decide-tty.test.ts` never reached PRESENT.** Its fixture scripts DECIDE's
  `spec_write` session and not WRITE's, so WRITE's session threw and `init` exited 1 after DECIDE,
  on stderr, which the harness swallows. Its cases assert DECIDE's results alone, so they were
  right, but the first case's comment said PRESENT's approval was deferred, and answered it. The
  comment now says what runs, and this ticket's CLI test drives the conforming pack instead.
- **Two tests read a presentation by `print` where nothing asked.** `backhalf.test.ts`'s T-068 case
  and `vacuous-gate.test.ts`'s PRESENT hop read what `print` received with no asker, one of the
  three copies. They read the interrupt now.

## Recorded, not fixed

- **`readPresentation` throws on malformed JSON.** Its doc-block says it returns null when the file
  "will not parse"; a schema failure does, and text that is not JSON throws from `JSON.parse`. This
  is the audit's `present.ts:49`, in PRDR-298's fourth criterion.
- **Leftovers for PRDR-298,** in its new note: `questions.ts` holds only DECIDE's similarity,
  DISCOVER's `patterns_searched` has no reader, and `planningBriefSchema`'s doc-block still says
  C-3′ carries a question to PRESENT.
