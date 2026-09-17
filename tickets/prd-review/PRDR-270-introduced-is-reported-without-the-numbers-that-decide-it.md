---
id: PRDR-270
title: "`introduced` is reported without the two numbers that decide whether it was forced: `revisionOutcome` defines `introduced = |after| - survived` with `survived <= |before|`, so a filtered set that GREW forces `introduced >= |after| - |before|` however good the revision was — and `nullNote`'s doc-block names that misreading, cites `src/init/present.ts:277-284` as what prevents it, and 277-284 is a comment above code that prints six ordered pairs' worth of raw churn counts beside a single before/after figure"
state: DONE
severity: major
category: defect
labels: ["prd-review", "found-by-live-run", "doc-claim-drift", "D-30", "D-29", "PRDR-196", "PRDR-200", "PRDR-269"]
surface: ["src/init/plan-notes.ts", "src/init/present.ts", "tests/init/plan-notes.test.ts", "tests/init/present.test.ts", "tests/init/review-evidence.test.ts"]
prd_refs: ["C-4⁗″", "PRDR-196", "PRDR-200", "PRDR-269", "D-29", "D-30"]
acceptance_criteria: ["The structural floor is named. `remainLine` reports `|before|` and `|after|` and, when `introduced > resolved`, the forced minimum `introduced - resolved` — the introductions no revision could have avoided at those set sizes. Both terms are already inside `RevisionOutcome`: `|before| = resolved + survived`, `|after| = survived + introduced`, so the floor is `introduced - resolved` and no new data is plumbed. Against HEAD the line prints `resolved` and `introduced` alone, so a measured `9 introduced` against a forced 6 is indistinguishable from nine the revision caused.", "The human-facing line stops printing six pairs' worth of counts beside a one-pair figure. `src/init/present.ts` renders the churn as a RATE on the revision figure's own scale, as `nullNote` already does for the slice note, instead of `${churn.resolved} resolved, ${churn.survived} survived, ${churn.introduced} introduced`. At `PLAN_REVIEW_SAMPLES = 3` those counts are summed over k*(k-1) = 6 ordered pairs while the revision figure is one before/after pair — the exact mismatch `nullNote`'s doc-block calls a misreading.", "One sentence says one thing. `src/init/present.ts:290` currently reads `The difference between the two lines is what the revision did; the second line is not error to subtract` — an instruction to subtract and a warning against subtracting, joined by a semicolon. The replacement states a single claim.", "`nullNote`'s doc-block stops citing a comment as a safeguard. It says the misreading is one ``src/init/present.ts:277-284`` exists to prevent; 277-284 is a doc comment and the code at 287-291 commits the misreading directly beneath it. Either the citation names code that does the work, or the claim goes.", "The null clause names the population it measured. `nullNote` computes `resolved/(resolved+survived)` over RAW unfiltered read pairs and is printed beside a figure computed over FILTERED sets. Filtering removes the unstable findings that generate churn, so a raw-pair null is not the baseline a filtered figure is read against. Measured on PRDR-269's s07: the note printed `null % 60%` from raw pairs beside `revision % 75%` from filtered sets, where the filtered null for that same slice is 25% — the clause understated the revision by 35 points. Naming the population is the fix; computing a filtered null in production is a non-goal.", "Falsifying test: `remainLine` given `{ resolved: 3, survived: 1, introduced: 9 }` — PRDR-269's own recorded s07 figure — must produce a line naming `|before| = 4`, `|after| = 10`, and a forced minimum of 6. Against HEAD it fails, and it fails because HEAD names none of the three, not by construction."]
non_goals: ["Does NOT change `revisionOutcome`, `sampleChurn`, `findingKey` or the ⌈k/2⌉ threshold. Every number involved is correctly computed; what is defective is what is said about it. PRDR-269 already settled that the arithmetic is right.", "Does NOT compute a filtered-set null in production. That needs two independent panels — six reads where production pays for three — and the $8.60 replay that produced D-30's null ran against a copied root precisely because production cannot afford it in-loop. The fix is to label the null that exists, not to buy a second one.", "Does NOT change what is STORED on the slice artifact. `revision` keeps its three fields so the six slices already measured stay readable; the change is to what is said about them, not to the record.", "Does NOT re-open PRDR-269. Its `Expected effect` section carries the measurement and the null as of `dfe9297`; this ticket fixes the instrument that section had to work around.", "Does NOT touch `churnLine`, which already names both its pair count and its population and is the one line in this area that reads correctly."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-196", "PRDR-200", "PRDR-269"]
depends_on: []
---

# PRDR-270 — `introduced` is printed without the numbers that decide whether it was forced

## Where this came from

PRDR-269's fourth arm on s07 recorded `3 resolved, 1 survived, 9 introduced` and the ticket read the
9 as the fix underperforming. It was not. `revisionOutcome` defines

    resolved   = |before| - survived
    introduced = |after|  - survived

and `survived <= |before|`, so

    introduced >= |after| - |before|      which is      introduced - resolved

With `|handed| = 4` and `|leftover| = 10` that floor is **6**. A revision that answered everything
perfectly and drew ten reproduced findings on its output would still have printed `9 introduced`.
Only `9 - 6 = 3` was ever attributable, and the same-text null measured 3.80.

The two numbers that make the 9 readable — `|before|` and `|after|` — are already inside the
`RevisionOutcome` the line is handed. It prints neither.

## What the code does

`remainLine` (`src/init/plan-notes.ts:57-68`) prints `resolved` and `introduced` and a null clause:

    s07 review after revision: 10 finding(s) remain (3 resolved, 9 introduced; null 60% resolution
    over 6 unrevised read pairs) — dependency, sizing, ...

Its own doc-block states the identity this ticket turns on —

    `revisionOutcome` defines `resolved = |before| - survived` and `introduced =
    |after| - survived`, so `|after| = |before| - resolved + introduced`.

— and then closes with *"Both numbers that tell the two cases apart were already computed; they were
on other lines."* An earlier ticket saw this exact shape of problem and fixed it by moving `resolved`
and `introduced` onto the line. It did not carry `|before|` or `|after|` across, so the floor the
identity implies is still not derivable by the reader.

## The doc-claim drift

`nullNote`'s doc-block (`src/init/plan-notes.ts:14-22`) says:

    The raw churn counts are six pairs' worth and are not on the same scale as
    the revision beside them; printing them as though they were is the
    misreading `src/init/present.ts:277-284` exists to prevent.

`src/init/present.ts:277-284` is a doc comment. The code immediately beneath it, at 287-291, prints:

      ...and with NOTHING revised, the same count over repeated reads of the same draft:
      18 resolved, 12 survived, 18 introduced. The difference between the two lines is what
      the revision did; the second line is not error to subtract (C-4⁗″).

Those are raw counts over six ordered pairs, set beside a revision figure over one pair. The
safeguard named in the doc-block is a comment, and the code under it commits the misreading the
comment describes. `nullNote` fixed the scale problem for the SLICE note by rendering a rate; the
human-facing line in `present.ts` never got the same treatment, and the doc-block claims otherwise.

The final sentence also contradicts itself inside one semicolon: *the difference between the two
lines is what the revision did* instructs a subtraction, and *the second line is not error to
subtract* forbids it.

## The second population mismatch

`nullNote` computes `resolved/(resolved+survived)` over RAW read pairs. The revision figure printed
beside it is computed over FILTERED sets — the ⌈k/2⌉ survivors. Filtering removes exactly the
unstable findings that generate churn, so the two are not the same baseline.

Measured on s07 (D-30, `scripts/null-review.ts`, six reads of byte-identical revised text split ten
ways):

                          printed          correct
    revision resolution     75%   (filtered)    75%
    null resolution         60%   (RAW pairs)   25%   (filtered panels)

The printed pair reads as +15 points. The real separation is +50, and outside the null's entire
range across all ten splits (max 50%). The clause did not merely mislead — it understated the
revision it was there to qualify.

## Why this is worth a ticket rather than a note

The numbers are right; every consumer of `revisionOutcome` is a note, a display line, or the stored
artifact field, and nothing branches on them. That makes this a reporting defect and not a
correctness one. It is filed anyway because the reporting is the product: PRDR-269 was amended to
the wrong conclusion off these lines, by a reader with the artifacts in hand and the source open.
A number whose floor is invisible and whose null is drawn from the wrong population is not a
measurement, and this pipeline exists to produce measurements a human can act on.

## What this moves that PRDR-260 pinned

`tests/init/review-evidence.test.ts` asserts the remain line's literal shape for PRDR-260, which put
`resolved` and `introduced` on it and made the null a rate. Both of those survive unchanged; the two
sizes are added before the parenthesis, so the assertions move from

    s01 review after revision: 2 finding(s) remain (2 resolved, 2 introduced;

to

    s01 review after revision: 2 finding(s) remain — 2 handed, 2 left (2 resolved, 2 introduced;

PRDR-260's requirement is that the line distinguishes a round that did everything from one that did
nothing. That requirement is not weakened here, it is the one this ticket found insufficient: two
sets of equal size can still decompose to `2 resolved, 2 introduced`, and until the sizes are printed
a reader cannot tell that from the case where the second set is larger and the introductions were
forced. The fixture's sets ARE equal, so no forced clause is printed and the test asserts its absence.

## Evidence

- `D-30` and `D-29` in `~/.detent-run-logs/ksar-run-issues.md`.
- `dfe9297` — PRDR-269's `Expected effect` section, amended to carry the null.
- `scripts/null-review.ts --root <copy> --slices s07 --together --runs 3`, 3 sessions, $8.60.
