---
id: PRDR-292
title: "PLAN drafts from prose it must re-read, cannot see what earlier tickets provide (56 of 60 drafting sessions dug through Detent's state files for it), and one 1,826-word prompt for four jobs tells it to ask questions the pack has already settled. PLAN is drafted from the pack's records: tickets carry `criterion_ids`, contracts use catalogue ids, the drafter reports only spec defects, each job gets its own prompt, and planner sessions lose Bash"
state: DONE
severity: major
category: capability
labels: ["prd-review", "planning-redesign", "operator-decision", "A-1", "prompts", "traceability"]
surface: ["src/init/plan-records.ts", "src/init/plan-inputs.ts", "src/init/plan-draft-checks.ts", "src/init/plan.ts", "src/init/plan-slices.ts", "src/init/plan-whole.ts", "src/init/plan-write.ts", "src/init/contracts.ts", "src/init/slice.ts", "src/init/slice-seed.ts", "src/init/slice-key.ts", "src/init/pipeline.ts", "src/init/present.ts", "src/init/present-spec.ts", "src/init/machine.ts", "src/init/questions.ts", "src/init/session.ts", "src/init/agents.ts", "src/kernel/referee-session.ts", "src/kernel/run.ts", "src/kernel/migrate.ts", "src/kernel/tickets/mutations.ts", "src/schemas/init.ts", "src/schemas/ticket.ts", "src/schemas/records.ts", "src/schemas/roles.ts", "src/sessions/backend.ts", "src/sessions/guard.ts", "src/sessions/prompts.ts", "src/sessions/sdk.ts", "scripts/hash-prompts.ts", "prompts/planner.md", "prompts/slice.md", "prompts/plan.md", "prompts/plan_review.md", "prompts/manifest.json", "hooks/dist/detent-hook.cjs", "README.md", "skills/init/SKILL.md", "detent-prd-v3.md", "tests/init/plan-inputs.test.ts", "tests/init/plan-prompts.test.ts", "tests/init/plan-records.test.ts", "tests/init/seed-fixture.ts", "tests/kernel/migrate.test.ts", "tests/cli/run-approval.test.ts", "tests/sessions/prompts.test.ts"]
prd_refs: ["A-1", "A-1‴", "A-2", "C-2⁗", "C-3′", "F-3", "S-1′", "PRDR-120", "PRDR-278", "PRDR-279", "PRDR-286"]
acceptance_criteria: ["A PLAN session's inputs come from the checker's parse of the slice's records: each requirement's id, milestone and text; its criteria, with ids and Given / When / Then; and the decisions, facts and catalogue entries it cites. With them come the slice's baseline items, the stack, the bindings, the session budget, X-4″'s `sizing_evidence` (C-4⁵, PRDR-278), and a compact index of the tickets in the slices it depends on: id, title, surface, and `provides` as `kind:id`. `analysis` and document paths are not among them.", "The draft schema and the A-1 ticket gain `criterion_ids`. Each pack criterion a ticket carries appears verbatim among its acceptance criteria. A test drafts a ticket that paraphrases one, and asserts that it is refused.", "For every kind a catalogue covers, catalogue ids are the canonical names in `provides` and `consumes`. A name of such a kind that is not in the catalogue is a contract failure (PRDR-293).", "The draft has no `questions`. It has `spec_defects`, each quoting, with ids, the pack passages that contradict each other or the gap. A spec defect found while planning takes the specification phase's amendment path before approval (PRDR-286), and PRESENT refuses approval while one is open.", "`prompts/planner.md` is replaced by `prompts/slice.md` and `prompts/plan.md`; the review prompt is PRDR-294's. No prompt a model reads cites a Detent PRD id. Every rule in them is enforced by code or stated as a judgement the reviewer makes, and the ticket lists which is which.", "Planner sessions get Read, Grep, Glob and their artifact write, and neither Bash nor subagents. A test launches one and asserts the tool list. They never read `archive/`: discovery keeps the originals out of their inputs (PRDR-279), and their tools must not reach them either.", "The persisted draft and ticket shapes change under F-3, with their migration."]
non_goals: ["Does NOT anchor ticket counts to a number. Sizing is judged by the reviewer (PRDR-294) and measured at run time (PRDR-297).", "Does NOT let a drafter ask the founder anything. What the pack does not settle is a spec defect, and the amendment path owns it."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-120", "PRDR-271", "PRDR-286"]
depends_on: ["PRDR-291"]
---

# PRDR-292 — PLAN drafted from pack records

## Where this came from

The planning audit of 2026-09-26, §5 and §6.
- `plan_index` carries id, slice, title and surface (`src/init/plan.ts:229`). What earlier tickets
  provide is missing, so 56 of 60 drafting sessions read `.detent/state/plan/*.json` to recover it,
  in 892 tool calls.
- The prompt serves four stages, contradicts the code in four places, and cites Detent PRD ids no
  input defines.
- Of 6,117 tool calls, 1,104 errored or were denied, and read-only Bash ran 2,846 times.

## Problem

The drafter re-derives from prose what a pack states as data, guesses the names other tickets own,
and is told to ask questions. After the specification phase, the founder has already answered them,
and anything the pack leaves unsettled is a defect in the pack, not a question for planning.

## Design

The redesign plan's §5. Criteria copied verbatim give PRDR-293's coverage check something to
count, and the run phase something to test. Catalogue ids give contracts one spelling. A spec defect
is routed like any other amendment.

## From PRDR-290

ANALYZE is gone (D-10″). A draft is handed `stack`, the entry the decision log records in
greenfield and null otherwise, where it was handed `analysis`, and no other part of the checker's
parse. The parse is VALIDATE's `pack` output; `planningPack` in `src/init/pipeline.ts` reads it and
returns null where VALIDATE handed none, which is where the records this ticket drafts from do not
exist.

## From PRDR-291

On a pack, a slice's cache key is its requirement ids and each one's record from the checker's
parse (C-2¹⁵, `recordsOf` in `src/init/slice-key.ts`):
- its text, kind, milestone, level and tags;
- its criteria;
- the decisions, defaults, facts and catalogue entries it and its criteria cite, read as the
  checker reads a citation.

Those are the records this ticket's first criterion hands PLAN, so the key and the inputs agree
once it lands. Until then they do not. A PLAN session reads whole documents while its key reads
records, so an edit to text no record holds re-plans nothing: prose around a requirement, an entry
no requirement cites, a design document or an ADR. This ticket closes that gap, and it must land
before a release carries PRDR-291.

Each slice's documents on a pack are code's (`packDocs` in `src/init/slice.ts`): the module PRDs
that hold its requirements and their criteria, and every document planning reads that is not a
module PRD. With this ticket's first criterion, `docs` leaves the draft's inputs.

SLICE's instructions are still in `prompts/planner.md`. Its `At SLICE` paragraph covers the seed,
the session that may only add, and documents cut as they are. Splitting the prompt is this ticket's
fifth criterion. Until then, an edit to PLAN's or the review's part of `prompts/planner.md` re-cuts
the product and re-plans every slice, since SLICE's basis and every slice's key read the prompt's
hash.

## Building it

What building it settled. Each is recorded in the PRD as C-4⁷ and is open to the operator's veto:

1. **The records** (`src/init/plan-records.ts`) are the checker's parse of the slice's live
   requirements. For each requirement the draft gets its id, milestone, level, tags and text; its
   kind is its id's `F` or `N` and adds nothing. For each criterion that tests one of them it gets
   the requirements the criterion tests, its tags, its Given, When and Then, and `text`. It also
   gets the decisions, defaults, facts and catalogue entries they cite, read as the checker reads
   a citation, each catalogue entry with its row. The first criterion names decisions, facts and
   catalogue entries; defaults (`X-n`) are handed too. They are decisions the founder may veto,
   and the key has read them since PRDR-291. A withdrawn requirement is not handed.
2. **A criterion's words** are `<id>: Given <given>, when <when>, then <then>.`, built from the
   parse and not copied from the bullet. A criterion rewrapped or re-bolded in its document keeps
   the same words, and the id makes each one findable in a ticket's acceptance criteria.
3. **The slice** is named by id, title, goal, requirement ids and baseline items, and by no
   document path. Beside the records come `catalogue_ids`, each kind's ids for every kind the pack
   catalogues at least one of. The first criterion does not list them. The third criterion makes
   catalogue ids the canonical names, and a drafter cannot use a name it is never shown.
4. **`plan_index`** is the tickets of the slices this one names in `depends_on`, and of the slices
   those name, transitively. The first criterion says "the slices it depends on". Capstone
   blockers make every slice in that closure DONE first, so each of its tickets is something this
   slice may build on. Each entry is `{id, title, surface, provides}`, with `provides` as `kind:id`
   strings; the note stays on the ticket, where a consumer is handed it (A-1‴).
5. **Without a pack, drafts keep their documents.** That covers where there is no parse, and where
   the documents planning reads hold none of the pack's requirements, so SLICE cut them as they are
   (`draftingPack` in `src/init/pipeline.ts`). There a draft is handed `docs` as C-2‴ built it. It
   may name no criterion and no spec defect, since neither can be checked, and a draft naming
   either is refused.
6. **"Verbatim" is compared word for word**, with whitespace, `**` markers and backticks set aside.
   A model copying Markdown drops code ticks and rewraps lines; the words are the criterion.
7. **A refused draft** is relaunched once and told each reason, as content that was refused
   (`refusedAttemptInput`), not as a shape to keep. A second refusal stops planning, as any unusable
   draft does. The second criterion asks only that a paraphrase is refused.
8. **The key** hashes the same records the draft reads (`src/init/slice-key.ts`). `plan_index` and
   `catalogue_ids` stay out of it: putting them in would re-plan every later slice after any edit
   to an earlier one. A vanished ticket id is still caught by `external_deps` (C-8‴), and a name
   no ticket provides is still a contract finding (A-1‴). The key reads PLAN's prompt and the
   review's (`planPrompts`); SLICE's basis reads SLICE's prompt alone.
9. **Catalogue names** (the third criterion). A-1‴'s kinds gain `error_code`, `setting` and `job`,
   so every kind a catalogue lists has a contract kind. Where the pack catalogues at least one
   entry of a kind, a `provides` or `consumes` of that kind naming an id the catalogue lacks is a
   `traceability` finding among the contract checks (`catalogueFindings` in
   `src/init/contracts.ts`). A kind the pack catalogues nothing of is named freely. The finding is
   reported, not refused: the criterion calls it "a contract failure (PRDR-293)", and turning a
   proved failure into a redraft and holding approval on it is A-1⁷'s, which is PRDR-293.
10. **A spec defect** (the fourth criterion) is `{kind, passages, defect}`:
    - `kind` is `contradiction` or `gap`;
    - `passages` is at least one `{id, quote}`, and a contradiction quotes at least two;
    - `defect` says what the pack leaves unsettled.

    A passage's id names a requirement, a criterion, a `D-n` or `X-n`, a fact as `N.M` or `§N.M`,
    or a catalogue id. Its quote must be in the record, either as the parse holds it or as the
    document writes it: the record's own line and the lines continuing it, up to a blank line or
    the next entry. Whitespace, `**` and backticks are set aside. A misquote or an unknown id is
    refused, like a paraphrased criterion.
11. **SLICE asks nothing either.** The fourth criterion takes `questions` out of the draft, and
    C-3⁗ says no planning stage asks, so the slicing loses them too. A slicing that carries any is
    refused, and the slicing record (PRDR-291, never released) loses the field. PRESENT's question
    merge is left in place with nothing left to feed it. Deleting it is PRDR-298's second
    criterion.
12. **An amendment reaches a cached slice.** A defect may quote a record outside the slice's own,
    such as a decision its requirements do not cite, and the key does not read that record. So a
    cached slice is planned again once any passage one of its defects quotes is no longer in the
    pack (`stillQuoted`). Without this, amending what a defect quoted could leave the defect open
    forever.
13. **PRESENT holds approval.** It lists each open defect with the slice that reported it and each
    passage's `file:line`, which PLAN adds from the parse. It raises AWAIT_INFO with one item per
    defect before approval is offered, so `--approve` is never consulted, and its first line says
    the plan is not approvable. `presentation.json` records `spec_defects`, the count (0 where the
    field is absent), and `detent run`'s deferred approval refuses while it is not zero. The
    amendment path the criterion names, X-4⁷'s, is PRDR-286's and not built. Until it is, the
    operator amends the pack by hand and re-runs `detent init`. A defect the operator judges false
    has no rejection path; `--replan` drafts every slice again.
14. **One prompt per job** (the fifth criterion). The planner's prompts are `slice.md`, `plan.md`
    and `plan_review.md`, picked by the stage a session is launched for (`promptOf`). A planner
    session launched for any other stage is refused rather than handed another job's words.
    `plan_review.md` holds the review's job until PRDR-294 gives it a role of its own; the
    criterion leaves the review prompt to PRDR-294, and one had to exist for the planner role to
    stop reading `planner.md`. The manifest pins prompts by id under `prompts`, where it pinned
    roles under `roles`.
15. **"No prompt a model reads cites a Detent PRD id"** is read for the planning prompts, which is
    this ticket's surface. That means `slice.md`, `plan.md`, `plan_review.md`, every instruction
    and skeleton code hands a planning session, and the preamble every init session reads, which
    lost its `(P2)` for all init roles, since it is one string. The ten other prompts still cite 68
    ids between them; see "Recorded, not fixed".
16. **Planner tools** (the sixth criterion). `SessionSpec.tools` is the SDK's base tool set,
    `Read`, `Grep`, `Glob` and `Write`, and the allowlist is Read, Grep, Glob and a `Write` to the
    artifact alone. Bash, Edit and subagents are not in the set, so they are not merely unlisted.
    The platform granted read-only Bash to an allowlist that did not name it.
17. **`archive/` is out of reach** (the sixth criterion's last sentence). Where the root holds
    `archive/`, a planner session's guard refuses any call that reaches it:
    - a path inside it, as written or resolved, with the archive itself compared resolved too, so
      a link reaches it wherever the root is reached through one;
    - a Grep whose search root holds it;
    - a Glob whose pattern can match below it.

    A Grep or Glob naming no path searches the root, so it is refused there, and the refusal says
    to name the directories to search. `docs/archive/` is an ordinary directory. The other init
    roles are not restricted, since AUDIT, DECIDE, WRITE and VALIDATE work with the originals.
18. **A pack's slices carry no documents.** PRDR-291's `packDocs` fed only the draft's inputs and
    the key. With both reading records, it would have fed nothing, so it is gone and a slice cut
    from the pack has `docs: []`.
19. **The migration** (the seventh criterion) is four steps in F-3″'s one v1→v2 event:
    - a ticket in `.detent/plan/` gains `criterion_ids: []`, and the plan, its presentation and its
      approval are left alone;
    - each slice cache in `.detent/state/plan/` and `plan-draft.json` trade `questions` for
      `spec_defects: []`, and each ticket in them gains `criterion_ids: []`;
    - `whole-plan.json` does the same for each slice it redrafted.

    A transform key may name every JSON file in one directory (`<dir>/*.json`). What was asked is
    dropped, since none of it quoted the pack and so none of it is a defect. The approval hashes
    `criterion_ids` only where a ticket carries some, so a plan approved before the field stays
    approved after the migration adds an empty one.
20. **Who holds each prompt rule** (the fifth criterion's second half). Each planning prompt sorts
    its rules by who holds them. The groups are what code refuses, what it reports, what it does,
    what the plan's reviewer judges, and what is the drafter's or the slicer's own. The list is
    under "The prompts' rules, and who holds each". Six of `plan.md`'s rules are neither code's nor
    a review tag's:
    - a ticket's `type`;
    - no scaffolding ticket in a new project;
    - a `depends_on` naming only what a ticket needs;
    - a baseline item's criteria being its `verifiable_by`, and the pack winning where it decides
      otherwise;
    - what an engineer decides from the records, with why in the description;
    - a spec defect being only what the pack leaves open.

    The criterion asks that each be stated as a judgement the reviewer makes. The prompt states
    them as the drafter's own, which Detent does not check and the operator reads with the plan. The
    review's tags are left as they were: the review is PRDR-294's to redesign, against the churn the
    planning audit measured (151 verdicts, every one `changes`), and more to judge would feed it.
    Which of the six the review takes on is PRDR-294's call. A spec defect is read by the operator,
    who is shown each one at PRESENT; the review is handed none. `slice.md`'s judgements are the
    slicer's, since no review reads a cut.
21. **Three prompt statements now say what code does.** They were found while listing who holds
    each rule:
    - Code renames a ticket id another ticket holds, or one that is not lowercase letters, digits,
      `-` and `_`, to the slice's next free `t-<slice>-NNN`. `plan.md` said only that ticket ids are
      `t-<slice>-NNN`, and code keeps a safe id of any other form.
    - Milestone order is checked on a cut from a seed, and `slice.md` now says "From a seed".
      Without a parse, code knows no milestones.
    - Without a pack, placing every requirement id the documents define is the slicer's own
      judgement, and `slice.md` now says so under "What is yours to judge". A `docs` entry that
      names no document is dropped, and the operator is told, which `slice.md` now lists among what
      Detent checks.

## The prompts' rules, and who holds each (the fifth criterion)

**`prompts/plan.md`**
- **Code refuses.** A refused draft is relaunched once and told each reason, and a second refusal
  stops planning (`src/init/plan.ts`). It refuses:
  - a draft that is not exactly the `expected_output` shape (`planDraftSchema`, strict). That
    covers an unknown key such as `questions`, a `type` other than `feature` or `bug`, a contract
    kind outside the nine, a spec defect of another kind, and a contradiction quoting fewer than two
    passages;
  - a `criterion_ids` entry the pack does not define, or one whose words are not among the ticket's
    acceptance criteria (`draftIssues` in `src/init/plan-draft-checks.ts`);
  - a spec defect with a passage not in the record its id gives; and, without a pack, any
    criterion id or spec defect (`draftIssues`).
- **Code reports**, at PRESENT, and the draft stands:
  - a requirement id or baseline item of the slice that no ticket names in `requirement_ids` or
    `baseline_ids` (`coverage`, `src/init/contracts.ts`);
  - a name two tickets provide (`coherence`), and a consumed name no ticket provides (`dependency`),
    in the same check;
  - a catalogued kind named by an id its catalogue lacks (`traceability`, `catalogueFindings`);
  - a `depends_on` naming no planned ticket, which is dropped, and a dependency cycle, which is
    broken at the edge that closes it (`normaliseDraft` and `breakCycles` in
    `src/init/plan-slices.ts`).
- **Code does:**
  - renames a ticket id another ticket holds, or one that is not lowercase letters, digits, `-` and
    `_`, to the next free `t-<slice>-NNN` (`normaliseDraft`). A ticket drafted under the bootstrap's
    id is renamed and reported the same way;
  - adds the edge from a consumer to the ticket that provides what it consumes
    (`src/init/contracts.ts`). Where that ticket is in a later slice, or the edge would close a
    loop, it adds none and reports a `dependency` finding. The prompt does not name the later-slice
    case, since a drafter is shown no later slice's tickets;
  - requires a `note` on each `provides` (the schema), and hands it to the consumer's session word
    for word (`src/kernel/referee-context.ts`, A-1‴);
  - holds every ticket of a slice until the slices it depends on are done (`capstoneBlockers` in
    `src/init/plan-write.ts`);
  - writes the bootstrap ticket in a new project and blocks every other ticket on it, and keeps
    every ticket already done, whatever a draft says (`src/init/plan-write.ts`);
  - discards a whole-plan redraft that drops an id in `keep_ids` (`src/init/plan-whole.ts`);
  - holds approval while a spec defect is open (`defectInterrupt` in `src/init/present-spec.ts`,
    and `src/kernel/run.ts`);
  - gives the session Read, Grep and Glob and a write to its artifact alone (`SessionSpec.tools`,
    the allowlist and the guard).
- **The plan's reviewer judges**, as the tags of `prompts/plan_review.md`:
  - sizing, with `sizing_evidence` outweighing the text (`sizing`);
  - the walking skeleton (`shape`);
  - a command or a test for each criterion (`testability`);
  - `non_goals` (`boundaries`);
  - a criterion that needs another ticket's work, and a `provides`, `consumes` or `note` that does
    not match what the criteria build (`dependency`). That tag covers declaring only what crosses a
    ticket boundary;
  - duplicates and contradictions (`coherence`);
  - every ticket sourced from the records or the baseline (`traceability`). That tag covers
    planning on the pack and the stack as written;
  - each `review_findings` entry answered. The review of the revised draft judges it afresh, and
    code counts what the revision resolved, kept and introduced for PRESENT (`revisionOutcome`).
- **The drafter's own**, which Detent does not check and the operator reads with the plan: the six
  in Building it, item 20.

**`prompts/slice.md`**
- **Code refuses.** A refused artifact is relaunched once with the reason, and a second refusal
  stops planning (`src/init/slice.ts`). It refuses:
  - an artifact that is not exactly the `expected_output` shape: an unknown key, `questions` and a
    ticket estimate among them, a missing field, or a slice id that is not `s01`, `s02`, …
    (`slicesSchema`, `sliceAdditionsSchema`);
  - a `depends_on` naming a slice that does not come before (`slicesSchema`);
  - on a cut from a seed, an id placed twice, placed not as written, or not in the seed, a seed id
    left out, and milestone order broken (`cutIssue` in `src/init/slice-seed.ts`);
  - from the session shown `slices`, a placement into no slice, a new slice under a taken id or
    after no slice, and an id it was not shown (`withAdditions`).
- **Code drops and reports:**
  - a `baseline_items` entry naming no baseline item;
  - without a pack, a `docs` entry naming no document. A slice left with none plans from every
    document (`groundSlices` in `src/init/slice.ts`).
- **Code does:** hands each slice's draft the tickets of the slices it names in `depends_on`, and of
  the slices those name (`dependencyIndex`), and gives the session its tools.
- **The slicer's own**, which nothing checks, since no review reads a cut:
  - the walking skeleton first;
  - naming every slice a slice builds on;
  - each slice's size against `slice_size`;
  - where each baseline item goes, and why one is left out;
  - without a pack, placing every requirement id the documents define, once and as written;
  - titles, goals and rationales.

**`prompts/plan_review.md`** is PRDR-294's to design. Its tags are the reviewer's own judgements.
Code refuses a verdict that is not the `expected_output` shape and relaunches the review once. A
second unusable verdict leaves the draft unreviewed, which PRESENT says (`src/init/plan-review.ts`).
A verdict word code knows as a synonym is read as `approve` or `changes`, and the note says so.

## Falsification (verification protocol, item 1)

The final test files were copied into a `git archive` of HEAD `26cb476` in the scratchpad and run
there, against HEAD's source, so the working tree was not touched. The copy holds every test file
that differs from HEAD: three new suites, twenty-three changed ones and three fixtures. A `diff -r`
against a fresh archive shows the copy's `src/`, `prompts/`, `skills/` and `scripts/` unchanged.

As copied, 149 of 404 tests fail, and three files fail to load. HEAD's strict schemas refuse
`criterion_ids` in the fixtures' tickets before a test reaches what it tests. That accounts for 130
of the failures and two of the files. The third file is `plan-records.test.ts`, whose module HEAD
does not have.

A second run removed the five `criterion_ids: [],` lines from the copy's fixtures, so every fixture
ticket had HEAD's shape. The lines were in `slicing-fixture.ts`, `slicing.test.ts`,
`plan-write.test.ts`, `contracts.test.ts` and `run.test.ts`. That run fails 51 of 416 tests, each
on what it tests:
- a PLAN session is handed no records and no catalogue ids, its index lists every earlier ticket
  without what it provides, and its inputs name the slice's documents;
- a ticket that carries a criterion is refused for the unknown key, so nothing carries, copies or
  refuses a criterion;
- a catalogued name outside its catalogue is no finding, and `error_code`, `setting` and `job` are
  no contract kinds;
- a draft or a slicing that asks is kept, and a spec defect is an unknown key. So nothing reaches
  PRESENT or holds approval, and nothing is quoted, refused, kept through a revision, a redraft or
  the cache, or planned again when amended;
- `detent run` offers approval of a plan with an open spec defect;
- `planner.md` serves every job, `slice.md`, `plan.md` and `plan_review.md` do not exist, the
  prompts cite PRD ids, and a planner session launched for no job is handed a prompt;
- planner sessions are given every tool, and the root's `archive/` is readable;
- the migration adds no `criterion_ids`, and a ticket without the field reads as having none at
  all.

Four of the new or changed tests pass at HEAD, and each is a control:
- a slice drafted from documents where planning's documents hold no requirement of the pack. HEAD
  drafts every slice from documents. The test guards the regression `draftingPack` fixes;
- a slice reaching the slices its dependencies depend on. HEAD hands every earlier slice's tickets,
  and here those are the slices it reaches. Its sibling, which asks for no other slice's tickets,
  fails;
- a root without `archive/`, where a search from the root is the allowlist's, as before;
- a presentation written before spec defects were counted, which is approvable. HEAD has no such
  field.

```
 × plan-inputs > is handed each requirement, its criteria and what they cite, and no document or document path
     → Cannot read properties of undefined (reading 'requirements')
 × plan-inputs > is handed the tickets of the slices it depends on, each with what it provides as kind:id, and no other slice's
     → expected [ { id: 't-s01-001', …(3) }, …(1) ] to deeply equal [ { id: 't-s01-001', …(3) } ]
 × migrate > carries a ticket to `criterion_ids`, and PLAN's draft and its two caches from `questions` to `spec_defects`
     → expected undefined to deeply equal []
 × plan-inputs > a ticket that paraphrases a criterion it carries is refused, and the relaunch is told the words to copy
     → PLAN could not draft slice s01 (s01, take 1): PLAN produced an invalid draft: tickets.0: Unrecognized key: "criterion_ids". Slices already
 × plan-inputs > a name of a catalogued kind that its catalogue does not hold is a contract finding, and a catalogue id is not
     → PLAN could not draft slice s03 (s03, take 1): PLAN produced an invalid draft: tickets.0.provides.2.kind: Invalid option: expected one of "
 × plan-prompts > planner.md is gone, and SLICE's, PLAN's and the review's prompts are each pinned
     → expected true to be false // Object.is equality
 × plan-prompts > no prompt a planner session reads cites a Detent PRD id
     → SLICE reads: == ROLE ==
 × plan-prompts > a planner session launched for a stage no job has is refused, and is not handed another job's prompt
     → {}: expected [Function] to throw error matching /only SLICE, PLAN and REVIEW_PLAN hav…/u but got 'a planner session with no job was run'
 × plan-inputs > a draft that asks a question is refused
     → s01 is drafted again, without the question: expected [ { stage: 'PLAN', …(8) } ] to have a length of 2 but got 1
 × plan-prompts > SLICE, PLAN and the review are given exactly those tools, and neither Bash nor a subagent
     → expected undefined to deeply equal [ 'Read', 'Grep', 'Glob', 'Write' ]
 × plan-inputs > a spec defect quoted from the pack reaches PRESENT, which raises AWAIT_INFO naming it and never offers approval
     → expected +0 to be 2 // Object.is equality
 × plan-prompts > their tools cannot reach the originals under the root's archive/, and reach the rest of the project
     → SLICE: expected 'abstain' to be 'deny' // Object.is equality
 × plan-inputs > a spec defect whose quote is not in the record it names is refused, and so is one under an id the pack does not define
     → expected 'PLAN produced an invalid draft: <root…' to contain 'order.shipped'
 × run-approval > a plan with an open spec defect is presented but not approvable
     → an open spec defect interrupts before any approval is offered: expected 'AWAIT_APPROVAL' to be 'AWAIT_INFO' // Object.is equality
 × plan-inputs > a slice whose spec defect quotes a passage the pack has since amended is planned again, and the rest are reused
     → expected 'AWAIT_APPROVAL' to be 'AWAIT_INFO' // Object.is equality
 Test Files  12 failed | 14 passed (26)
      Tests  51 failed | 365 passed (416)
```

## Mutation battery (verification protocol, item 2)

The battery ran 97 mutants, one defect each, against the new suites. Where a mutant reaches them,
it also ran against `slice-seed`, `slicing`, `contracts`, `plan-quality`, `fold-analyze`, `migrate`,
`run-approval`, `prompts` and `run`, or against `tests/init` or `tests/kernel` whole. A prompt
mutant had its manifest rehashed, so only a check on the prompt's content could kill it. Each file
was restored from a snapshot, never by `git checkout`, and checked byte for byte after every pass.
The mutants covered:
- **The records:**
  - a criterion's words without its id;
  - a withdrawn requirement handed;
  - no criteria, or a criterion that also tests another slice's requirement dropped;
  - no decision, every default whether cited or not, and no fact;
  - citations read from the requirements alone;
  - a catalogue entry without its row, an empty catalogue closing its kind, and error codes named
    as events;
  - the index not transitive, every earlier slice indexed, and the index without `provides`.
- **A draft's inputs:**
  - documents on a pack, and beside the records;
  - no catalogue ids, and no index;
  - the slice with its documents;
  - a refused draft told its content was sound;
  - the skeleton without `criterion_ids`.
- **What code checks in a draft:**
  - an undefined criterion, a paraphrase, a misquote and an unknown id accepted;
  - words compared raw;
  - a spec defect accepted without a pack;
  - an amended quote still holding;
  - a record's continuation lines dropped, a fact quoted by its section mark unknown, and a
    criterion judged on its document alone;
  - no `file:line`, and a defect listed twice.
- **Contracts:** no catalogue finding; a consumed name unchecked; the check without a pack, an
  equivalence probe; catalogue findings dropped by PLAN.
- **PLAN:**
  - a refused draft kept, or relaunched as a shape error;
  - no defect reaching PRESENT;
  - a whole-plan redraft's defects dropped, in `plan.ts` and in `plan-whole.ts`;
  - an amended quote reusing the slice, a reused slice dropping its defect, and the cache
    forgetting defects;
  - a revision's defect dropped.
- **Keys:**
  - the records or the prompts out of a slice's key;
  - the review's prompt keying nothing, SLICE's keying every draft, and PLAN's keying the cut;
  - records for a slice cut from prose.
- **PRESENT and approval:**
  - a defect never holding approval, the defects not listed, and a passage of any shape shown;
  - no `file:line` shown, and the header saying ready;
  - the count not recorded, and PLAN's defects not read;
  - `run`'s deferred approval approving, and an older presentation unreadable;
  - criteria out of the approval, and an empty list in it.
- **Migration:**
  - tickets, slice caches, the draft or the whole-plan cache not carried;
  - the plan artifact treated as a ticket;
  - questions kept;
  - directory keys never matching;
  - tickets never gaining the field, and a ticket required to carry it.
- **Guard and tools:**
  - the archive reachable;
  - a Grep from above allowed, `**` not special, and a pattern past the directory allowed;
  - resolved paths not compared, a Glob's base ignored, and a path judged as written only;
  - no tool set, in the session or the SDK;
  - no unreadable directory, and the archive barred where none exists.
- **Prompts:**
  - every planner session, every job, or a planner session with no stage, reading PLAN's prompt;
  - the preamble citing P2, and `slice.md` citing a PRD id;
  - `plan.md` no longer saying a criterion is copied, or naming catalogue ids;
  - `plan_review.md` losing a tag.
- **Shapes:**
  - a contradiction of one passage;
  - a slicing or a draft that may ask;
  - a ticket, or a new one, losing its criteria;
  - a pack's slice naming documents.

The first pass killed 72. Twenty-five survived, and each but one was a gap in the tests:
- **R02**, a withdrawn requirement handed: no pipeline hands one, since a cut placing one is
  refused. `sliceRecords` is now tested directly, in `tests/init/plan-records.test.ts`.
- **R04**, a criterion that also tests another slice's requirement dropped: no fixture criterion
  tested two slices' requirements. A cut now puts CHK-F-001 and CHK-F-002 in two slices, and each
  slice is handed CHK-AC-02.
- **I06** and **P03**, a refusal relaunched as a shape error: nothing read the relaunch's note. The
  paraphrase case now asserts that it is told to fix what the issue names, and not that its content
  was sound.
- **C03**, words compared raw: every copied criterion matched raw. A criterion rewrapped, with its
  code ticks and bold markers dropped, is now kept as drafted.
- **C04**, a spec defect accepted without a pack: nothing reported one there. A draft from documents
  that reports a defect, or carries a criterion, is now refused.
- **C08**, **C09** and **C10**, three sources of a quote: every quote was in the parse. Four
  passages are now found where HEAD's forms would not find them:
  - one across a criterion's continuation line;
  - one of a criterion's `text`;
  - a fact quoted as `§1.1`;
  - one without its code ticks.
- **C11**, **E04** and **N03**, PRESENT's `file:line` and header: nothing read them. The PRESENT
  case now does.
- **C12**, **P05** and **W01**, a whole-plan redraft's defects: no whole-plan review faulted a
  slice. The fixture's review can now be scripted for each scope. A redraft now reports a defect
  that reaches PRESENT. In a second run both drafts report it, and it is listed once.
- **S02**, a reused slice dropping its defect: no slice with a defect was reused. An edit to another
  slice's requirement now reuses it, and its defect stays open.
- **S04**, a revision's defect dropped: no slice review asked for a revision. One now does, and the
  revision's defect reaches PRESENT.
- **U02**, an older presentation unreadable: every presentation read carried the count. One without
  it is now approved.
- **G03**, `**` not special: every `**` pattern had a segment after it. `**` alone is now refused.
- **G06**, a Glob's base ignored: no Glob named the link in its pattern. `docs/old/*.md`, through a
  link into the archive, is now refused.
- **O02**, a planner session with no stage reading PLAN's prompt: no case launched one. One launched
  with no stage, and one launched for ANALYZE, are now refused.
- **Z01**, a contradiction of one passage: no case quoted one passage. One now does, and is refused.
- **Z04**, a ticket required to carry `criterion_ids`: every ticket read had the field. A current
  ticket without it now reads as carrying none.
- **Q04**, `plan.md` no longer naming catalogue ids: the checklist's marker `catalogue_ids` is also
  in the prompt's list of inputs. The marker is now the sentence's own words, "by its id in
  `catalogue_ids`".
- **K03**, the catalogue check without a pack, is equivalent, as the probe expected. With no pack
  no kind is catalogued, so no name is checked either way.

Between the first two passes, three prompt statements were corrected (Building it, item 21), and
the fixture's review became scriptable. The second pass ran the 25 again and killed 24. K03
survived, as the equivalent it is.

After the second pass, R02's test moved to its own file, so that `plan-inputs.test.ts` loads at
HEAD, and `plan.md` was sorted by who holds each rule (Building it, item 20). A third pass ran R02
against its new file, and Q01 and Q04 against the sorted prompt, and killed all three. Every
mutant but K03 is killed: 72 in the first pass, 24 in the second, and R02, Q01 and Q04 again in
the third.

## What changed

- **`src/init/plan-records.ts`** (new): a slice's records (`sliceRecords`), a criterion's words
  (`criterionText`), each catalogued kind's ids (`catalogueIds`), and the index of the slices a
  slice depends on (`dependencyIndex`).
- **`src/init/plan-inputs.ts`** (new): a draft's inputs (`draftInputs`) and its skeleton, moved out
  of `plan.ts`. They carry records in place of documents on a pack.
- **`src/init/plan-draft-checks.ts`** (new): what code refuses in a draft (`draftIssues`), whether
  a defect's quotes still hold (`stillQuoted`), and the defects PRESENT lists (`openDefects`).
- **`src/init/plan.ts`**:
  - a refused draft is relaunched once, told it was refused;
  - PLAN's `spec_defects` output;
  - catalogue findings join the contract findings;
  - `pack` in `PlanDeps` is the drafting pack.
- **`src/init/plan-slices.ts`**: each draft's spec defects are kept once, the revision's included,
  and the cache keeps them. A cached slice whose defect's quote left the pack is planned again.
- **`src/init/plan-whole.ts`**: a whole-plan redraft's spec defects.
- **`src/init/plan-write.ts`**, **`src/kernel/tickets/mutations.ts`**: `criterion_ids` on the A-1
  ticket.
- **`src/init/contracts.ts`**: `catalogueFindings`.
- **`src/init/slice.ts`**, **`src/init/slice-seed.ts`**: a slicing asks nothing, a pack's slice has
  no documents (`packDocs` is gone), and the SLICE instruction cites no PRD id.
- **`src/init/slice-key.ts`**: keyed by `sliceRecords`, and by PLAN's and the review's prompts.
- **`src/init/pipeline.ts`**:
  - `planPrompts` and `draftingPack`;
  - SLICE's basis reads SLICE's prompt;
  - PLAN is handed the drafting pack.
- **`src/init/present.ts`**, **`src/init/present-spec.ts`**: spec defects listed, AWAIT_INFO before
  approval, and the count in `presentation.json`.
- **`src/init/machine.ts`**: the approval hashes `criterion_ids` where a ticket carries some.
- **`src/init/questions.ts`**: `openQuestionsInput` and `openQuestionsInstruction` are gone.
- **`src/init/session.ts`**:
  - a planner session's prompt is picked by its stage;
  - its tool set;
  - the root's `archive/` is unreadable to it;
  - the preamble has no `(P2)`.
- **`src/init/agents.ts`**, **`src/kernel/referee-session.ts`**: a kernel role's prompt by
  `promptOf`.
- **`src/kernel/run.ts`**: the deferred approval refuses while a spec defect is open.
- **`src/kernel/migrate.ts`**: the four PRDR-292 steps of the v1→v2 event, and keys that name
  every JSON file in a directory.
- **`src/schemas/init.ts`**:
  - the draft gains `criterion_ids` and `spec_defects` (`specDefectSchema`);
  - the draft and the slicing lose `questions`;
  - a slice's cache gains `spec_defects`.
- **`src/schemas/ticket.ts`**, **`src/schemas/records.ts`**: `criterion_ids` on a ticket, and
  `spec_defects` in the presentation.
- **`src/schemas/roles.ts`**: `PROMPT_IDS`, `PLANNER_PROMPTS` and `promptOf`.
- **`src/sessions/backend.ts`**, **`src/sessions/sdk.ts`**: `SessionSpec.tools`, and the SDK's
  `tools`.
- **`src/sessions/guard.ts`**: `GuardPolicy.unreadable`, and what reaches it (`unreadableReached`,
  `globDescends`).
- **`src/sessions/prompts.ts`**, **`scripts/hash-prompts.ts`**: the prompt set and the manifest by
  prompt id, under `prompts`.
- **Prompts:** `planner.md` is deleted; `slice.md`, `plan.md` and `plan_review.md` are new; the
  manifest is regenerated.
- **`hooks/dist/detent-hook.cjs`**: rebuilt by `npm run plugin`.
- **`README.md`**, **`skills/init/SKILL.md`**: PLAN drafting from records, and PRESENT's spec
  defects.
- **`detent-prd-v3.md`**: C-4⁷, and notes on C-4⁵, C-2‴, C-2¹⁵, C-3′, C-3‴, A-1‴, C-7″, D-10″,
  S-1‴, F-3″ and C-8‴.
- **PRDR-286, PRDR-293, PRDR-294, PRDR-296 and PRDR-298**: a "From PRDR-292" section each.
- **Tests:**
  - `tests/init/plan-inputs.test.ts` (new, 26 tests):
    - the records;
    - the index;
    - criteria copied and refused;
    - catalogue names;
    - what a draft is refused for;
    - spec defects through PRESENT, a revision, a whole-plan redraft, the cache and an amendment;
    - drafting without a pack.
  - `tests/init/plan-prompts.test.ts` (new, 10 tests):
    - one prompt per job;
    - no PRD id;
    - a stage no job has;
    - what a prompt's edit re-plans;
    - the tool set, through the SDK too;
    - the archive, a link into it, and a root without one.
  - `tests/init/plan-records.test.ts` (new): the records hold no withdrawn or undefined
    requirement.
  - `tests/init/seed-fixture.ts`: a scripted review for each scope, and every launch's session spec.
  - `tests/kernel/migrate.test.ts`: the four steps, and a current ticket without the field.
  - `tests/cli/run-approval.test.ts`: an open spec defect refused, and an older presentation
    approved.
  - `tests/sessions/prompts.test.ts`: the prompt set by id, and the three prompts' markers.
  - `tests/init/slice-seed.test.ts`: a pack's slices carry no documents, a criterion from another
    module's PRD reaches its slice's records, `slice.md`'s words, and SLICE's prompt keying the cut
    alone.
  - `tests/init/slicing.test.ts`: the question cases driven through planning are gone, since no
    stage asks. Distinct ids across stages are tested on PRESENT's builder, given PLAN's and SLICE's
    outputs.
  - `tests/init/open-questions.test.ts`: the cases that handed asked questions to later drafts are
    gone with `openQuestionsInput`.
  - `tests/init/decide-plan.test.ts`: PRESENT shows no planning question, and still names one the
    log answers where PLAN's outputs carry it.
  - `tests/init/plan-quality.test.ts`: PLAN's digest moves with `plan` and `plan_review`, and not
    with `slice`.
  - `tests/init/fold-analyze.test.ts`: the stack sentence is read from `slice.md` and `plan.md`.
  - `tests/init/contracts.test.ts`: the nine kinds.
  - `tests/init/write-plan.test.ts`: a pack's slice drafts from records and names no document.
  - Fixtures lose `questions` and gain `criterion_ids`, and planner launches name their stage, in:
    - `backhalf`, `config-defaults`, `plan-critic-sampling`, `plan-fixture`, `plan-whole`,
      `plan-write`, `session-in-flight`, `slicing-fixture`, `slicing-scale`, `stages`,
      `validate-plan` and `write-plan`, under `tests/init/`;
    - `tests/kernel/run.test.ts`, `tests/scripts/plan-corpus.test.ts` and
      `tests/sec/ticket-scrub.test.ts`.

## Recorded, not fixed

- **Ten other prompts still cite PRD ids**, 68 citations between them:
  - `audit`, `spec_write` and `spec_review`;
  - `diagnose`, `implement`, `blind_fix`, `informed_fix` and `review_fix`;
  - `research` and `review`.

  Their sessions are handed marks no input defines, as the planner's were. The prompt-lint
  checklist requires one of them, `A-3` in `diagnose.md`. Building it, item 15, reads the fifth
  criterion for planning's prompts. Removing the rest is a ticket of its own, offered as PRDR-302.
- **The amendment path is PRDR-286's.** An open spec defect holds approval, and PRESENT says to
  amend the pack by hand and re-run `detent init`. A defect the operator judges false has no
  rejection path. `--replan` drafts every slice again, and a drafter may report it again.
- **Six rules of `plan.md` are the drafter's own.** Building it, item 20, lists them. No review
  tag covers them, and no reviewer reads a spec defect. PRDR-294's "From PRDR-292" section says so.
- **The review still reads documents.** It is handed the tickets and `docs`. Its verdict is cached
  with the slice, under a key that reads the records, so an edit to a document no record holds
  leaves a cached verdict standing. PRDR-294 gives the review its own role and inputs.
- **PRESENT's question machinery has nothing left to feed it.** It gathers, renumbers, merges and
  renders SLICE's and PLAN's questions, and neither stage has any. Deleting it is PRDR-298's second
  criterion.
- **Whether every criterion is carried is not counted.** A ticket that names a criterion copies it,
  and nothing checks that each criterion of a slice's requirements reaches a ticket. That count is
  PRDR-293's first criterion. So is refusing a catalogue finding, which is reported today.
- **Two findings handed to the whole-plan review cite PRD marks.** `already_found` is the contract
  checks' findings, written for the operator, and two coverage findings in `src/init/contracts.ts`
  cite `A-1⁵` and `C-8`. PRDR-293 hands proved findings to a redraft, and its "From PRDR-292"
  section says to drop them there.
- **No live run has drafted from records.** The sessions are scripted. Whether a model copies
  criteria, names catalogue ids and reports only real defects is measured by the next live run.
  The ksar evaluation is paused until the planning redesign is built.
- **K03 is equivalent**, as the battery says.
