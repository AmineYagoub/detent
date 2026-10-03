---
id: PRDR-322
title: "Each of a round's reviewers writes the same foundations to the cache. Every VALIDATE reviewer reads the pack's foundations before its own area: on tabachir, 24 documents and 198 KB of the pack's 571. Each reads them with its own tool calls into a context of its own, so a round of 26 reviewers writes them to the cache 26 times, at $8 a million tokens on Opus 5.5. Handed in one fixed order at the start of every reviewer's first message, byte for byte the same, they would be written by the round's first reviewers and read by the rest at $0.20, about $0.45 a review on tabachir. It changes what a reviewer is handed, so it becomes the default only if the review set of PRDR-326 finds every blocker with it"
state: DONE
severity: minor
category: spend
labels: ["prd-review", "cost-strategy", "S-6‴", "S-6", "S-6′", "C-2¹⁴", "prompt-cache", "validate"]
surface: ["docs/evaluation.md", "src/init/validate-foundations.ts", "src/init/validate-round.ts", "src/init/validate-checks.ts", "src/init/validate-kept.ts", "src/init/validate.ts", "src/init/pipeline.ts", "src/init/session.ts", "src/sessions/backend.ts", "src/sessions/sdk.ts", "src/kernel/worstcase.ts", "src/cli/init.ts", "src/eval/run.ts", "src/eval/run-units.ts", "src/eval/results.ts", "src/eval/score.ts", "scripts/eval-run.ts", "prompts/spec_review.md", "prompts/manifest.json", "tests/init/validate-round-prefix.test.ts", "tests/kernel/run.test.ts", "detent-prd-v3.md", "README.md", "docs/plan-cost-strategy.md"]
prd_refs: ["S-6", "S-6′", "C-2¹⁴", "C-2²³", "D-35", "N-8"]
acceptance_criteria: ["Every reviewer of a round is handed the foundations' text as its system prompt, in one order and byte for byte the same for every reviewer of the round, with nothing in it that differs between reviewers. (Amended 2026-10-02: the first message was measured to share nothing across sessions; see Progress.)", "A reviewer is still told its own documents, and reads them itself. The foundations it was handed count as read for C-2¹⁴'s check of documents_read.", "The prompt says that the foundations are given, and that the reviewer reads its own documents.", "Measured on one round of the review set, the cache writes of each reviewer after the first four fall by at least the foundations' tokens less 10%, and the ticket records the figures. (Amended 2026-10-02: shown per reviewer by its first request reading at least the foundations' tokens less 10% from the cache, with no foundation read again from its file. A whole session's writes vary between runs by more than the foundations' tokens, so they are not compared directly.)", "It is the default only if PRDR-326's review set, reviewed with it on Opus 5.5 at max, reports each of the 18 blockers at its place as a blocker or a major. The ticket records the run and its cost. (Amended 2026-10-03: at `high`, where PRDR-327 moved a first round's review, as S-6‴ already said: the level the reviewers are routed to. That is the setup the default puts in force, and at `max` the run would have cost about $100 of the $180 left of the measuring budget.)", "Falsifying test, against HEAD: two reviewers of one round are handed no shared text beyond the role's prompt: neither has a system prompt, and neither's first message holds a foundation's text."]
non_goals: ["Does NOT change which documents a round reviews, what a reviewer reports, or the areas.", "Does NOT give AUDIT's checks or the writer a shared prefix. Their shared part is the role's prompt, a few thousand tokens.", "Does NOT change the order in which a round's reviewers start."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-054", "PRDR-205", "PRDR-284", "PRDR-313", "PRDR-316", "PRDR-318", "PRDR-326"]
depends_on: ["PRDR-318", "PRDR-326"]
---

# PRDR-322 — a round's reviewers share one cached prefix

## Where this came from

The cost plan (`docs/plan-cost-strategy.md` §3, §4.4) measured VALIDATE's reviews from their
transcripts. A review writes 406K tokens to the cache on average: what it reads, and what it thinks.

## Problem

- **The foundations are read 26 times.** A reviewer is told its `foundations` and `documents` and
  reads them with Read (`reviewArea`, `src/init/validate-round.ts`). The foundations are the same
  for every reviewer of a round (`tasksFor`, `src/init/validate.ts`). On tabachir they are 24
  documents and 198 KB, about 55K tokens. Each reviewer reads them into its own context, so each
  writes them to the cache.
- **S-6's prefix stops at the role's prompt.** A session's first message is the role's prompt, then
  the task's inputs (`fullPrompt`, `src/sessions/backend.ts`). The inputs begin with what differs
  between reviewers, the round and the area, so nothing after the prompt is shared.
- **What it costs.** About 55K tokens at $8 a million is about $0.44 a reviewer. Read from the
  cache it would be about $0.01.

## Design

- **The round hands the foundations.** Each reviewer's first message holds, after the role's
  prompt, the foundations' text in the areas' order, each under its path, and only then the
  reviewer's own inputs. Every reviewer of a round gets the same bytes up to that point.
- **The reviewer reads its own documents,** as today. The foundations it was handed count as read.
- **The first wave pays.** With four at once (C-2²³), the first four reviewers write the prefix,
  and the rest of the round reads it.
- **Checked on the review set before it is the default.** Handing a reviewer 55K tokens it did not
  choose to read changes how it works, so it becomes the default only if PRDR-326's review set,
  reviewed with it, reports every blocker. Until then it is off.
- **The PRD:** S-6‴ extends S-6′'s byte-identical first turns to a round's reviewers.

## Building it

- `src/init/validate-round.ts`: the foundations' text in the reviewer's first message; the
  `documents_read` check counts them.
- `src/init/session.ts` and `src/sessions/backend.ts`: a shared block between the role's prompt and
  the task's inputs.
- `prompts/spec_review.md`: one sentence on what is given. The manifest is re-hashed.

### Vetoable calls

1. **Reviewers only.** Their shared part is 55K tokens. The claim checks and the writer share the
   role's prompt alone.
2. **Off until the review set passes.** The saving is small beside the risk of a reviewer that
   reads its handed foundations less carefully than the ones it chose.
3. **Foundations, not the whole area.** A reviewer's own documents differ from every other's, so
   handing them would share nothing.

## Falsification (to run against HEAD when this is built)

- Two reviewers of one round get first messages that differ within their first 2,000 bytes after
  the role's prompt, and neither holds a foundation's text.

## Progress

### The design moved to the system prompt (measured 2026-10-02)

The design above hands the foundations at the start of each reviewer's first message. A live probe
on Claude Code 2.1.285, the runtime Detent bundles, showed that this shares nothing. Each probe
session ran on Sonnet 5.5 at `low`, with one turn and no tools, and opened with the same 30K
tokens:

| How the shared 30K tokens were given | 1st session's cache write | 2nd session's cache read |
|---|---|---|
| the start of the first message, one text block | 29,927 | 0 |
| the first message's first content block, of two | 29,924 | 0 |
| the system prompt | 29,920 | 29,281 |

Claude Code sets its cache breakpoint at the end of the last message, and an entry is only ever
read at a breakpoint someone wrote. So a start shared by two first messages is never read by the
second session. A system prompt is a block of its own, and the second session read it from the
cache for $0.008 instead of $0.12. The probes cost about $0.61 of the measuring budget.

So the round hands the foundations as the reviewer's **system prompt**. Detent's sessions passed
none until now, so the SDK's default, an empty one, applied. ACs 1, 4 and 6 are amended to match,
each marked in the frontmatter.

### Built

- **The setting.** The config's `review_foundations` is `read` by default, as every reviewer
  worked before, or `given`.
- **The handed text.** `given` hands each reviewer of a round the same system prompt
  (`src/init/validate-foundations.ts`). It holds each foundation whole, in the round's order, under
  its path, with its lines numbered as the Read tool numbers them (`N<tab>line`, read from a
  2.1.285 transcript), so a quote cites a handed line at the number Read would give it.
- **The first message.** It is unchanged, but for `foundations_given: true` in the inputs.
- **The checks.** A foundation the reviewer was handed counts as read in `documents_read`
  (C-2¹⁴). A review made with the foundations handed is kept under a key of its own. A reviewer
  that reads them keeps the key it had, pinned by a test to the value computed at `8e09020`, so
  N-8's set and every kept review still hold.
- **The prompt.** The `spec_review` prompt says the foundations may be given, and that a reviewer
  reads its own documents from their files unless the system prompt holds them. The manifest is
  re-hashed.
- **The plumbing.** `SessionSpec.systemPrompt` reaches the SDK only where a spec names one, so
  every other session's options are unchanged. `cli/init.ts` passes the setting into the pipeline.
- **The evaluation.** `scripts/eval-run.ts --foundations given` hands a reviews set's reviewers the
  foundations, records it in the results and their file name, and refuses it on a claims set.

**Falsified at HEAD (`8e09020`).** Two reviewers of one round were handed no system prompt, and
the config refused `review_foundations`. Both checks fail there and pass on the fix.

**Mutation battery (25 mutants): all killed.** The first pass killed 24. `V4`, where the round
does not count the handed foundations as read, survived because every test reviewer listed them
anyway. A test was added in which a reviewer relies on the handed text and lists none of it; it
kills `V4` and `C1`.

### Measured (ACs 4, 5)

One run of N-8's review set with `--foundations given`, on Opus 5.5 at `high`, four sessions at
once on runtime 2.1.285, from a frozen worktree at `047be16`, 2026-10-03 06:20 to 06:36 UTC. It
ran within the $500 the user approved for measuring, after PRDR-327's arms.

**AC 5, the bar: PASS.** It reported 18 of the 18 blockers at their place as a blocker or a major,
and spent $17.91 over 10 sessions in 15.7 minutes, against a $100 cap. The level is `high`, not
the `max` the AC first named: PRDR-327 moved a first round's review to `high` the same morning,
and S-6‴ already asked for the level the reviewers are routed to. So the run measured the setup
the default puts in force. AC 5 is amended to match, marked in the frontmatter.

**AC 4, the cache: met.** From the transcripts (scratch `measure322.py`, which reads each
session's first request and its Read calls):

| Reviewers | First request: written | First request: read from the cache | Foundation files read |
|---|---|---|---|
| the four launched together at 06:20:34 | 80,582 to 83,186 | 2,970 | 0 |
| the six launched after them | 4,798 to 5,550 | 78,759 | 0 |
| PRDR-327's arm at `high`, reading them (15) | 4,705 to 7,309 | 2,970 | 24 each |

- The handed system prompt is 75,789 tokens: 78,759 less the 2,970 of tools and runtime prompt
  that every reviewer reads from the cache. Each later reviewer read all of it on its first
  request, so its first request wrote only its own message. The bar was the foundations' tokens
  less 10%.
- One of the first four, the foundations' own reviewer, logged its first reply at 06:24:18, after
  a first turn of nearly four minutes. It was launched with the others at 06:20:34, so it wrote
  the prompt as they did.
- No reviewer read a foundation from its file.

**What else changed, against PRDR-327's arm at `high` reading them:**
- a review's median cost fell from $2.92 to $1.76, its length from 7.8 to 5.7 minutes, and its
  turns from 45 to 14;
- the median session's cache writes fell from 184K tokens to 103K;
- the reviews reported 148 findings instead of 200. The bar counts blockers, and both runs met
  it. The drop is recorded, not judged: one run each cannot separate the change from a run's own
  variance.

### The default (AC 5)

- **`review_foundations` is `given` by default** (`src/kernel/worstcase.ts`), and its doc-block
  names the run. `read` has each reviewer read them itself.
- **`init` always passes the config's setting.** A pipeline built without it, as a test builds
  one, keeps the reviewers reading. `PipelineDeps` says so.
- **The evaluation runner keeps reading by default,** as the set's reviewers did, so its results
  stay comparable with every run before. `--foundations given` measures the default.
  `docs/evaluation.md` now says both.
- **A config written by an earlier Detent** names no `review_foundations`, so it takes the new
  default. A run that stopped in a round whose reviewers read the foundations, resumed with them
  given, reviews that round's areas again, since a review made with them handed is kept under a
  key of its own. Its config can say `read` to keep them. S-6‴ and the README say so.
- **The documents:** S-6‴ is "built and measured by PRDR-322" and holds the run. The README's
  paragraph describes the default. The plan's §4.4 holds the measurement. The two notes S-6‴
  amended, on S-6′ and C-2¹⁴, now say it is the default.

### Falsification of the default

Three tests of `tests/init/validate-round-prefix.test.ts`, run against HEAD's
`src/kernel/worstcase.ts`, `detent-prd-v3.md` and `README.md` (`ec145f7`):

```
× is given by default, takes read, and refuses anything else
× S-6‴ states the setting, its default and why the system prompt carries it
× PRDR-322: the config's doc-block, S-6‴ and the README name the run that made given the default
```

All three fail there and pass on the change.

### Mutation battery of the default (5 mutants)

All killed, on a baseline of 57 passing tests, each restored from a snapshot and checked with
`cmp`:

| Mutant | Killed by |
|---|---|
| F1 the default stays `read` | the default's test |
| F2 the config refuses `read` | the default's test |
| F3 a pipeline built without the setting hands them | the reading pipeline's test, the stopped run's, and the runner's |
| F4 `init` does not pass the config's setting | the config reaches the pipeline |
| F5 the doc-block names no run | the run is named |

### What changed (closing)

- `src/kernel/worstcase.ts`: `review_foundations` defaults to `given`, and its doc-block names the
  run.
- `src/init/pipeline.ts`: `reviewFoundations` says what its absence means.
- `tests/init/validate-round-prefix.test.ts`: the default's test, the reading pipeline's, and the
  documents' test.
- `detent-prd-v3.md`, `README.md`, `docs/plan-cost-strategy.md`, `docs/evaluation.md`: as above.

### Recorded, not fixed

- **The findings dropped** from 200 to 148 against the `high` arm that read the foundations, with
  every blocker still found. One run each. If the user judges the bar too narrow for a change to
  what a reviewer is handed, `read` restores the old behaviour per project, and the default can
  return to it.
- **Verifications were not measured.** N-8's set holds only a first round's reviews. A
  verification is handed the foundations too, and runs at `max`.
- **`ensureConfig` does not write the key,** as it did not before. The README names it.

