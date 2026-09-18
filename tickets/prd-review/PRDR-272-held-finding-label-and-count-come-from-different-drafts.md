---
id: PRDR-272
title: "`heldFindings` takes a finding's LABEL from the union of both review panels' sub-threshold reads and its COUNT from a merge of both panels' maps where the post-revision panel wins, so a finding read once before the revision and twice after is labelled `seen-once` while carrying `seen: 2` — a count describing one draft attached to a label describing another, which is the population mix PRDR-270 settled one layer up"
state: DONE
severity: major
category: defect
labels: ["prd-review", "found-by-live-run", "D-32", "PRDR-269", "PRDR-270", "PRDR-271"]
surface: ["src/init/plan-signal.ts", "src/schemas/init.ts", "src/kernel/plan-findings.ts", "tests/kernel/plan-findings.test.ts", "tests/init/plan-signal.test.ts"]
prd_refs: ["C-4⁗″", "D-24′", "D-25", "D-32", "PRDR-209", "PRDR-269", "PRDR-270", "PRDR-271"]
acceptance_criteria: ["A held finding's count and its label describe the SAME population. `heldFindings` builds `seenOnce` as `samples.flatMap(s => s.seenOnce)` — the union of both panels — and the count map as `new Map(samples.flatMap(s => s.seen))`, a merge in which a later sample overwrites an earlier one on a shared key. Nothing ties the two, so a finding drawn from the PRE-revision panel's sub-threshold list can take its integer from the POST-revision panel. After this ticket the integer a finding carries is the count from the panel its label came from.", "Both panels' counts are carried, and which is which is recorded. This is PRDR-270's own finding applied one layer down: the two panels read DIFFERENT drafts — the pre-revision draft and the revision — so their counts are not interchangeable and merging them silently is the error. `seen_before` and `seen_after` are separate optional fields; a finding one panel never saw simply lacks that field rather than recording a zero, because absent-from-the-panel and seen-by-no-read-of-the-panel are different facts and only the first ever occurs.", "The existing corpus still ranks. `seen` was added by PRDR-271 yesterday and the only artifacts carrying it are run 6's, whose PLAN.json feeds the run phase this whole feature exists to serve. `readPlanFindings` must therefore rank a finding that has only the legacy `seen`, and a backfilled finding carrying `seen_before`/`seen_after`, by the same rule. `seen` is retained, and REDEFINED as the count from the panel the label describes — which is what it was always documented to mean and never was.", "`findingLine` says which draft a count describes. The dossier is read at an escalation, where the question is what PLAN already knew; `(seen in 2 of the plan's reads)` does not say whether those reads were of the draft that was replaced or of the one on disk. A finding with both counts renders both, named.", "Falsifying test: a finding in the pre-revision panel's `seenOnce` with `before.seen` of 1, which the post-revision panel also counted at 2. Against HEAD `heldFindings` returns it labelled `seen-once` with `seen: 2` — above the ⌈k/2⌉ threshold of 2, so by its own number it did not fall below the filter its label says it fell below. This is `t-s08-005 dependency`, observed live under `e309de3`."]
non_goals: ["Does NOT change `PLAN_REVIEW_SAMPLES`, the ⌈k/2⌉ threshold, `sampleReviewPlan`'s partition, `revisionOutcome`, or `sampleChurn`. The sampling and the arithmetic are correct and were settled by PRDR-200 and PRDR-270; this ticket is about how one function combines two of their outputs.", "Does NOT drop or re-filter any finding. Every finding that reaches PRESENT today still reaches it, with the same label, except those whose label and count disagreed — which get a coherent count, not removal.", "Does NOT rewrite run 6's artifacts. The persisted per-read draws make the counts recomputable and that backfill is real work, but it is data repair against a corpus this ticket has not yet changed; it is tracked separately so this fix can be falsified and shipped on its own.", "Does NOT add a `panel` discriminator to `HeldFinding`. `seen` carrying the label's own panel is what the reader needs to rank coherently, and `seen_before`/`seen_after` carry the rest; a third field naming the origin would be derivable from those two and the label."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-269", "PRDR-270", "PRDR-271"]
depends_on: []
---

# PRDR-272 — a held finding's label and its count come from different drafts

## Where this came from

D-32, the first real production data for PRDR-271. Slice s08 of run 6 under `e309de3`: 14 of 14
findings carry a count, so the channel works. The label/count grid holds one impossible row.

| held | seen | n |
|---|---|---|
| after-revision | 2 | 1 |
| introduced | 2 | 3 |
| introduced | 3 | 1 |
| seen-once | 1 | 8 |
| **seen-once** | **2** | **1** |

`t-s08-005 dependency` is labelled `seen-once` while carrying `seen: 2`, and 2 IS the ⌈k/2⌉
threshold for k=3 — so by its own number it did not fall below the filter its label says it fell
below. Recomputing from the persisted draws: 1 of 3 reads before the revision, 2 of 3 after.

## What the code does

```ts
const seenOnce = samples.flatMap((s) => [...(s?.seenOnce ?? [])]);
return labelHeld(handed, leftover, seenOnce, new Map(samples.flatMap((s) => [...(s?.seen ?? [])])));
```

The label comes from the first expression — the union of both panels' sub-threshold reads. The count
comes from the second — a `Map` built from concatenated entries, where a later pair overwrites an
earlier one on a shared key, so the post-revision panel always wins. The two expressions are
independent. A finding that fell below the threshold pre-revision and reached it post-revision takes
its label from the pre panel and its integer from the post one.

The doc-block does not hide this; it states the merge outright. So this is not doc-claim drift — the
defect is that the described behaviour is itself incoherent.

## Why it matters

The two panels read different drafts. The pre-revision panel read the draft the revision replaced;
the post-revision panel read what is on disk. A count from one attached to a label from the other is
a population mix, and PRDR-270 settled exactly that question one layer up when it refused to print a
filtered null against a raw production figure. The same mistake, one layer down, inside the fix for
it.

The consequence is not cosmetic. `readPlanFindings` sorts by `seen` descending, so this finding
outranks genuine seen-once findings. That ordering is arguably right — it WAS reproduced twice
somewhere — but its label asserts the opposite, and a reader has no way to learn which population
the number describes.

## Scale

1 of 14 in s08. The condition needs a finding that crosses the threshold between drafts, which is
uncommon but not rare; expect roughly one per slice.

## The fix

`seen` is retained and redefined to mean the count from the panel the label describes — which is
what its doc-block already claimed and what it never was. `seen_before` and `seen_after` carry both
panels, so nothing is lost and the reader can see the crossing that caused the confusion. Retaining
`seen` is what keeps run 6's corpus rankable: the artifacts on disk carry only that field, and the
run this feature exists to serve is the one currently on slice 13 of 24.

## Evidence

- D-32 in `~/.detent-run-logs/ksar-run-issues.md`.
- `e309de3` — PRDR-271, which introduced `seen` and this combination.
- `.detent/state/plan/s08.json` in run 6's root, and the six per-read draws it persists.
