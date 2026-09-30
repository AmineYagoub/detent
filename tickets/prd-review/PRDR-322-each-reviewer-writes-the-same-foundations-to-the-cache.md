---
id: PRDR-322
title: "Each of a round's reviewers writes the same foundations to the cache. Every VALIDATE reviewer reads the pack's foundations before its own area: on tabachir, 24 documents and 198 KB of the pack's 571. Each reads them with its own tool calls into a context of its own, so a round of 26 reviewers writes them to the cache 26 times, at $8 a million tokens on Opus 5.5. Handed in one fixed order at the start of every reviewer's first message, byte for byte the same, they would be written by the round's first reviewers and read by the rest at $0.20, about $0.45 a review on tabachir. It changes what a reviewer is handed, so it becomes the default only if the review set of PRDR-326 finds every blocker with it"
state: OPEN
severity: minor
category: spend
labels: ["prd-review", "cost-strategy", "S-6‴", "S-6", "S-6′", "C-2¹⁴", "prompt-cache", "validate"]
surface: ["src/init/validate-round.ts", "src/init/validate-kept.ts", "src/init/session.ts", "src/sessions/backend.ts", "prompts/spec_review.md", "prompts/manifest.json", "tests/init/validate-round-prefix.test.ts", "tests/init/validate-batch.test.ts", "detent-prd-v3.md"]
prd_refs: ["S-6", "S-6′", "C-2¹⁴", "C-2²³", "D-35", "N-8"]
acceptance_criteria: ["Every reviewer of a round is handed the foundations' text in its first message, in one order and before anything that differs between reviewers, so that the first messages of a round's reviewers share their bytes up to the end of the foundations.", "A reviewer is still told its own documents, and reads them itself. The foundations it was handed count as read for C-2¹⁴'s check of documents_read.", "The prompt says that the foundations are given, and that the reviewer reads its own documents.", "Measured on one round of the review set, the cache writes of each reviewer after the first four fall by at least the foundations' tokens less 10%, and the ticket records the figures.", "It is the default only if PRDR-326's review set, reviewed with it on Opus 5.5 at max, reports each of the 18 blockers at its place as a blocker or a major. The ticket records the run and its cost.", "Falsifying test, against HEAD: the first messages of two reviewers of one round differ within their first 2,000 bytes after the role's prompt, and neither holds a foundation's text."]
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
