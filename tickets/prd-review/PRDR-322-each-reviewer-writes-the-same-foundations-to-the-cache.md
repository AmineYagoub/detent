---
id: PRDR-322
title: "Each of a round's reviewers writes the same foundations to the cache. Every VALIDATE reviewer reads the pack's foundations before its own area: on tabachir, 24 documents and 198 KB of the pack's 571. Each reads them with its own tool calls into a context of its own, so a round of 26 reviewers writes them to the cache 26 times, at $8 a million tokens on Opus 5.5. Handed in one fixed order at the start of every reviewer's first message, byte for byte the same, they would be written by the round's first reviewers and read by the rest at $0.20, about $0.45 a review on tabachir. It changes what a reviewer is handed, so it becomes the default only if the review set of PRDR-326 finds every blocker with it"
state: OPEN
severity: minor
category: spend
labels: ["prd-review", "cost-strategy", "S-6‴", "S-6", "S-6′", "C-2¹⁴", "prompt-cache", "validate"]
surface: ["src/init/validate-foundations.ts", "src/init/validate-round.ts", "src/init/validate-checks.ts", "src/init/validate-kept.ts", "src/init/validate.ts", "src/init/pipeline.ts", "src/init/session.ts", "src/sessions/backend.ts", "src/sessions/sdk.ts", "src/kernel/worstcase.ts", "src/cli/init.ts", "src/eval/run.ts", "src/eval/run-units.ts", "src/eval/results.ts", "src/eval/score.ts", "scripts/eval-run.ts", "prompts/spec_review.md", "prompts/manifest.json", "tests/init/validate-round-prefix.test.ts", "tests/kernel/run.test.ts", "detent-prd-v3.md", "README.md", "docs/plan-cost-strategy.md"]
prd_refs: ["S-6", "S-6′", "C-2¹⁴", "C-2²³", "D-35", "N-8"]
acceptance_criteria: ["Every reviewer of a round is handed the foundations' text as its system prompt, in one order and byte for byte the same for every reviewer of the round, with nothing in it that differs between reviewers. (Amended 2026-10-02: the first message was measured to share nothing across sessions; see Progress.)", "A reviewer is still told its own documents, and reads them itself. The foundations it was handed count as read for C-2¹⁴'s check of documents_read.", "The prompt says that the foundations are given, and that the reviewer reads its own documents.", "Measured on one round of the review set, the cache writes of each reviewer after the first four fall by at least the foundations' tokens less 10%, and the ticket records the figures. (Amended 2026-10-02: shown per reviewer by its first request reading at least the foundations' tokens less 10% from the cache, with no foundation read again from its file. A whole session's writes vary between runs by more than the foundations' tokens, so they are not compared directly.)", "It is the default only if PRDR-326's review set, reviewed with it on Opus 5.5 at max, reports each of the 18 blockers at its place as a blocker or a major. The ticket records the run and its cost.", "Falsifying test, against HEAD: two reviewers of one round are handed no shared text beyond the role's prompt: neither has a system prompt, and neither's first message holds a foundation's text."]
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

### Not yet measured (ACs 4, 5)

Both need one run of the review set on Opus 5.5 at `max` with `--foundations given`, about $100 at
the measured $9.64 a review. Until it passes, the default stays `read`. It runs only if the $500
measuring budget has room once PRDR-327's arms end; otherwise the user decides.

