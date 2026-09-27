---
id: PRDR-293
title: "Code proves defects in the plan and nothing fixes them: ksar-cloud's plan was approved with 34 of them (28 names consumed that no ticket provides, 6 names with two owners), because proved findings are only reported and the reviewer is told to treat them as handled; and requirement coverage is claimed but never checked. Mechanical checks now drive one targeted redraft, run across the whole plan in place of the review that overflowed, and block approval when they still fail"
state: DONE
severity: major
category: capability
labels: ["prd-review", "planning-redesign", "operator-decision", "A-1‴", "coverage", "contracts"]
surface: ["src/init/contracts.ts", "src/init/plan.ts", "src/init/plan-slices.ts", "src/init/plan-whole.ts", "src/init/plan-review.ts", "src/init/present.ts", "src/cli/approve.ts", "src/kernel/plan-findings.ts", "src/schemas/init.ts", "tests/init/plan-checks.test.ts"]
prd_refs: ["A-1‴", "C-2⁗", "C-3′", "C-4″", "C-5", "C-7", "PRDR-117", "PRDR-120", "PRDR-193", "PRDR-201", "PRDR-278"]
acceptance_criteria: ["After each slice's draft, and after its revision, code checks five things. Coverage: every requirement id and baseline item of the slice is in some ticket's `requirement_ids` or `baseline_items` (A-1⁷, PRDR-278), every criterion id of those requirements is in some ticket's `criterion_ids`, and no ticket names an id from outside its slice. Contracts: every consumed name is provided in this slice or an earlier one, no name has two providers, and derived edges are added as today. Milestone order. Gate coverage (PRDR-295). And no cycle after derived edges.", "A failing slice gets one targeted redraft with the failures as its inputs, and the checks run again. A test seeds each kind of failure and asserts that the redraft receives it.", "After every slice, the same checks run across the whole plan. A name nobody provides sends one redraft to the earliest slice that consumes it; a name with two providers sends one to each owner's slice.", "What still fails blocks approval. PRESENT raises AWAIT_INFO naming each failure, and `detent approve` refuses the plan. A test drives a residual failure to that refusal.", "The whole-plan model review is gone, and with it the `already_found` hand-off and its instruction to treat proved findings as handled. Contract findings reach redrafts, and any left reach the run phase with their tickets.", "The claim in `src/schemas/init.ts` that every requirement id lands in exactly one slice is now what code checks, and the doc-block says where."]
non_goals: ["Does NOT judge what only a model can judge: sizing, shape and coherence stay the reviewer's (PRDR-294).", "Does NOT add a second redraft: one targeted attempt, then the operator.", "Does NOT add a model read of the cross-slice contracts. One is added only if run-time outcomes show tickets failing on contracts the checks passed (the redesign's decision 10)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-120", "PRDR-193", "PRDR-201"]
depends_on: ["PRDR-292", "PRDR-295"]
---

# PRDR-293 — mechanical checks that fix, and block approval

## Where this came from

The planning audit of 2026-09-26, §2 and §5.
- `resume-20260918-072057.log:144-146`: the whole-plan review was refused twice, at about 1.55M
  tokens against a 1M limit, and "the plan was never reviewed as one thing".
- The same log lists 34 contract findings proved by code. The plan was approved with all of them.

## Problem

Proved defects never reach a fix:
- The whole-plan reviewer is handed them as `already_found` and told to treat them as handled
  (`src/init/plan-review.ts:246`).
- They are kept out of `review_findings` (`src/init/plan.ts:333-345`), the only list the run phase
  reads (`src/kernel/plan-findings.ts:44-47`).
- Only PRESENT prints them.

Coverage is worse. `src/schemas/init.ts:508` states that every requirement id lands in exactly one
slice, and no code checks it.

## Design

The redesign plan's §6. A proved defect needs no reviewer to confirm it, so it drives a redraft
directly. The checks grow with the plan's size where the review grew with its text, and a failure
that survives its one redraft is the operator's before approval, not a line in a report.

## From PRDR-291

On a pack, code checks SLICE's cut (`cutIssue` in `src/init/slice-seed.ts`):
- every live requirement id in exactly one slice;
- no id the seed does not hold;
- milestone order.

The doc-block on `sliceSchema` in `src/schemas/init.ts` says where. Two things stay with this
ticket's sixth criterion. The first is the plan's coverage: whether each slice's tickets carry its
ids (A-1⁷). The second is the same claim where there is no parse, and for the baseline items at
all. There the slicer is told it, and no code checks it.

SLICE announces the session formula of planning as built (`planningSessions` in
`src/init/slice.ts`):
- at least `4N + 1`: a draft and three review reads per slice, and one whole-plan review;
- 4 more for each revision round;
- `C + 1` more when the whole-plan review faults C slices.

Deleting the whole-plan review changes that sentence, and the formula case in
`tests/init/slice-seed.test.ts` pins it.

The whole-plan review's cache key (`wholeKey` in `src/init/plan-whole.ts`) hashes the slices whole,
titles and goals included, since the review reads them. A re-cut in new words re-runs it. On a pack
that happens only when the band, the baseline or the prompt moves, since a cut on record keeps its
slices' words otherwise.

## From PRDR-292

- A ticket carries `criterion_ids` (A-1). Code refuses a draft whose ticket names a criterion the
  pack does not define, or names one without carrying its words among its acceptance criteria
  (`draftIssues` in `src/init/plan-draft-checks.ts`). Nothing counts whether every criterion of a
  slice's requirements is carried: that is this ticket's first criterion.
- A name of a catalogued kind that its catalogue lacks is a `traceability` finding among the
  contract checks (`catalogueFindings` in `src/init/contracts.ts`). PRDR-292's third criterion
  calls it a contract failure of this ticket's. It is reported and refuses nothing. Turning it into
  a redraft's input, and holding approval on it, is this ticket's.
- `already_found` hands the whole-plan review the contract checks' findings, and two coverage
  findings in `src/init/contracts.ts` cite PRD marks (`A-1⁵`, `C-8`). A drafter's inputs cite none
  (C-4⁷). Once this ticket hands proved findings to a redraft, their words reach a drafter, so they
  should cite none either.
- A redraft reports spec defects as a first draft does, and PLAN keeps each draft's once per slice
  and set of passages: the revision's in `src/init/plan-slices.ts`, the whole-plan redraft's in
  `src/init/plan-whole.ts`. A targeted redraft can keep them the same way.
- Without a pack, `prompts/slice.md` now states that placing every requirement id the documents
  define is the slicer's own judgement, since no parse lists those ids. This ticket's sixth
  criterion still covers the claim there.

## From PRDR-295

- A-1⁷'s gates check is built as a check of its own, at PRESENT: `ungatedPaths` in
  `src/init/present-gates.ts` lists each path of a ticket that is not DONE lying in a package that
  binds none of `lint`, `typecheck` and `test`, and each package manifest a ticket writes in a
  directory that is not a package. PRESENT raises AWAIT_INFO on it and records the count as
  `ungated` in `presentation.json`, and `detent run`'s deferred approval refuses while the count is
  not zero. It runs once, over the whole plan, and no draft is redrafted for it. This ticket makes
  it one of the checks that run after each slice's draft, with the rest, and hands its failures to
  the targeted redraft.
- A drafter is told a package's gates only as labels in `bound_slots` (`web:test`), not which
  packages exist or which have none. A redraft sent for an ungated path needs the packages and
  their bound slots among its inputs, or the failure's own words, to narrow the surface.

## Building it

A-1⁷ is built, and the PRD records it as A-1⁸. `src/init/plan-checks.ts` holds the checks, one pure
function over the plan in five families, with V-5″'s gate check moved from `present-gates.ts` into
`src/init/plan-check-gates.ts`. `src/init/plan-redraft.ts` sends a failing slice its one redraft,
`src/init/plan-cross.ts` runs the checks across the plan after every slice and sends what they find,
and `src/init/present-checks.ts` runs them again at PRESENT, on the tickets as they stand, and holds
approval. The whole-plan review is deleted: `src/init/plan-whole.ts` and its suite,
`src/init/present-gates.ts`, `already_found` and the instruction to treat what code proved as
handled, the review's `whole` scope, and its line in the revision notes. What the line ceiling moved
out of `plan-slices.ts`, `plan.ts` and `pipeline.ts` is in `src/init/plan-normalise.ts` (A-1″'s
repairs of a draft), `src/init/plan-cache.ts` (a cached ticket's schema) and
`src/init/planning-outputs.ts` (what PLAN and PRESENT read from the phases before them).

The acceptance criteria, as built:
1. **Five checks, after each draft and each revision.** Coverage: each requirement id and baseline
   item a slice holds is named in one of its tickets' `requirement_ids` or `baseline_ids`, each
   criterion that tests a live requirement is in some ticket's `criterion_ids`, and no ticket names
   an id its slice does not hold. Contracts: A-1‴'s checks, a catalogued kind named by its catalogue
   id (C-4⁷), and a consumer whose provider lies in a later slice; derived edges are added as
   before. Milestone order. Gates, V-5″'s. The graph: an edge A-1‴ refuses because it would close a
   cycle, and a cycle that remains. `tests/init/plan-checks.test.ts` holds 19 cases, one or more per
   family. The criterion says `baseline_items` for a ticket's field; that is a slice's field, and a
   ticket's is `baseline_ids`, which is what the check reads.
2. **One targeted redraft.** A failing slice's drafter is handed `check_failures`, each failure's
   family, ticket and words, and `draft`, the tickets as drafted, and the checks run again.
   `tests/init/plan-redraft.test.ts` seeds each of the five families in a slice's first draft and
   asserts that the redraft receives the failure and its draft, is the one redraft, and passes; a
   sixth case does the same for a revision.
3. **Across the plan.** After every slice, reused or planned, the checks run over the plan so far.
   Two tests: a name with two providers sends one redraft to each owner's slice, and a name nobody
   provides sends one to the earliest slice that consumes it and none to a later consumer. Three
   more cover the record: a resumed PLAN reuses a redraft, one that died after it does not pay for
   it again, and `--replan` sends it again.
4. **What still fails blocks approval.** PRESENT runs the checks on the tickets under
   `.detent/plan/`, names each failure and raises AWAIT_INFO before approval is offered, so an
   approval flag is never asked, and records the count as `check_failures` in `presentation.json`;
   `detent run`'s deferred approval presents the plan and refuses while it is not zero. The tests
   drive one residual failure to both refusals, and show an operator's edit of the ticket clearing
   it. `detent approve <id>` promotes a ticket and approves no plan, so this reads "`detent approve`
   refuses the plan" as approval's two exits (vetoable call 17).
5. **The whole-plan model review is gone**, with `already_found` and its instruction; a test
   asserts that no review is launched for anything but a slice and that no input carries
   `already_found`. What the checks prove reaches a redraft. "Any left reach the run phase with
   their tickets" is not built: a plan with a failure left is not approved, so none reaches `run`
   (vetoable call 18).
6. **The claim in `src/schemas/init.ts`.** `sliceSchema`'s doc-block names the three places code
   checks that each id lands in exactly one slice: C-2¹⁵'s cut on a pack, `slicesSchema`, which now
   refuses an id or a baseline item placed in two slices, pack or none, and these checks. Which ids
   documents without a parse define, and which baseline items apply, stay the slicer's judgement.

### Vetoable calls

1. **One pure function.** `checkPlan` runs every family over the plan and returns the failures, each
   with its family, the slice it lies in and a key that names it across drafts. A slice's own
   redraft is sent the failures that lie in it.
2. **A slice naming none of its items fails for each.** A-1⁵ reported that slice as "undeclared",
   so a cache from before the fields was not read as a plan that dropped them. Every such cache
   misses its key now, since PLAN's prompt moved, and a failure is sent to a redraft, which is what
   the report asked the operator to do.
3. **Where a criterion is due.** In the last slice holding a live requirement it tests, once that
   slice is drafted, since it cannot be verified before that slice's work exists. A ticket anywhere
   in the plan carrying it covers it. A criterion that tests only withdrawn requirements is not due.
4. **Foreign ids.** A requirement, a baseline item, and on a pack a criterion, which counts as the
   slice's where it tests one of the slice's requirements.
5. **Two providers** fail once in each owner's slice, naming that slice's first owner, since each
   slice is sent the failure.
6. **A provider in a later slice** is a `contracts` failure. A-1‴ reported it and derived no edge,
   and still derives none.
7. **Milestones.** A ticket's milestone is the earliest of the requirements it delivers. It fails
   when any chain of its edges, through tickets that deliver nothing too, reaches a ticket
   delivering a later milestone's requirement, and the nearest such ticket is named with the chain.
   One failure per ticket.
8. **The graph.** A refused derived edge is a `graph` failure. A cycle that remains can come only
   from an edit of the tickets, since A-1″ breaks a drafted one, so it is checked for PRESENT's
   sake, once per cycle.
9. **DONE work** provides its names, including DONE tickets this plan no longer drafts, and no
   failure names a DONE ticket, except a name with two providers, whose other owner still yields.
10. **Gates at PLAN** are checked where bindings exist when PLAN runs; PRESENT checks them always.
11. **At most two redrafts from a slice's own checks**, one after its draft and one after its
    revision. The review reads the draft after the first. The redraft after a revision, and every
    redraft across the plan, is judged by the checks alone.
12. **What a redraft is handed.** `check_failures` and `draft`, the latter without the slice tag
    Detent adds. A-1″'s repairs apply to a redraft as to a draft, and its spec defects are kept.
13. **Routing across the plan.** A name nobody provides goes to the earliest slice that consumes it,
    a name with two providers to each owner's slice, and the rest to the slice they lie in. The
    failures are checked again before each slice. A slice is sent a failure once, whether its own
    checks or these sent it. A pass runs at most three rounds (`CROSS_ROUNDS`).
14. **Ids later slices depend on** are handed as `keep_ids`, and a redraft that drops one is
    discarded; the slice stands, and the failure counts as sent.
15. **The record.** `.detent/state/plan-checks.json`, keyed by the slice's own key, its draft, the
    failures, the ids it keeps and the tickets it builds on; written before the next launch, pruned
    to what the run used when PLAN ends, and wiped by `--replan` with the slice caches (C-8′).
16. **PRESENT reads the tickets on disk**: a ticket's blockers are its edges, its slice is the one
    `plan.json` lists it in, and the bootstrap, in none, is checked for its gates and its graph.
    `check_failures` replaces V-5″'s `ungated`.
17. **"`detent approve` refuses the plan"** is read as both of approval's exits, `init`'s PRESENT and
    `run`'s deferred approval.
18. **No failure reaches the run phase.** The criterion's "any left reach the run phase with their
    tickets" would carry them into `review_findings`, which sessions read. A plan cannot be approved
    with a failure left, and a failure an edit had cleared would reach sessions stale, so
    `src/kernel/plan-findings.ts` is unchanged.
19. **A failure's words cite no PRD mark**, since a drafter reads them; a line reads
    `family (ticket): words`.
20. **`slicesSchema` refuses an id placed in two slices**, pack or none.
21. **The whole-plan review's cache takes no migration step.** Nothing reads
    `state/whole-plan.json`, and a state holding it keeps it as it was.
22. **SLICE's announcement** counts `4N + 4R + C`: no whole-plan review, and one session for each
    redraft the checks send.
23. **The prompts.** `prompts/plan.md` lists the checks under "What Detent checks", with the
    inputs a redraft is handed, and A-1″'s repairs under what Detent does itself.
    `prompts/plan_review.md` judges one slice, and `coherence` within it or against `plan_index`.
24. **The coverage harness** (`scripts/coverage-report.ts`) calls `checkPlan` and keeps its coverage
    family, without the pack's parse, so it judges what SLICE assigned and no criterion.
25. **A presentation carrying `ungated` is not migrated.** Only a build of the unreleased 3.1.1 line
    wrote it; it does not parse, and `run` sends the operator to `detent init`, as for any record
    it cannot read.

## Falsification (verification protocol, item 1)

The two new suites and the two fixtures they share were copied into a `git archive` of HEAD
`475a960` in the scratchpad and run there, against HEAD's source, so the working tree was not
touched. A `diff -r` against a fresh archive shows the copy's `src/`, `prompts/`, `skills/` and
`scripts/` unchanged.

`tests/init/plan-checks.test.ts` fails to load: HEAD has no `src/init/plan-checks.ts`. All 15 cases
of `tests/init/plan-redraft.test.ts` fail, each on what it tests:

```
 × coverage: the redraft receives the failure …    → expected [] to include 'coverage'
 × contracts: …                                     → expected [] to include 'contracts'
 × gates: …                                         → expected [] to include 'gates'
 × graph: …                                         → expected [] to include 'graph'
 × milestones: …                                    → expected [] to include 'milestones'
 × a revision that fails a check is redrafted once too  → expected '' to contain '`NOPE`'
 × a name with two providers sends one redraft to each owner's slice
                                                    → expected [] to deeply equal [ 'contracts' ]
 × a name nobody provides sends one redraft, to the earliest slice that consumes it
                                                    → expected [ … ] to have a length of 2 but got 1
 × a redraft the checks across the plan sent is written down, and a resumed PLAN reuses it
                                                    → expected [ … ] to have a length of 2 but got 1
 × a redraft is written down before the next launch …
   → s01's redraft across the plan ran before s03 died:
     expected [ 'PLAN:s01', 'PLAN:s02', 'PLAN:s03' ] to deeply equal [ 'PLAN:s01', 'PLAN:s02', …(3) ]
 × `--replan` sends it again …                      → expected [ 'PLAN:s01', 'PLAN:s02', 'PLAN:s03' ] to deeply equal [ … ]
 × PRESENT names each failure and raises AWAIT_INFO, and an approval flag is never asked
   → the failure bought one redraft, which kept it: expected [ … ] to have a length of 2 but got 1
 × `run` presents the plan and refuses to offer approval while a check fails
                                                    → expected 1 to be +0
 × an operator who edits the ticket answers the failure: PRESENT checks the tickets as they stand
                                                    → expected 'AWAIT_APPROVAL' to be 'AWAIT_INFO'
 × no session reviews the plan as one thing …       → expected false to be true
 Test Files  2 failed (2)
      Tests  15 failed (15)
```

At HEAD a failing draft is sent no failure and no redraft, a name nobody provides or two provide is
redrafted nowhere, PRESENT offers approval over a proved defect, `run` asks once, and the whole-plan
review runs.

## Mutation battery (verification protocol, item 2)

The battery ran 50 mutants, one defect each, against the two new suites and every suite under
`tests/init`, with `run-approval`, `plan-corpus` and `migrate` where a mutant reaches them. Each file
was restored from a snapshot, never by `git checkout`, and checked byte for byte after every
mutant; at the end all 15 files matched the snapshot directory. The mutants covered:
- **The checks:** every failure kept, a DONE ticket's among them; a two-provider failure dropped
  where one owner is DONE; DONE work no longer drafted providing nothing; a criterion due before its
  slice is drafted, due in the first slice holding its requirements, or due for a withdrawn
  requirement; a foreign requirement id or criterion passing; milestone order read from direct
  edges only, a same-milestone dependency failing, a ticket's milestone read as its latest; no gate
  check, no cycle check, no catalogue-name check; a slice's redraft sent every slice's failures; a
  DONE ticket's paths checked for gates.
- **The redraft:** none sent; sent neither failures nor draft, or no draft; not remembered as
  sent; discarded, the failing draft standing.
- **Across the plan:** an unowned name sent to the latest consumer; a failure sent again to a slice
  already sent it; a redraft dropping a kept id standing; a recorded redraft never reused; one
  round per pass; the key omitting the failures; a redraft written down only when PLAN ends; no ids
  kept for later slices.
- **PLAN:** a revision not checked; a reused slice's sent failures forgotten; no checks across the
  plan after a reused or a planned slice; a draft not checked before its review; no gates at PLAN;
  a redraft's inputs carrying neither failures nor draft, or the draft carrying Detent's slice tag.
- **PRESENT and approval:** a DONE ticket the plan lists left out; no edges read; no work read as
  DONE; approval offered over a failure; no count recorded; `run` ignoring the count.
- **The rest:** two providers failing in the first owner's slice alone; a slice naming none of its
  items passing, as "undeclared" did; a provider in a later slice passing; an id placed in two
  slices accepted; `--replan` keeping the record; the announcement counting a whole-plan review;
  the coverage harness reporting every family.

First pass: 36 killed, 14 survived. Each survivor was a behaviour no test pinned, and each has a
test now, in `plan-checks.test.ts`, `plan-redraft.test.ts` or `plan-corpus.test.ts`:
- **C02**, a name a DONE ticket and a drafted one in its slice both provide;
- **C06**, a criterion that tests only a withdrawn requirement, in a slice still holding it;
- **C11**, a ticket delivering M0 and M1 that waits on M1's work;
- **X03** and **X08**, a redraft across the plan that drops an id a later slice depends on, and
  the `keep_ids` it was told;
- **X05**, a redraft in one round that makes a failure in an earlier slice, which the next round
  sends;
- **X06**, a slice sent new failures on a later run, which is redrafted again rather than handed
  the recorded redraft;
- **S01**, a revision's failure sent by the slice's own checks: the checks across the plan send the
  same failure later, so the test that the redraft happened could not tell the two apart;
- **S02**, a resumed PLAN that sends a reused slice nothing it was sent before;
- **P01** and **P03**, a DONE ticket at PRESENT that still covers its requirement and fails
  nothing;
- **P02**, an edge an operator adds that makes a cycle;
- **V01**, the coverage harness over a corpus that also fails a contract.

**G01** survived because it was redundant: `ungatedPaths` skipped a DONE ticket, and `checkPlan`
drops every failure naming one anyway. The skip is gone, and the doc-block says where the rule
lives.

Second pass, the 13 survivors against their new tests: 12 killed. **P01** survived again: its test
marked a slice's only ticket DONE, and a slice whose every ticket is left out reads as unplanned,
which coverage does not judge, so leaving the DONE ticket out changed nothing the test could see.
The test now marks one ticket of a two-ticket slice DONE. A third pass ran P01 and P03 against it:
both killed. Every file matched its snapshot after each pass.

## Gates

`lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check` and `test` all
pass: 2142 tests passed and 2 skipped, across 180 files. `npm run plugin` builds.

`lint`'s line ceiling was met by splitting by responsibility as the work went: A-1″'s repairs of a
draft moved from `plan-slices.ts` to `src/init/plan-normalise.ts`, a cached ticket's schema to
`src/init/plan-cache.ts`, and what PLAN and PRESENT read from the phases before them from
`pipeline.ts` to `src/init/planning-outputs.ts`. The largest file this ticket touches is
`src/init/machine.ts`, at 286 code lines.

## Found along the way

- **The scale test's payload table described a fixture that no longer existed.** PRDR-160 measured
  each stage's widest prompt at 500 tickets and recorded it beside the bounds in
  `tests/init/slicing-scale.test.ts`. PRDR-290 to PRDR-292 changed what PLAN and the review are
  handed, and the table was not measured again: measured now, SLICE is 7.42 KB where it said 8.00,
  PLAN 106.17 where it said 106.64, and a slice's review 127.10 where it said 125.39. The bounds
  held throughout. The table holds the new figures, and loses the whole-plan review's row, which
  was 484.11 KB of its 600.
- **The coverage harness's doc-block named a call that had changed under it.**
  `scripts/coverage-report.ts` said it called `applyContracts` "with the same four arguments
  `plan.ts` passes". HEAD passed five, the scaffold since PRDR-206, and added the catalogue check
  beside it since PRDR-292. The scaffold does not reach coverage, so the report was right and only
  its claim was stale. It calls `checkPlan` now, as PLAN and PRESENT do.

## Recorded, not fixed

- **`state/whole-plan.json` stays in a state that holds it.** Nothing reads it, migrates it or
  deletes it (vetoable call 21).
- **The review is handed nothing the checks proved, and a redraft after a revision or across the
  plan is never reviewed** (vetoable call 11). Both are PRDR-294's, and its "From PRDR-293" section
  says so, with where the session formula and its tests change when the review becomes one read.
- **A redraft's `draft` input is its slice's tickets in full.** It is slice-sized, as a slice's own
  draft is, and no fixture here sends a redraft at the 500-ticket scale, so its size is unmeasured.
- **`CROSS_ROUNDS` is 3 by choice, not by measurement.** A chain of redrafts longer than three
  rounds leaves its failures to the operator at PRESENT.
- **Without a parse, which ids the documents define stays the slicer's judgement**, and no code
  lists them, as the sixth criterion's doc-block says.
- **No live run has met these checks.** Every test here drives the real pipeline with a scripted
  backend and no model session. ksar-cloud's 34 proved defects are the case they were built from;
  its plan is paused until the new planner re-plans it, and Detent is not run against ksar or any
  other project in this build of the redesign.
