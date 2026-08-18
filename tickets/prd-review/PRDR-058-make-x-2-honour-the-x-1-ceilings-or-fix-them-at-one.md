---
id: PRDR-058
title: "Make X-2 honour the X-1 ladder ceilings, or declare them fixed at one"
state: DONE
severity: minor
category: contradiction
labels: ["prd-review"]
surface: ["detent-prd-v2.md"]
prd_refs: ["X-1", "X-2", "D-12", "P6", "F-1"]
acceptance_criteria: ["A reader can determine, from the PRD alone, what happens when an operator sets a ladder ceiling above 1 — either the resolver honours it or the config is refused.", "X-1 and X-2 agree: the three ladder rows are not presented as configurable while the routing function ignores their values.", "If the ceilings stay fixed at 1, the PRD says so and config load rejects any other value, rather than accepting it silently.", "D-12's 'each slot at most once' safety property remains provable under whichever resolution is chosen."]
non_goals: ["Does not change the ladder's shape or order (blind → research → informed → human).", "Does not propose making the ceilings genuinely tunable if the answer is that they are fixed; either resolution is acceptable, silence is not.", "Does not affect `review_fix_attempts`, which X-3 checks against its counter in the IN_REVIEW row and which has the same question but is out of X-2's scope."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-058 — Make X-2 honour the X-1 ladder ceilings, or declare them fixed at one

**Severity:** minor · **Category:** contradiction · **Amends:** X-1, X-2

## Problem

X-1 presents `blind_fix_attempts`, `informed_fix_attempts`, and `research_sessions` as budget rows with a maximum of 1 — the same table shape as every other ceiling, all of which are named config keys under `config.json`'s budgets object (F-1). Nothing marks these three as different.

X-2's routing function does not read them. It compares each counter against the literal zero:

```
resolveRed(c): BLIND_FIX     if c.blind_fix == 0
               RESEARCH      elif c.research == 0
               INFORMED_FIX  elif c.informed_fix == 0
               NEEDS_HUMAN   otherwise
```

The signature takes only `c`. So an operator who sets `blind_fix_attempts: 2` in config gets no second blind fix: the value validates, loads, is reported by `status`, and is silently ignored. That is the failure mode P6 exists to prevent, inverted — a ceiling that appears to be raised while the real limit stays put.

This surfaced at implementation. Written faithfully to X-2, the resolver's `budgets` parameter is unused, and the lint flags it — the signature was advertising a dependency the function does not have.

There is a good reason X-2 is written this way: comparing against zero is what makes "no second blind fix" a *property of the function* rather than a consequence of configuration. D-12 says as much — the testable form of the safety property is "each slot at most once". If that is the intent, the PRD should say the three ladder ceilings are structural rather than tunable, and config load should refuse any other value. What it should not do is present them as ordinary budget rows.

## Evidence (verbatim from detent-prd-v2.md)

- X-1: "| `blind_fix_attempts` (D-12) | 1 | ticket/generation | resolver → next slot / NEEDS_HUMAN |"
- X-1: "| `informed_fix_attempts` (D-12) | 1 | ticket/generation | NEEDS_HUMAN (X-2 scope) |"
- X-1: "Every ceiling is a named key in `config.json`'s budgets object (F-1), so the set a config-load validator must accept is enumerable from this table alone."
- X-1: "Fix capacity is three independent **unit budgets** (D-12), each consumed exactly on entry to its namesake state — the safety property is \"each slot at most once\", testable per slot."
- D-12: "Fix capacity = three independent **unit budgets** (blind, informed, review), each consumed on entry to its namesake state | PRD review 2026-08-17 (pass 2); \"each slot at most once\" is the testable form of the safety property"
- P6: "**Budgets are hard.** Every loop has a counter; every counter has a ceiling; every ceiling routes to a human."

## Proposed change

Take the structural reading, which matches D-12's stated intent and preserves the provable property.

**1. Mark the three rows as fixed.** In X-1's table, annotate each ladder ceiling `1 (fixed)` and append to the note beneath: "The three ladder ceilings are **structural, not tunable**. X-2 compares each slot against zero rather than against a configured value, because 'no second blind fix' is a property of the routing function and not a consequence of configuration (D-12). Config load accepts only `1` for these three keys and refuses any other value — a ceiling that cannot be raised must not appear raisable."

**2. Make X-2's signature honest.** Append: "`resolveRed` takes only the counters. It reads no budgets, by design: the ladder's shape is fixed, and passing budgets it ignores would advertise a dependency it does not have."

**3. Extend the config-load assertion.** Append to X-1's AC: "…and a config setting any ladder ceiling to a value other than 1 is rejected at load, naming the key — the same load path that rejects an insufficient net (R-9)."

## Acceptance criteria

1. A reader can determine, from the PRD alone, what happens when an operator sets a ladder ceiling above 1 — either the resolver honours it or the config is refused.
2. X-1 and X-2 agree: the three ladder rows are not presented as configurable while the routing function ignores their values.
3. If the ceilings stay fixed at 1, the PRD says so and config load rejects any other value, rather than accepting it silently.
4. D-12's "each slot at most once" safety property remains provable under whichever resolution is chosen.

## Non-goals

- Does not change the ladder's shape or order (blind → research → informed → human).
- Does not propose making the ceilings genuinely tunable if the answer is that they are fixed; either resolution is acceptable, silence is not.
- Does not affect `review_fix_attempts`, which X-3 checks against its counter in the IN_REVIEW row and which has the same question but is out of X-2's scope.
