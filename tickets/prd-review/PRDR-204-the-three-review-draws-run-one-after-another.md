---
id: PRDR-204
title: "C-4⁗″'s three review draws are independent by construction and run one after another: launched together they cost the same money in a third of the time — unless each pays to cache the one prompt they share"
state: DONE
severity: normal
category: design
labels: ["prd-review", "concurrency", "init", "review-sampling", "cost", "wall-clock"]
surface: ["src/init/plan-sample.ts", "src/init/plan-review.ts", "src/init/launch-batch.ts", "src/init/session.ts", "src/init/plan.ts", "src/init/pipeline.ts", "src/init/plan-slices.ts", "src/sessions/backend.ts", "src/sessions/sdk.ts", "src/sessions/mock.ts", "scripts/null-review.ts", "scripts/plan-corpus.ts", "tests/init/plan-critic-sampling.test.ts", "tests/init/plan-review-retry.test.ts", "detent-prd-v3.md"]
prd_refs: ["C-4⁗″", "D-28′", "S-6", "F-3", "V-6", "N-6", "PRDR-200", "PRDR-203"]
acceptance_criteria: ["The k draws of a slice's review are launched TOGETHER. With a backend that holds every session until the test releases it, three sessions are in flight after `sampleReviewPlan` is called; today there is one. Observed FIRST with one (V-6).", "Reads are collected in launch order whatever order the draws complete in — PRDR-203's fifth criterion, falsifiable now that the orders can differ: a backend that releases the third draw first still yields `reads[0]` from the first, so the `churn` C-8 caches and the finding order the reviser is handed are the same across runs.", "The second and third draws are not launched before the first session has produced its first model response, through a backend seam the mock honours too, and a test pins that ordering. That this is the moment the shared prompt's cache becomes readable is NOT assumed — the next criterion measures it.", "Measured live on ONE slice before the concurrent form is the default, on the null harness's own copy of a planned root, with the ledger's own columns: `cache_creation_input_tokens` per draw and wall-clock from first launch to last return, serial and concurrent, recorded in this ticket. The concurrent form ships only if the second and third draws' cache creation does not exceed the serial form's beyond the run's own noise, or the stagger closes the gap; otherwise the stagger is corrected and re-measured.", "No knob. Concurrency is not an X-1 key or a config field — an F-3 schema event, declined by C-4″ and again by C-4⁗″ for this loop. The measurement decides the shape that ships, and PLAN's existing announcement (PRDR-197) says the draws were launched together.", "The in-flight bound is STATED, not left to be discovered: the batch is k first attempts under one gate (D-28′); a C-4⁗ relaunch inside a draw is gated on its own and may overlap the other draws, so the most that can be in flight is `2k − 1`, each relaunch bounded at one session like any launch."]
non_goals: ["Does not sample the whole-plan review, nor make it concurrent. It is drawn once, and PRDR-200's scope note stands: three reads of a 484KB context is a ticket to reason in, not a loop to flip.", "Does not parallelise slice planning or the whole-plan redrafts. The cumulative `plan_index` is how cross-slice `depends_on` edges form, and each redraft sees the running plan; the evidence C-4⁗″ was built on says sequential reasoning degrades under every multi-agent topology.", "Does not touch `detent run`. Per-ticket worktrees and the merge exist (B-2′, B-2″); dispatching two tickets at once is a scheduler and a merge-order question with a conflict rate to measure, and its own PRDR.", "Does not change k, the threshold, or what the reviser is handed. C-4⁗″'s arithmetic is untouched; only WHEN the draws launch changes.", "Does not add a ceiling key or a config field."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-200", "PRDR-203", "PRDR-197"]
depends_on: ["PRDR-203"]
---

# PRDR-204 — three independent draws, one at a time

**Severity:** normal · **Category:** design · **Found by:** asking where in the pipeline
concurrency buys wall-clock without touching plan quality, and finding exactly one place

## Problem

C-4⁗″ draws a slice's review three times over byte-identical tickets. The draws are independent
by construction — that independence is the whole reason the threshold means anything — and
`sampleReviewPlan` runs them one after another:

```ts
const batch = newLaunchBatch();
for (let i = 0; i < k; i += 1) {
  const review = await reviewPlan(deps, tickets, scope, { index: i + 1, batch });   // plan-review.ts:116
```

Three draws in sequence cost three sessions' wall-clock. On `detent-smoke-1` the init journal
holds 45 sessions with start and end times: **median 5.1 min, p90 10.9, max 17.9, 301 minutes in
all**. Three median draws are a quarter of an hour per slice; launched together they take about
as long as the slowest one. And since k=3 the draws are three of every four to six sessions a
slice costs, so the saving is most of a slice's review time — on the order of two hours across a
fifteen-slice gate, at no change in money: the same three sessions run, they just overlap.

PRDR-203 made that launch possible and bounded. This ticket makes it.

## The catch: one prompt, three cache writes

The three draws are handed the same `promptPrefix` (S-6's stable prefix) AND the same
`promptVariable` — same tickets, same scope, same instruction, same skeleton — so the first
turn of each is byte-identical to the others. Run in sequence, the first draw writes that prompt
to the cache and the next two can read it. Run together, all three may be in flight before any
cache exists, and each writes its own.

The ledger says how much is at stake. Every smoke-1 session created between 20k and 260k cache
tokens and read between 0.35M and 1.9M; the shared first-turn prompt is some tens of thousands of
those. At Opus rates a 50k-token prompt is roughly $0.94 to write and $0.08 to read, so two extra
writes are about $1.70 a slice — some $25 on a fifteen-slice gate. Small beside the gate's
$420–480, and exactly the kind of number that turns "the same money" into "nearly the same
money" if nobody looks. It is not assumed in either direction here: whether a request that starts
after the first response begins reads the cache, and whether the SDK's stream shows that moment,
is what the live measurement is for.

## The shape

- `sampleReviewPlan` launches the draws with `Promise.all` over `reviewPlan(…, { index, batch })`,
  keeping results by index. `reviewPlan` never rejects — every failure inside it is already an
  unusable attempt (PRDR-084) — so one draw dying cannot take the others with it.
- A backend seam for "this session has produced its first model response": the SDK backend fires
  it on the first `assistant` message of the stream (`sdk.ts:325`); the mock fires it when its
  stage function runs. Draw 1 launches; draws 2..k launch when the seam fires, or after a bounded
  wait if it never does. The wait is the stagger, and the measurement says whether it is needed.
- Reads are ordered by launch, not completion. The `churn` C-8 caches (PRDR-200) and the finding
  order the reviser sees (PRDR-084) depend on it.
- The announcement PRDR-197 already requires gains three words: "launched together".
- C-4⁗″ gains one sentence in the PRD: the draws launch together, bounded as D-28′ says.

## How it is tested

V-6 order, deterministic first:

1. A backend that holds every session. `sampleReviewPlan` is called; after a tick, the number of
   sessions in flight is asserted. Observed at ONE before the loop changes; three after.
2. The same backend releases the third draw first. `reads[0]` is the first draw's findings.
3. The seam: draw 2's launch is not observed before draw 1's first-response callback fires.

Then live, once, on one slice of the null harness's copy of a planned root — the harness already
calls the production `reviewPlan` through the production launch seam (PRDR-202). Serial, then
concurrent; wall-clock and the two cache columns per draw; six sessions, roughly $6–12 at smoke-1
rates. The numbers go in this ticket before the loop is the default.

## What implementation changed

**The seam.** `SessionSpec.onFirstResponse` — the SDK backend fires it on the stream's first
`assistant` message, the mock when its stage function runs. `LaunchBatch` carries
`firstResponse` / `noteResponse`, and a batched launch hands the backend the batch's signal.

**The sampler is its own module.** `plan-review.ts` was at its 300-line ceiling, so
`sampleReviewPlan`, `SampledReview` and `FIRST_RESPONSE_WAIT_MS` moved to `plan-sample.ts`; that
file is one review, this one is what PLAN does with several. Draw 1 launches; draws 2..k launch
when it answers, or returns, or after 60 s (injectable, unref'd so a won race cannot hold the
process open), whichever first. `Promise.all` keeps reads in launch order. The sampler says which
way the stagger went and how long it waited, because that is what the ledger's cache columns are
read against.

**The harness gained `--together`** (the production sampler) **and `--draws`** (one at a time,
one artifact each — production's shape since PRDR-203), and prints each session's cost and cache
columns from the ledger with the set's wall-clock. `readLedger` joined `plan-corpus.ts`.

**V-6, in order.** Three tests written in final form, run against the sequential loop: all three
failed at `expected 1 to be 3` — the second and third draws never launched — then passed. One
existing test changed: the C-4⁗ relaunch test found the relaunch at position 2, and since the
other draws are now in flight before draw 1 is judged unusable, the relaunch is call 4. It finds
the relaunch by what it carries now. Product behaviour unchanged: one relaunch, carrying the
validator's words.

## What the measurement found

Five runs of three draws each, all on a copy of smoke-1, all through the production `reviewPlan`
and `launchInitSession` seams. `cache_creation` is per draw, in thousands of tokens.

| run | slice | form | wall-clock | spend | cache_creation |
|---|---|---|---|---|---|
| 1 | s04 | in sequence, one shared artifact path | 9.0 min | $2.41 | 54 · **21 · 17** |
| 2 | s04 | together, one path each | **2.9 min** | $2.56 | 42 · 44 · 44 |
| 3 | s04 | in sequence, one path each | 9.5 min | $1.90 | 18 · 12 · 13 (warm: run 2 had cached these exact turns) |
| A | s05 (fresh) | in sequence, one path each | 8.0 min | $2.64 | 44 · **45 · 47** |
| B | s07 (fresh) | together, one path each | 4.5 min | $4.58 | 49 · 59 · 90 |

**Wall-clock is the claim exactly**: 9.0 → 2.9 minutes on s04, the time of the slowest draw.

**Criterion 4's comparison came out the way it did for a reason the ticket did not anticipate.**
Run 1 against run A is the clean pair — same form, same freshness, differing only in whether the
draws name one artifact path or one each — and it says the per-draw path alone costs the second
and third draws the first-turn cache block: 21k/17k created behind a shared path, 45k/47k behind
their own. `fullPrompt` is one user message, prefix then variable, with `artifact_out` at its
tail, and the block misses on the tail. That is PRDR-203's cost, present in sequence and together
alike, about 25k tokens — $0.45 — a draw. Run 3 looked like a refutation and was contamination:
S-6 requests the hour-long cache, and run 2 had cached those exact three first turns minutes
earlier. Runs A and B on never-cached slices settled it.

**Launching together adds nothing the data can see beyond that.** The stagger did its job — *the
first answered after 3 s* — and run B's second and third draws created more than A's because
they were longer sessions, not because they missed a block A would have hit: their `cache_read`
was 619k and 1.76M against 144k–259k everywhere else, and creation grows with turns. One of the
three was the most expensive draw of the day, $2.30 against a $0.56–0.97 norm for identical
work. With one slice per condition that is session variance, and the concurrent form ships on
it; the exposure if that reading is wrong is bounded at the same ~$0.45 a draw. Reverting is one
function.

**The decisive measurement moves to PRDR-205.** Until the three first turns are byte-identical
again, the stagger's value cannot be observed — nothing can read a block whose tail differs.
Once they are, the cache columns become the stagger's own test: draws 2 and 3 create what a
sequential draw creates, or the wait is wrong.

Spend for the five runs: $14.09.
