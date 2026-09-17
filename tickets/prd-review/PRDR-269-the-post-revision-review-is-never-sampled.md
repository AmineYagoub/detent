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

**Corrected by the fourth arm: those ratios use the wrong yield.** The column above is the
PRE-revision churn yield, taken on the unrevised draft, because a single post-revision read cannot
produce a yield. Arm 4 takes three and shows the two diverge — 5.0 per read before the revision,
10.0 after it, on a draft of the same ticket count. Against the pre-revision yield arm 4's ratio is
2.0 and the pattern breaks; against the post-revision yield it is 10 held over 10.0 per read, a
ratio of 1.00. The claim this paragraph makes is right and its arithmetic was reading the yield of
a document the count does not come from.

## Expected effect — predicted, then measured, and the prediction was wrong

**Predicted, before the fix shipped.** The 2-of-3 filter kept 3 of 11, 4 of 14 and 6 of 14 of the
first review's findings in these three arms — it discards 57–73%. Applying it to the 7–8
post-revision findings should leave roughly 2–3 per slice that reproduce, against ~13 held per
slice today and a ~310 projection at PRESENT.

**Measured.** Fourth arm on s07 against this ticket's own binary (`f0c2c6a`), `PLAN_REVISIONS = 1`
— the same round count as the arm-1 baseline — same slice key `ad87931c4d2d`, s01-s06 reused for
$0. Log `exp269-20260917-175117.log`. **The residue rose to 10 and HELD rose from 15 to 21.**

                            1 round      2 resample      2 ITERATE    1 + SAMPLED
    tickets                      17              16             20             17
    revision resolved             3               4              6              3
    revision survived             0               0              0              1
    revision introduced           7               7              8              9
    revision %                 100%            100%           100%            75%
    null %                      67%             68%            48%            60%
    HELD total                   15              17             16             21
      after-revision              7               7              8              1
      introduced                  -               -              -              9
      seen-once                   8              10              8             11

**The prediction applied the filter to the wrong base.** The per-read yields are in the evidence
files and they settle it:

                              read 1   read 2   read 3   UNION   at or above 2 of 3
    pre-revision                   5        6        4      10                    4
    post-revision (revised)        8       13        9      15                   10
    arm 1 post-revision            7  — one unfiltered read: no union, no filter

The filter does exactly what this ticket claims for it: it cuts the three-read union by 60% before
the revision and by 33% after it. The count rose against arm 1 because arm 1's 7 was ONE draw and
not a union, and 7 sits inside the arm-4 per-read range of 8, 13, 9. Sampling a review both ADDS
reads and filters them, and against a single-read baseline the adding dominates. The 2–3 figure came
from applying a 2-of-3 threshold to one read's 7 findings — a quantity the mechanism never produces.

**No acceptance criterion asserted a volume.** The four that the artifact can witness — the
post-revision review is sampled, `after-revision` means survived, a non-handed leftover is
`introduced`, and `revision` keeps its meaning — all hold in it: the review ran as three reads into
`slices/s07/revised/draws/1..3/`, and of the 10 findings put in front of the human `revisionOutcome`
labels 1 `after-revision` and 9 `introduced`. The other two are not artifact-observable — PRESENT's
ordering is applied at render time and the stored `remaining` carries `labelHeld` order, and the
sixth is a test — so both rest on the suite, where they pass.

**What the fix bought is the labelling, not a shorter list.** Under the old label all 10 findings
would have read "survived a paid revision" and PRDR-267 would have sorted all 10 to the top of
PRESENT — nine false claims put in the strongest slot. This section should not have promised a
volume on top of that.

**Two things the fourth arm saw that no earlier arm could.** `survived` is non-zero for the first
time across four arms, so revision % falls from 100% to 75%: the three-arm finding that the revision
"resolves 100% of what it is handed, every time" rested on a post-revision read too noisy for its
findings to match a handed `(ticket, tag)` pair, and one matched once the read was filtered. That is
1 of 4 handed findings — not a trend. And the revised draft draws twice the complaints per read as
the pre-revision draft at the same ticket count, 10.0 against 5.0, which no earlier arm could see
because none took more than one post-revision read. Neither is actionable at n=1; both want the same
A/B on a second slice. Both are recorded in the run tracker rather than filed.

## Cost

Two extra reads per slice at the post-revision step. Reads in this run cost $3.04–$4.19, so about
$6–8 per slice. For comparison, the second revision round measured above cost $15.59 and moved the
held count by +1.

**Measured: +$10.52 per slice.** The arm-4 s07 cost $35.81 against the arm-1 baseline's $25.29 for
the same slice at the same round count. The estimate was low — it priced two extra reads and not the
larger revised draft those reads are taken against.

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
