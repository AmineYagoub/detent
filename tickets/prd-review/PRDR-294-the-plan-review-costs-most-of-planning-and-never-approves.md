---
id: PRDR-294
title: "The plan review costs 78% of planning: three reads a slice, a revision, then three more reads. In the runs that built ksar-cloud's plan, reviewers wrote 151 verdicts, every one `changes`, and revisions resolved 121 findings while introducing 119. Each slice now gets one read, by a separate `plan_review` role limited to judgement and graded by severity; a blocker or major buys one revision, and the sampling and measurement built around the loop are deleted"
state: OPEN
severity: major
category: capability
labels: ["prd-review", "planning-redesign", "operator-decision", "C-4″", "F-3", "review"]
surface: ["src/schemas/roles.ts", "src/init/plan-review.ts", "src/init/plan-slices.ts", "src/init/plan-sample.ts", "src/init/plan-signal.ts", "src/init/plan-notes.ts", "src/init/present-advice.ts", "src/init/plan.ts", "src/kernel/plan-findings.ts", "prompts/plan_review.md", "prompts/manifest.json", "tests/init/plan-review-role.test.ts"]
prd_refs: ["C-4″", "C-4⁗", "D-24", "F-3", "PRDR-084", "PRDR-196", "PRDR-200", "PRDR-268", "PRDR-269", "PRDR-271", "PRDR-278"]
acceptance_criteria: ["A `plan_review` role exists with its own prompt, model and effort, and its `role@hash` assignments migrate under F-3. It shares one `schema_version` event with PRDR-281's `audit` role: whichever lands first bumps the version and writes the migration, and the other extends it before a release.", "Each slice gets one review read, after the mechanical checks pass. Its scope is sizing, shape, the dependencies contracts cannot see, and coherence. Coverage, traceability and contracts are code's (PRDR-293).", "A finding carries a severity (blocker, major or minor), its ticket and its fix. `approve` is the verdict when nothing is blocker or major, and a test with a clean scripted draft asserts it.", "A blocker or major buys one revision of the slice. The mechanical checks run on the revision, and there is no second review. Minor findings are recorded on their tickets and reach the run sessions through PRDR-271's path.", "Deleted, with their tests: the three-read sampling (`plan-sample.ts`), the review after revision (PRDR-269), the churn and null lines (`plan-signal.ts`, `plan-notes.ts`), the held-finding labels, the advice file (`present-advice.ts`), and the `revisionRounds` seam.", "A slice costs at most three sessions: the draft, the review and one revision. A test pins it."]
non_goals: ["Does NOT judge the reviewer by its finding counts. Its worth is decided by run-time outcomes (PRDR-297).", "Does NOT remove `launch-batch.ts` if VALIDATE's parallel reviewers use it (PRDR-284)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-084", "PRDR-200", "PRDR-269", "PRDR-271", "PRDR-281"]
depends_on: ["PRDR-293"]
---

# PRDR-294 — one review read, by the `plan_review` role

## Where this came from

The planning audit of 2026-09-26, §3 and §4:
- review and revision cost $705 of the $903 in ksar-cloud's plan;
- no written verdict was `approve`;
- revision resolved 121 findings and introduced 119;
- the operator's own experiments showed that finding counts track how much the reviewer says, not
  plan quality.

## Problem

PRDR-084 declined a separate role because a new `RoleId` is an F-3 schema event. So the reviewer
runs with the drafter's role, prompt, model and effort, reads the drafter's own "too few tickets"
rule, and never approves. Around it, September built sampling to separate signal from noise and
measurement to report the revision's effect. Neither changed a plan: PRDR-268's own commit says
production behaviour was identical to HEAD at one revision round, and PRDR-269 falsified its own
prediction and was kept.

## Design

The redesign plan's §7. The operator decided the F-3 cost is worth paying, the scope is what a model
can judge, and severity makes the loop's stop mean something.
