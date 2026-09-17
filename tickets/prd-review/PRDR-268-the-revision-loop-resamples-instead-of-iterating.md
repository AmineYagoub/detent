---
id: PRDR-268
title: "`PLAN_REVISIONS` counts resamples, not revisions: every round is handed the same findings from the one review taken before the loop, the previous draft is deleted, and round N+1 cannot see what round N left — so PRDR-084's 'a second bite adds cost without adding information' is true by construction rather than by measurement"
state: DONE
severity: major
category: defect
labels: ["prd-review", "found-by-live-run", "doc-claim-drift", "D-24", "PRDR-084", "PRDR-200", "PRDR-251", "seam"]
surface: ["src/init/plan-slices.ts", "src/init/plan.ts", "src/init/pipeline.ts", "src/init/plan-review.ts", "tests/init/plan-quality.test.ts"]
prd_refs: ["D-24", "C-2‴", "C-4⁗″", "PRDR-084", "PRDR-196", "PRDR-200", "PRDR-251"]
acceptance_criteria: ["Each revision round is drafted against the findings the PREVIOUS round left, not against the findings of the one review taken before the loop. `reviewPlan` moves inside the loop so a round has a result to carry forward; the review that produces `leftover` is the last round's, which is the same review the code takes today at `PLAN_REVISIONS = 1`.", "At `PLAN_REVISIONS = 1` the behaviour is byte-identical to HEAD: exactly two drafts — the first with no `review_findings`, the second carrying the review's findings — and exactly one `reviewPlan` call. This ticket changes the MECHANISM and not the default; whether the default should move is a measurement the seam below makes possible and this ticket does not prejudge.", "A round whose review comes back clean stops the loop rather than paying for another draft. HEAD cannot early-exit because it has no review inside the loop to exit on; with the review moved in, paying an index-carrying session to redraft a plan the reviewer just passed is waste the loop can now see.", "The round count is reachable in a test. `PLAN_REVISIONS` is a module constant, so no test can exercise any value but the default, and a change whose whole content is what happens on round two is untestable while that holds. `revisions?` joins `sleep?`, `note?` and `progress?` as an optional seam on `PlanDeps` and `PipelineDeps`, defaulting to `PLAN_REVISIONS` — PRDR-251's precedent exactly: the S-5 refusal 'could not be tested while this was an inline literal'.", "A test drives two rounds and pins that the THIRD draft carries the findings the SECOND review produced, and that they are not the findings the first review produced. That assertion fails against HEAD with any round count, because HEAD passes `review.findings` on every iteration."]
non_goals: ["Does NOT change `PLAN_REVISIONS` from 1. The constant stays where PRDR-084 put it; this ticket makes a second round MEAN something, so that the question PRDR-084 answered by assertion can be answered by measurement.", "Does NOT change what the sample filter hands the revision. PRDR-200's 2-of-3 threshold is untouched: a round still starts from recurring findings, and `seen-once` still bypasses the revision and goes to the human (PRDR-267).", "Does NOT re-sample the review inside the loop. `sampleReviewPlan` draws three reads and is paid for once, before the loop; the in-loop review is the single-draw `reviewPlan` the code already calls after it. Round two costs one draft plus one review, not one draft plus three.", "Does NOT change `revisionOutcome`'s meaning. `revision` still compares the ORIGINAL review's findings against the final leftover — did the loop resolve what it started with — which is the only reading under which the figure stays comparable to the six slices already measured.", "Does NOT add a CEILINGS key. The round count is a mechanism constant with a test seam, not an X-1 budget."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-084", "PRDR-196", "PRDR-200", "PRDR-251", "PRDR-267"]
depends_on: []
---

# PRDR-268 — the revision loop resamples instead of iterating

## Where this came from

Setting up a live A/B on run 6's corpus to answer "does a second revision round help?" — a
question raised because PRDR-084 settles it by assertion. Reading the loop to wire the experiment
showed the experiment could not answer the question as posed.

## What the code does

    for (let round = 0; round < PLAN_REVISIONS; round += 1) {
      drafted = await draftAndRead(deps, { slice, planIndex: index, findings: review.findings, openQuestions: [...] });
      normalised = normaliseDraft(slice, tagSlice(drafted.tickets, slice.id), index, deps.note);
    }
    const second = await reviewPlan(deps, normalised.tickets, { kind: "slice", slice, planIndex: index });

Every iteration passes `review.findings` — the findings of the ONE review taken before the loop.
`drafted = await …` replaces the previous round's draft, which is discarded. The review that
decides `leftover` runs once, after every round has finished.

**There is no implicit channel either.** `DraftScope` carries six fields — `slice`, `planIndex`,
`findings`, `keepIds`, `openQuestions` — and none of them is a previous draft. And `draftPlan`
removes the prior artifact before every session, on purpose:

    /* A re-run derives fresh (C-8); a stale draft is an echo chamber, not an input. */
    rmSync(planDraftPath(deps.root), { force: true });

So round two cannot reach round one's work through the scope, through the session inputs, or
through the filesystem. It is a redraft from identical inputs, last one wins.

## Why this is doc-claim drift

`plan-review.ts` states the reason for the constant in the present indicative:

> PRDR-084: ONE revision round, deliberately — the D-24 argument applies here too. **A second
> bite adds cost without adding information**, and a plan the reviewer still faults after a
> revision is a judgment the human should see at approval, not one the machine should keep
> grinding on.

The sentence reads as a finding about diminishing returns — a second pass was considered and
judged not worth its cost. The code makes it a tautology: round two is handed exactly the
information round one was handed, so of course it adds none. The claim is true, and true for a
reason the block does not say and a reader would not guess. The name compounds it —
`PLAN_REVISIONS` says revisions; the loop counts resamples.

The rest of the block is sound and stays: a plan still faulted after revision IS the human's call
(D-24), and this ticket does not touch that.

## The rule, and why it cuts here

A round should be drafted against what the previous round LEFT. That requires a review inside the
loop, which is one line moved and one variable threaded — and it buys an early exit HEAD cannot
have, since a loop with no review in it has nothing to stop on.

At `PLAN_REVISIONS = 1` the sequence is draft, review — the same two sessions, in the same order,
as today. The default does not move. What moves is that a second round, if ever chosen, would be
a revision rather than a re-roll.

## Falsification against HEAD

The seam lands first and is behaviour-neutral: with `revisionRounds` threaded but the loop
unchanged, the suite is 1329 passed / 1 failed, and the one failure is `PRDR-192 … the repository
has no violations` — `state/stale-open`, because this ticket's id is cited in shipped code while
it is OPEN. Adding a seam changes nothing; the loop is what this ticket fixes.

Three cases were then written against that tree. Two fail, and the third — the parity case — passes
throughout, which is the point:

    × PRDR-268 … the third draft carries the SECOND review's findings, never the first's again
      → round two answers what round one LEFT: expected [ { tag: 'sizing', …(2) } ] to deeply equal [ { tag: 'dependency', …(2) } ]
    × PRDR-268 … a round whose review comes back clean stops the loop instead of paying for another draft
      → the second round is not bought: expected [ { stage: 'PLAN', …(8) }, …(2) ] to have a length of 2 but got 3
    ✓ PRDR-268 … at the default of one round the sequence is what it always was: two drafts, one review after the sample

    Tests  2 failed | 19 passed (21)

The first failure IS the defect, stated exactly: round two was handed `sizing` — the finding the
review before the loop produced — when the review it had just paid for said `dependency`.

## The live A/B this ticket came from

Run 6's s07 re-planned from its C-8 checkpoint, same slice key `ad87931c4d2d`, s01-s06 reused for
$0, against a `PLAN_REVISIONS = 2` binary. 13 sessions, $32.94.

                            1 round (baseline)    2 rounds
    revision resolved                        3           4
    revision survived                        0           0
    revision introduced                      7           7
    revision %                            100%        100%
    null %                                 67%         68%
    HELD after-revision                      7           7
    HELD seen-once                           8          10

**The second round changed nothing it could change.** `after-revision` is identical at 7, both
revisions resolved everything handed to them, both introduced 7. The only movement is in
`seen-once` (8 → 10), which the sampled review produces BEFORE the loop and which no number of
rounds can touch. $32.94 bought a re-roll.

That is PRDR-084's claim confirmed — and confirmed for the reason this ticket names rather than
the reason the doc-block implies. The measurement was worth taking precisely because it could not
have come out otherwise: with identical inputs, round two had nothing new to work from.

## What changed

`reviewPlan` moves INSIDE the loop. `outstanding` starts at the sampled review's findings and
becomes each round's `leftover`, so round N+1 drafts against what round N left. A round whose
review returns no findings breaks the loop rather than buying another draft.

`revisionOutcome(review.findings, leftover)` is untouched: `revision` still compares the ORIGINAL
findings against the final leftover, which keeps the figure comparable to the seven slices already
measured.

`revisionRounds?` joins `sleep?`, `note?` and `progress?` as an optional seam on `PlanDeps` and
`PipelineDeps`, defaulting to `PLAN_REVISIONS`. Named `revisionRounds` and not `revisions` because
`SlicePlan.revisions` is already an array of outcomes; two fields one letter apart meaning a count
and a list is a trap.

At `PLAN_REVISIONS = 1` the sequence is draft, review — the same two sessions in the same order as
HEAD. The three tests that pin "exactly ONE revision" pass unchanged.

## Mutation battery

| # | mutation | result |
|---|---|---|
| M1 | `findings: outstanding` → `findings: review.findings` (restores HEAD) | caught — 1 failed |
| M2 | drop `outstanding = leftover` | caught — 1 failed |
| M3 | drop `if (leftover.length === 0) break;` | caught — 1 failed |
| M4 | `leftover.length === 0` → `leftover.length > 0` | caught — 2 failed |
| M5 | `reviewed = after !== null` → `reviewed = true` | **SURVIVED**, then caught |

**M5 survived the FULL suite, not just this file** — 1332 passed with only the expected
`stale-open` failure. So nothing anywhere pinned that a review which never produced a usable
verdict leaves the slice unreviewed, and this ticket moved that assignment. Closed by a case that
feeds the in-loop review an artifact tagged `reach` twice, so the artifact AND its one relaunch
are unusable and `reviewPlan` yields null; the cached slice must then carry `reviewed: false`.
M5 now fails with `no verdict is not a passed review: expected true to be false`.

Twenty-two cases, five of five mutants caught. Restoration between mutants was from a `cp`
snapshot, never `git checkout`.
