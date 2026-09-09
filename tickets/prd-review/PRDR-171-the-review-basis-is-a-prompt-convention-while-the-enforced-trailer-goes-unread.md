---
id: PRDR-171
title: "A ticket's commits are selected by an unenforced subject-prefix convention while the hook-enforced Detent-Ticket trailer has zero readers, so an unprefixed commit is invisible to the reviewer and merges anyway"
state: DONE
severity: critical
category: defect
labels: ["prd-review", "found-by-audit", "verification-integrity"]
surface: ["src/kernel/git.ts", "tests/kernel/review-basis.test.ts"]
prd_refs: ["A-5", "P2", "B-4"]
acceptance_criteria: ["A commit carrying this ticket's `Detent-Ticket:` trailer is part of the review basis whether or not its subject was prefixed — the trailer is written by a git hook, the prefix by a model that is asked to remember.", "The subject-prefix convention keeps working, so nothing that is attributed today stops being attributed."]
non_goals: ["Does not stop asking sessions to prefix subjects. A readable log is worth keeping; it just cannot be the only mechanism.", "Does not widen the basis to commits belonging to other tickets — PRDR-094 narrowed it for a reason, and that narrowing stands."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-094", "PRDR-146"]
depends_on: []
---

# PRDR-171 — two mechanisms, and the load-bearing one is the one nobody reads

**Severity:** critical · **Category:** defect · **Found by:** the full-project audit of `0752fef`

## Problem

`ticketCommits()` picks a ticket's commits with `subject.startsWith(`${ticketId}:`)` — a
convention stated in prompt text and enforced nowhere. Implement and fix sessions hold an
unrestricted `Bash(git commit:*)` grant, and are asked to remember the prefix three or four times
per ticket across the fix ladder.

Meanwhile `installTrailerHook` writes a real `prepare-commit-msg` hook that stamps
`Detent-Ticket: <id>` onto every commit made while a ticket is claimed, and `parseTicketTrailers`
exists to read it. **`parseTicketTrailers` has zero production callers.**

So a commit the session made correctly, with the hook's trailer attached, but whose subject it
forgot to prefix, is completely absent from the diff the reviewer judges — not truncated, not
flagged. It merges. `reviewStage` cross-checks nothing against the separately computed
`changedFiles()` the B-4 risk gate uses.

This is the structural inverse of PRDR-094, which stopped the reviewer seeing another ticket's
work. This lets it see too little of the ticket's own.

## Fix

Union, with the enforced mechanism first. The trailer is written by a hook and needs no cooperation
from the model; the subject prefix stays as a fallback so nothing attributed today loses
attribution.
