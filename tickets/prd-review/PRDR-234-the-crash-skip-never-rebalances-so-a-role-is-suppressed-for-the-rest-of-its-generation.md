---
id: PRDR-234
title: "The crash skip writes no balancing event, so `unfinished` stays true and the skipped role is suppressed for the rest of its generation — the review-fix ceiling is then spent on launches that never happen, and the ticket reaches NEEDS_HUMAN with the reviewer's finding never handed to a running fixer"
state: DONE
severity: major
category: defect
labels: ["prd-review", "B-5", "B-5′", "X-1‴", "journal", "resume", "gate-313", "live-run"]
surface: ["src/kernel/referee-session.ts", "src/kernel/journal.ts", "tests/kernel/run.test.ts", "detent-prd-v3.md"]
prd_refs: ["B-5", "B-5′", "X-1", "X-1‴", "X-8", "C-12", "V-6", "N-6", "PRDR-131"]
acceptance_criteria: ["A role whose session crashed is skipped exactly ONCE per generation: the ladder may re-enter that role in the same generation and the next launch runs a real session. Observed FIRST (V-6): `src/kernel/referee-session.ts:66` returns after appending `{event: \"skipped_after_crash\"}`, and `src/kernel/journal.ts:100` computes `unfinished` as `starts > ends` counting ONLY `event === \"start\"` and `event === \"end\"` — the skip event increments neither, so the imbalance that caused the skip survives it and every subsequent launch of that role in that generation is skipped too. No test exercises a ladder that RE-ENTERS the crashed role: `tests/kernel/run.test.ts:583` crashes `blind_fix` and the ladder proceeds to `informed_fix`, a different role, so the permanence is invisible.", "A skipped launch does not consume a budget slot without doing work. Observed FIRST: `review_fix_attempts` is consumed on ENTRY to REVIEW_FIX by `countReviewFix` at `src/kernel/machine.ts:167` — before the launch that `referee-session.ts:66` then skips — so the review→review_fix→review cycle burns the ceiling against a tree nobody touched and reaches NEEDS_HUMAN with the reviewer's finding unaddressed.", "B-5's skip-once and B-5′'s generation scoping both survive: a crashed role is still not relaunched for the launch that crashed, and a requeue still clears the skip. The existing assertions at `tests/kernel/run.test.ts:500-533` and `:583` stay green unchanged.", "Both defects are proved by a test that fails on today's tree: a ladder that re-enters REVIEW_FIX within one generation, whose second entry launches no session at all."]
non_goals: ["Does not remove the crash skip: B-5's premise — the budget was consumed, so a crashed session may not relaunch blindly — is sound for the one launch that crashed.", "Does not change how generations scope the skip (B-5′/PRDR-131 is correct and must survive).", "Does not add a retry: the skip stays a skip; it simply stops being permanent.", "Does not change the review_fix_attempts ceiling — that is an operator budget, addressed separately."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-131", "PRDR-219"]
depends_on: []
---

# PRDR-234 — the skip that never ends

**Severity:** major · **Category:** defect · **Found by:** watching the live gate-313 run halt
on `t-s01-012`, then reading the journals

## Problem

B-5 skips a stage whose previous attempt crashed: the budget was charged before the launch, so a
killed session may not silently relaunch. The guard is one predicate:

```ts
// src/kernel/referee-session.ts:65-70
const openGen = currentGeneration(ticket).index;
if (ctx.journal.unfinished(id, role, openGen)) {
  ctx.journal.appendTicketEvent(id, { stage: role, event: "skipped_after_crash", at: ctx.iso(), generation: openGen });
  return;
}
```

and `unfinished` is a counter:

```ts
// src/kernel/journal.ts:122-125
if (record.event === "start") starts += 1;
else if (record.event === "end") ends += 1;
...
return starts > ends;
```

The skip appends `skipped_after_crash`. That event is neither a `start` nor an `end`, so it
changes neither tally. **The condition that triggered the skip is still true after it.** Every
later launch of that role, in that generation, is skipped in turn — forever.

This is not a new diagnosis. B-5′ in the PRD already states it:

> `unfinished` counted `start` against `end` over the ticket's whole journal **and the skip event
> rebalanced neither**, so one killed session suppressed that role on that ticket permanently

PRDR-131 read that sentence and fixed the *scope* — the skip now belongs to the generation rather
than the ticket's lifetime — and left the *imbalance* exactly as it found it. Across generations
the suppression clears, because X-8 starts a new generation with a new index. Within one
generation the original defect is untouched, word for word.

It went unnoticed because the ladder usually moves ON after a skip. `blind_fix` crashes, is
skipped, and the ladder proceeds to research and `informed_fix` — different roles, different
tallies. The test at `tests/kernel/run.test.ts:583` asserts exactly that shape. The path that
RE-ENTERS the same role in the same generation is `REVIEW_FIX`: review finds changes → review_fix
→ review → review_fix. Nothing covers it.

## Measured, on the live run

Three tickets carry the skip twice or reach DONE through it. Two were harmed; the third is
recorded because it looks like a third victim and is not.

**`t-s01-012` — a false NEEDS_HUMAN, and the run halted.**

```
10:02:17  start  review_fix          ← killed with take 12 (SIGTERM 17:46)
18:35:24  skipped_after_crash review_fix
18:36:45  skipped_after_crash review_fix
18:38:49  end    review  → NEEDS_HUMAN
```

Its ledger holds ONE `review_fix` session in the ticket's entire history ($1.40, 10:00) while the
counter reads `review_fix_attempts: 3`. Two of the three rounds that exhausted the ceiling did no
work. Each time, the reviewer re-read an unchanged tree, re-raised the same finding — that
`finalizeTicket` treats `surface[]` entries as literal paths when A-1 defines them as globs — and
the ticket walked to NEEDS_HUMAN with that finding never once handed to a running fixer.
`detent run` exited 10. The operator's documented remedy, C-12 requeue, would have cleared the
skip only because a requeue opens a new generation.

**`t-s01-008` — the same two skips, survived by luck.** Its earlier real fix session had already
done enough that the third review approved. Identical mechanism, benign outcome.

**`t-s01-006` — the skip reaching `implement`, and NOT a defect.** Recorded because it looks like
one and is not:

```
09:29:09  implement  start                ← crashed, no end
17:08:52  implement  skipped_after_crash
17:08:58  review     start → end  $0.98
```

State DONE, merged at `2c49524`, its implement session never having written an `end` in any
generation. That reads alarmingly — a ticket DONE whose implementation stage was skipped — but it
is P2 working as designed. The referee judges the TREE, never the session's self-report: the
killed session had already written and committed its work (477 lines across all four surface
files), the authoritative gate ran green on it, and the reviewer approved it. A session that dies
after committing complete work is indistinguishable from one that returns, and should be.

It is also outside this defect's reach in a second way: the ladder never re-enters `implement`
within a generation, so for that role skip-once and skip-forever are the same behaviour. The
permanence bites only on a role the ladder returns to — which in practice means `REVIEW_FIX`.

Five tickets on this run carry skip events: `t-s01-003`, `t-s01-005`, `t-s01-006` (one each),
`t-s01-008`, `t-s01-012` (two each). Only the last two were harmed.

## Why the counter is the right place

Two repairs are available. The skip could write a balancing `end`, or `unfinished` could count
`skipped_after_crash` as terminal. They differ in what a reader of the journal is told.

Writing a fake `end` would claim a session ended that never ran, and `end` carries `ok` and `cost`
that every ledger and report reader trusts. The journal is the audit trail of what actually
executed; a synthetic `end` corrupts it to satisfy a predicate.

So the predicate changes: a `skipped_after_crash` discharges the unmatched `start` it was written
for. The event already records `stage` and `generation`, so it discharges precisely — and the
journal keeps saying, truthfully, that the session never ran.

## Scope

`unfinished` in `src/kernel/journal.ts`, plus the tests that pin the two uncovered paths. B-5's
skip-once and B-5′'s generation scoping both survive unchanged — this restores the property both
were written to provide.

## What implementation changed

**`src/kernel/journal.ts`** — `unfinished` counts `skipped_after_crash` alongside `end`. One
clause. The skip now discharges the unmatched `start` it was written for, so the predicate that
fired it is false afterwards and the next entry into that role launches a real session.

Counted in the predicate rather than written as a synthetic `end` event: `end` carries `ok` and
`cost`, which the ledger and the report readers trust, so fabricating one would put a session that
never ran into the audit trail. The skip event already records `stage` and `generation`, so it
discharges precisely the start it belongs to.

**`tests/kernel/run.test.ts`** — two tests, both observed failing first (V-6):

- *REVIEW_FIX launches a real session on its second entry in the same generation.* Implement
  green, review asks for changes, the fix session crashes; on resume the skip fires once, review
  asks for changes again, and the ladder re-enters REVIEW_FIX. Before: two `skipped_after_crash`
  events and zero fix launches. After: one skip, one real launch.
- *Does not spend the review-fix ceiling on launches that never happen.* Before: three rounds
  charged against one real launch — the `t-s01-012` shape exactly. After: every charged round
  beyond the one the crash legitimately consumed runs a session.

Nothing else moved. The existing B-5 crash-resume assertions and the B-5′ generation-scoping
assertions pass unchanged, which is the third acceptance criterion.

**Not done, deliberately:** `t-s01-006` is left alone. It reached DONE with its implement stage
skipped, which reads like a third victim and is not — the killed session had already committed
complete work, the authoritative gate ran green on it and the reviewer approved it. P2 judges the
tree, never the session's self-report, and a session that dies after committing is
indistinguishable from one that returns. The ladder also never re-enters `implement` within a
generation, so for that role skip-once and skip-forever are the same behaviour.
