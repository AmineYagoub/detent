---
id: PRDR-278
title: "`init` plans from documents nothing has judged: a contradiction, a wrong external fact or a rule that is consistent but wrong reaches a ticket as an assumption, and a session that implements it literally ships it with green gates. The operator's decisions: a specification phase inside `init` (AUDIT, DECIDE, WRITE, VALIDATE), and a planning phase rebuilt on the pack it produces, recorded in one PRD amendment before any code"
state: DONE
severity: major
category: decision
labels: ["prd-review", "specification-phase", "planning-redesign", "operator-decision", "C-3′", "C-5", "C-14′", "D-5", "D-10", "N-7", "doc-claim-drift"]
surface: ["detent-prd-v3.md", "docs/plan-specification-phase.md", "docs/plan-planning-redesign.md", "docs/planning-phase-audit-2026-09-26.md", "docs/release-checklist.md", "tests/docs/prd-marks.ts", "tests/docs/prd-requirement-ids.test.ts", "tests/docs/prd-specification-phase.test.ts", "tickets/prd-review/**"]
prd_refs: ["N-6", "C-2‴", "C-3′", "C-3″", "C-3‴", "C-4″", "C-5", "C-8", "C-8′", "C-8‴", "C-10", "C-14′", "X-4", "D-5", "D-10", "D-26", "V-5", "NG2", "OQ-4", "N-7", "F-3", "F-4", "S-1", "S-1′", "S-5′", "S-5″", "S-5‴", "X-3"]
acceptance_criteria: ["The PRD records the phase as four `init` phases between DISCOVER and DETERMINE_VERIFICATION: AUDIT, DECIDE, WRITE and VALIDATE, each with what it reads, what it writes and when it stops. v3's line for the inherited pipeline shows them in order.", "C-3′ is amended, not contradicted. Planning still never stops for a question an assumption can carry. AWAIT_INFO may now also be raised at DECIDE, on a TTY, for C-3″ (PRDR-119) questions, and at VALIDATE for a blocker left at the validation ceiling. The interrupt set stays C-5's five, and the amendment says why a sixth was refused: C-14′ makes a new decision class a major-version decision.", "The operator's sixteen decisions of 2026-09-26 are recorded with their reasons (the plan's §2). Decision 8 is recorded with its correction: the re-plan after an amendment covers only the affected slices, because `--replan` re-derives every slice (C-8′).", "X-3 is amended: PREMISE_FALSIFIED is admitted from BLIND_FIX, INFORMED_FIX and REVIEW_FIX with IN_PROGRESS's outcome, so a fix session may declare a false premise and file an amendment (decision 12, PRDR-289). No state or event is added.", "S-1 gains four roles in one F-3 `schema_version` event with a migration for `role@hash` assignments: `audit`, `spec_write` and `spec_review` for the specification phases, one per tool set (decisions 11 and 15), and `plan_review` for the redesign. S-5′'s default routing gains them: the three on `claude-opus-5-5` at `max` (decision 14), and `plan_review` on the planner's seat, `claude-opus-5` at `max` (the redesign's decision 9).", "There is no switch that skips the phase (decision 10), and `spec_validation_rounds` defaults to 8 (decision 13). Each phase's spend is reported beside planning's, and nothing stops for it (decision 16).", "Off a TTY, DECIDE takes every recommended answer and logs it as a vetoable default. PRESENT lists every default with C-3′'s assumptions.", "N-7 keeps `detent-prd-v3.md` as its only input and runs the phase headless. Release-checklist item 5 records the self-build's duration and spend beside the green.", "The PRD records the planning redesign of `docs/plan-planning-redesign.md`: ANALYZE folded into DECIDE, with D-10's order naming DECIDE; SLICE seeded by the pack and keyed by requirement ids; PLAN drafted from pack records, with `criterion_ids` and `spec_defects` in place of questions, which amends C-3‴ (PRDR-207): no planning stage asks, so DECIDE's decision log is what keeps a question to one asking; mechanical checks that drive one targeted redraft and block approval when they still fail, with no model read of the cross-slice contracts unless run-time outcomes call for one (that plan's decision 10); one review read by a `plan_review` role; gates bound per package, which amends D-5, V-5 and NG2 and closes OQ-4; the explicit approval of a plan more than one Detent build produced (that plan's decision 8); and PRESENT as that plan's §9 describes.", "The PRD states the rule the operator chose on 2026-09-26: a planning mechanism that claims to improve plans names the run-time outcome it should move, and reviewer finding counts are not an outcome.", "Every id the amendment adds is defined exactly once, the first rule the plan gives the pack checker, and in a shape `tests/docs/prd-requirement-ids.test.ts` (PRDR-287) parses, so that test fails the PRD otherwise."]
non_goals: ["Does NOT renumber PRD marks. PRDR-287 and PRDR-288 did: nine marks each named more than one rule, and ten definitions moved. The plan cites them as the evidence for the checker's first rule.", "Does NOT write code. PRDR-279 to PRDR-286 implement the phase, each after this lands (N-6).", "Does NOT tune the routing past these defaults. A later change names the run-time outcome it should move (the redesign's decision 3)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-117", "PRDR-119", "PRDR-207", "PRDR-263", "PRDR-287", "PRDR-288", "PRDR-289", "PRDR-265", "PRDR-290", "PRDR-291", "PRDR-292", "PRDR-293", "PRDR-294", "PRDR-295", "PRDR-296", "PRDR-297", "PRDR-298"]
depends_on: []
---

# PRDR-278 — the specification phase, recorded in the PRD before any code

## Where this came from

The operator's trials of Detent on other projects kept raising one complaint: Detent keeps hitting
contradictions in the PRD. The ksarjs specification (2026-09-24 … 26) then showed what fixing the
documents before planning takes. A raw PRD became a pack of 2,024 requirements and 1,144
acceptance criteria through an audit, founder decisions, writing and seven validation rounds.
The defects it found, and what found each, are the table in `docs/plan-specification-phase.md`
§1. On 2026-09-26 the operator decided to make that work a phase of `init`. The sixteen
decisions are the plan's §2; the last seven settled its open questions later that day.

## Problem

Nothing in `init` judges the documents. ANALYZE records an assumption where they are silent or
disagree (C-3″, PRDR-119), SLICE and PLAN work from them, and C-4″'s review judges the plan
against them. A rule that is wrong but consistent survives all of it. The implement session
builds it, the tests are written from the same criteria, and review approves. This is the
doc-claim drift PRDR-263 names, one level up, where no test can see it.

N-6 forbids building the phase before the PRD says so. The phase changes C-3′'s central sentence,
"Planning does not stop for a question". It also adds phases to the pipeline v3 inherits from v2
§4.1, and raises AWAIT_INFO in two new places.

## What the amendment records

- The four phases, and the pipeline with them (plan §3).
- C-3′ amended: AWAIT_INFO at DECIDE and at VALIDATE's ceiling. The five interrupts are unchanged,
  and the amendment says why (C-5, C-14′).
- The pack, its precedence and its conformance record (plan §4), and the checker as a referee
  gate (plan §5).
- Vetoable defaults, and the defaults taken off a TTY (plan §6).
- VALIDATE's stop rule and ceiling, 8 rounds by default (plan §7, decision 13).
- The amendment path during `run`, with decision 8's correction (plan §8). Fix sessions may file
  too, so X-3's table gains a PREMISE_FALSIFIED row from each fix state (decision 12, PRDR-289).
- Three roles for the phase, one per tool set: `audit`, `spec_write` and `spec_review`, added with
  the redesign's `plan_review` in one F-3 event and routed to Opus 5.5 at `max` (decisions 11, 14
  and 15); no switch that skips the phase (decision 10); and each phase's spend reported, never
  capped (decision 16).
- N-7: the raw PRD stays its input, and the checklist records the added time and spend
  (plan §9).

## The planning redesign, in the same amendment

On 2026-09-26 an audit of the planning phase (`docs/planning-phase-audit-2026-09-26.md`) found that
September's 79 planning tickets mostly measured the planner rather than improved it. ksar-cloud's
approved plan was never reviewed as a whole, kept 34 defects that code had proved, and spent 78% of
its planning on a review that never approved. The operator decided to rebuild planning on the pack,
in this amendment (`docs/plan-planning-redesign.md`, PRDR-290 to PRDR-298). The amendment records:
- ANALYZE folded into DECIDE, and D-10 amended to match;
- SLICE, PLAN, the mechanical checks, the single review and PRESENT as that plan describes;
- C-3‴ (PRDR-207) amended to match: no planning stage asks, so DECIDE's decision log is what keeps
  a question to one asking;
- gates per package, which amends D-5, V-5 and NG2 and closes OQ-4;
- the explicit approval of a plan more than one Detent build produced (that plan's decision 8);
- `plan_review` on the planner's seat, and no model read of the cross-slice contracts until
  outcomes call for one (that plan's decisions 9 and 10);
- the rule that run-time outcomes, not reviewer findings, decide which planning mechanisms stay.

## Falsification (verification protocol, item 1)

`tests/docs/prd-specification-phase.test.ts` was written before the PRD was touched, and run
against `663e5ae`, the branch head, in a scratch worktree holding the new test files. The shared
parser (`tests/docs/prd-marks.ts`) and the refactored uniqueness test went with them:

```
 ✓ tests/docs/prd-requirement-ids.test.ts (13 tests)
   × … the inherited pipeline line shows AUDIT, DECIDE, WRITE and VALIDATE between DISCOVER and DETERMINE_VERIFICATION, and no ANALYZE
     → expected [ 'INIT_FS', 'DISCOVER', …(10) ] to deeply equal [ 'INIT_FS', 'DISCOVER', …(15) ]
   × … every mark the amendment adds is defined exactly once, and names PRDR-278
     → C-2⁶ is defined once: expected [] to have a length of 1 but got +0
   × … each specification phase says what it reads, what it writes and when it stops
     → AUDIT has its own entry in C-2⁶: expected '' not to be '' // Object.is equality
   × … C-3′ is amended, not contradicted: AWAIT_INFO at DECIDE and at VALIDATE, the five interrupts kept, and why a sixth was refused
     → C-3′: expected '' to contain 'C-3′'
   × … X-3 admits PREMISE_FALSIFIED from each fix state with IN_PROGRESS's outcome, and adds no state or event
     → BLIND_FIX: expected '' to contain 'BLIND_FIX'
   × … S-1 gains four roles in one F-3 schema event, and S-5⁵ states every role's default model and effort as the code has them
     → `audit`: expected '' to contain '`audit`'
   × … no switch skips the phase, VALIDATE's ceiling defaults to 8, and each phase's spend is reported and never capped
     → expected '' to match /no switch/iu
   × … N-7 keeps the raw PRD and runs the phase headless, and the checklist records its duration and spend
     → expected '' to contain '`detent-prd-v3.md`'
   × … the planning redesign is recorded rule by rule
     → expected '' to match /ANALYZE[\s\S]*DECIDE/u
   × … the operator's decisions are cited: all sixteen of the specification plan's and all ten of the planning plan's
     → expected [] to deeply equal [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, …(6) ]
   × … C-3′ points forward to C-3⁗
     → C-3⁗: expected '- **C-3′ (3.1.1, PRDR-117).** Plannin…' to match /Amended by [^*]*C-3⁗(?![′″‴⁗⁰¹²³⁴⁵⁶⁷…/u
   × … (the same for C-3″, C-3‴, C-4″, C-4‴, C-4⁗″, C-4⁗‴, D-28′, D-24′, C-2‴, C-2⁗, C-2⁵′,
        A-1‴, A-1⁵, C-8′, C-8″, C-8‴, C-8⁗, V-1′, A-1⁶, X-4⁵ and S-1″: 21 more)
 Test Files  1 failed | 1 passed (2)
      Tests  32 failed | 13 passed (45)
```

The uniqueness test passing there is the other half: moving its parser into `prd-marks.ts`
changed nothing it sees. Two of the new checks were later tightened, after the mutation battery
below showed each was satisfied by the wrong sentence: the phase table's check, and D-5′'s.

## What changed

- **`detent-prd-v3.md`.** A dated block before the pipeline line it changes:
  - C-2⁶: the four phases, each with what it reads and writes and when it stops, plus the
    conforming-pack path, no switch, no second DISCOVER, and sessions and spend;
  - C-2⁷: the pack, its conformance record and its checker;
  - C-3⁗: questions move to DECIDE, AWAIT_INFO at DECIDE and at VALIDATE's ceiling, and why a
    sixth interrupt was refused;
  - D-10′: ANALYZE folded into DECIDE;
  - C-2⁸: SLICE seeded, with slice keys;
  - C-4⁵: PLAN from pack records;
  - A-1⁷: checks that fix and block;
  - C-4⁶: one review read;
  - C-7″: PRESENT and approval, mixed builds included;
  - C-8⁵: the scoped re-plan, and `--replan`'s entry;
  - X-3′: the fix-state rows;
  - X-4⁷: amendments during `run`;
  - S-1‴: four roles in one F-3 event;
  - S-5⁵: the default routing, models and efforts;
  - D-5′, V-5′ and OQ-4: gates per package;
  - N-5′: run-time outcomes;
  - N-7′: the headless self-build.

  The block adds D-31, D-32 and D-33 to the decision log, rewrites the pipeline line, and adds
  a forward pointer at the end of each of the 22 rules it amends. It also corrects the
  Inheritance section, whose "inherited verbatim" and "nothing in it changes" were already false
  before this change: X-4′, X-4″ and X-8′ added events, and C-12‴ added rows.
- **`docs/release-checklist.md` item 5** records the self-build's duration and spend, per phase.
- **Tests.**
  - `tests/docs/prd-marks.ts` holds the parser `prd-requirement-ids.test.ts` carried, now shared
    so that the two tests cannot read the PRD two ways.
  - `tests/docs/prd-specification-phase.test.ts` pins the amendment. It compares S-5⁵'s table
    with `DEFAULT_MODEL_ROUTING` and `DEFAULT_EFFORT_ROUTING` for every role the code has, and
    `spec_validation_rounds`'s default with `CEILINGS` once the key exists. The PRD therefore
    cannot drift from the code when PRDR-281, PRDR-284 and PRDR-294 land. The test names none of
    them, since an id cited under `tests/` reads to `tickets:check` as work that has landed.
- **The plans.** Both status lines now point at the PRD and at this ticket.
- **Nine OPEN tickets aligned with the PRD** (the PRD wins, N-6):
  - PRDR-281: AUDIT's research pool;
  - PRDR-286: its stale "which roles may is an open question";
  - PRDR-289: the DEPENDENCY_DISCOVERED rows;
  - PRDR-290: `--replan`'s entry;
  - PRDR-291: the slice key and SLICE's reuse;
  - PRDR-292: PLAN's baseline items and `sizing_evidence`;
  - PRDR-293: baseline coverage;
  - PRDR-294: the review's tags and `sizing_evidence`;
  - PRDR-295: the per-path gate check.

## Calls the plans left open, settled in the PRD

The operator's decisions are recorded as made. These points were open or stated two ways in the
plans; the PRD settles each as below, and each can be vetoed with a later amendment:
1. **AUDIT's research pool.** `planning_research_tool_calls` keeps its name and is counted and
   reported against AUDIT's research. It is never told to a session as a share, because a told
   share caps how much AUDIT checks, and specification decision 16 caps nothing in the phase.
   The plans said only that AUDIT reuses the research engine.
2. **Fix-state DEPENDENCY_DISCOVERED rows.** A fix session's `missing` is a dependency, as an
   implementer's is (X-3′). PRDR-289's criteria already required it, but the plan named only
   PREMISE_FALSIFIED.
3. **The slice key** adds the catalogue entries a requirement cites and the session budget,
   because P9 keys a checkpoint by every input, and C-8‴'s key had the budgets.
4. **SLICE's reuse** is also keyed by the baseline, the band and the prompt. The criteria counts
   guide the grouping and do not key it, a deliberate exception to P9 stated in C-2⁸, since
   otherwise an edited criterion would re-cut the product.
5. **`expected_tickets` goes; C-2⁵′'s band stays** as the slice session's guidance. The plan
   deleted the estimate, and its deletions table does not list the band.
6. **Production-baseline items stay.** SLICE places them, PLAN drafts them, and A-1⁷'s coverage
   check covers them. The plan's coverage check named only requirement and criterion ids.
7. **PLAN and the review keep X-4″'s `sizing_evidence`.** The plan's input list omitted it, and
   X-4″ stands.
8. **Review findings carry one of four tags**: `sizing`, `shape`, `dependency` or `coherence`.
   S-3″'s earned reminder is triggered by `coherence` and `dependency` findings.
9. **`--replan` enters at DETERMINE_VERIFICATION** (`REPLAN_FROM` was ANALYZE), and never
   re-runs the specification phase.
10. **The gate check is per surface path.** The plan's §8 read two ways. "A surface outside every
    bound package" suggests per path, and "a ticket no gate can fail" suggests per ticket.
    ksar-cloud's evidence, 69 tickets that wrote `dashboard/` and not only the 41 that wrote
    nothing else, describes the per-path reading.
11. **Cycles.** A derived edge that A-1‴ refuses because it would close a cycle counts as a
    failure, and A-1″'s repairs run first and are still reported. Otherwise the plan's check 5
    could never fail.
12. **D-28′'s rule stands for any later batch** now that the draws it bounded are deleted.
13. **The migration writes the four new roles' default routing into an existing config.** S-5′
    keeps an existing routing untouched, and a new role must not default silently.

## Mutation battery (verification protocol, item 2)

Twenty mutants of the PRD and the checklist were run against the two doc tests. The files were
restored from a snapshot copy after each mutant, never with `git checkout`, and were
byte-identical to the snapshots at the end:

```
ANALYZE back in the pipeline line: killed          ceiling default 6: killed
a sixth interrupt in the pipeline: killed          a switch: killed
C-2⁶ defined twice: killed (2 tests)               D-33 counts findings: killed
VALIDATE loses what it writes: killed              specification decision 12 uncited: killed
C-3⁗ drops why a sixth was refused: killed         planning decision 10 uncited: killed
X-3′ adds an event: killed                         AUDIT stops: killed
spec_review routed to Opus 5: killed               D-5′ forgets NG2: killed
review's effort disagrees with the code: killed    §3 keeps NG2: killed
S-1‴ loses the migration: killed                   X-4⁵ loses its pointer: killed
§7 says nothing changes: killed                    checklist item 5 drops duration: killed
```

The first run had three survivors, and each changed something:
- "VALIDATE loses what it writes" survived, because `\bwrites\b` matched "writes and runs a
  randomized simulation". The phase check now pins each phase's reads, writes and stops from the
  plan's §3 table.
- "D-5′ forgets NG2" survived, because D-5′ names NG2 while describing it. The check now requires
  "lifts NG2", and the §3 inheritance note.
- "specification decision 7 uncited" survived because the decision is cited twice. That was a bad
  mutant, not a gap; it was replaced by decisions cited once.

## Recorded, not fixed

- **Init sessions record no effort.** `src/schemas/roles.ts` says so: init sessions are routed a
  level and record neither the routed nor the settled one, and "ARCH-2 parity is owed there and
  is not paid". Every session S-5⁵ puts at `max` for the specification phase is an init session.
  So a run cannot show from its journal that specification decision 14 was honoured. This is
  worth its own ticket; none is filed here.
- **`planning_research_tool_calls`'s default of 16** was sized for a few planning questions.
  AUDIT's use is now only counted, and the first N-7 run shows whether the figure means anything
  for it (D-33).
- **Package-less paths.** Under V-5′, a ticket that writes a path in no package with bound gates
  cannot be approved. A root without a manifest therefore blocks a ticket that touches only
  `README.md` at that root. The plan chose this ("a ticket no gate can fail cannot be
  approved"); the per-path reading of item 10 makes it reachable for mixed tickets too.
- **Historical accounts are left as written**, as dated records of what each rule found:
  - P6′'s list of billable phases, which names ANALYZE and REVIEW_PLAN;
  - C-7′'s and C-8″'s accounts of ANALYZE re-running;
  - MP3's "seven phases";
  - the N-7 scoping note's "analyst".

  The rules that changed carry pointers; these did not change.
- **The plans are not rewritten.** Their status lines say the PRD wins where the two differ, and
  this ticket lists where.
