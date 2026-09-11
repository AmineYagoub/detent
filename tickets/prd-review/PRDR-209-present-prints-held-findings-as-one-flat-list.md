---
id: PRDR-209
title: "PRESENT prints every held review finding as one flat list — 144 lines on gate-313 — so the judgement D-24 hands the human is a wall nobody reads before approving"
state: DONE
severity: minor
category: usability
labels: ["prd-review", "present", "review", "D-24", "approval"]
surface: ["src/init/present-advice.ts", "src/init/present.ts", "src/init/plan-slices.ts", "src/init/plan.ts", "src/schemas/init.ts", "tests/init/present.test.ts", "tests/init/plan-critic-sampling.test.ts", "detent-prd-v3.md"]
prd_refs: ["D-24", "C-9", "C-4⁗″", "V-1‴", "V-6", "N-6", "PRDR-119", "PRDR-196", "PRDR-200"]
acceptance_criteria: ["Held findings render GROUPED BY TICKET, tickets ordered by how many distinct tags they drew and then by count, each line naming its tags and counts — so the twenty-six tickets three reads called `sizing` on gate-313 are the first thing seen, not the seventy-fourth. Observed FIRST as the flat list (V-6).", "Each finding says which kind it is: seen in one read and never reproduced (C-4⁗″'s `seenOnce`), or held AFTER a revision that was paid to remove it. The second is the stronger signal and is marked as such; D-24 is unchanged — all of it is advice.", "Above a stated size the terminal shows the grouped summary and the per-tag totals, and the full list goes to a file under `.detent/state/` whose path is printed; below it the list renders inline as today. The size is a named constant beside PRDR-119's noise rules, not a knob.", "The same findings are not printed twice for one approval: `--approve` re-presents the summary, not the wall."]
non_goals: ["Does not drop, rank away or auto-resolve a finding — D-24 says they are the human's, and they still are, all of them, in the file.", "Does not change what is HELD: C-4⁗″'s threshold and PRDR-196's revision measure stand."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-119", "PRDR-196", "PRDR-200"]
depends_on: []
---

# PRDR-209 — advice a human can act on

**Severity:** minor · **Category:** usability · **Found by:** trying to read gate-313's PRESENT

## Problem

D-24 is exactly right: the review advises, never blocks, and what it could not settle is a
judgement call for the human at approval (C-9). PRESENT then renders those calls like this, 144
times, twice — once at init and again at `--approve`:

```
Review findings held after revision (144) — judgement calls for you, not defects the machine kept grinding on (D-24):
  dependency (t-s02-011): t-s02-011's criterion 4 requires the escalation dossier that t-s02-016 builds: it asserts the halt routes …
  coherence (t-s06-004): t-s06-004's AC5 ('An architecture test greps the repository and fails if any construction of session options …
  … (142 more)
```

Seventy-four `dependency`, twenty-nine `sizing`, twenty-six `coherence`, eight `testability`, six
`coverage`, one `shape`. Buried in it: the twenty-six tickets at least one read called too big
for a session, including two in the walking skeleton — the single most actionable thing the
review found, and the one a person approving a $2,000 run would want to split first. Also buried:
which of the 144 survived a paid revision (a stronger signal) and which were seen once and never
again (C-4⁗″'s null says most of those are noise).

A list this long is not read. So the judgement D-24 reserved for the human is, in practice, not
made.

## The shape

Structure, not suppression. Group by ticket, order by how many tags a ticket drew, mark each
finding as seen-once or held-after-revision, print tag totals per slice, and above a stated size
put the full list in a file and print the path. Everything is still there; the first screen is
the part a person can act on.

## What implementation changed

**Kinds, where they are made.** `HeldFinding` is a review finding plus an optional
`held: "seen-once" | "after-revision"`. `plan-slices.ts` marks C-4⁗″'s `seenOnce` and the
re-review's leftovers as they join the held list; `plan.ts` marks the whole-plan review's
leftovers. The slice cache's `remaining` is a loose object, so the field rides through C-8
untouched and an older cache reads as unmarked.

**`present-advice.ts`.** `present.ts` was at its line ceiling, so the rendering lives beside
it: `ADVICE_INLINE_MAX = 12` and `ADVICE_TOP_TICKETS = 10`; `renderHeldFindings` — inline with
kinds at or below the size, otherwise totals by tag, totals by kind, the top tickets by distinct
tags then count, the plan-wide count, and the file; `renderAdviceMarkdown` — the same grouping
with every finding in full; `writeAdvice` — `.detent/state/advice.md`. `presentStage` writes
the file above the size and hands the path to the renderer, so `--approve` re-presents the
summary too.

**V-6, in order.** Observed on the tree as it was: `ADVICE_INLINE_MAX` undefined; the inline
list without kinds; no file and no path in PRESENT; the sampled-review fixture's six seen-once
findings reaching PRESENT unmarked. Then the change; then 65 of 65 across the present, sampling,
stages and slicing tests.

**Two files at their ceilings.** `present.ts` gave up the rendering to its own module;
`plan-slices.ts` took the kinds inline on one line rather than an import. Both are exactly at
300 counted lines now, which is the next ticket's problem to notice before it starts.
