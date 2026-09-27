---
id: PRDR-296
title: "PRESENT gave the operator 457 held findings, a revision headline that summed 16 of 24 slices, and a 457-KB advice file, yet never showed the decisions the plan rests on. PRESENT now shows the plan, the decision log with every vetoable default, the checks that still fail, the spec defects planning found, the majors left as risks, and what planning cost; it refuses approval while a check fails or a spec defect is open"
state: OPEN
severity: major
category: capability
labels: ["prd-review", "planning-redesign", "operator-decision", "C-7", "presentation"]
surface: ["src/init/present.ts", "src/init/present-advice.ts", "src/init/machine.ts", "src/cli/init.ts", "src/cli/approve.ts", "tests/init/present.test.ts"]
prd_refs: ["C-3′", "C-7", "C-7′", "D-24", "PRDR-166", "PRDR-196", "PRDR-255", "PRDR-278", "PRDR-282"]
acceptance_criteria: ["PRESENT shows: the slices, tickets and milestones; every `D-n` and every `X-n` in the decision log, the `X-n` marked vetoable; the checks that still fail; the spec defects planning found; the review majors left after revision, as risks; and what each specification phase and planning cost, with no cap (the specification plan's decision 16).", "It refuses approval while a check fails or a spec defect is open, raising AWAIT_INFO with each item.", "The revision and churn lines, the advice file and the question list are gone.", "The presentation is printed once, off a TTY as on one. Today it is printed three times.", "The persisted presentation that `run` replays (PRDR-255) is the same text, byte for byte."]
non_goals: ["Does NOT change C-7's dual exit or the approval record."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-255", "PRDR-282"]
depends_on: ["PRDR-293", "PRDR-294", "PRDR-282"]
---

# PRDR-296 — PRESENT rebuilt

## Where this came from

The planning audit of 2026-09-26, §2. ksar-cloud's presentation listed 457 held findings. Its
revision headline, "89 resolved, 9 survived, 82 introduced", summed slices s09–s24 only. Its advice
file ran to 457 KB. Nothing in it named the defaults the plan had assumed.

## Problem

A presentation nobody can read is not an approval gate. What the operator must decide is short: the
defaults they may veto, anything still proven wrong, and what the pack failed to settle. That is
what PRESENT should show.

## Design

The redesign plan's §9.

## From PRDR-292

PRESENT lists the spec defects planning found. Each shows the slice that reported it, its kind,
each passage's record id, quote and `file:line`, and the defect. While one is open, PRESENT raises
AWAIT_INFO with one item per defect before approval is offered, and its first line says the plan
is not approvable. `presentation.json` counts them in `spec_defects`, and `detent run`'s deferred
approval refuses while the count is not zero.

So the first criterion's "the spec defects planning found" is built, and so is the second
criterion's refusal while a spec defect is open. The refusal while a check fails is PRDR-293's.

## From PRDR-294

Each slice's review is read once (C-4⁸), and PRESENT's part of it is built in
`src/init/present-review.ts`:
- Each blocker and major a slice's read found is listed as a risk, with its slice, ticket, grade,
  tag and fix, blockers first. Each bought one revision that no review read, so none is known to
  be answered, and the first criterion's "the review majors left after revision" is built as every
  blocker and major sent to a revision. PLAN outputs them as `review_risks`, and each slice no
  review read, with why, as `unreviewed`.
- The minors are counted and not listed: each is recorded in PLAN's `review_findings` and reaches
  the sessions that run its ticket. The repairs code made to a draft (A-1″) are listed, since each
  is a decision code made for the operator.
- The revision and churn lines, the held-finding labels and the advice file are gone, with
  `present-advice.ts`, so the third criterion holds but for the question list.
