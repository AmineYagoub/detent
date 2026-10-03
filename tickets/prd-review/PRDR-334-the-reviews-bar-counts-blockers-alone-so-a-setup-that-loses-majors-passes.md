---
id: PRDR-334
title: "N-8's reviews bar counts blockers alone, so a setup that loses a tenth of the majors passes it, and PRDR-322 made one the default. Scored against the 132 majors the original reviews of the set's 10 areas hold, today's `max` re-run reported 126 at their place as a blocker or a major, Opus 5.5 at `high` 124, `high` with the foundations given 113 and `medium` 106. Every run but `medium` found all 18 blockers, so `high` with the foundations given passed, and `review_foundations` now hands them by default, though its reviewers reported 11 fewer of the majors than reviewers reading them at the same level. The set will hold its majors, the bar will ask for 90% of them, the four runs will be re-scored, and `review_foundations` will default to `read` again"
state: OPEN
severity: major
category: defect
labels: ["prd-review", "cost-strategy", "N-8", "D-35", "S-6‴", "S-5⁷", "evaluation", "quality"]
surface: ["src/eval/sets.ts", "src/eval/reviews-set.ts", "src/eval/score.ts", "src/eval/run.ts", "scripts/eval-build.ts", "src/kernel/worstcase.ts", "src/init/pipeline.ts", "tests/eval/score.test.ts", "tests/eval/reviews-set.test.ts", "tests/eval/run.test.ts", "tests/init/validate-round-prefix.test.ts", "tests/init/effort-by-task.test.ts", "detent-prd-v3.md", "README.md", "docs/evaluation.md", "docs/plan-cost-strategy.md"]
prd_refs: ["N-8", "D-35", "S-6‴", "S-5⁷", "C-2¹⁴"]
acceptance_criteria: ["The reviews set holds each area's majors. A set the builder makes carries them. An older set gains them in place from the copy it was read from: each area's majors come from the kept review its key proves, and the set is refused where an area's review is missing or its blockers or findings differ from the set's. The set's tree and its `built` stamp stay as they were, so results run on it still score against it.", "The reviews score counts each of the set's majors reported at its place, the same file and an overlapping quote, as a blocker or a major, and lists each one missed. A setup passes only when it also reports at least 90% of the set's majors so. A reviews set without majors is refused by the runner before any session starts, and by the scorer, each naming the command that adds them.", "The four reviews runs of 2026-10-02 and 2026-10-03 are re-scored from their results and recorded in this ticket, the PRD and the plan. Today's `max` re-run and Opus 5.5 at `high` pass. `medium` and `high` with the foundations given fail. No new evaluation runs.", "`review_foundations` defaults to `read` again. Its doc-block, S-6‴, the README and the plan say why: with the foundations given, the set's reviewers reported 113 of the 132 majors, where reviewers reading them at the same level reported 124.", "`spec_review/review` stays at `high`: its run passes the bar with the majors, 124 of 132, and S-5⁷ records it.", "The ticket records the recommended config: every setting this measuring bears on, its value, and the measurement behind it, or that none exists.", "Falsifying test, against HEAD: a reviews run that reports every blocker and only 113 of a set's 132 majors passes, and a config that names no `review_foundations` hands the reviewers the foundations."]
non_goals: ["Does NOT change the claims bar, which is the user's to decide (PRDR-327, AC 6).", "Does NOT run any new evaluation. The four runs are re-scored from their results.", "Does NOT remove `review_foundations: given`. It stays available, and its run stays recorded.", "Does NOT tell or move existing configs about `spec_review/review`. The plan's question 2 stays the user's."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-322", "PRDR-326", "PRDR-327"]
depends_on: ["PRDR-322", "PRDR-327"]
---

# PRDR-334 — the reviews bar counts blockers alone, so a setup that loses majors passes

## Where this came from

On 2026-10-03, once PRDR-327 and PRDR-322 were closed, the user asked which config the measurements
point to. Before answering, the four reviews runs were scored against the majors as well as the
blockers. The set holds only the blockers, so the majors came from the kept reviews the set was
built from, each proven by the key the set names, and were matched the way the scorer matches a
blocker. The user then asked for this ticket, with every recommendation in it.

## Problem

- **The bar counts 18 findings of 200.** The original reviews of the set's 10 areas hold 200
  findings: 18 blockers, 132 majors and 50 minors. The bar asks for each blocker at its place, as a
  blocker or a major, and nothing more (N-8). A round goes on while it holds a blocker or a major
  (C-2¹⁴), and the writer fixes both, so a major the reviewers miss is a defect the pack keeps.
- **The four runs, against the majors:**

| Run | Blockers | Majors at their place, as a blocker or a major | Median cost of a review |
|---|---|---|---|
| today's `max`, re-run | 18 of 18 | 126 of 132 | $10.54 |
| Opus 5.5 at `high` | 18 of 18 | 124 of 132 | $2.92 |
| `high`, the foundations given | 18 of 18 | 113 of 132 | $1.76 |
| Opus 5.5 at `medium` | 14 of 18 | 106 of 132 | $2.04 |

- **A setup that lost majors became the default.** PRDR-322's run passed on its blockers, so
  `review_foundations` now defaults to `given`. Its reviewers reported 11 fewer of the majors than
  the `high` arm, which read the foundations, and 13 fewer than `max`. That saves about $1.16 a
  review, about $30 on a tabachir first round.
- **`high` holds.** It reported 2 fewer majors than `max` on its re-run, and `max` itself missed 6 of
  its own original 132 on that re-run. So the move PRDR-327 made stands.

## Design

- **The set holds its majors.** Each area of the reviews set carries the majors of the kept review
  its key proves, beside its blockers. The builder writes them.
- **An older set gains them in place.** `npx tsx scripts/eval-build.ts --majors <reviews set>`
  reads the kept reviews of the copy the set was read from (`built.from`). It takes each area's
  review by the key the set holds, checks that the review's blockers and its count of findings are
  the set's, and writes the majors. It changes nothing else, so the tree, the `built` stamp and every
  result run on the set still hold. An area whose review is gone, or differs, refuses the whole
  set.
- **The bar asks for 90% of the majors.** A setup passes the reviews set only when it reports each
  blocker, and at least 90% of the majors, at their place as a blocker or a major. The score lists
  each major missed. A set without majors cannot be scored on this bar, so the runner refuses it
  before any session starts and the scorer refuses it, both naming `--majors`.
- **The four runs, re-scored.** The tabachir set gains its majors, and each run's results are scored
  again, spending nothing. The results go in this ticket, N-8′ and the plan.
- **`review_foundations` defaults to `read` again.** `given` stays available, with its run
  recorded. Its doc-block, S-6‴, the README and the plan say why. `docs/evaluation.md` drops "as
  `init` does by default".
- **The PRD:** N-8′ holds the majors' part of the bar and the re-scored runs. N-8, S-6‴ and S-5⁷
  carry amendment notes, and so do S-6′ and C-2¹⁴, whose notes now say the foundations are handed
  only where the config asks.

### Vetoable calls

1. **90%, not today's re-run's own 95%.** `max`, re-run, reported 126 of 132, and `high` reported
   124. A run's variance is a few majors either way, and 90% refuses the two setups that lost 19 and
   26. A floor drawn from a re-run would move with every re-run.
2. **Majors only, not minors.** A minor does not keep a round going (C-2¹⁴). A round that reaches
   the ceiling with majors open shows them at PRESENT as risks.
3. **Majors matched as blockers are.** The same file and an overlapping quote. It is lenient, and a
   run that reports more findings has more chances to meet a place, so a floor below 100% is
   needed for any setup to pass.
4. **The set extended in place, not rebuilt.** A rebuilt set has a new `built` stamp, and the
   scorer refuses every result run on the old one. The key proves each review, so the majors are
   the ones the set's reviewers would have been held to from the start.
5. **`read` again, not a re-measured `given`.** Another run of `given` might report a few more
   majors, but the measurement in hand fails the bar, and quality comes before the $30.

## The recommended config

What the measurements of PRDR-327, PRDR-322 and this ticket point to. Quality first (cost
decision 1), then cost.

| Setting | Value | Why |
|---|---|---|
| `effort_routing["spec_review/review"]` | `high` | Measured: 18 of 18 blockers and 124 of 132 majors, against `max`'s 18 and 126 on its re-run, at $2.92 and 7.8 min a review against $10.54 and 35.8 min. The default for a new config since PRDR-327; a config written earlier keeps `max` until the key is added. |
| `review_foundations` | `read` | Measured: given, the reviewers reported 113 of 132 majors, against 124 reading them. The default again, by this ticket. |
| `effort_routing["audit/verify_claims"]` (the role's `audit: max`) | `max` | Measured: nothing cheaper met the bar. `high` found 8 of the 14 wrong claims and Sonnet 5.5 at `max` 7, confirming 4 of the others. `max` itself found 11 on its re-run, so the bar is the user's to decide (PRDR-327, AC 6). |
| `spec_review/verify`, `spec_write`, `planner`, `plan_review` | `max` | Not measured: N-8's sets hold no verification, writer batch or plan. |
| the code-writing roles | Sonnet 5.5 at `xhigh` | Not measured. `run` raises them by risk and after a failed attempt (S-5⁸). |
| `budgets.init_sessions_at_once` | 4, or up to 8 where the account's usage limits allow | Changes nothing a session is given (X-1⁸). 8 halves AUDIT's and VALIDATE's wall clock, uses the usage window faster, and a limit costs no finished work (X-8″). |
| `risk` | globs of the project's security-critical paths | Not measured. A ticket whose surface meets one runs its implement, fix and review sessions at `max` (S-5⁸). |

## Falsification (to run against HEAD before any code)

- A reviews set with 18 blockers and 132 majors, and a run that reports every blocker as a blocker
  and only 113 of the majors at their place: the score passes it at HEAD.
- `loadConfig` of a config that names no `review_foundations`: `given` at HEAD.
