---
id: PRDR-116
title: "REVIEW_PLAN wrote `revise` instead of `changes`; the validator refused the artifact, six real findings were discarded, and the plan was written unreviewed with a note that said 'no artifact'"
state: DONE
severity: major
category: correctness
labels: ["prd-review", "found-by-execution"]
surface: ["src/init/plan-review.ts", "src/init/plan.ts", "prompts/planner.md", "detent-prd-v3.md"]
prd_refs: ["C-4", "D-6", "A-5", "P2"]
acceptance_criteria: ["A review artifact whose verdict is a plain synonym of `approve` or `changes` is read as that verdict, and the note says which word was read as which.", "An absent or unusable review artifact relaunches REVIEW_PLAN once with the validator's issue in the inputs; a usable second artifact is used.", "Only after the relaunch does the draft stand unreviewed, and the note names the reason — never 'no artifact' for an artifact that exists.", "The planner is told the verdict is exactly `approve` or `changes`."]
non_goals: ["Does not open the vocabulary. The schema still accepts exactly two verdicts; synonyms are read, not stored.", "Does not add a second revision round. PLAN_REVISIONS stays 1 (D-24's argument)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-084", "PRDR-109", "PRDR-115"]
depends_on: []
---

# PRDR-116 — a plan-review verdict of `revise` threw six findings away

**Severity:** major · **Category:** correctness · **Found by:** `detent init` on ksar-cloud,
fourth pass, 2 September 2026

## What happened

REVIEW_PLAN on Fable 5.1 (7 turns, $1.66) judged the twenty-ticket draft and wrote a
5.5 KB artifact: verdict `revise`, six findings — t-108, t-117 and t-118 larger than one
session; t-106 and t-113 reaching code other tickets build with no edge; t-117's "walks
from a fresh host to a green `task e2e`" settleable by no command. Exactly the tickets an
operator would have worried about, and the same oversize shape that cost the
certification gate its four turns breaches.

The schema's verdict enum is `approve | changes`. `revise` is neither, `parseArtifact`
refused the whole artifact, `reviewPlan` returned null, and `planStage` wrote the draft
unreviewed with the note *"plan review produced no artifact"* — for an artifact that
existed, was sound, and was one word away from valid.

## Resolution

`normaliseVerdict` reads plain synonyms as the word they mean and the note records the
reading. An absent or unusable artifact relaunches the review once with the validator's
issue in `previous_attempt`, the A-5′ shape. The note distinguishes absent, invalid and
newer-schema, and names the issue. The planner's REVIEW_PLAN instruction and prompt both
say the verdict is exactly `approve` or `changes`.
