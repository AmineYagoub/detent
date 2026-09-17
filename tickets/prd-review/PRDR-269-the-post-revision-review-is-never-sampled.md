---
id: PRDR-269
title: "The review that produces held findings is the only unsampled one: `sampleReviewPlan` filters the findings a revision is PAID to chase, `reviewPlan` hands the findings a HUMAN is asked to act on straight through unfiltered — and `after-revision`'s doc-block calls that population 'survived a revision that was paid to remove it' when `revisionOutcome` reports survived = 0 on every slice measured"
state: DONE
severity: major
category: defect
labels: ["prd-review", "found-by-live-run", "doc-claim-drift", "D-25", "D-24", "PRDR-200", "PRDR-209", "PRDR-267", "PRDR-268"]
surface: ["src/init/plan-slices.ts", "src/init/plan-signal.ts", "src/schemas/init.ts", "src/init/present-advice.ts", "tests/init/plan-signal.test.ts", "tests/init/plan-quality.test.ts", "tests/init/present.test.ts"]
prd_refs: ["D-24", "D-24′", "C-4⁗″", "PRDR-084", "PRDR-196", "PRDR-200", "PRDR-209", "PRDR-267", "PRDR-268"]
acceptance_criteria: ["The post-revision review is SAMPLED. The in-loop call becomes `sampleReviewPlan`, so `leftover` holds only findings at or above the ⌈k/2⌉ threshold, and what fell below it travels to the human as `seen-once` instead of being discarded unrecorded. HEAD calls the single-draw `reviewPlan` there, so every finding of one unreplicated read becomes a held finding.", "`after-revision` MEANS survived. A held finding carries `held: \"after-revision\"` only when its `(ticket, tag)` key was among the findings the revision was handed AND is still in the sampled leftover — precisely `revisionOutcome`'s `survived` bucket, computed by the same `findingKey`. The doc-block at `src/schemas/init.ts` already claims this; this criterion makes the claim true rather than rewriting it to match an accident.", "A leftover finding whose key was NOT handed to the revision is labelled `introduced`. It is reproduced across reads of the revised draft, which is real signal, but it is not something a revision failed to fix and must not be presented as though it were.", "PRESENT orders the populations by the strength of the evidence behind them: `after-revision` (reproduced AND survived a paid attempt) before `introduced` (reproduced) before `seen-once` (one read of three) before unmarked. PRDR-267 installed this ordering on a label whose meaning was false, so the strongest slot currently holds the weakest evidence.", "The `revision` figure keeps its meaning: `revisionOutcome(review.findings, leftover)` still compares the ORIGINAL review's findings against the final leftover. Only `leftover`'s provenance changes — from one read to the reproduced subset of three — so the six slices already measured stay readable against the new ones with the sampling difference noted.", "Falsifying test: a leftover containing one finding the revision was handed and two it was not must produce exactly one `after-revision` and two `introduced`. Against HEAD this fails — HEAD labels all three `after-revision` — and it fails for the reason the ticket names rather than by construction."]
non_goals: ["Does NOT change `PLAN_REVISIONS`. It stays at 1. Whether a round fed REPRODUCED findings beats one round is a measurement this ticket makes possible and does not prejudge; the PRDR-268 loop already makes it a one-constant experiment.", "Does NOT remove `\"after-revision\"` from `HeldKind`. Cached slice artifacts written before this change carry that value and must keep parsing; `kindOf` already degrades an unrecognised value to unmarked, and the same tolerance is what lets a new value ship.", "Does NOT change the 2-of-3 threshold, `PLAN_REVIEW_SAMPLES`, or `sampleReviewPlan` itself. The filter is correct; the defect is that only one of the two reviews goes through it.", "Does NOT change `revisionOutcome` or `sampleChurn`. Their arithmetic is what this ticket borrows to make the labels honest, and both are already right.", "Does NOT re-run the s07 A/B. That follows this change and is recorded separately."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-196", "PRDR-200", "PRDR-209", "PRDR-267", "PRDR-268"]
depends_on: []
---

# PRDR-269 — the post-revision review is never sampled, and `after-revision` misdescribes what it holds

## Where this came from

A three-arm live A/B on run 6's s07 (same slice key `ad87931c4d2d`, s01–s06 reused from C-8 for
$0), asking whether a second revision round helps. It does not — but the numbers said why, and the
why is not about rounds.

                            1 round      2 resample      2 ITERATE
    revision resolved             3               4              6
    revision survived             0               0              0
    revision introduced           7               7              8
    revision %                 100%            100%           100%
    null %                      67%             68%            48%
      after-revision              7               7              8
      seen-once                   8              10              8

**`survived` is 0 in all three arms.** The revision resolves 100% of what it is handed, every
time. The residue is entirely `introduced` — findings that did not exist when the revision was
paid. Adding rounds cannot drain a backlog that is empty.

## What the code does

`plan-slices.ts` takes two reviews per slice and filters exactly one of them.

    379:  const review = await sampleReviewPlan(deps, normalised.tickets, { ... })   // k=3, keeps what ⌈k/2⌉ saw
    407:  const after  = await reviewPlan(deps, normalised.tickets, { ... })          // ONE read, no filter

`sampleReviewPlan` splits its draws into `findings` (at or above the threshold) and `seenOnce`
(below it), and C-4⁗″ exists because an unreproduced finding is mostly noise. `reviewPlan` is one
draw with no reproduction test at all. Everything it returns becomes `leftover`, and every element
of `leftover` is held:

    448:  const held = [...normalised.findings, ...leftover.map((f) => ({ ...f, held: "after-revision" })), ...(review?.seenOnce ?? []).map(...)];

So the reproducibility filter is applied to the findings a revision is paid to chase, and not to
the findings a human is asked to act on. The population that reaches the human is the unfiltered
one.

## The doc-claim drift

`src/schemas/init.ts`:

    * `after-revision` survived a revision that was paid to remove it — the stronger signal.

This is false, and `revisionOutcome` in the same codebase computes the exact concept the sentence
names. `survived` is the count of keys present both before and after; it is 0 on every slice
measured. The held findings are the `introduced` bucket. The same claim is repeated in the
`plan-slices.ts` block above the held construction ("survived a paid revision, or seen in one read
and never again").

The defining shape: a load-bearing doc-block states a mechanism in the present indicative, the
code implements the half that is easy to assert, and the tests cover the built half and pass.

## What it costs downstream

**PRDR-267 (`db4b35e`, this branch) sorts `after-revision` first.** It was built to put the
strongest signal in front of the human first, and the label it sorts on identifies the weakest —
one unreplicated read. The ordering is inverted, and it is inverted because the doc-block it was
built against was not true.

**The `held` volume is a reviewer yield, not a defect count.** The churn block measures what a
single read of a slice returns on UNCHANGED text:

                          survived/pair   introduced/pair   findings per read   post-revision held
    1 round                        1.67              3.33                5.0                   7
    2 resample                     2.00              4.33               6.33                   7
    2 ITERATE                      4.00              3.67               7.67                   8

Each arm's post-revision count lands at or just above the per-read yield (ratios 1.4, 1.1, 1.04).
The residue is what a reviewer finds when it reads anything, and today all of it is held.

## Expected effect

The 2-of-3 filter kept 3 of 11, 4 of 14 and 6 of 14 of the first review's findings in these three
arms — it discards 57–73%. Applying it to the 7–8 post-revision findings should leave roughly 2–3
per slice that reproduce, against ~13 held per slice today and a ~310 projection at PRESENT.

## Cost

Two extra reads per slice at the post-revision step. Reads in this run cost $3.04–$4.19, so about
$6–8 per slice. For comparison, the second revision round measured above cost $15.59 and moved the
held count by +1.

This reverses PRDR-268's non-goal "Does NOT re-sample the review inside the loop", which was
written before the three-arm result existed. That non-goal was a scope boundary on a mechanism
change, and it was correct then: nothing at the time said the in-loop read's output was mostly
unreproduced. The measurement now says it.

## Falsification against HEAD (`4ec2b91`)

Three tests added to `tests/init/plan-quality.test.ts` before any fix. One slice, one ticket; the
three sampled draws all report `sizing/t-100` so it recurs and is handed to the revision; the
post-revision read returns that same finding plus `dependency/t-100` and `coverage/t-100`, which
the revision was never handed. Verbatim:

    × PRDR-269 … > a finding the revision was handed and did not remove is `after-revision`
      → only what was handed to the revision and came back:
        expected [ 'coverage', 'dependency', 'sizing' ] to deeply equal [ 'sizing' ]

    × PRDR-269 … > a finding that did not exist when the revision was paid is `introduced`, not `after-revision`
      → reproduced on the revised draft, but no revision failed to fix them:
        expected [] to deeply equal [ 'coverage', 'dependency' ]

    × PRDR-269 … > the post-revision review is drawn PLAN_REVIEW_SAMPLES times, like the one before the revision
      → both reviews sampled, not one of two:
        expected […] to have a length of 6 but got 4

The first failure is the claim: HEAD labels all three findings `after-revision`, including the two
no revision was ever paid to remove. The second is the missing distinction. The third is the cause
— four review sessions, not six: three sampled before the revision, one unreplicated read after it.

## Tests this ticket deliberately changes

`PRDR-268`'s two count assertions pin `PLAN_REVIEW_SAMPLES + 1` review sessions per slice, which is
the asymmetry itself. They become `PLAN_REVIEW_SAMPLES * 2`. The assertions are correct about HEAD
and were written before the three-arm measurement; the count they pin is what this ticket changes,
and nothing else about PRDR-268's behaviour moves.

## What the fix turned out to need that the ticket did not foresee

**PRDR-260's path keying does not survive a second sampled review.** Its draws are written to
`state/slices/<slice>/draws/<n>/plan-review.json` and the un-drawn re-review one directory up.
Sampling the second review sends it into the SAME `draws/1..k`, so the review of the revised draft
overwrote the reads that BOUGHT the revision — PRDR-260's own defect, one level down. The fix adds
`revised` as a third key to `planReviewPath`, so the revised draft's draws live in their own
subtree, and the un-drawn slice path is no longer written because nothing reviews a slice un-drawn.
Caught by `review-evidence.test.ts`, which failed on content rather than on a count: draw 1 of s01
held s01's post-revision verdict instead of its first read.

## Mutation battery

Baseline: 1 failing test (`tickets-check` `state/stale-open`, this ticket's own id cited while it
was still OPEN). Seven mutants, all caught; two needed tests that did not exist.

    M1  labelHeld always answers "after-revision" (HEAD's behaviour)        5 caught
    M2  an unmatchable finding (no ticket) counts as a survivor             1 caught
    M3  the revised review's draws share the first review's subtree         1 caught
    M4  the post-revision review's sub-threshold reads are dropped          SURVIVED -> test added
    M5  the `introduced` section renders ABOVE the survivors                SURVIVED -> test added
    M6  `kindOf` no longer recognises `introduced`                          1 caught
    M7  labelHeld is handed its two reads the wrong way round               1 caught

**M4** is the first acceptance criterion — what falls below the threshold on the revised draft must
travel to the human rather than be discarded — and nothing pinned it. Closed by a case whose three
post-revision draws are `[HANDED, NEW_A]`, `[HANDED]`, `[HANDED]`: `NEW_A` is seen once, so it must
appear as `seen-once` while `HANDED` stays `after-revision`.

**M5** is the fourth — the populations render in the order of the evidence behind them. PRDR-267
pinned `after-revision` above `seen-once`, and inserting a third population between them left its
position unpinned, so the section order could inverted silently. Closed by a case rendering one
finding of each kind and asserting the three headings in order.

Both gaps were in the tests, not the implementation. A mutant that survives a full suite is the
only thing that finds an acceptance criterion nobody pinned.
