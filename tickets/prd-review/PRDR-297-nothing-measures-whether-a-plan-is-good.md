---
id: PRDR-297
title: "Nothing measures whether a plan is good. So September judged 79 planning tickets by reviewer finding counts, which its own experiments showed track the reviewer, and ksar-cloud's plan was assembled by at least four Detent builds, one slice of it from an experiment run against the live tree. Run-time outcomes are now recorded per ticket and aggregated per plan with the build and pack that made it; a planning mechanism must name the outcome it should move; and a plan's builds are recorded and shown"
state: OPEN
severity: major
category: capability
labels: ["prd-review", "planning-redesign", "operator-decision", "measurement", "evaluation"]
surface: ["src/kernel/run.ts", "src/kernel/ledger.ts", "src/cli/status.ts", "src/cli/report.ts", "src/schemas/records.ts", "src/init/machine.ts", "src/init/present.ts", "src/cli/init.ts", "src/cli/run.ts", "src/cli/approve.ts", "detent-prd-v3.md", "tests/kernel/plan-quality.test.ts"]
prd_refs: ["X-4", "X-4′", "X-4″", "X-1⁵", "F-3", "F-4", "N-7", "C-7", "PRDR-081", "PRDR-255", "PRDR-276", "PRDR-278"]
acceptance_criteria: ["Per ticket, from `transitions.jsonl` and the ledger: escalations to NEEDS_HUMAN, falsifications by cause (premise, oversized, dependency discovered), budget breaches, whether it was done in its first generation, review rounds, cost and wall-clock.", "Per slice and per plan, together with the Detent build and the pack hash that produced the plan: `detent status` shows a quality section, and the end of a run writes a record of it.", "The PRD states the rule. A planning mechanism that claims to improve plans names the outcome it should move, and a measured run in which that outcome does not move is grounds to remove the mechanism. Reviewer finding counts are not an outcome.", "Every planning checkpoint records the Detent build that wrote it, and PRESENT names every build that contributed. A plan more than one build produced is approved the way a toolchain install is (PRDR-276): on a TTY, PRESENT asks [y/N] after naming the builds, and so does `run`'s deferred approval (PRDR-255); off one, `--approve` needs `--accept-mixed-builds` beside it, or the approval is refused. The approval record lists the builds.", "A test replays a recorded run's transitions and ledger, and asserts the per-ticket and per-plan figures.", "`detent status` shows what each specification phase and planning cost. No cap or threshold applies (the specification plan's decision 16)."]
non_goals: ["Does NOT gate anything on these numbers. They are evidence for the operator's decisions, not a stop.", "Does NOT forbid experiments. It records which build made what, so an experiment's output cannot pass for the real plan."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-081", "PRDR-255", "PRDR-269", "PRDR-276"]
depends_on: ["PRDR-278"]
---

# PRDR-297 — run-time outcomes, and evaluation hygiene

## Where this came from

The planning audit of 2026-09-26, §1, §2 and §7:
- about 19 of 79 planning tickets have live evidence of a result, and only PRDR-081's effect was
  measured on execution (67/67 DONE on the 3.1.0 gate);
- s07 of ksar-cloud's approved plan is the draft of the "no revision" experiment arm;
- the plan came from at least four builds.

## Problem

Without an outcome, every planning change is judged by proxies. The proxy September used, finding
counts, measures the reviewer. And a plan whose parts came from different builds and an experiment
cannot be attributed to any one of them.

## Design

The redesign plan's §10. The operator's decision 3 makes run-time outcomes the bar. `run` already
records every event the figures need, so this ticket aggregates and attributes; it measures nothing
new.
