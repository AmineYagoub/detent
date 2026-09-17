---
id: PRDR-267
title: "D-24′ separates the two held populations by LABEL and never by ORDER, so the 43 findings a paid revision could not remove are scattered through 70 ticket sections among 52 that one read of three produced and no other reproduced"
state: DONE
severity: major
category: defect
labels: ["prd-review", "found-by-live-run", "D-24", "D-24′", "C-4⁗″", "PRDR-209", "PRDR-119", "PRDR-200", "operator-signal"]
surface: ["src/init/present-advice.ts", "tests/init/present.test.ts"]
prd_refs: ["D-24", "C-4⁗″", "C-7", "PRDR-209", "PRDR-119", "PRDR-196", "PRDR-200"]
acceptance_criteria: ["`renderAdviceMarkdown` leads with the findings a revision was paid to remove and failed. The document is split into two top-level sections — held-after-revision first, seen-once second — each still grouped by ticket exactly as today, with every finding present and its kind still named. Structure, not suppression: nothing is dropped, the high-confidence population is simply not interleaved with the low-confidence one.", "The screen's top-ticket ranking counts after-revision findings FIRST, before distinct tags and before total count. On the live n=7 corpus the current ranking gives a top-10 slot to `t-s04-004`, whose two findings are BOTH seen-once — a ticket with no revision-surviving finding at all outranks tickets that have them.", "The two populations are named with their evidential weight where the human meets them, not only defined once in a preamble. `seen once` is one read of three that the other two did not reproduce, against a measured null where 50-85% of findings fail to recur over byte-identical tickets with nothing revised between the reads (mean 61%, n=7) — a majority-noise prior. `held after revision` survived a session paid to remove it.", "A test pins the ordering against the shape that produced the defect: a corpus where a seen-once-only ticket draws more findings and more distinct tags than an after-revision ticket must still rank the after-revision ticket higher, and `advice.md` must place every after-revision finding above every seen-once one."]
non_goals: ["Does NOT feed seen-once findings to the revision round. PRDR-200 established that a review is a SAMPLE and that the revision was being paid an index-carrying session to chase findings that were not reliably there; the 2-of-3 filter is that finding's fix and stays exactly as written. This ticket changes what the HUMAN sees, never what the revision is handed.", "Does NOT drop, suppress, or truncate seen-once findings. The null says a majority are noise, not that all are; ~39% recur and some of those are real. Every finding still reaches `advice.md` in full.", "Does NOT change `ADVICE_INLINE_MAX`, `ADVICE_TOP_TICKETS`, or the ≤12 inline path. At twelve findings the interleaving is not what makes a list unreadable, and PRDR-209 named both numbers deliberately beside PRDR-119's noise rules rather than as knobs.", "Does NOT weight a seen-once finding by its slice's measured null, though the data says it should be possible — a one-read finding is more anomalous in a 50%-null slice than in an 85%-null one. `churn` is on the slice artifact and does not reach PRESENT; plumbing it is its own ticket.", "Does NOT change `PLAN_REVISIONS`, which is a separate live experiment against this same corpus.", "Does NOT add a CEILINGS key or touch any budget."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-209", "PRDR-119", "PRDR-196", "PRDR-200"]
depends_on: []
---

# PRDR-267 — the two populations are labelled, and never ordered by

## Where this came from

Run 6, a full `detent init` against `/Users/workstation/ksar-cloud` from `393b2df`, stopped
after seven slices on 2026-09-17. Seven slices produced **95 held findings over 70 distinct
tickets**: 43 marked `after-revision`, **52 marked `seen-once` (55%)**.

## What D-24′ set out to do, in its own words

`present-advice.ts` opens by naming the exact distinction this ticket is about:

> gate-313's PRESENT rendered 144 of those calls as one flat list, twice; buried in it were the
> twenty-six tickets some read called too big for a session — the most actionable thing the
> review found — and **which findings had survived a paid revision against which were seen once
> and never again**. A list that long is not read, so the judgement was not made.

So the populations were identified, and the failure mode — burial — was named precisely.

## What the code does

It renders the distinction as a **label** and a **count**, and never as an **order**.

- `renderAdviceMarkdown` groups by `byTicket()` and, inside each group, emits findings in
  arbitrary order with `— seen once` or `— held after revision` appended to each.
- `byTicket()` sorts by distinct tags, then count, then id. **Both populations count equally.**
- The >12 screen view reports `seen in one read and never again: N · held after a paid revision: M`
  as totals, then lists the top ten tickets by that same population-blind ranking.

Nothing anywhere sorts, sections, or ranks by `held`. The label is decoration on a list whose
order ignores it.

## Why the label alone does not discharge D-24′

Burial is a property of ORDER, not of vocabulary. At 95 findings over 70 tickets, `advice.md` is
70 sections deep and the reader meets the two populations interleaved inside each one. Marking
each entry tells a reader what a finding is once they have already reached it; it does not get
them to the 43 first.

The null is what makes this weight asymmetric rather than merely different. Measured over
byte-identical tickets with nothing revised between the reads, **50-85% of findings appear in one
read and never again (mean 61%, n=7)**. `seen-once` is therefore the population with a
majority-noise prior — and it OUTNUMBERS the high-confidence population 52 to 43.

## Falsification against HEAD

Against the live corpus, HEAD's ranking puts a ticket with **no revision-surviving finding at
all** in the top ten:

    current top-10 (distinct tags, then count) — a-rev/once per ticket:
       t-s03-008      4 findings  a-rev=1 once=3
       t-s03-013      3 findings  a-rev=2 once=1
       t-s06-001      3 findings  a-rev=2 once=1
       t-s07-004      3 findings  a-rev=1 once=2
       t-s07-014      3 findings  a-rev=2 once=1
       t-s02-013      2 findings  a-rev=1 once=1
       t-s04-004      2 findings  a-rev=0 once=2      <-- zero after-revision
       t-s04-007      2 findings  a-rev=1 once=1
       t-s04-016      2 findings  a-rev=1 once=1
       t-s04-017      2 findings  a-rev=1 once=1

    top-10 today surfaces 12 of 43 after-revision findings
    top-10 ranked by after-revision first would surface 17 of 43

`t-s03-008` leads the whole list on three one-read findings and one real one. `t-s04-004` occupies
a slot on two findings that no second read reproduced. The screen a human is meant to act on
spends its ten lines on the noisier population.

## The rule, and why it cuts here

Order by evidential weight where the human meets it. The reader should exhaust the findings a
paid session tried and failed to remove BEFORE meeting the ones a single read produced — in the
document, and in the ten lines that stand in for the document.

That is a rendering change and nothing else. What the revision is handed does not move: PRDR-200
measured that a review is a sample and that chasing one-read findings wasted an index-carrying
session, and the 2-of-3 filter is that finding's fix. This ticket touches the human's end only.

## Falsification against HEAD

Four new cases in `tests/init/present.test.ts`, run against `393b2df` before any change. The four
pre-existing D-24′ cases pass throughout — this adds a rule, it does not correct one.

    ✓ D-24′ … above the inline size: grouped by ticket, the ticket drawing the most tags first …
    ✓ D-24′ … at or below the inline size: every finding, with its kind
    ✓ D-24′ … presentStage writes the full list to `.detent/state/advice.md` above the size …
    ✓ D-24′ … presentStage writes no file when the list fits inline
    × PRDR-267 … ranks a ticket whose findings survived a revision above one that merely drew more one-read noise
      → two findings a revision could not remove outrank three no second read reproduced: expected 470 to be less than 419
    × PRDR-267 … a ticket with no revision-surviving finding never displaces one that has them
      → expected 444 to be less than 405
    × PRDR-267 … advice.md places every after-revision finding above every seen-once one, and drops none
      → the paid-revision survivors come first: expected 578 to be less than 308
    × PRDR-267 … names what each population is worth where the reader meets it
      → expected '# Review findings held after revision…' to match /## Held after revision \(2\)/

    Tests  4 failed | 4 passed (8)

The falsifying corpus is the live shape reduced: `t-noise-001` draws three findings across three
distinct tags, all `seen-once`; `t-real-001` draws two across two tags, both `after-revision`.
Noise wins on BOTH of HEAD's sort keys, which is exactly how `t-s04-004` reached run 6's top ten
with no revision-surviving finding at all.

## What changed

**`byTicket()`** gains `survived()` as its FIRST sort key — the count of `after-revision` findings
— ahead of distinct tags, count and id. The later keys are untouched, so ties break as before.

**`renderAdviceMarkdown()`** renders `SECTIONS` in order: held-after-revision, seen-once, then
unmarked if any exist. Ticket groups move from `##` to `###` beneath them. Each section states
what its population is worth at the point the reader meets it, including the measured null for
`seen-once`. The per-entry kind suffix is dropped as redundant once the section carries it.

Nothing is suppressed, and the revision is handed exactly what it was handed before: PRDR-200
measured that chasing one-read findings wasted an index-carrying session, and the 2-of-3 filter
is untouched. This is the human's end only.

## Mutation battery

| # | mutation | result |
|---|---|---|
| M1 | `survived(fb) - survived(fa)` → `survived(fa) - survived(fb)` | caught — 2 failed |
| M2 | drop the `survived(...)` term entirely (restores HEAD's order) | caught — 2 failed |
| M3 | `survived()` counts `seen-once` instead of `after-revision` | caught — 1 failed |
| M4 | `SECTIONS` ordered seen-once before after-revision | caught — 1 failed |
| M5 | `if (fs.length > 0)` → `if (fs.length >= 0)` (render empty sections) | **SURVIVED**, then caught |

**M5 survived the first battery and the gap was in the tests, not the implementation** — every
case used a corpus where all three populations were either non-empty or unasserted, so an empty
`## Unmarked (0)` section rendered with nothing to object. Closed by a case that pins the
boundary from both sides: `lopsided()` marks every finding and must produce no `## Unmarked`, and
a seen-once-only corpus must produce no `## Held after revision (0)`. M5 then fails with
`expected … not to contain '## Unmarked'`. Nine cases, five of five mutants caught.

Restoration between mutants was from a `cp` snapshot, never `git checkout` — the working tree is
the only copy of an uncommitted fix.
