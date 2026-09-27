---
id: PRDR-294
title: "The plan review costs 78% of planning: three reads a slice, a revision, then three more reads. In the runs that built ksar-cloud's plan, reviewers wrote 151 verdicts, every one `changes`, and revisions resolved 121 findings while introducing 119. Each slice now gets one read, by a separate `plan_review` role limited to judgement and graded by severity; a blocker or major buys one revision, and the sampling and measurement built around the loop are deleted"
state: DONE
severity: major
category: capability
labels: ["prd-review", "planning-redesign", "operator-decision", "C-4″", "F-3", "review"]
surface: ["src/schemas/roles.ts", "src/init/plan-review.ts", "src/init/plan-slices.ts", "src/init/plan-sample.ts", "src/init/plan-signal.ts", "src/init/plan-notes.ts", "src/init/present-advice.ts", "src/init/plan.ts", "src/kernel/plan-findings.ts", "prompts/plan_review.md", "prompts/manifest.json", "tests/init/plan-review-role.test.ts"]
prd_refs: ["C-4″", "C-4⁗", "D-24", "F-3", "PRDR-084", "PRDR-196", "PRDR-200", "PRDR-268", "PRDR-269", "PRDR-271", "PRDR-278"]
acceptance_criteria: ["A `plan_review` role exists with its own prompt, routed to the planner's seat, `claude-opus-5` at `max` (the redesign's decision 9), and its `role@hash` assignments migrate under F-3. It shares one `schema_version` event with the specification phase's `audit`, `spec_write` and `spec_review` roles: whichever lands first bumps the version and writes the migration, and the others extend it before a release.", "Each slice gets one review read, after the mechanical checks pass. Its scope is sizing, shape, the dependencies contracts cannot see, and coherence. Coverage, traceability and contracts are code's (PRDR-293).", "A finding carries a severity (blocker, major or minor), its tag (`sizing`, `shape`, `dependency` or `coherence`), its ticket and its fix, and the review receives X-4″'s `sizing_evidence` (C-4⁶, PRDR-278). `approve` is the verdict when nothing is blocker or major, and a test with a clean scripted draft asserts it.", "A blocker or major buys one revision of the slice. The mechanical checks run on the revision, and there is no second review. Minor findings are recorded on their tickets and reach the run sessions through PRDR-271's path.", "Deleted, with their tests: the three-read sampling (`plan-sample.ts`), the review after revision (PRDR-269), the churn and null lines (`plan-signal.ts`, `plan-notes.ts`), the held-finding labels, the advice file (`present-advice.ts`), and the `revisionRounds` seam.", "A slice costs at most three sessions: the draft, the review and one revision. A test pins it."]
non_goals: ["Does NOT judge the reviewer by its finding counts. Its worth is decided by run-time outcomes (PRDR-297).", "Does NOT remove `launch-batch.ts` if VALIDATE's parallel reviewers use it (PRDR-284)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-084", "PRDR-200", "PRDR-269", "PRDR-271", "PRDR-281"]
depends_on: ["PRDR-293"]
---

# PRDR-294 — one review read, by the `plan_review` role

## Where this came from

The planning audit of 2026-09-26, §3 and §4:
- review and revision cost $705 of the $903 in ksar-cloud's plan;
- no written verdict was `approve`;
- revision resolved 121 findings and introduced 119;
- the operator's own experiments showed that finding counts track how much the reviewer says, not
  plan quality.

## Problem

PRDR-084 declined a separate role because a new `RoleId` is an F-3 schema event. So the reviewer
runs with the drafter's role, prompt, model and effort, reads the drafter's own "too few tickets"
rule, and never approves. Around it, September built sampling to separate signal from noise and
measurement to report the revision's effect. Neither changed a plan: PRDR-268's own commit says
production behaviour was identical to HEAD at one revision round, and PRDR-269 falsified its own
prediction and was kept.

## Design

The redesign plan's §7. The operator decided the F-3 cost is worth paying, the scope is what a model
can judge, and severity makes the loop's stop mean something.

## From PRDR-291

SLICE's announcement counts PLAN_REVIEW_SAMPLES review reads per slice, and the reads again after
each revision (`planningSessions` in `src/init/slice.ts`). One review read per slice and no second
review change it. With PRDR-293's deletion of the whole-plan review, the announcement's part of
N-5′'s `1 + 2N + R + C` becomes `2N + R + C`: the 1 is SLICE's own session, which has already run
when the announcement is made. The formula case in `tests/init/slice-seed.test.ts` pins the
sentence.

## From PRDR-292

The review has its own prompt, `prompts/plan_review.md`, and still runs on the planner role:
`promptOf` in `src/schemas/roles.ts` picks it for a planner session launched for REVIEW_PLAN. This
ticket's first criterion gives the review a role of its own, and the prompt moves with it.
- `prompts/plan.md` states six rules as the drafter's own, since no review tag covers them: a
  ticket's `type`, which sends a `bug` to diagnosis first; no scaffolding ticket in a new project;
  a `depends_on` naming only what a ticket needs; a baseline item's criteria being its
  `verifiable_by`, with the pack winning where it decides otherwise; what an engineer decides from
  the records, with why in the description; and a spec defect being only what the pack leaves
  open. Which of them the review takes on is this ticket's call, weighed against the churn it
  measured.
- It is handed the tickets and `docs`, the planning documents. It is handed neither the records a
  draft is planned from nor the draft's spec defects, so only the operator reads a defect, at
  PRESENT. Whether one is real, or the records settle it, is a judgement this ticket's review could
  make.
- A slice's review verdict is cached under the slice's key, which reads the records and not the
  documents the review reads. An edit to a document no record holds leaves a cached verdict
  standing.
- `REVIEW_INSTRUCTION` in `src/init/plan-review.ts` restates the tags beside the prompt, in its own
  words, and the two must agree.
- A review session is a planner session: Read, Grep and Glob, a write to its artifact alone, and no
  reach into the root's `archive/`.

## From PRDR-293

The whole-plan review is gone (A-1⁸), so the review has one scope: `ReviewScope` in
`src/init/plan-review.ts` is a slice, and `prompts/plan_review.md` judges `coherence` within the
slice or against `plan_index`. `REVIEW_INSTRUCTION` says the same in its own words.
- The checks run on a slice's draft before its review, and a failing draft is redrafted once with
  its failures, so the review reads the redraft. C-4⁶'s "one read, after A-1⁷'s checks pass" is not
  what runs: the review reads that draft whether or not the checks then pass, and what still fails
  reaches PRESENT, which holds approval on it. Whether the read waits for the checks, or skips a
  draft that still fails them, is this ticket's call.
- After the revision the checks run again, and a failing revision is redrafted once. That redraft,
  and every redraft the checks across the plan send, is judged by the checks alone and never
  reviewed.
- The review is handed nothing the checks proved, and its `coverage` and `dependency` tags overlap
  A-1⁷'s families, so a read can still report what code already checks. Limiting it to judgement
  (the redesign's decision 2) means deciding which of those tags it keeps.
- `planningSessions` in `src/init/slice.ts` announces `4N + 4R + C`, where C is the redrafts the
  checks send. One read and one revision make it `2N + R + C`. Two tests pin the numbers: the
  formula case in `tests/init/slice-seed.test.ts`, and the price assertion
  `1 + N_SLICES * (1 + PLAN_REVIEW_SAMPLES)` in `tests/init/slicing-scale.test.ts`, with the
  payload table beside it.

## Building it

C-4⁶ is built, and the PRD records it as C-4⁸. `plan_review` is a role in `src/schemas/roles.ts`,
with its own prompt, `prompts/plan_review.md`, routed to `claude-opus-5` at `max`.
`src/init/plan-review.ts` runs a slice's one read, relaunched once where its artifact is unusable,
and grades the verdict by its findings' severities. `src/init/plan-revision.ts` decides whether a
slice is read and runs the one revision a blocker or major buys. `src/init/plan-slices.ts` records
what a read leaves, by severity, in the slice's cache and in PLAN's outputs, and
`src/init/present-review.ts` shows it at PRESENT. Deleted, with their suites: `src/init/plan-sample.ts`,
`src/init/plan-signal.ts`, `src/init/plan-notes.ts`, `src/init/present-advice.ts`,
`src/init/launch-batch.ts` and `scripts/null-review.ts`, and with them
`tests/init/plan-critic-sampling.test.ts`, `plan-signal.test.ts`, `plan-notes.test.ts` and
`review-evidence.test.ts`. The PRESENT cases of those suites that still hold, PRDR-196's among them,
moved to `tests/init/present.test.ts`.

The acceptance criteria, as built:
1. **The role.** `plan_review` is in `ROLE_IDS`, read-only (S-1′) and not stop-gated, and each
   review session launches on it, reading `prompts/plan_review.md`, on `claude-opus-5` at `max` by
   default. Its session is otherwise a planner's: Read, Grep, Glob and its artifact's write, and no
   reach into `archive/`. A planner session launched for REVIEW_PLAN is refused. The F-3 event is
   PRDR-300's `schema_version` 2: `plan_review` joins `ROLES_ADDED` in `src/kernel/migrate.ts`,
   which routes it in an existing config, and the same entry re-pins `role@hash` assignments. No
   version of its own. `tests/init/plan-review-role.test.ts` pins the role, its routing, its prompt,
   its tools and the migration.
2. **One read, after the checks.** A slice's draft is read once, when A-1⁷'s checks pass on it or
   on the one redraft they send; a draft that still fails is not read (vetoable call 1). The read
   judges sizing, shape, dependency and coherence, and `REVIEW_TAGS` closes its tag set to those
   four. Coverage, traceability and contracts are code's, and the prompt says so.
3. **Findings.** `reviewFindingSchema` requires a severity, one of the four tags, a ticket and a
   fix, and the read is handed `sizing_evidence` where a previous plan measured it. The verdict is
   `approve` when nothing is blocker or major. A test drafts a clean slice and asserts the approval
   and its two sessions; another asserts that minors alone approve, whatever word the model wrote.
4. **One revision.** A blocker or major buys one revision, handed the draft the review read and
   the blockers and majors alone. The checks run on the revision, a failing one is redrafted once,
   and nothing reads it again. Minors are recorded in PLAN's `review_findings` and reach the run
   sessions through `readPlanFindings` (PRDR-271), gravest first; a test reads them there.
5. **Deleted**, with their tests: the three-read sampling (`plan-sample.ts`), the review after the
   revision (PRDR-269), the churn and null lines (`plan-signal.ts`, `plan-notes.ts`), the
   held-finding labels, the advice file (`present-advice.ts`), and the `revisionRounds` seam, from
   `pipeline.ts` and `plan.ts`. A test asserts each module is gone, and that a presentation carries
   no label, no advice file and no revision or churn line.
6. **Three sessions.** A test counts a slice with a major at three sessions, its draft, its read
   and its revision, and a clean slice at two. SLICE announces `2N + R + C`, and
   `tests/init/slice-seed.test.ts` pins the sentence. `tests/init/slicing-scale.test.ts` counts 51
   sessions for 25 slices, where the draws took 101.

The non-goals hold. No finding count judges the reviewer. `launch-batch.ts` is deleted, because
VALIDATE's reviewers launch one after another and never used it (vetoable call 12).

### Vetoable calls

1. **The read waits for the checks.** A draft that still fails a check after its redraft is not
   read: code has proved it wrong, the failures hold approval whatever a reader says of it, and the
   draft that answers them is not this one. PRESENT names the slice as not reviewed, with why.
   PRDR-293 left this call here.
2. **Code grades the verdict.** `approve` where nothing is blocker or major and `changes`
   otherwise, whatever word the model wrote, since the findings are the more exact of the two
   statements; a word that disagrees with the grades is noted. C-4⁗'s synonyms are read first.
3. **Where each severity goes.** A minor goes to the sessions that run its ticket, and PRESENT
   counts it. A blocker or major goes to the revision and to PRESENT as a risk, and not to a run
   session, since the revision answered it or tried to.
4. **Every blocker and major is a risk.** C-4⁶ presents "what survives the revision". No read of
   the revision says what survived, so each one sent to a revision is shown, with its fix, blockers
   first, and the operator reads the tickets it names.
5. **What the revision is handed.** The draft the review read, as `draft`, and the blockers and
   majors, as `review_findings`, each with its fix. Not the minors, which are the run sessions'.
6. **A revision that still fails is discarded.** The draft the review read passed the checks, so a
   revision that fails them after its redraft has made the slice worse by what code proves. The
   draft stands and the revision's spec defects are kept. The failures the revision's redraft was
   sent are not recorded as sent, so the checks across the plan can still send the standing draft
   one.
7. **Every finding names a ticket.** HEAD's schema let a finding be plan-wide, but a revision must
   answer it and a run session read it, and both need the ticket whose change answers it. A
   finding about two tickets names that one, and the other in its words.
8. **What the read is handed.** The slice's records on a pack, as its draft was handed them, and
   its documents without one, so that `coherence` is judged against what the draft was planned
   from; the index of earlier slices; the session budget; and `sizing_evidence`. No spec defect:
   whether one is real is the operator's at PRESENT, and PRDR-292 offered it to this ticket. Nothing
   code proved.
9. **The six drafter rules stay the drafter's.** PRDR-292 left to this ticket which of
   `prompts/plan.md`'s six rules the review takes on: none. The four tags cover none of them, and
   the planning audit measured what a wider review cost. Testability, `non_goals` and traceability
   moved from the reviewer's section to "What is yours to judge", beside the six.
10. **The migration seats the review on the config's planner.** S-1‴ says the migration writes
    each new role's default routing. The review ran on the planner's routing until now, so where
    an existing config routes its planner, `plan_review` takes the same model and effort, and the
    default only where it routes none. A config that already routes `plan_review` keeps what it
    says.
11. **The tag set loses `boundaries`.** PRDR-101 added it for the review, and the review has four
    tags now; where a ticket stops is the drafter's to judge. `PLAN_FINDING_TAGS` keeps the tags
    code's repairs and checks give.
12. **`launch-batch.ts` is deleted.** Its one caller was the draws. VALIDATE's reviewers launch one
    after another, so the non-goal's condition does not hold. The backend's support for S-6′'s told
    path and C-4⁗⁵'s signal has no caller now, and PRDR-298's "From PRDR-294" section lists it.
13. **PRESENT lists code's repairs and counts the minors.** A repair is a decision code made on the
    operator's behalf: an id renamed, an edge dropped, a cycle broken, a DONE ticket kept. Each is
    listed. A minor is no decision at approval, so it is counted.
14. **The cache records what the read left.** `review` holds every finding the read wrote, or null
    where none was read, and `unreviewed` says why. Both are required, so a cache that says nothing
    is never read as reviewed. A slice cached before this build misses on its key, which folds in
    the changed prompts.
15. **The verdict file stays per slice**, at `state/slices/<id>/plan-review.json` (PRDR-260), and
    the read's inputs keep `stage: "REVIEW_PLAN"`.

## Falsification (verification protocol, item 1)

`tests/init/plan-review-role.test.ts` was copied into a `git archive` of HEAD `430e074` in the
scratchpad and run there, against HEAD's source, so the working tree was not touched. All 18 of
its first cases failed, each on what it tests:

```
 × is a role of its own, routed to the planner's seat   → expected [ 'planner', 'diagnose', …(9) ] to include 'plan_review'
 × reads its own prompt, and a planner session is no longer handed the review's
                                                        → expected [Function] to throw an error
 × is read-only, with no stop gate and no tool that writes code
                                                        → expected false to be true
 × each review session runs on the role, its prompt, its model and its effort
                                                        → expected [] to deeply equal [ 's01', 's02' ]
 × a finding carries its severity, one of the four tags, its ticket and its fix
                                                        → expected false to be true
 × the prompt grades by severity and names the four tags alone
                                                        → `blocker`: expected 'You are Detent's plan reviewer. …' to contain '`blocker`'
 × the read is told the shape it writes                 → Cannot read properties of undefined (reading 'spec')
 × a clean draft is read once, approved, and never revised: two sessions
                                                        → expected [ Array(4) ] to deeply equal [ 'PLAN:s01', 'REVIEW:slice:s01' ]
 × minors alone are an approval, whatever word the model wrote
                                                        → expected [ Array(7) ] to deeply equal [ 'PLAN:s01', 'REVIEW:slice:s01' ]
 × a major buys one revision, handed the draft it read and the major alone: three sessions
                                                        → expected [ Array(7) ] to deeply equal [ Array(3) ]
 × a blocker is a revision too, and a slice's majors and blockers are the operator's risks
                                                        → expected [ Array(7) ] to have a length of 3 but got 7
 × the checks run on the revision, and a revision they send back is redrafted, never reviewed
                                                        → expected [ Array(7) ] to deeply equal [ Array(4) ]
 × a revision that still fails the checks after its redraft is discarded
                                                        → expected [ Array(7) ] to deeply equal [ Array(4) ]
 × a draft the checks still fail after its redraft is not read
                                                        → expected [ 'PLAN:s01', 'PLAN:s01', …(3) ] to deeply equal [ 'PLAN:s01', 'PLAN:s01' ]
 × SLICE announces 2N + R + C                           → expected 'PLAN will now run to the end of the p…' to match /at least 6 planning sessions, 2N \+ …/u
 × the sampling, the churn and null lines, the held labels and the advice file are deleted
                                                        → plan-sample.ts: expected true to be false
 × a config that routes its planner gives the review the same seat
                                                        → expected undefined to be 'claude-fable-5-1'
 × a config that routes no planner gives it the planner's default seat
                                                        → expected undefined to be 'claude-opus-5'
 Tests  18 failed (18)
```

The battery showed that nothing pinned what the read is handed (below), and two cases were added.
Run the same way at HEAD, both fail:

```
 × on a pack, the slice's records as its draft was handed them, no documents …
                                                        → s01: expected undefined to deeply equal { requirements: [ { …(5) } ], …(5) }
 × without a pack, the documents its draft was planned from
                                                        → expected [ Array(6) ] to have a length of 2 but got 6
 Tests  2 failed | 19 skipped (21)
```

At HEAD the review runs as the planner, three reads a slice and three more after the revision, on
an ungraded finding, and on a pack it is handed the planning documents rather than the records its
draft was planned from.

## Mutation battery (verification protocol, item 2)

The battery ran 45 mutants, one defect each, against `tests/init/plan-review-role.test.ts` and
every suite under `tests/init`, with `tests/kernel/plan-findings.test.ts` and
`tests/kernel/migrate.test.ts` where a mutant reaches them. Each file was restored from a snapshot,
never by `git checkout`, and checked byte for byte after every mutant; at the end all 15 files
matched the snapshot directory. The mutants covered:
- **The read and the revision:** a draft the checks still fail, read anyway; a revision that still
  fails, standing; the revision handed the minors too, or not handed its draft; the revision not
  checked; the verdict word trusted over the grades; a discarded revision's sends recorded; the
  revision's repairs lost; its spec defects dropped.
- **The review:** a major buying nothing; the verdict read as the word written; no relaunch of an
  unusable artifact; the read handed documents on a pack, or every document rather than its
  slice's; no sizing evidence; one verdict file for every slice; no instruction.
- **What a read leaves:** minors made risks; blockers and majors sent to the run sessions; an
  unread slice not named; a cache that says reviewed where none was, or forgets why a slice went
  unread; a reused slice losing its review.
- **PRESENT:** risks in drafting order; repairs counted and not listed; repairs counted as minors;
  a risk without its fix; a minor or ungraded row shown as a risk; no unreviewed slice named; the
  risks never reaching PRESENT; PLAN outputting none.
- **The rest:** run sessions shown the gravest finding last; a finding line without its fix; the
  review off the planner's model or effort; a planner session still able to run the review; the
  review stop-gated; the review given default tools and the archive; the migration ignoring the
  config's planner, or not routing the review; the announcement counting the sampled reads; the
  revision handed no finding; only a redraft handed its draft; a redraft that still fails
  reporting nothing left; the review launched as the planner.

First pass: 40 killed, 5 survived. Each survivor was a behaviour no test pinned, and each has a
test now, in `plan-review-role.test.ts` or `present.test.ts`:
- **V07**, a revision discarded after its redraft: the slice's cache records none of the failures
  the redraft was sent, so the checks across the plan can still send the standing draft one;
- **V08**, a revision whose edge to a ticket no slice plans is dropped: the repair reaches the
  ticket's sessions and PRESENT, as a draft's does;
- **R08**, the read's instruction, which names the four tags, the three grades, the fix and the
  verdict rule;
- **S05**, a slice reused from its cache, whose risk and minor reach PLAN's outputs again;
- **I01**, a `review_risks` row graded minor, graded outside the three, or missing a field, which
  PRESENT does not read as a risk.

Second pass, the five survivors against their new tests: 5 killed. Every file matched its
snapshot after each pass.

## Gates

`lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check` and `test` all
pass: 2115 tests passed and 2 skipped, across 177 files. `npm run plugin` builds.

The suite is smaller than PRDR-293's 2142 across 180 by what the deleted modules took with them:
four suites (the sampling, the churn and null lines, the held labels, the review evidence) and the
cases elsewhere that pinned the draws, the revision rounds and the advice file.
`tests/init/plan-review-role.test.ts` adds 23 cases, and `tests/init/present.test.ts` holds 10.
The first gate run failed twice, on this ticket's own text: three doc-blocks in `src/sessions/`
cited PRDR-298, which is OPEN, and now point forward by C-4⁸; and a rewrap of the init skill split
the phrase "who, when, and the hash", which `tests/docs/golden-path.test.ts` pins, across two
lines. The largest file this ticket touches is `src/schemas/init.ts`, at 289 code lines.

## Found along the way

- **At HEAD a revision was drafted without the draft it answered.** `plan-slices.ts` launched it as
  `draftAndRead(deps, { slice, planIndex: index, findings: outstanding })`, and `plan-inputs.ts`
  handed `draft` only to a redraft the checks sent. So the drafter was told to answer the findings
  "in this draft" and was not shown the tickets they were about: every revision was a fresh draft.
  That fits the audit's count, 121 findings resolved and 119 introduced, but this ticket did not
  measure whether it caused it. A revision is now handed the draft the review read, and told to
  keep the rest of it as it is.
- **The PRDR-196 cases ran PRESENT on a fixed root, `/tmp/x`.** `tests/init/plan-signal.test.ts`
  called `presentStage` with `root: "/tmp/x"`, so every run of the suite wrote
  `.detent/plan/presentation.json` into a shared system directory, where one from this morning's
  runs still is. The cases moved to `tests/init/present.test.ts`, on temporary roots removed after
  each test. The directory was left as found.
- **`src/schemas/init.ts` stacked four doc-blocks on one declaration.** PRDR-084's, which
  describes the review's artifact, sat above `PLAN_FINDING_TAGS` with PRDR-101's, PRDR-103's and
  C-2‴'s, each in its own comment, and not above the artifact's schema. The three on the tags are
  one doc-block now, and PRDR-084's is on `planReviewSchema`.
- **The scale test's payload table moved.** A slice's review is handed its records and not the
  planning documents, and its prompt is its own: the review's widest input measured 126.27 KB at
  500 tickets, where PRDR-293 measured 127.10. The table holds the new figure.

## Recorded, not fixed

- **Two lists of read-only roles.** `READ_ONLY_ROLES` in `src/schemas/roles.ts` sets the tools, and
  `READ_ONLY_STAGES` in `src/sessions/guard.ts` exempts a session from the stop gate. They hold the
  same seven roles, written out twice, and nothing ties them: a role added to the first alone gets
  read-only tools and is still stop-gated. `plan_review` is in both, and a test pins each.
- **The backend's batch support has no caller.** `SessionSpec.onFirstResponse` and `artifactTold`,
  the SDK's partial-message stream and the containment hook's told-path redirect serve only the
  deleted draws. Their doc-blocks say so, and PRDR-298 deletes them.
- **The announcement is an estimate.** `2N + R + C` counts a read for every slice, and a slice
  whose draft still fails its checks after its redraft is not read, so it over-counts by one for
  each; a relaunch of an unusable artifact is one session it does not count. Its floor, `2N`,
  holds: each slice is a draft and either a read or a redraft.
- **Whether one read is enough is not measured here.** The review's worth is decided by run-time
  outcomes (PRDR-297), not by how many findings it writes.
