---
id: PRDR-284
title: "A written pack still carries the defects reading misses, and fixing them introduces new ones: ksarjs needed seven rounds, and with no stop rule the loop ran until the operator asked why. VALIDATE runs the checker, then review rounds by area, until a round finds no blocker and no major, under a ceiling that hands what is left to the operator"
state: DONE
severity: major
category: capability
labels: ["prd-review", "specification-phase", "operator-decision", "X-1⁵", "ceiling", "AWAIT_INFO"]
surface: ["src/init/audit.ts", "src/init/decide-log.ts", "src/init/decide.ts", "src/init/machine.ts", "src/init/pack-check-refs.ts", "src/init/pack-check.ts", "src/init/pack.ts", "src/init/pipeline.ts", "src/init/plan-slices.ts", "src/init/present-spec.ts", "src/init/present.ts", "src/init/replan-guard.ts", "src/init/validate-checks.ts", "src/init/validate-round.ts", "src/init/validate-scope.ts", "src/init/validate.ts", "src/init/write.ts", "src/kernel/budgets.ts", "src/kernel/ledger.ts", "src/kernel/migrate.ts", "src/schemas/budgets.ts", "src/schemas/init.ts", "src/schemas/pack.ts", "src/schemas/roles.ts", "src/schemas/validate.ts", "src/sessions/guard.ts", "prompts/manifest.json", "prompts/spec_review.md", "prompts/spec_write.md", "README.md", "detent-prd-v3.md", "skills/init/SKILL.md", "tests/docs/golden-path.test.ts", "tests/docs/prd-specification-phase.test.ts", "tests/init/audit-role.test.ts", "tests/init/audit.test.ts", "tests/init/config-defaults.test.ts", "tests/init/decide-fixture.ts", "tests/init/decide.test.ts", "tests/init/machine.test.ts", "tests/init/pack-fixture.ts", "tests/init/pack-written.test.ts", "tests/init/plan-fixture.ts", "tests/init/validate-checks.test.ts", "tests/init/validate-fixture.ts", "tests/init/validate-plan.test.ts", "tests/init/validate-scope.test.ts", "tests/init/validate-writer.test.ts", "tests/init/validate.test.ts", "tests/init/write-fixture.ts", "tests/init/write-plan.test.ts", "tests/init/write.test.ts", "tests/kernel/migrate.test.ts", "tests/kernel/run.test.ts", "tests/kernel/x1-counting.test.ts", "tests/oracle/budgets.test.ts", "tests/sessions/prompts.test.ts"]
prd_refs: ["C-2⁶", "C-2⁷", "C-2⁹", "C-2¹⁰", "C-2¹¹", "C-2¹²", "C-2¹³", "C-2¹⁴", "C-3′", "C-3⁗", "C-5", "C-7″", "C-8", "C-8″", "C-8‴", "C-8⁵", "D-10′", "F-3″", "F-4", "S-1″", "S-1‴", "S-5⁵", "X-1⁵", "PRDR-166", "PRDR-191", "PRDR-265", "PRDR-278", "PRDR-279", "PRDR-280", "PRDR-283"]
acceptance_criteria: ["The checker runs first, and a red checker is fixed before any review round starts.", "A round runs one reviewer per area of the pack. Each finding carries its severity (blocker, major or minor), its `file:line`, a quote and the exact fix. A writer applies the round's findings, and the next round verifies those fixes and looks for the defects they introduced.", "Stop rule: a round with no blocker and no major ends the loop, and its minor findings are fixed without another round (decision 3). A test with scripted reviewers asserts that the loop ends on the first such round and launches nothing after it.", "Ceiling: `spec_validation_rounds` (default 8, decision 13) bounds the loop, as a ceiling and never a retry. At the ceiling the last round's majors reach PRESENT as recorded risks, listed beside the defaults, and planning goes on. A blocker stops `init` at VALIDATE with AWAIT_INFO, and `detent init` resumes VALIDATE once the operator settles it.", "The conformance record gets every round's counts by severity and the findings left open (PRDR-279).", "Progress: each completed specification phase and each completed round calls the progress mark `src/init/plan-slices.ts` calls after a slice's checkpoint (X-1⁵). The doc-block there that calls a slice's write the only thing that resets the no-progress breaker is corrected in the same change.", "A re-validation after an edit is scoped to the changed documents and whatever cites them (plan §4.3). An amendment is an edit that PRDR-286 builds, and reaches the same re-validation.", "On a pack DISCOVER classifies as conforming (PRDR-279, C-2⁹), AUDIT, DECIDE and WRITE do not run, and VALIDATE runs only the checker (decision 6). A test drives a fixture pack down that path and asserts that no specification session is launched. Moved here from PRDR-279 on 2026-09-26: until this ticket lands, no specification session exists to launch, so the test could not fail.", "VALIDATE's reviewers run as the `spec_review` role, read-only, and its fixes as `spec_write` (decision 15), all routed to `claude-opus-5-5` at `max` (decision 14). The sandbox that lets a reviewer simulate is PRDR-285's, which depends on this ticket.", "A red checker blocks every phase after VALIDATE, under either driver: with a blocking finding left, DETERMINE_VERIFICATION, SLICE and PLAN do not run. A test drives a pack whose checker stays red and asserts that none of them starts. Moved here from PRDR-280 on 2026-09-26: until VALIDATE exists, nothing runs after it to block.", "The checker's heuristic reports (its findings with `blocks: false`, the present-indicative rule's, C-2¹⁰) reach VALIDATE's reviewers with the pack, marked as a heuristic's, and never stop the loop on their own. Moved here from PRDR-280 on 2026-09-26, for the same reason.", "VALIDATE's last step discovers the pack with DISCOVER's recorded patterns (PRDR-166) and hands the checker's parse of it to the planning phases (PRDR-290). No phase runs twice under one name (F-4). Moved here from PRDR-283, whose WRITE makes this handoff until VALIDATE is built."]
non_goals: ["Does NOT run code; simulations are PRDR-285's.", "Does NOT fix a list of areas. The areas come from the pack's modules; ksarjs's five are an example, not a default.", "Does NOT stop for spend. The breaker announces, as PRDR-265 made it."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-191", "PRDR-265", "PRDR-283", "PRDR-285", "PRDR-286", "PRDR-290"]
depends_on: ["PRDR-280", "PRDR-283"]
---

# PRDR-284 — VALIDATE

## Where this came from

The ksarjs validation. The first round ran five adversarial reviewers, one per area: money and
orders; identity, security and surfaces; catalog, shipping, search and analytics; plugins and
notifications; facts and design consistency. Verification passes over each round's fixes
followed, seven rounds in all. Each round's fixes introduced new, smaller defects. After six
rounds the operator asked why the work was still running, and the seventh found only minor
defects. The briefs are kept as `~/ksar-spec-tools/review-brief.md` and `verify6-brief.md`.

## Problem

A loop that reviews until clean does not end on its own, because fixes introduce defects. One
that stops at a fixed count stops wherever it happens to be. The loop needs a rule, and a
ceiling for when the rule is not met.

## Design

The plan's §7. The ceiling's default, 8 (decision 13), sits above ksarjs's seven. A ceiling of 6
would have stopped on round 6's three majors, fixed but never verified:
- a forfeiture that swept the vendor's fees with its earnings;
- a re-refund that charged the vendor on a platform-liable loss;
- an invitation that let the next holder of an email address take over a vendor account.

Today a slice's checkpoint write is the only progress mark in `init`. Without marks of its own, a
healthy specification phase would have the no-progress breaker announcing throughout it.

## From PRDR-281

AUDIT does not audit a changed pack (C-2¹¹), and until VALIDATE exists nothing re-validates one:
it goes to planning unaudited, and AUDIT's note says "this build has no VALIDATE". That note, in
`auditPhase` in `src/init/audit.ts`, and the module's doc-block become false the day VALIDATE lands.

## From PRDR-282

`INTERRUPT_PHASE` is now a list of phases per interrupt, and the machine refuses an interrupt
raised at a phase its list does not name (C-2¹²). VALIDATE's AWAIT_INFO for a blocker at the
ceiling needs VALIDATE added to `AWAIT_INFO`'s list in `src/schemas/init.ts`, or the machine throws.
DECIDE's note on a changed pack names VALIDATE as unbuilt (`decidePhase` in `src/init/decide.ts`),
and becomes false the day it lands.

## From PRDR-283

WRITE is built (C-2¹³), and five things in it are VALIDATE's to extend or change:

- **The record.** `docs/conformance.json` gains `validated`, required. WRITE writes it `false`
  (`apply` in `src/init/write.ts`); VALIDATE writes `true` when it finishes, through
  `conformanceRecord(root, { …, validated: true })` in `src/init/pack.ts`.
- **A written pack.** DISCOVER classifies a pack whose record is not validated as `written`, with
  the checker's blocking count, whatever changed in it since (`classifyPack`). VALIDATE runs on a
  written pack, the whole of it, as it runs on a changed pack's change. WRITE, AUDIT and DECIDE
  skip both, and their notes name VALIDATE as not built: `skipNote` in `src/init/write.ts`,
  `packNote` in `src/init/pack.ts`, and the notes in `auditPhase` and `decidePhase`. Each becomes
  false the day this lands.
- **A red checker.** WRITE relaunches its session once on a blocking finding and then records the
  checker red, and planning goes on: nothing blocks on red until VALIDATE fixes the checker
  before its first round (C-2⁶).
- **The chain.** WRITE restarts C-8's chain (`restartsChain`) and is keyed after it runs. VALIDATE,
  after it, writes the pack its own digest would read, so it is keyed after it runs too; either it
  chains from WRITE's key, or it restarts the chain itself, in which case WRITE's key must stop
  reaching the planning phases. C-8″'s scan resumes at a phase that restarts the chain, and the
  second ask is made before it runs (`replansAt` in `src/init/replan-guard.ts`).
- **The handoff.** WRITE hands the planning phases what DISCOVER's patterns find, the log among
  them, with the stack markers and the log's entries: `planningDocs` in `src/init/decide.ts`,
  `planningMarkers` in `src/init/write.ts`, and PRESENT's `logged` read WRITE's outputs first.
  The criterion added above moves that handoff to VALIDATE's last step. A planning digest must
  read only the handing phase's outputs and the disk, or the scan, which cannot read DISCOVER's
  outputs after its re-run, reads every re-init as a re-plan.

## Building it

What building it settled. Each is recorded in the PRD as C-2¹⁴ and is open to the operator's veto:

1. **VALIDATE classifies the pack when it runs.** DISCOVER classifies before WRITE runs, so on a
   raw set's first `init` it says raw, and by VALIDATE's turn WRITE's pack exists. With no
   record, nothing is validated. A conforming pack runs no session, since classifying it ran the
   checker. A written pack is validated whole or carried on, and a changed pack is re-validated
   for its change. `plan_docs` narrows what planning reads and never what VALIDATE reviews.
2. **The checker's findings go to the round writer's session.** Each blocking finding reaches a
   `spec_write` session told `source: checker`, as `CHECK-n` with its rule, place, text and
   message, and the session is checked as a round's writer is. If the checker is still red after
   the second attempt, the fixes are undone and `init` stops at VALIDATE with AWAIT_INFO, which
   lists what the checker finds. Nothing marks that stop, so each `init` tries again, the writer
   included. An edit the operator makes in between is the writer's new input, and a marker would
   need an invalidation of its own. The writer's fixes count as moved against the record, so a
   stopped validation reviews them in the round it carries on with.
3. **The areas are the index's.** The foundations, every typed document that is not a module PRD,
   come first. Every reviewer reads them before its own documents, since they rank above the
   PRDs. Then come the `## Codes` areas, in the index's order, each with the module PRDs its codes
   register. A PRD named by two areas goes to the first, so it is reviewed once. A module PRD no
   code registers is an area of its own, named by its file. A context document is never
   reviewed. A document at no layout path is not reviewed either, since the checker judges it.
4. **Reviewers run one after another**, the foundations first, so a round's journal and ledger
   read in one order.
5. **A verifier is shown every finding of the round before in its area**, with what became of
   each, including the applied ones, and the diff of the fixes. A finding names the finding it
   continues in `previous`. An area with no document in scope still gets a reviewer when it has
   a finding to verify.
6. **Findings are merged by category and place set.** Two reviewers can see one defect from its
   two ends, most of all a contradiction between two areas' documents. The key is the category
   and the sorted `file:line` set, and the more severe of two findings stands in the first one's
   position. Findings that differ in either stay apart, since merging two defects loses one.
7. **A review is strict first, then keeps what stands**, as AUDIT's survey does. A first review
   is refused for any of these:
   - a quote that is not at its line;
   - a place outside the pack;
   - an unknown `previous`;
   - a document it was given and did not read.

   The second attempt keeps what stands, drops the rest aloud, and names each document it still
   did not read. A review unusable twice fails the phase.
8. **The writer is checked as WRITE's session is** (C-2¹³):
   - the log stays append-only, and is restored at once when it is damaged;
   - a default the writer adds is cited in the pack;
   - the pack holds a requirement;
   - the checker is green.

   The first attempt is strict, and one relaunch follows. After the second attempt, a red
   checker or a pack with no requirement undoes every fix of the round and leaves each finding
   `undone`, for the next round to judge. An account unusable twice puts the pack back and fails
   the phase.
9. **"Applied" means a document changed.** Code declines two kinds of finding, each with its
   reason:
   - a finding listed as applied by a writer that changed no document: "its writer listed it as
     applied and changed no document";
   - a finding the writer did not account for: "its writer did not say whether it applied it".

   Code cannot tell which change fixed which finding, so this is judged per round, and the next
   round's verifiers judge each fix.
10. **What a round leaves open.** Declined and undone findings, each with its reason. At the
    ceiling, the blockers and majors its writer fixed are open too, as `unverified`. A minor fixed
    at the ceiling is not, since decision 3 already fixes minors without verifying them.
11. **The record is written after every round.** It carries `validated: false` and the rounds so
    far after each round, and `true` when the loop ends. A killed or stopped validation carries
    on from its record. The rounds are the current validation's, and a re-validation writes its
    own, numbered from 1.
12. **Carrying on.** A stopped validation resumes from its last recorded round, as a verification
    of what that round left open and the documents it changed, with its diff where one was kept.
    With nothing moved, it ends without a session when that round met the stop rule or reached
    the ceiling, so a blocker at the ceiling stops `init` again at no cost. Any edit earns one
    round past the ceiling, a removal included, and a raised `spec_validation_rounds` allows
    rounds up to its new value.
13. **Re-validating a change also reviews what the last validation left open.** The new record
    replaces the old one, which would otherwise lose those findings, so their documents join the
    change's. A changed decision log or facts file reaches every document that cites any entry of
    it, since the record keeps no earlier copy to say which entry moved. Citing is read from the
    pack as it is now, and covers:
    - the requirement and criterion ids a changed document defines, with ranges expanded;
    - `§` references by a document's name or an ADR's id;
    - relative links.
14. **The diff of a round's fixes** is `git diff --no-index` of the snapshot's bytes against the
    tree's. It is kept at `.detent/state/validate/<label>.diff`, which is local state and never
    committed, and the verifiers read it by its path.
15. **VALIDATE restarts the chain, keyed after it runs by WRITE's digest.** The digest is
    `packDigest`, shared with WRITE, and reads the documents, the pack, its record, the markers
    and `plan_docs` from the disk. It never reads a prompt, since a new prompt must not reopen a
    validated pack. It never reads the ceiling either, which bounds a validation and never reopens
    a finished one. Once VALIDATE follows WRITE, WRITE's key reaches nothing. On the next `init`,
    WRITE re-runs without a session, as DISCOVER, AUDIT and DECIDE do.
16. **The in-flight refusal asks before VALIDATE and not before WRITE** (`replansAt`). While a
    ticket is in flight, an edited pack is refused before any reviewer spends.
17. **The handoff is VALIDATE's.** WRITE's `handoff` is exported and VALIDATE calls it, adding
    whether it ran, its rounds, the risks and the checker's parse. The planning readers read
    VALIDATE's outputs first: `planningDocs`, `planningMarkers`, ANALYZE's digest and PRESENT's
    log. Nothing reads the parse until PRDR-290.
18. **Risks** are the open majors of the validated record's last round, as
    `{id, where, fix, left, reason}`. They are read from the record on a conforming pack too, so a
    later `init` still lists them. PRESENT lists them after the defaults and says how to settle
    one. They do not refuse approval: C-7″ refuses for a failing check or an open spec defect, and
    a risk is neither.
19. **Simulation is off, and said once per run.** `spec_review` is read-only (`READ_ONLY_ROLES`,
    `READ_ONLY_STAGES`) and writes only its artifact. The scratch directory and the sandbox are
    PRDR-285's.
20. **`spec_validation_rounds`** is a positive integer, scope `init`, breach target
    `UNVERIFIED_FIXES`, default 8, counted in `init/validate`. It needs no migration step, since a
    config's budgets take the default of any key they omit.
21. **The record's rounds change shape without a migration step.** Each open finding gains an id,
    `left` and a reason, and each round gains the documents it changed. Only a hand-written record
    can hold the older shape, and its reader refuses such a record by name (C-2⁹), because:
    - no build wrote a round before this one;
    - WRITE writes none;
    - the record did not exist in 3.1.0.
22. **The planning suites leave VALIDATE out**, as they leave WRITE out (`planningPipeline`, and
    `initThrough`'s `all`). What planning reads from VALIDATE is `validate-plan.test.ts`'s.
23. **The sixth criterion's doc-block.** `plan-slices.ts` said a slice's write was the only thing
    that resets the breaker. It now names every mark, and so does `ledger.ts`.

## Falsification (verification protocol, item 1)

The new and changed test files were copied into a `git archive` of HEAD `f6fc350` in the
scratchpad and run there, so the working tree was not touched: 19 files, 55 failed and 222 passed.
`validate-checks.test.ts` and `validate-scope.test.ts` cannot load at HEAD, since the modules they
test do not exist there. Three changed files pass at HEAD, as they should:
- `migrate.test.ts`'s rich state routes `spec_review`, fixture data the new build needs;
- `run.test.ts`'s budgets name `spec_validation_rounds`, also fixture data;
- `golden-path.test.ts`'s change is a doc comment. Its T-130 reads HEAD's `INTERRUPT_PHASE` and
  `SKILL.md` in the copy, and it fails in the working tree if the skill does not name VALIDATE.

The tests the battery below added are not in this run.

```
 ❯ tests/init/decide.test.ts (18 tests | 1 failed) 2822ms
   × PRDR-282: a pack's decision log is the founder's record already (C-2⁶) > decides nothing on a changed pack either, and says VALIDATE re-validates its change 153ms
     → expected 'the pack no longer matches its confor…' to contain 'DECIDE: the documents are a changed p…'
 ❯ tests/init/write-plan.test.ts (6 tests | 3 failed) 3533ms
   × PRDR-283: the phases after WRITE plan from the pack (C-2⁶) > re-plans nothing on the next init, though DISCOVER finds the pack where the originals were 367ms
     → expected [ 'DISCOVER', 'AUDIT', 'DECIDE' ] to deeply equal [ 'DISCOVER', 'AUDIT', 'DECIDE', …(1) ]
   × PRDR-283: the phases after WRITE plan from the pack (C-2⁶) > re-runs WRITE without a session for an edit to the pack, and replays the planning phases from VALIDATE 631ms
     → expected [ 'DISCOVER', 'AUDIT', 'WRITE', …(5) ] to deeply equal ArrayContaining{…}
   × PRDR-283: the phases after WRITE plan from the pack (C-2⁶) > lets the next init through while a ticket is in flight: DISCOVER's re-run re-plans nothing, and the scan sees it (C-8″) 415ms
     → WRITE runs again and is not asked, since VALIDATE restarts the chain after it (PRDR-284): expected [ 'DISCOVER', 'AUDIT', 'DECIDE' ] to deeply equal [ 'DISCOVER', 'AUDIT', 'DECIDE', …(1) ]
 ❯ tests/init/validate-plan.test.ts (10 tests | 10 failed) 4264ms
   × PRDR-284: nothing plans from a red pack (C-2⁷) > runs no phase after VALIDATE while the checker stays red: not DETERMINE_VERIFICATION, not SLICE, not PLAN 369ms
     → expected 'PRESENT' to be 'VALIDATE' // Object.is equality
   × PRDR-284: nothing plans from a red pack (C-2⁷) > plans once the operator settles a blocker left at the ceiling, and not before 329ms
     → expected 'PRESENT' to be 'VALIDATE' // Object.is equality
   × PRDR-284: VALIDATE hands planning the pack (C-2⁶, F-4) > hands on the pack it validated, the stack markers, the log's entries and the checker's parse, and no phase runs twice 350ms
     → expected [ 'WRITE', 'ANALYZE', …(1) ] to deeply equal [ 'WRITE', 'VALIDATE', 'ANALYZE' ]
   × PRDR-284: VALIDATE hands planning the pack (C-2⁶, F-4) > runs no specification session on a conforming pack: VALIDATE's checker is DISCOVER's, and its risks are the record's (specification dec
     → docs/conformance.json is invalid: rounds.0: Unrecognized key: "changed"; rounds.1.open.0: Unrecognized keys: "id", "left", "reason"; rounds.1.open.1: Unrecognized keys: "id", "left", "reason"
   × PRDR-284: the risks reach PRESENT, beside the defaults (C-2¹⁴) > lists each major the last round left open, where it is and its fix, after the defaults 329ms
     → expected 'Plan ready for approval.\n\nVerificat…' to contain 'Risks (1) — majors VALIDATE\'s last r…'
   × PRDR-284: a re-validation reads the change and whatever cites it (C-2⁷) > reviews only the index when only the index moved, and replays the planning from VALIDATE 595ms
     → expected [] to deeply equal [ Array(1) ]
   × PRDR-284: a re-validation reads the change and whatever cites it (C-2⁷) > reviews an edited module PRD and the index that links it, and not the log or the facts 497ms
     → expected [] to deeply equal [ [ 'foundations', …(1) ], …(1) ]
   × PRDR-284: a re-validation reads the change and whatever cites it (C-2⁷) > reviews what the last validation left open with the change, since the new record replaces it 576ms
     → expected [] to deeply equal [ [ 'foundations', …(1) ], …(1) ]
   × PRDR-284: a re-validation reads the change and whatever cites it (C-2⁷) > renews the record without a round when only a context document moved 581ms
     → expected [ …(10) ] to include 'VALIDATE: nothing that moved is a doc…'
   × PRDR-284: VALIDATE restarts C-8's chain (C-8″) > lets the next init through while a ticket is in flight, and refuses a re-validation that would re-plan before any session 368ms
     → expected [ 'DISCOVER', 'AUDIT', 'DECIDE' ] to deeply equal [ 'DISCOVER', 'AUDIT', 'DECIDE', …(1) ]
 ✓ tests/kernel/migrate.test.ts (23 tests) 4710ms
 ❯ tests/init/write.test.ts (30 tests | 1 failed) 4522ms
   × PRDR-283: when WRITE writes nothing (C-2⁶, C-2¹³) > writes nothing on the pack it wrote, edited since, and says VALIDATE validates it 205ms
     → expected 'the documents are the pack WRITE wrot…' to contain 'WRITE: the documents are the pack WRI…'
 ❯ tests/init/audit.test.ts (31 tests | 1 failed) 4696ms
   × PRDR-281: a pack is not audited (specification decision 6, C-2⁷) > does not audit a changed pack as a raw PRD, and says VALIDATE re-validates its change 145ms
     → expected 'the pack no longer matches its confor…' to contain 'AUDIT: the documents are a changed pa…'
 ❯ tests/init/validate.test.ts (10 tests | 10 failed) 1716ms
   × PRDR-284: one reviewer per area, the foundations first (C-2⁶) > reviews the whole pack WRITE wrote, each area's reviewer reading the foundations before its own documents 188ms
     → expected [] to deeply equal [ [ 1, 'review', …(2) ], …(1) ]
   × PRDR-284: the stop rule (specification decision 3) > verifies a round's fixes in the next, and ends on the first round with no blocker and no major, its minor fixed and nothing launched after 17
     → expected [] to deeply equal [ [ 1, 'review', …(2) ], …(3) ]
   × PRDR-284: the stop rule (specification decision 3) > marks progress after each round and once the loop ends, so the breaker hears of a healthy validation (X-1⁵) 157ms
     → actual value must be number or bigint, received "undefined"
   × PRDR-284: the stop rule (specification decision 3) > says once that no reviewer runs a simulation, since its scratch directory is not built 204ms
     → expected [] to have a length of 1 but got +0
   × PRDR-284: the ceiling (specification decision 13) > stops at spec_validation_rounds, a ceiling and never a retry, and hands the last round's majors on as risks 136ms
     → expected [] to deeply equal [ 1, 1, 2, 2 ]
   × PRDR-284: the ceiling (specification decision 13) > stops init at VALIDATE with AWAIT_INFO for a blocker left at the ceiling, and asks again, running nothing, while nothing moves 164ms
     → expected 'READY' to be 'VALIDATE' // Object.is equality
   × PRDR-284: the ceiling (specification decision 13) > carries on from the round it stopped at once the operator settles the blocker in the pack, one round more 179ms
     → expected [] to deeply equal [ [ 2, 'verify', …(2) ], …(1) ]
   × PRDR-284: the ceiling (specification decision 13) > carries on up to a ceiling the operator raised, without an edit 202ms
     → expected [] to deeply equal [ 1, 1, 2, 2, 3, 3 ]
   × PRDR-284: a validation cut short carries on from its record (C-2¹⁴) > resumes at the round after the last one recorded, verifying what it fixed, when a session dies mid-round 127ms
     → promise resolved "{ exitCode: +0, …(6) }" instead of rejecting
   × PRDR-284: a validation cut short carries on from its record (C-2¹⁴) > finishes without a round when the record's last round already met the stop rule 186ms
     → expected [] to have a length of 2 but got +0
 ❯ tests/init/config-defaults.test.ts (11 tests | 2 failed) 422ms
   × PRDR-197 effort_routing is validated on both axes > a first init writes the key, so the knob is discoverable 21ms
     → an operator must be able to see, in the file they edit, the level each role runs at: expected { planner: 'max', …(9) } to deeply equal { planner: 'max', …(10) }
   × PRDR-263 init writes the effort routing > routes every role — the planner, audit, spec_write and spec_review at max, the other seven at xhigh 20ms
     → spec_review decides what in the pack is wrong before anything plans from it (S-5⁵): expected undefined to be 'max' // Object.is equality
 ❯ tests/init/pack-written.test.ts (5 tests | 3 failed) 802ms
   × PRDR-283: DISCOVER calls a pack nothing has validated written > whatever its record's checker said, and counts what the checker blocks on in it now 261ms
     → docs/conformance.json is invalid: rounds.0: Unrecognized key: "changed"; rounds.1.open.0: Unrecognized keys: "id", "left", "reason"; rounds.1: Unrecognized key: "changed"
   × PRDR-283: DISCOVER calls a pack nothing has validated written > stays written after an edit, which VALIDATE's first run checks with the rest, and counts a break it makes 262ms
     → docs/conformance.json is invalid: rounds.0: Unrecognized key: "changed"; rounds.1.open.0: Unrecognized keys: "id", "left", "reason"; rounds.1: Unrecognized key: "changed"
   × PRDR-283: DISCOVER calls a pack nothing has validated written > says so at DISCOVER: written by WRITE, not validated, and what the checker blocks on 3ms
     → expected 'the documents are the pack WRITE wrot…' to be 'the documents are the pack WRITE wrot…' // Object.is equality
 ❯ tests/init/audit-role.test.ts (9 tests | 3 failed) 1071ms
   × PRDR-281, PRDR-282: the v1→v2 migration routes the new roles (F-3″, S-5′) > writes audit's default model and effort into a config that routes other roles but not audit 287ms
     → expected { planner: 'claude-fable-5-1', …(2) } to deeply equal { planner: 'claude-fable-5-1', …(3) }
   × PRDR-281, PRDR-282: the v1→v2 migration routes the new roles (F-3″, S-5′) > leaves a routed audit as the config says, model and effort separately 248ms
     → expected { audit: 'claude-sonnet-5', …(1) } to deeply equal { audit: 'claude-sonnet-5', …(2) }
   × PRDR-281, PRDR-282: the v1→v2 migration routes the new roles (F-3″, S-5′) > gives a config that never routed anything the new roles' routing alone 262ms
     → expected { audit: 'claude-opus-5-5', …(1) } to deeply equal { audit: 'claude-opus-5-5', …(2) }
 ❯ tests/kernel/x1-counting.test.ts (15 tests | 1 failed) 1657ms
   × PRDR-265 a converted ceiling declares NONE and keeps its counting site > keeps every ceiling's DEFAULT exactly where it was — what changes is whether crossing it halts 5ms
     → no key is deleted — they stay configurable and reported: expected [ 'blind_fix_attempts', …(16) ] to have a length of 18 but got 17
 ✓ tests/docs/golden-path.test.ts (17 tests) 61ms
 ❯ tests/sessions/prompts.test.ts (21 tests | 2 failed) 22ms
   × T-047 the roles are a pinned wire format (S-1, S-7) > the role ids are exactly S-1's eight and S-1‴'s audit, spec_write and spec_review, in order — adding or renaming one is an F-3 schema ev
     → expected [ 'planner', 'diagnose', …(8) ] to deeply equal [ 'planner', 'diagnose', …(9) ]
   × T-047 the roles are a pinned wire format (S-1, S-7) > the read-only set is S-1's four and S-1‴'s audit and spec_review 1ms
     → expected [ Array(5) ] to deeply equal [ Array(6) ]
 ❯ tests/init/machine.test.ts (19 tests | 2 failed) 2764ms
   × T-060 C-5: the interrupt set is closed > exactly five interrupts, each anchored to the phase that may raise it 9ms
     → expected { AWAIT_DOCS: [ 'DISCOVER' ], …(4) } to deeply equal { AWAIT_DOCS: [ 'DISCOVER' ], …(4) }
   × T-060 C-5: the interrupt set is closed > the phase order is C-4.1's, as C-2⁶ amends it 1ms
     → expected [ Array(11) ] to deeply equal [ 'INIT_FS', 'DISCOVER', …(10) ]
 ❯ tests/oracle/budgets.test.ts (7 tests | 1 failed) 164ms
   × T-012 unit budgets (X-1, D-12) > the X-1 table has exactly eighteen keys, and the adapter timeouts derive from it (PRDR-061) 10ms
     → expected [ 'blind_fix_attempts', …(16) ] to have a length of 18 but got 17
 ❯ tests/init/validate-writer.test.ts (15 tests | 15 failed) 2016ms
   × PRDR-284: the checker first (C-2⁶) > has its writer fix a red checker before any round, told the checker's findings, and reviews the whole pack after 202ms
     → expected undefined to match object { task: 'fix', source: 'checker' }
   × PRDR-284: the checker first (C-2⁶) > stops init at VALIDATE when two attempts leave the checker red, with the pack as it was, and no round 140ms
     → expected 'READY' to be 'VALIDATE' // Object.is equality
   × PRDR-284: what the writer leaves open (C-2¹⁴) > undoes every fix of a round that leaves the checker red, leaves its findings open as undone, and goes on 150ms
     → relaunched once with the checker's words: expected [] to have a length of 2 but got +0
   × PRDR-284: what the writer leaves open (C-2¹⁴) > leaves a declined finding open with its reason, which the next round's verifier is shown 151ms
     → expected undefined to match object { Object (open, changed) }
   × PRDR-284: what the writer leaves open (C-2¹⁴) > counts a finding the writer says it applied, and changed no document for, as declined 206ms
     → expected undefined to deeply equal [ ObjectContaining{…} ]
   × PRDR-284: what the writer leaves open (C-2¹⁴) > relaunches an account that leaves a finding out, and counts it declined if the second does too 151ms
     → Cannot read properties of undefined (reading 'issue')
   × PRDR-284: what the writer leaves open (C-2¹⁴) > puts the decision log back when a fix changes a row it held, and relaunches with why 133ms
     → expected '# Founder decisions\n\nWhat `detent i…' to be '' // Object.is equality
   × PRDR-284: what the writer leaves open (C-2¹⁴) > asks for a cite of a default the writer added, and says it is owed when the second attempt still omits it 157ms
     → the next free id, counted over the log as it was before the round: expected undefined to be 'X-5' // Object.is equality
   × PRDR-284: what the writer leaves open (C-2¹⁴) > fails the phase, with the pack as it was, when the writer's account is unusable twice 175ms
     → promise resolved "{ exitCode: +0, …(6) }" instead of rejecting
   × PRDR-284: a reviewer's finding stands where it says (C-2¹⁴) > relaunches a review whose quote is not at its line, and keeps the finding the second attempt places 108ms
     → Cannot read properties of undefined (reading 'issue')
   × PRDR-284: a reviewer's finding stands where it says (C-2¹⁴) > drops a finding the second attempt still places wrong, says so, and counts it nowhere 94ms
     → expected 'AUDIT found 1 contradiction, 1 gap, 0…' to contain 'VALIDATE round 1, Lending: a finding …'
   × PRDR-284: a reviewer's finding stands where it says (C-2¹⁴) > relaunches a review that did not read a document it was given, and names the document when the second does not either 83ms
     → Cannot read properties of undefined (reading 'issue')
   × PRDR-284: a reviewer's finding stands where it says (C-2¹⁴) > fails the phase when a reviewer writes no usable review twice, and records no round 92ms
     → promise resolved "{ exitCode: +0, …(6) }" instead of rejecting
   × PRDR-284: a reviewer's finding stands where it says (C-2¹⁴) > gives each reviewer the checker's heuristic reports on its documents, marked as a heuristic's, and never stops the loop on them (
     → expected undefined to deeply equal [ ObjectContaining{…} ]
   × PRDR-284: VALIDATE's sessions and what they may write (S-1‴, S-5⁵) > runs its reviewers as spec_review, reading and writing their artifact alone, and its writer as spec_write over the pack's
     → no Edit, no Write but its artifact's, no Bash: expected undefined to deeply equal [ 'Glob', 'Grep', 'Read' ]
 ✓ tests/kernel/run.test.ts (30 tests) 21715ms
 ❯ tests/init/validate-checks.test.ts
   Error: Failed to load url ../../src/init/validate-checks.js … Does the file exist?
 ❯ tests/init/validate-scope.test.ts
   Error: Failed to load url ../../src/init/validate-scope.js … Does the file exist?

 Test Files  16 failed | 3 passed (19)
      Tests  55 failed | 222 passed (277)
```

## Mutation battery (verification protocol, item 2)

The battery ran 126 mutants, one defect each, against 19 test files: the five new ones, plus the
suites for WRITE, the pack, AUDIT, DECIDE, the machine, the roles and their routing, the prompts,
the guard, the ceilings, the migration and the golden path. Each file was restored from a
snapshot copy, never by `git checkout`, and its hash checked. The first pass killed 106 and 20
survived:
- **Four equivalent.**
  - **5**, an edit earning no round past the ceiling. A loop always runs the round it starts
    with, so `Math.max(ceiling, rounds + 1)` was the ceiling on every path. The code now reads
    the ceiling, and its doc-block says why an edit earns one round past it.
  - **29**, a ceiling round that meets the stop rule leaving fixes unverified. Such a round has no
    blocker or major to leave unverified, so the stop-rule clause was redundant, and is gone.
  - **13**, blockers counted as risks. A validated record's last round never holds an open
    blocker, since a blocker at the ceiling stops `init` instead of finishing.
  - **21**, no mark when VALIDATE runs no session. VALIDATE follows WRITE, which marks when it
    completes, and a VALIDATE with no session spends nothing after that mark.
- **One malformed.** **74**, the writer given no log entries, was written as `[] && entries`,
  which evaluates to `entries`. It was re-run as `[] || entries`, below.
- **Two killed by suites the battery did not run.** `pack-discover.test.ts` kills **110**, an
  added document not counted as moved. `prd-specification-phase.test.ts` kills **120**, a ceiling
  default of 7. Each now has a test of VALIDATE's own too, and the second gains an unconditional
  pin now that the key exists.
- **Thirteen real gaps**, each now covered by a new test or assertion:
  - **4**, a removal not counted as a move, and **18**, an area with only a finding to verify
    being skipped. No test settled a blocker by removing its document.
  - **10**. No resume had an open finding in a document that no fix changed.
  - **15**. No ceiling round had a minor beside its major.
  - **33** and **34**. No test checked a round's scope where a finding's document and a fix's
    document differ.
  - **40**. The completion mark could not be told from the last round's, since nothing is spent
    between them. The unit cost the completion records, $0, now tells them apart.
  - **60** and **68**. No writer's fixes left the pack with no requirement while the checker
    stayed green.
  - **75**. Nothing checked that the writer was given the pack's paths and the precedence.
  - **76**. The diff test looked for an added line, which a diff against no file also shows.
  - **112**. No writer added a default that PRESENT then had to list.
  - **121**. Nothing refused a ceiling of 0 or a fraction.

The second pass re-ran the survivors against the grown tests, with 74 corrected. It also ran five
mutants on the code the first pass changed: the resume's ceiling check off by one, a resume that
never concludes, a met stop rule that does not conclude, the loop's ceiling off by one, and fixes
at the ceiling left applied. It killed 21 of 23. The two it did not kill are 13 and 21, both
equivalent, as above. 5 and 29 are gone with the code they stood on.

Every mutant that changes behaviour is killed: 106 in the first pass, the 16 real survivors in the
second, and the five on the changed code.

## What changed

- **`src/init/validate.ts`** (new): the phase.
  - `validatePhase`: restarts the chain, and is keyed after it runs by `packDigest`, read from the
    disk alone. Its reviewers run as `spec_review`, and its writer as `spec_write` with
    `PACK_PATHS` as the surface.
  - `validateStage`: classifies, runs the checker first, then carries on, concludes or loops.
  - `startOf`, where a validation starts; `checkerFirst`; `loop`, the rounds; `conclude`, the
    ceiling; `finished`, the record and the handoff; `risksOf`; `openOf`; `tasksFor`.
- **`src/init/validate-round.ts`** (new): the sessions of a round.
  - `reviewArea`: one reviewer, strict and then kept.
  - `fixFindings`: one writer, checked as WRITE's is, with rollback.
  - The artifact paths and skeletons, and `diffPath` and `writeDiff`.
- **`src/init/validate-checks.ts`** (new): what code checks of the sessions:
  - `checkReview`, `mergeFindings` and `countsOf`;
  - `fixIssues` and `outcomes`.
- **`src/init/validate-scope.ts`** (new): the areas, and the citing: `areasOf`, `areaOf`,
  `reviewable`, `citing` and `scopeOf`.
- **`src/schemas/validate.ts`** (new): the review and fix artifacts, and the nine finding
  categories.
- **`src/init/present-spec.ts`** (new): PRESENT's defaults block, moved out of `present.ts`, and
  the risks block after it.
- **`src/schemas/pack.ts`**: the record's rounds gain an id, `left` and a reason on each open
  finding (`OPEN_REASONS`), and `changed` on each round.
- **`src/init/pack.ts`**: `movedSince`, shared by `classifyPack` and VALIDATE, and `packNote`'s
  written text.
- **Checker and machine wiring:**
  - `src/schemas/budgets.ts` adds `spec_validation_rounds`, and `src/kernel/budgets.ts` its
    enforcement site;
  - `src/schemas/init.ts` adds VALIDATE to `INIT_PHASES` and to AWAIT_INFO's phases;
  - `src/schemas/roles.ts` adds `spec_review`, read-only, routed to `claude-opus-5-5` at `max`;
  - `src/sessions/guard.ts` adds `spec_review` to `READ_ONLY_STAGES`;
  - `src/kernel/migrate.ts` routes `spec_review` in the v1→v2 entry, and its doc-block says why
    the rounds key and the record's rounds need no step;
  - `src/init/pipeline.ts` registers the phase, and ANALYZE reads VALIDATE's outputs first.
- **The handoff:** `write.ts` exports `handoff` and `packDigest`, and `planningMarkers`,
  `planningDocs` (`decide.ts`) and PRESENT's `logged` read VALIDATE's outputs first.
  `pack-check-refs.ts` exports the reference patterns that `validate-scope.ts` reads.
- **Notes and doc-blocks made true:**
  - AUDIT's, DECIDE's and WRITE's notes on a written or changed pack;
  - `packNote`;
  - `machine.ts`'s header, `keyedAfterRun`, `restartsChain` and `REPLAN_FROM`;
  - `replan-guard.ts`, `decide-log.ts`'s `LogView.ids`, and `pack-check.ts`'s first unchecked
    property;
  - `plan-slices.ts` and `ledger.ts` on the progress marks (the sixth criterion).
- **The prompts:** `prompts/spec_review.md` is new, `prompts/spec_write.md` gains the `fix` task,
  and `prompts/manifest.json` changes with them.
- **Docs:**
  - `detent-prd-v3.md` adds C-2¹⁴, with pointers on S-1″, C-8″, C-8‴, C-2⁶, C-2⁷, C-3⁗, D-10′,
    C-7″, S-1‴, C-2⁹, C-2¹⁰, C-2¹¹, C-2¹² and C-2¹³;
  - the README and `skills/init/SKILL.md` name the twelve phases and say what VALIDATE does;
  - PRDR-285, PRDR-286 and PRDR-290 each gain a "From PRDR-284" section.
- **Tests:**
  - new: `tests/init/validate.test.ts`, `validate-writer.test.ts`, `validate-plan.test.ts`,
    `validate-scope.test.ts`, `validate-checks.test.ts` and `validate-fixture.ts`;
  - `write-fixture.ts` routes the `fix` task and runs through a chosen set of phases;
  - `plan-fixture.ts`'s `planningPipeline` and `decide-fixture.ts`'s `initThrough` leave VALIDATE
    out;
  - pins moved:
    - the phase order and AWAIT_INFO's phases (`machine.test.ts`, `golden-path.test.ts`);
    - the roles and the read-only set (`prompts.test.ts`);
    - the routing (`config-defaults.test.ts`, `audit-role.test.ts`, `migrate.test.ts`);
    - the eighteen ceilings, and the rounds ceiling's default and bounds (`budgets.test.ts`,
      `x1-counting.test.ts`, `run.test.ts`, and `prd-specification-phase.test.ts`, whose pin is
      unconditional now that the key exists);
    - the record's rounds (`pack-fixture.ts`);
    - the notes (`audit.test.ts`, `decide.test.ts`, `write.test.ts`, `pack-written.test.ts`);
    - what WRITE hands on now that VALIDATE follows it (`write-plan.test.ts`).

## Recorded, not fixed

- **No reviewer simulates.** The scratch directory and its sandbox are PRDR-285's. Until then the
  invariants a pack states, a ledger's or a state machine's, are read and never run, and VALIDATE
  says so once per run. ksarjs's money defects were found and confirmed by simulation.
- **Amendments are PRDR-286's.** An amendment's edit reaches VALIDATE as any edit does, and is
  refused by both of the in-flight guard's asks while its filing ticket is NEEDS_HUMAN.
- **Nothing reads the checker's parse.** VALIDATE hands it on, and SLICE and PLAN still receive
  ANALYZE's analysis until PRDR-290.
- **Each phase's spend beside planning's** (C-2⁶, decision 16) is reported for none of the four
  phases. Their sessions are on the ledger against ticket `init`, as every init session is.
- **A changed decision log or facts file re-validates widely.** It reaches every document citing
  any entry of it, since the record keeps no earlier copy to say which entry moved.
- **Findings merge only on an exact match.** Two findings of one category at the same `file:line`
  set merge. One that names an extra passage, or the same defect under another category, stays
  apart and costs the writer a second look.
- **"Applied" is judged per round, not per finding.** A writer that changed one document and
  listed ten findings as applied has all ten counted as applied. The next round's verifiers judge
  each fix, but at the ceiling no round does.
- **A validation killed mid-round loses that round.** Its findings were never recorded, so the
  round that carries on reviews what moved, including a writer's partial edits, without those
  findings or a diff of them. The applied findings of the last recorded round are not in the
  record either, only its open ones, its changed documents and its kept diff. So a verifier after
  a crash sees less than one in an unbroken loop.
- **A document a reviewer did not read is named, not re-reviewed.** The second attempt's note
  says so, the record does not, and the next round reviews that document only if its scope
  reaches it.
- **Reviewers run one after another.** On a pack of many areas, a round's wall-clock is the sum of
  its reviewers'. Running them in parallel is a change to how every init session is journaled.
- **One writer per round.** Whether one session applies a round of many areas' findings within
  its turns is untested at ksarjs's size, as WRITE's one session is (C-2¹³).
- **A checker VALIDATE's writer cannot make green costs a writer session on every `init`** until
  the operator fixes it, since nothing marks the stop.
- **Minors are fixed and never verified**, at the stop rule and at the ceiling alike (decision 3).
