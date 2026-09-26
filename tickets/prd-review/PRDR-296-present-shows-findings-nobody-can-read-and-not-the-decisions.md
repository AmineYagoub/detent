---
id: PRDR-296
title: "PRESENT gave the operator 457 held findings, a revision headline that summed 16 of 24 slices, and a 457-KB advice file, yet never showed the decisions the plan rests on. PRESENT now shows the plan, the decision log with every vetoable default, the checks that still fail, the spec defects planning found, the majors left as risks, and what planning cost; it refuses approval while a check fails or a spec defect is open"
state: OPEN
severity: major
category: capability
labels: ["prd-review", "planning-redesign", "operator-decision", "C-7", "presentation"]
surface: ["src/init/present.ts", "src/init/present-advice.ts", "src/init/machine.ts", "src/cli/init.ts", "src/cli/approve.ts", "tests/init/present.test.ts"]
prd_refs: ["C-3′", "C-7", "C-7′", "D-24", "PRDR-166", "PRDR-196", "PRDR-255", "PRDR-278", "PRDR-282"]
acceptance_criteria: ["PRESENT shows: the slices, tickets and milestones; every `D-n` and every `X-n` in the decision log, the `X-n` marked vetoable; the checks that still fail; the spec defects planning found; the review majors left after revision, as risks; and what planning cost.", "It refuses approval while a check fails or a spec defect is open, raising AWAIT_INFO with each item.", "The revision and churn lines, the advice file and the question list are gone.", "The presentation is printed once, off a TTY as on one. Today it is printed three times.", "The persisted presentation that `run` replays (PRDR-255) is the same text, byte for byte."]
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
