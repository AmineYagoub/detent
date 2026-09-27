---
id: PRDR-286
title: "A session that proves the specification wrong can only falsify its own ticket. Nothing carries the fix back to the pack, the tickets built on the same requirement keep being drawn, and re-planning an approved plan means `--replan`, which re-derives every slice and is refused while the falsified ticket sits in NEEDS_HUMAN. An amendment rides X-4 to the operator, holds the affected tickets, and ends in a re-plan scoped to the slices it changed"
state: DONE
severity: major
category: capability
labels: ["prd-review", "specification-phase", "operator-decision", "X-4", "C-8", "C-10", "replan"]
surface: ["src/schemas/records.ts", "src/kernel/falsify.ts", "src/kernel/referee.ts", "src/kernel/dependency.ts", "src/kernel/run.ts", "src/init/machine.ts", "src/cli/init.ts", "prompts/implement.md", "tests/kernel/amendment.test.ts", "tests/init/scoped-replan.test.ts"]
prd_refs: ["X-3", "X-4", "X-4′", "C-7′", "C-8", "C-8′", "C-8″", "C-8‴", "C-10", "N-6", "PRDR-085", "PRDR-118", "PRDR-277", "PRDR-278", "PRDR-280", "PRDR-284", "PRDR-289"]
acceptance_criteria: ["An implement or fix session that proves a specification defect writes `falsified.json` with an amendment. It names the affected requirement ids and the defect class, carries the evidence (a failing test, or two passages of the pack that contradict each other, quoted), and proposes the new text. The referee admits PREMISE_FALSIFIED from every state X-3 allows it in (PRDR-289); no state or event is added.", "Until the amendment is decided, the pool draws no READY ticket whose `requirement_ids` include an amended requirement, and the run goes on with the rest.", "The operator approves, edits or rejects it through C-10's escalation: on a TTY inside `run`, and with exit 10 off one. A rejection returns the held tickets to the pool and leaves the filing ticket in NEEDS_HUMAN, with the rejection as its note.", "On approval the pack is edited, the checker gates it (PRDR-280), and VALIDATE re-validates the change (PRDR-284).", "The scoped re-plan: only the slices whose requirement ids changed are re-planned, and every other slice's cache is reused (C-8‴), because slices are keyed by their requirement ids (PRDR-291). A DONE ticket is never redrafted, so a change to built code becomes a new ticket (C-8′). C-8″'s in-flight refusal covers the re-planned slices' tickets only, and the filing ticket's own NEEDS_HUMAN does not refuse the re-plan it asked for. The changed plan is presented for approval again (C-7′).", "The filing ticket and the held tickets return to the queue through HUMAN_REQUEUE, as PRDR-277 returns the tickets an install frees, or are superseded by the re-plan.", "Falsifying test: a two-slice plan, approved, and a NEEDS_HUMAN ticket in its second slice. Against HEAD, `detent init` reports the approved plan and re-plans nothing (C-8), and `detent init --replan` is refused while that ticket is NEEDS_HUMAN (C-8″). Fixed, the amendment's re-plan re-plans the second slice only and reuses the first slice's cache."]
non_goals: ["Does NOT let review or diagnose sessions file an amendment. Decision 12 settled which roles may: implement and the three fix roles (X-3′, PRDR-278).", "Does NOT apply an amendment without the operator. The pack is the founder's record, and an amendment changes it.", "Does NOT change `--replan`. It still re-derives every slice (C-8′), for an operator who wants that."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-085", "PRDR-118", "PRDR-277", "PRDR-289", "PRDR-291"]
depends_on: ["PRDR-280", "PRDR-284", "PRDR-289", "PRDR-291"]
---

# PRDR-286 — amendments during `run`, and the scoped re-plan

## Where this came from

ksar-cloud's run 7 exercised X-4 end to end. A session proved its premise false, the ticket went
to NEEDS_HUMAN, and every ticket behind it waited (PRDR-277). With a specification pack, some
falsifications mean the pack itself is wrong, and the session that proves it has the fix in hand.
The operator's decision 8 gives that a path back to the pack.

## Problem

Today a session can falsify its ticket (X-4) and do nothing else. The pack stays wrong, and the
tickets citing the same requirement keep being drawn and built on the wrong rule.

Re-planning after the fix has no fitting path either:
- On an approved plan, `init` returns before any replay and asks for `--replan` (C-8,
  `src/init/machine.ts:385`).
- `--replan` removes every slice's cache and re-derives them all (C-8′).
- Both routes pass through the in-flight guard (C-8″). `inFlightTickets` counts every ticket that
  is neither READY nor DONE, so the filing ticket's own NEEDS_HUMAN refuses the re-plan it needs.

## Design

The plan's §8. No state or event is added: v3 inherits §7's machine unchanged, and an amendment
is a falsification that names its fix. The hold is a pool filter, like a dependency. The
decision is C-10's escalation. The re-plan is C-8‴'s slice cache, scoped by the amended
requirement ids, with C-8′'s reconciliation and C-8″'s guard narrowed to the slices it touches.

## From PRDR-284

VALIDATE is built (C-2¹⁴), and an approved amendment's edit to the pack reaches it through the
path every edit takes. The next `init` finds the record's documents moved and starts a new
validation. That validation runs the checker first, then rounds scoped to the changed documents,
to what the last validation left open, and to whatever cites either. Three things in it are this
ticket's to take up:

- **Two asks of the in-flight guard.** C-8″'s second ask is now made before VALIDATE runs
  (`replansAt` in `src/init/replan-guard.ts`), and `inFlightTickets` counts the filing ticket's
  own NEEDS_HUMAN. As built, an amendment's re-validation is refused before any reviewer runs,
  and the first ask refuses it too. Narrowing both to the re-planned slices' tickets (C-8⁵) is
  this ticket's.
- **Stopping at the ceiling.** VALIDATE stops at its ceiling on a blocker with AWAIT_INFO. During
  `run`, that is an `init` interrupt reached from an amendment, and whether `run` surfaces it
  through C-10's escalation or leaves it to the next `detent init` is this ticket's to decide.
- **Scope.** A changed decision log or facts file reaches every document that cites any entry of
  it, since the record keeps no earlier copy to say which entry moved. An amendment that touches
  the log therefore re-validates widely. Holding an earlier copy of the log, or scoping by the
  amendment's own requirement ids, would narrow it.

## From PRDR-291

The scoped re-plan's machinery is built for an edit to the pack (C-2¹⁵). A slice's cache key is its
requirement ids and their records, so an edit that changes one requirement re-plans only the slice
that holds it. An edit to a decision, default, fact or catalogue entry re-plans only the slices
whose requirements or criteria cite it, and an edit to the stack's entry re-plans every slice.

SLICE keeps its cut on record in `.detent/state/slicing.json`:
- an added requirement is placed by a session that may only add;
- a withdrawn requirement leaves its slice;
- a requirement whose milestone moved is placed again;
- every other slice keeps its id, its members and its cache.

What stays this ticket's is the amendment's path to that edit: the hold, the decision and the edit
itself. So are C-8″'s guard, narrowed to the re-planned slices' tickets, and presenting the changed
plan again. A PLAN session still reads whole documents until PRDR-292 lands, so an amendment that
edits text no record holds re-plans nothing until then.

## From PRDR-292

A spec defect found while planning now holds approval (C-4⁷). PLAN keeps each one a draft
reports, once its quotes are checked against the pack. PRESENT lists each with its passages'
`file:line` and raises AWAIT_INFO before approval is offered. `detent run`'s deferred approval
refuses while `presentation.json` counts one.

PRDR-292's fourth criterion says such a defect "takes the specification phase's amendment path
before approval". That path is this ticket's, and until it is built:
- PRESENT tells the operator to amend the pack where each defect quotes it and re-run
  `detent init`.
- A slice whose defect quotes a passage the pack no longer holds is planned again (`stillQuoted` in
  `src/init/plan-draft-checks.ts`). The record it quotes may lie outside the slice's own, and so
  outside its key.
- A defect the operator judges false has no rejection path. `--replan` drafts every slice again,
  and a drafter may report it again.

The path this ticket builds can take a planning defect as it takes a run-time one. The record ids
and quotes of its passages, and the defect, are the amendment's evidence.

## Building it

An amendment rides X-4 to the operator, holds the tickets on its requirements, and ends in a
re-plan of the slices it changed. No state or event is added: the filing is a field of the
falsification, the hold is a filter in the pool, the decision is C-10's escalation, and the
re-plan is C-8‴'s slice cache with C-8″'s guard asked slice by slice. The PRD records it as X-4⁸,
placed after X-4⁷, and X-4⁷, C-8⁵, C-8″, C-2⁷, C-2¹⁴, C-4⁵ and C-4⁷ point to it.

The acceptance criteria, as built:
1. **Filing.** `falsified.json` takes an `amendment` beside its `note`: `requirement_ids`,
   `defect_class` (`contradiction`, `wrong` or `gap`), `evidence` and `edits`
   (`src/schemas/amendment.ts`). The evidence is a failing test with its output, or two or more
   passages, each with the id of the record it quotes; a contradiction's must be passages. Each
   edit names a record and gives `old`, text the record's document holds exactly once, on the
   lines that write that record, and `new`. `consumeFalsifiedSignal` hands the field to
   `fileSignalled` (`src/kernel/amendment-file.ts`), which parses the pack as VALIDATE does
   (every document, greenfield by the stack markers) and files the amendment only when every
   requirement is the pack's, every quote is in its record (`passageIssue`, C-4⁵'s check, now
   exported) and every edit is so placed (`recordSpan`, new beside it). A proposed text that looks
   like a secret is refused, and the evidence is scrubbed (SEC-4). A filed amendment is written to
   `.detent/amendments/AM-nnn.json`, a committed layout entry, noted on the ticket with how to
   decide it, and journaled as `amendment_filed`; one the pack refuses is noted with each reason,
   and the falsification stands without it. The referee admits PREMISE_FALSIFIED from each of the
   four states X-3′ allows (PRDR-289), and a filed amendment clears `missing`, so a pack defect
   goes to the human rather than waiting on a sibling (X-4′).
2. **Holding.** `ready()` leaves out a READY ticket whose `requirement_ids` meet an open or
   applied amendment's (`holdOf`, `src/kernel/amendment-store.ts`), and `claimRefusal` says which
   amendment holds it and what it waits on. The run goes on with the rest. `status` lists each
   held ticket among the pending with that reason, so a run that leaves only held work exits 10,
   and `detent status` lists each amendment still holding, what it waits on and what it holds.
3. **Deciding.** On a TTY inside `run`, the escalation of a ticket that filed an amendment is the
   amendment's (`src/cli/escalate.ts`): it is shown, with its evidence and each edit, and the
   operator approves, edits with a JSON file of their own `{id, old, new}` edits, rejects with a
   reason, skips, or quits. The driver records the decision through the `record` tool's
   `amendment` kind (`src/referee/registry.ts`), which the run skill uses too; a decision the
   referee refuses is announced and the amendment offered again, and an open amendment no
   escalation offered is offered when the pool empties. Off a TTY the run exits 10 naming the
   amendment, and `detent amend <AM-id>` shows it, or with `--approve`, `--edit <file>` or
   `--reject <reason>` decides it, under the run lock. A rejection (`src/kernel/amendment-decide.ts`)
   records who and why, frees the tickets it held, and leaves the filing ticket in NEEDS_HUMAN
   with the rejection as its note.
4. **Applying.** An approval or an edit makes the edits in order, each replacing text its
   document holds exactly once at that point, and runs the checker on the result (PRDR-280): red,
   every document is written back and the decision refused with the findings. Green, the changed
   documents are committed alone (`commitPaths`, `src/kernel/git.ts`), with the claimed ticket's
   trailer marker set aside and put back, so B-5's reset at a resume and a finalize's sweep
   cannot take the change and no ticket's trailer claims it. The amendment is `applied`, with the
   commit, and its note tells the operator to run `detent init`, where VALIDATE re-validates the
   changed pack as it re-validates any edit (PRDR-284).
5. **The scoped re-plan.** An applied amendment makes a plain `detent init` re-plan an approved
   plan (`src/init/machine.ts`): C-8's early return and C-8″'s two whole-plan asks stand aside,
   and PLAN is forced. Unchanged slices are reused from their caches (C-8‴, keyed by their
   requirements' records since PRDR-291), and before PLAN plans a slice again it asks C-8″ of
   that slice's tickets alone, as the written plan lists them (`sliceScope`,
   `src/init/replan-guard.ts`): a ticket in flight there refuses the re-plan by name before any
   session runs, and the filing ticket's NEEDS_HUMAN does not. A slice PLAN reuses keeps its
   tickets as they stand, with their state, generations and notes, and takes only the new plan's
   blockers (`writePlan`'s `keep`), and so does the bootstrap. A DONE ticket is never redrafted
   (C-8′, unchanged). The changed plan is presented for approval again (C-7′).
6. **Back to the queue.** Once PLAN has written the plan (`settleAmendments`,
   `src/init/amendment-replan.ts`), each applied amendment is `replanned` with the slices planned
   again, which frees what it held, and a filing ticket the re-plan did not supersede, still in
   NEEDS_HUMAN, returns through HUMAN_REQUEUE with the amendment as its guidance, as PRDR-277
   returns the tickets an install frees. A filing ticket in a re-planned slice is written afresh
   or removed with it. The requeue runs after PLAN's journal closes, since a journal is single-open.
7. **The falsifying test** is `tests/init/scoped-replan.test.ts`'s first case: a two-slice plan,
   approved, with a NEEDS_HUMAN ticket in its second slice. `--replan` is refused on it, as
   before; `detent init` plans the second slice again and reuses the first.

The prompts: `implement.md` and the three fix prompts give the field's shape, and review,
diagnose and research are not told it (decision 12). `skills/run/SKILL.md` has the model driver
present an amendment and decide it through `record`. The README lists `detent amend`.

### Vetoable calls

1. **The amendment is a field of `falsified.json`**, not a signal of its own: it is a
   falsification that names its fix, and the session already writes that file.
2. **An amendment the pack refuses leaves the falsification standing.** The session found a false
   premise either way; only its proposal failed, and the note says why.
3. **A filed amendment clears `missing`.** A pack defect is the operator's, and waiting on a
   sibling's work would build the sibling on the same defect.
4. **Each edit names one record and replaces text written once, on that record's lines.** The
   operator then decides on the pack's own words, and an edit cannot reach past what it names.
   An edit that spans two records is two edits.
5. **A proposed text that looks like a secret is refused, not scrubbed.** Scrubbed, `[REDACTED]`
   would be committed into the pack.
6. **The hold is READY-only,** as the criterion says: a ticket already in flight on an amended
   requirement goes on.
7. **An applied amendment still holds** until the re-plan, since until then the plan says what
   the pack no longer does.
8. **Held tickets are pending in `status`,** so a run that leaves only held work exits 10, where
   it would have exited 0 with work waiting on a human.
9. **An amendment's escalation offers no ticket act,** and the filing ticket stays in NEEDS_HUMAN
   after any decision; `detent approve` and `detent requeue` stay available for it.
10. **A skip writes no note,** so the pending reason still names the amendment.
11. **An open amendment no escalation offered is offered when the pool empties,** once per run:
    a bug's false premise returns the ticket to diagnosis, and an earlier run's may be waiting.
12. **The checker's gate is a green pack,** not "no new finding": a validated pack is green, and
    a red one stops at VALIDATE anyway.
13. **The changed documents are committed alone, as no ticket's work.** The amendment record is
    left for the operator to commit, as the plan files `init` writes are.
14. **`detent amend` takes the run lock,** as `init` does: a live run decides its amendments at
    its own escalation, and two writers never commit to one tree.
15. **`run` does not run `init`.** VALIDATE's AWAIT_INFO at its ceiling stays `detent init`'s,
    which the amendment's note tells the operator to run; the ticket left this open.
16. **The scope of a re-validation is PRDR-284's.** An amendment that edits the decision log
    re-validates every document that cites it; narrowing that is left as the ticket found it.
17. **PLAN is forced under an applied amendment,** so an amendment whose edit was undone by hand
    still settles; it costs nothing when every slice is reused.
18. **A slice's tickets are the written plan's list,** read from `plan.json`, since the guard runs
    before the slice is drafted again.
19. **Only a NEEDS_HUMAN filing ticket is exempt.** One still in flight, a bug's back in
    diagnosis, refuses the re-plan like any other.
20. **Reused slices keep their tickets only under an applied amendment.** A plain re-plan still
    writes every ticket afresh, as C-8′ says.
21. **`writePlan`'s live-claim check covers the tickets it writes or removes,** and a ticket left
    exactly as it stands is not in the way.
22. **The requeue is made by `detent`,** with the amendment as its guidance; one the kernel
    refuses is noted, the ticket stays with the operator, and the re-plan stands.
23. **The approval still covers the re-planned plan where the approved fields did not change,** as
    C-8's hash says; PRESENT presents it again either way.
24. **`record`'s `amendment` kind answers `{ok, message}`,** not a structured error: `REFUSED` is
    the headless driver's outage route, and a refused decision is not an outage.
25. **Ids are `AM-nnn`, one past the highest,** never reused, and a torn amendment file is named,
    as a torn ticket is (PRDR-137).

## Falsification (verification protocol, item 1)

The final three test files were copied into a `git archive` of HEAD `be7ae45` in the scratchpad
and run there, against HEAD's source. 13 of the 14 run and re-plan cases fail, each on what it
tests:

```
 × AC 7: an approved two-slice plan, a NEEDS_HUMAN ticket in the second: the second slice is
   planned again, and the first reused
   → expected 'plan approved (hash 2b1af7da116a…) — …' not to contain 'pass --replan'
 × a slice it would plan again with a ticket in flight is refused before any session, and nothing
   is written                                          → expected +0 to be 2
 × a filing ticket still in flight in a slice it would plan again refuses it
                                                       → expected +0 to be 2
 × an amendment whose edit was undone by hand is settled all the same
                                                       → expected 'NEEDS_HUMAN' to be 'READY'
 × a slice not planned again keeps its tickets as they stand, and the filing ticket there returns
   through HUMAN_REQUEUE                               → expected [] to deeply equal [ 'PLAN:s02' ]
 × a kept ticket the re-plan gives new blockers keeps its state, generations and notes
                                                       → expected [] to deeply equal [ 'PLAN:s01' ]
 × files it, holds the tickets on its requirement, and the run goes on with the rest
                                                       → expected undefined to be 'open'
 × an amendment the pack does not hold is refused and said, and the falsification stands without it
   → expected 'falsified mid-implementation: the rul…' to be 'amendment refused: it names requireme…'
 × a rejection frees what it held, and the run builds it
   → expected [ [ 't-chk', undefined ] ] to deeply equal [ [ 't-chk', 'AM-001' ] ]
 × an approval changes the pack in its own commit, and holds its tickets for `detent init`
   → expected '# Checkout\n\n- **CHK-F-001** [M1] Ch…' to contain 'Checkout MUST accept DZD only, and re…'
 × a decision the referee refuses is said, and the amendment offered again
                                                       → expected [] to have a length of 2 but got +0
 × a skipped amendment stays open and is not offered again in the run, which ends naming it
                                                       → expected [ undefined ] to deeply equal [ 'AM-001' ]
 × an amendment no escalation offered is offered before the run ends
                                                       → expected [] to deeply equal [ 'AM-001' ]
 FAIL tests/kernel/amendment.test.ts
   → Error: Cannot find module '../../src/kernel/amendment-file.js'
 Test Files  3 failed (3)
      Tests  13 failed | 1 passed (14)
```

The one that passes, that a decided amendment is not offered again when its ticket escalates
later, is a guard: HEAD offers no amendment at all, so it holds on both sides.
`tests/kernel/amendment.test.ts` fails at its import, since HEAD has nothing to file or decide an
amendment with; its thirteen cases are the units under the run-level ones.

## Mutation battery (verification protocol, item 2)

59 mutants, one defect each, run against the three new test files and the suites that cover each
file (the falsification, dependency and plan-writing suites), and restored from a snapshot, never
by `git checkout`; at the end all 20 files matched it. They covered:
- **The store:** a rejected or re-planned amendment still holding; an applied one holding nothing;
  every ticket held; an id reused; held tickets not pending; a decided amendment taking its
  ticket's escalation; a torn file not named.
- **Filing:** requirements, passages, the once rule and the record's lines unchecked; only an
  edit's first line checked; a secret let into the pack; the evidence not scrubbed; a refusal
  unsaid; a filed amendment yielding to `missing`; the field not read.
- **Deciding:** a rejection leaving it open or unsaid; the operator's edits ignored, or not held to
  their records; no checker gate; a red pack left red; nothing committed; a decided amendment
  decided again; the trailer marker not set aside or not put back; everything staged committed.
- **Holding and offering:** no hold in the pool or at the claim; held tickets not pending in
  `status`; the escalation ignoring the amendment; no offer before the run ends; a refused
  decision not offered again; an offer forgotten; no run lock for `detent amend`; two decisions at
  once; `detent status` showing none.
- **The re-plan:** an approved plan ignoring the amendment; the whole-plan guard asked up front or
  per phase; PLAN not forced; the slice refusal not caught; the filing ticket not exempt, or exempt
  in flight; the slice scope ignored; a slice holding no tickets; no guard per slice; re-planned
  slices not recorded; nothing kept, or the re-planned slices kept too; a kept ticket written
  afresh; the bootstrap not kept; a kept ticket's claim in the way; the filing ticket not returned;
  the amendment not settled; nothing settling.
- **What sessions and drivers are told:** the implementer not told the field; the run skill
  deciding no amendment.

First pass: 56 killed, 2 survived, and 1 hung.
- **PW1** (a kept ticket written afresh) survived. A kept ticket is written only when its blockers
  change, and no case changed them. The re-plan suite gained a case whose re-planned slice drafts
  a new capstone, so the kept slice's ticket takes a new blocker; it must keep its state,
  generations and notes.
- **PW2** (the bootstrap not kept) survived for the same reason: the bootstrap never changes its
  blockers, so a fresh one is not written either. What differs is what the operator is told: the
  mutant says the bootstrap was created. The keep case now asserts that note is absent.
- **DV4** (an offer forgotten) hung its case instead of failing it: the driver offered a skipped
  amendment without end. The worker was stopped by hand; the run cases' escalation stub now quits
  after eight offers, so the loop ends and an assertion fails.

A second pass killed all three, and PW1 again after its case was simplified. All 59 are killed.

## Gates

`npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check` and
`test` all pass: 2138 tests passed and 2 skipped, across 183 files; the 27 new cases are the three
files above. `npm run plugin` builds, and rewrites `agents/implement.md` from the prompt.

## Found along the way

- **A journal is single-open per process** (`RunJournal`, PRDR-203), and PLAN's phase holds one
  while it plans. The requeue that returns a filing ticket journals its own transition, so
  `settleAmendments` runs once PLAN's journal has closed, not inside it.
- **A requeue reads the project's budgets** from `.detent/config.json`, which `detent init` writes
  before any phase runs (`src/cli/init.ts`) and the machine's own test harness did not. The re-plan
  tests write it as the command does, and a requeue that throws is said rather than failing PLAN.
- **An offer loop that never yields hangs a test instead of failing it.** It awaits only settled
  promises, so vitest's timer never fires (DV4 above). The escalation stub is bounded now.
- **The approval case's "no ticket's trailer" check held vacuously** until the case installed the
  trailer hook: with no hook, no commit could carry a trailer. It installs it now, and GP1 is
  killed by it.

## Recorded, not fixed

- **A spec defect found while planning does not take this path.** PRDR-292 left its fourth
  criterion's "amendment path before approval" to this ticket, and this ticket built the path for
  `run`'s sessions only. PRESENT still tells the operator to amend the pack by hand and re-run
  `detent init`, and a defect the operator judges false still has no rejection: `--replan` drafts
  every slice again, and a drafter may report it again. Giving PLAN's `spec_defects` the
  amendment's shape (their record ids and quotes are its evidence) needs its own ticket.
- **A re-validation's scope stays PRDR-284's.** An amendment that edits the decision log or the
  facts file re-validates every document that cites any entry of it (vetoable call 16).
- **`run` does not run `init`** (vetoable call 15). An applied amendment waits for the operator's
  `detent init`, which its note and `detent status` name; until then its tickets stay held.
- **The amendment record is not committed by Detent** (vetoable call 13). It sits in
  `.detent/amendments/`, a committed layout entry, for the operator to commit with the plan files
  `init` writes.
- **A ticket already in flight on an amended requirement goes on** (vetoable call 6). The hold is
  READY-only, as the criterion says.
