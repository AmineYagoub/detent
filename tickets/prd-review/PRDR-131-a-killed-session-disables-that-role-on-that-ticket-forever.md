---
id: PRDR-131
title: "The crash-resume skip is keyed to a ticket's whole lifetime rather than its generation, so one killed session disables that role on that ticket permanently and requeue cannot clear it"
state: DONE
severity: major
category: correctness
labels: ["prd-review", "found-by-audit", "user-raised", "found-by-execution"]
surface: ["src/kernel/journal.ts", "src/kernel/referee-session.ts", "tests/kernel/run.test.ts", "detent-prd-v3.md"]
prd_refs: ["B-5", "X-8", "C-9", "D-30"]
acceptance_criteria: ["Session `start` and `end` events carry the generation they belong to; today they carry no scoping information at all, so the fact needed to decide this is not on disk.", "`unfinished` counts only events belonging to the generation being resumed, so a crash suppresses a relaunch WITHIN its generation and not beyond it.", "Events written by older builds, carrying no generation, count toward generation 0 — the conservative reading, which preserves B-5 for the resume it was written for.", "A test asserts that a `start` with no `end` in generation 0 skips the session in generation 0 and LAUNCHES it in generation 1.", "The B-5 behaviour that already works keeps working: the same test asserts the within-generation skip still fires."]
non_goals: ["Does not change what a crash costs. The budget was consumed and the ledger row still records it as a flagged lower bound (S-4).", "Does not repair journals already on disk. An older journal counts toward generation 0, so an affected ticket recovers on its next requeue rather than retroactively.", "Does not add a crash-resume metric. `crash_resume_correctness` is under-tested (§14) but that is PRDR-144's scope."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-112", "PRDR-090"]
depends_on: []
---

# PRDR-131 — B-5 is right within a generation and wrong across one

**Severity:** major · **Category:** correctness · **Found by:** the production-readiness audit
of 7 September 2026, independently by two auditors

## What happens

`src/kernel/journal.ts:87-100`:

```ts
unfinished(ticketId: string, role: string): boolean {
  const file = this.ticketJournalPath(ticketId);   // per-TICKET; no generation in the path
  ...
  return starts > ends;
}
```

Consumed as the first statement of `launch` (`referee-session.ts:62-65`):

```ts
if (ctx.journal.unfinished(id, role)) {
  ctx.journal.appendTicketEvent(id, { stage: role, event: "skipped_after_crash", at: ctx.iso() });
  return;
}
```

The start/end imbalance is **never repaired**. `skipped_after_crash` matches `record.stage ===
role` but is neither a `start` nor an `end` (`journal.ts:96-97`), so it does not rebalance the
count. Verified: `openGeneration` (`generations.ts:39-58`) only rewrites the generations array,
and nothing anywhere deletes or truncates a ticket journal.

So `starts > ends` stays true forever.

## The failure, end to end

An implement session for `t-042` is OOM-killed — an observed failure mode, not a hypothetical:
this project's own gate run was SIGTERM-killed three times in one week.

The journal holds `implement:start` with no `end`. On resume the skip fires, correctly: that
is B-5's intent and within generation N it is right. The ticket burns its ladder and lands
NEEDS_HUMAN.

A human requeues. X-8 opens a fresh generation with zeroed counters, giving the ticket a new
budget. Generation N+1 reaches IN_PROGRESS → `launch` → `unfinished` **still returns true**,
because it reads the same file. The implement session is skipped again.

The gate then runs against an unchanged tree, goes red, and the ladder spends real money on
`blind_fix`, `research` and `informed_fix` — distinct roles, so they all run — trying to
repair an implementation that was never written. The ticket returns to NEEDS_HUMAN at cost,
and it will do so on every future generation, in this run and every later run on this machine.

The documented remedy can never work.

## Why the justification stops where it does

`journal.ts:82-86` states B-5's premise:

> *a `start` with no matching `end` means the process died mid-session. The budget was
> consumed; the session may NOT relaunch, and the gate judges the tree as-is.*

That is sound for the generation being resumed. It is false across one, because a generation
is *defined* by zeroed counters — X-8 says the budget is fresh, and B-5 says the budget was
consumed, and both are reading the same file.

The information needed to tell them apart is not recorded: the session `start`/`end` lines
(`referee-session.ts:152-158`, `:180-186`) carry no generation field. So the first half of
this fix is to write down the fact, and only then to read it.
