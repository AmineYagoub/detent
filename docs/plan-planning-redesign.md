# The planning phase, rebuilt on the pack — implementation plan

**Status:** proposed; filed as PRDR-290 … PRDR-298; no code yet.
**Prerequisite (N-6):** PRDR-278 lands before any code. It is the one PRD amendment for this plan and
for `docs/plan-specification-phase.md`, by the operator's decision.
**Evidence:** `docs/planning-phase-audit-2026-09-26.md`.
**Decided by:** the operator, 2026-09-26, after that audit (§2).

---

## 1. What this fixes

September added 79 tickets and 4,500 lines to the planning phase. The audit found that about 19
delivered a result a live run could see, nearly all of them plumbing. None has evidence of a better
plan, because nothing measures one. The plan ksar-cloud approved on 2026-09-23 shows what the design
does at scale:
- it was never reviewed as a whole: the review's prompt was 1.55M tokens against a 1M limit;
- 34 defects that code had proved stayed in it, because proved defects are reported and never fixed;
- 78% of its planning spend went to a review loop whose reviewer never approved, and whose
  revisions introduced as many findings as they resolved (121 and 119).

The specification phase gives `init` something planning never had: a validated pack with
requirement ids, criteria with exact values, a decision log and a checker. Planning should be
built on it. The pack alone is not enough, though. ksar-cloud's documents were already half a pack,
and every mechanism problem above still appeared.

## 2. The operator's decisions (2026-09-26)

1. **One amendment.** The planning redesign and the specification phase are recorded in the same
   PRD amendment, PRDR-278.
2. **One review read.** Each slice gets one review, by its own reviewer role with its own prompt,
   limited to judgement: sizing, shape, dependencies and coherence. Mechanical checks own coverage
   and contracts. The three-read sampling and the revision-measurement stack are deleted.
3. **Run-time outcomes decide.** Whether a planning mechanism stays is decided by what happens when
   the plan runs: escalations, falsifications and oversized tickets. Reviewer finding counts are not
   an outcome.
4. **ksar-cloud waits.** Its approved plan is paused and will be re-planned by the new planner. That
   run becomes the baseline for later changes.
5. **ANALYZE folds into DECIDE.** The greenfield stack becomes a decision in the log, and the pack's
   parse replaces ANALYZE's summary.
6. **A failed check blocks approval.** A mechanical check that still fails after one targeted
   redraft stops the plan at PRESENT.
7. **Gates bind per package**, as part of this redesign. This lifts a limit v1 set on purpose
   (§8). The operator chose it before that was noticed, was told, and kept it the same day.

Accepted with the audit's recommendation:
- mechanical cross-slice checks replace the whole-plan model review;
- planner inputs come from the pack;
- the dead weight is deleted;
- evaluation runs use a frozen build.

## 3. The pipeline

```
INIT_FS → DISCOVER → [AWAIT_DOCS] → AUDIT → DECIDE → [AWAIT_INFO] → WRITE → VALIDATE → [AWAIT_INFO]
        → DETERMINE_VERIFICATION → [AWAIT_BINDING_CHOICE | AWAIT_SETUP_CONSENT]
        → SLICE → PLAN → PREPARE_AGENTS → PRESENT → [AWAIT_INFO | AWAIT_APPROVAL] → READY
```

- **ANALYZE is gone.** It handed later phases three things:
  - `greenfield`, which code already computes from the stack markers (`isGreenfield`);
  - in greenfield, the stack with its scaffold files, which DECIDE now records as a decision, and
    which the pack must carry (PRDR-279);
  - a prose summary, replaced by the checker's parse of the pack.
- **D-10's reason still holds.** Verification cannot bind before a stack exists, and the stack now
  exists after DECIDE, which still precedes DETERMINE_VERIFICATION. D-10's order is amended to name
  DECIDE.
- **A conforming pack** (specification-phase decision 6) goes from the checker to
  DETERMINE_VERIFICATION, and its stack comes from its decision log.
- **Persisted shapes.** The phase list is persisted in checkpoints, so removing a phase is an F-3
  schema event.

## 4. SLICE, seeded by the pack

- **The seed is mechanical.** Code groups the pack's requirement ids by milestone, then by module
  code, and counts each group's criteria.
- **One slice session orders and groups the seed.** It puts the walking skeleton through the
  riskiest integration first; that judgement stays with the model. Code checks the rest:
  - every requirement id lands in exactly one slice;
  - the slices respect milestone order;
  - no slice names an id the pack does not define.
- **Identity.** A slice is its requirement ids.
  - Its cache key is those ids, the content hash of each requirement with its criteria and cited
    decisions and facts, the stack, the bindings and the prompt. The model's own words (title,
    goal) are never in the key.
  - SLICE is reused while the set of ids and milestones is unchanged, so an edited requirement
    re-plans only its own slice.
  - An added requirement is placed by a slice session that may only add, to an existing slice or a
    new one.
  - A removed requirement re-plans its slice.
  - This is what makes the specification phase's scoped re-plan (PRDR-286) possible.
- **No guessed sizes.** The slicer no longer estimates ticket counts; those estimates were off by
  58% and varied from 308 to 554 for the same documents. The announcement states the session
  formula of §10 for the slice count, not a guess.

## 5. PLAN, drafted from pack records

- **Inputs per slice.** From the checker's parse:
  - each requirement's id, milestone and MUST/SHOULD text;
  - its criteria, each with its id and Given / When / Then;
  - the decisions, facts and catalogue entries it cites;
  - the stack, the bindings and the session budget;
  - a compact index of the tickets in the slices this one depends on: id, title, surface, and what
    each provides as `kind:id`.

  Catalogue ids (routes, events, error codes, settings, jobs) are the canonical names in `provides`
  and `consumes`, so a drafter no longer digs through Detent's state files to find them.
- **Outputs.** The ticket gains `criterion_ids`. Every pack criterion a ticket carries is copied
  into its acceptance criteria verbatim, and a ticket may add criteria of its own.
- **No questions.** The pack has settled what the founder must decide. A drafter may report only
  `spec_defects`: a contradiction or gap in the pack, quoted from it. A spec defect found while
  planning takes the specification phase's amendment path (its §8) before approval: PRESENT raises
  AWAIT_INFO, an approved amendment edits the pack, the checker gates it, VALIDATE re-validates the
  change, and only the affected slices re-plan. This amends C-3‴ (PRDR-207): with no planning
  stage asking, DECIDE's decision log is what keeps a question to one asking (PRDR-282).
- **Prompts.**
  - One prompt per job: `prompts/slice.md`, `prompts/plan.md`, and `prompts/plan_review.md` for
    the new role.
  - No Detent PRD ids in text the model reads.
  - Every rule is either enforced by code or stated as a judgement the reviewer makes.
- **Tools.** Planner sessions read with Read, Grep and Glob and write their artifact. They get no
  Bash and no subagents. The audit counted:
  - 2,846 read-only Bash calls;
  - 97 attempts to spawn subagents;
  - 1,104 of 6,117 tool calls that errored or were denied.

## 6. Mechanical checks that fix

**After each slice's draft, and after its revision, code checks:**
1. **Coverage.** Every requirement id of the slice is in some ticket's `requirement_ids`. Every
   criterion id of those requirements is in some ticket's `criterion_ids`. No ticket names an id
   from outside its slice.
2. **Contracts.** Every consumed name has a provider in this slice or an earlier one, and no name
   has two providers. Derived edges (PRDR-120) are added as today.
3. **Milestone order.** No ticket delivering an `[Mk]` requirement depends on one delivering an
   `[Mj]` with `j > k`.
4. **Gates.** Every ticket's surface falls under at least one bound gate (§8).
5. **The graph.** No cycle remains after derived edges.

**A failure buys one targeted redraft** of the slice, with the failures as its inputs: they are
proved, so no reviewer's judgement is needed. Then the checks run again.

**After every slice, the same checks run across the whole plan.** A name nobody provides sends one
redraft to the earliest slice that consumes it. A name with two providers sends one to each owner's
slice. Then the checks run again.

**What still fails blocks approval** (decision 6). PRESENT raises AWAIT_INFO naming each failure.
The operator amends the pack or edits the tickets, and `detent init` resumes.

This replaces the whole-plan model review. The checks grow linearly with the plan. The review's
prompt carried every ticket in full: it worked at about 260 tickets, reached 1.55M tokens at 547, and
ksarjs's pack (2,024 requirements) is larger still.

## 7. One review read, by its own role

- **Role.** A new `plan_review` role, with its own prompt, model and effort, separate from the
  drafter. Role ids are persisted, so this is an F-3 schema event with a migration for `role@hash`
  assignments. PRDR-084 declined that cost; the audit says it is now worth paying.
- **One read per slice**, after the mechanical checks pass. The scope is judgement only:
  - sizing: does each ticket fit one implement session;
  - shape: walking skeleton first, vertical increments;
  - dependencies that contracts cannot see;
  - coherence: tickets that contradict each other or the pack.
- **Findings** carry a severity (blocker, major or minor), the ticket and the fix. "Approve" is the
  expected verdict when nothing is blocker or major.
- **Revision.**
  - A blocker or major buys one revision of the slice.
  - The mechanical checks run on the revision, and there is no second review.
  - Minors are recorded on their tickets and reach the run sessions by PRDR-271's path.
- **Deleted:**
  - the three-read sampling;
  - the review after revision (PRDR-269);
  - the churn and null lines;
  - the held-finding labels;
  - the advice file.

## 8. Gates per package

- **What this amends.** Root-only binding is deliberate today:
  - D-5: "root-only in v1; workspace scoping is a named v2 migration";
  - NG2 lists per-workspace gate scoping as a non-goal;
  - V-5 binds root entrypoints only;
  - OQ-4 left the design open.

  This section settles OQ-4 and amends D-5, V-5 and NG2 in PRDR-278. A per-package binding is a
  persisted shape, so it is the F-3 migration D-5 anticipated ("`schema_version` carries the
  upgrade").
- **Discovery.** DETERMINE_VERIFICATION looks for a manifest in every package directory, not only
  the root (`package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml` and the rest of the adapters'
  ecosystems), and binds each package's gates.
- **A ticket's gates** are those of the packages its surface touches. A surface outside every bound
  package fails check 4 of §6, so a ticket no gate can fail cannot be approved. On ksar-cloud, 69
  tickets wrote `dashboard/`, 41 wrote only there, and no gate could fail for any of them.
- **Declared packages.** The pack may declare packages and their gate commands (PRDR-279). Declared
  commands are the bindings, as documented commands are today (PRDR-115). ANALYZE used to copy them
  out of prose; the pack now carries them in structured form.

## 9. PRESENT

- **Shown:**
  - slices, tickets and milestones;
  - the decision log: every `D-n`, and every `X-n` as vetoable;
  - the checks that still fail;
  - the spec defects planning found;
  - review majors left after the revision, as risks;
  - what planning cost.
- **Gone:**
  - the revision and churn lines;
  - the 457-KB advice file;
  - the question list, which is DECIDE's now.
- **Approval is refused** while a check fails or a spec defect is open.

## 10. Measuring plans by how they run

- **Per ticket**, from what `run` already records (`transitions.jsonl`, the ledger):
  - escalations to NEEDS_HUMAN;
  - falsifications by cause: premise, oversized, dependency discovered;
  - budget breaches;
  - done in its first generation;
  - review rounds;
  - cost and wall-clock.
- **Per slice and per plan**, with the Detent build and the pack hash that produced the plan: a
  quality section in `detent status`, and a record when a run ends.
- **The rule, in the PRD.** A planning mechanism that claims to improve plans names the outcome it
  should move. A measured run where the outcome does not move is grounds to remove the mechanism.
- **Evaluation hygiene.**
  - Every planning checkpoint records the Detent build that wrote it.
  - PRESENT names every build that contributed.
  - Approving a plan built by more than one build takes an explicit flag.
  - Experiments run on a copy of the project, never on its live `.detent` tree. That is how s07 of
    the "no revision" arm reached ksar-cloud's plan.
- **Sessions per plan** of N slices: `1 + 2N + R + C`, where R is the slices revised and C the
  targeted redrafts. Today it is at least `4N + 3`. ksar-cloud's 24 slices took 186 sessions; the
  new design needs 49 when no slice needs revising and 73 when every slice does, plus targeted
  redrafts. This is an estimate, for the first run to measure.

## 11. Deleted

| What | Why | Replaced by |
|---|---|---|
| ANALYZE (`analyze.ts`) | decision 5 | DECIDE, and the pack's parse |
| Planning research (`plan-research.ts`, its pipeline wiring) | answers never reached planning | AUDIT, which reuses the research engine and brief format of PRDR-262/264 |
| Question machinery (`questions.ts`, PRESENT's merge and renumbering, PLAN's `questions`) | the pack settles questions | DECIDE; `spec_defects` |
| Three-read sampling, post-revision review, churn, labels, advice (`plan-sample.ts`, `plan-signal.ts`, `plan-notes.ts`, `present-advice.ts`, the `revisionRounds` seam) | decision 2; they changed no plan | one review read |
| The whole-plan model review (`plan-whole.ts`'s review) | overflowed at 546 tickets | the cross-slice checks of §6 |
| `consent.ts`, `allowlist.ts`, and the seams only tests use (`bootstrapBlocks`, `planPath`) | unreachable | nothing |
| Stale doc-blocks (the spend-gate wording; `retry.ts:2`, `questions.ts:9`, `symbol-reminder.ts:55`, `contracts.ts:19`, `present.ts:49`) and the presentation printed three times | doc-claim drift | accurate text |

## 12. The specification phase, adjusted

`docs/plan-specification-phase.md` now reads with these changes:
- VALIDATE hands the pack to DETERMINE_VERIFICATION.
- Decision 6's conforming pack goes straight on to DETERMINE_VERIFICATION.
- DECIDE records the stack in greenfield.
- A red checker blocks everything after VALIDATE.
- PRDR-286's scoped re-plan rests on §4's slice keys.

## 13. Open questions

- The reviewer's model and effort. Today the planner runs at max effort and the run-time reviewer
  at xhigh.
- Whether a compact model read of the cross-slice contract index is ever worth adding back. It
  would be added only if run-time outcomes show incoherence across slices that the checks miss.
- The flag that approves a plan built by several builds: its name, and whether off a TTY it may be
  given at all.

## 14. Tickets

| Ticket | Part | Depends on |
|---|---|---|
| PRDR-278 | The PRD amendment, now covering this plan too | — |
| PRDR-290 | ANALYZE folds into DECIDE | PRDR-278, PRDR-282 |
| PRDR-291 | SLICE seeded by the pack, keyed by requirement ids | PRDR-278, PRDR-280 |
| PRDR-292 | PLAN from pack records: `criterion_ids`, canonical names, `spec_defects`, split prompts, no Bash | PRDR-291 |
| PRDR-293 | Mechanical checks that fix, and block approval | PRDR-292, PRDR-295 |
| PRDR-294 | One review read, by the `plan_review` role | PRDR-293 |
| PRDR-295 | Gates per package | PRDR-278 |
| PRDR-296 | PRESENT rebuilt | PRDR-293, PRDR-294, PRDR-282 |
| PRDR-297 | Run-time outcomes, and evaluation hygiene | PRDR-278 |
| PRDR-298 | Delete what the redesign replaces | PRDR-290 … PRDR-296 |
