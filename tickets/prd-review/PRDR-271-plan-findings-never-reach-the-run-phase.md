---
id: PRDR-271
title: "Every held plan finding dies at PRESENT: `renderHeldFindings` puts them in front of a human as Markdown and `writeAdvice` spills the overflow to `advice.md`, and nothing in `src/kernel/` reads either — so the ~310 findings a run produces never reach the implement session that could confirm or dismiss them, and the reproduction count that says which ones are strong is computed at `plan-sample.ts:101`, used as a boolean, and discarded"
state: DONE
severity: major
category: defect
labels: ["prd-review", "found-by-live-run", "doc-claim-drift", "D-29", "D-30", "PRDR-209", "PRDR-267", "PRDR-269", "PRDR-270"]
surface: ["src/init/plan-sample.ts", "src/init/present-advice.ts", "src/kernel/session-inputs.ts", "src/schemas/init.ts", "tests/kernel/session-inputs.test.ts", "tests/init/plan-critic-sampling.test.ts"]
prd_refs: ["A-1", "S-1", "X-1", "X-4′", "C-4⁗″", "D-24′", "PRDR-209", "PRDR-267", "PRDR-269", "PRDR-270"]
acceptance_criteria: ["Held findings persist in a form the kernel can read, keyed by the ticket they name. They ARE already persisted structurally: `plan.ts:345` assembles them and `writeCheckpoint` saves the PLAN stage's outputs to `.detent/state/PLAN.json`, where `outputs.review_findings` is the full list. What does not exist is a reader — `advice.md` (`present-advice.ts:150-155`) is the only form anything consumes, it is Markdown for a human, and it is written only when the list exceeds `ADVICE_INLINE_MAX`. So this criterion is satisfied by reading what PLAN already writes, not by adding a file. `HeldFinding` already carries `ticket`, `tag`, `finding` and `held`, so the keying needs no new field.", "The implement session receives the findings that name its ticket. `attemptInputs` (`src/kernel/session-inputs.ts:47-48`) returns `{ ticket: publicTicket(ticket, ctx.root) }` for `IN_PROGRESS` and nothing else, so a session cannot act on a finding it is never shown. The findings travel as their own input key, not folded into the ticket, because A-1's ticket schema is the persisted contract and a finding is evidence about a ticket rather than part of one.", "The reproduction count travels with each finding. `sampleReviewPlan` builds `seen`, a Map of key to how many of the k reads saw it (`src/init/plan-sample.ts:79-82`), then uses it once as a boolean at line 101 — `>= threshold ? findings : seenOnce` — and discards the integer. A finding seen 3-of-3 and one seen 2-of-3 reach the human, and would reach the session, indistinguishable. Measured over six reads of one slice: 14 of 16 distinct findings reproduce 3+ times of 6, nothing sits at 2 of 6, and about half of what survives the filter reproduces 5-6 times. That is the evidence-strength signal the run phase needs to decide what to chase first, and it is already computed.", "A finding confirmed at run time enters the EXISTING ladder and is not escalated straight to a human. No new `State` and no new `Event`: `[\"IN_PROGRESS\", \"GATE_RED\", guard(\"resolveRed\")]` already routes a red gate through `BLIND_FIX -> RESEARCH -> INFORMED_FIX -> NEEDS_HUMAN` (`src/kernel/resolver.ts:26-37`), consuming one budgeted slot per rung. The confirmation criterion is therefore the gate, not a judgement: a finding is confirmed when the ticket's gate goes red while that finding is in the session's inputs. Nothing in this ticket lets a session escalate because it considers a finding important.", "The finding survives every rung and lands in the dossier. `fixInputs` already carries `last_failure.json` and `hypothesis.json` into `BLIND_FIX`, `RESEARCH` and `INFORMED_FIX`; the confirmed finding must be readable at each rung and named in what reaches `NEEDS_HUMAN`, or the ladder spends three sessions rediscovering what PLAN already wrote down.", "Falsifying test: with a slice artifact holding a finding whose `ticket` is `t-s07-004`, `attemptInputs(ctx, t_s07_004, \"IN_PROGRESS\", workDir)` must return that finding. Against HEAD it fails — the returned object has exactly one key, `ticket` — and it fails because no channel exists, not by construction."]
non_goals: ["Does NOT add a `State` or an `Event`. `STATES` and `EVENTS` are the persisted artifact vocabulary — every `transitions.jsonl` line carries a from/event/to triple — so adding to either is a versioned change to files already on disk. The existing `GATE_RED` edge reaches the whole ladder, so none is needed.", "Does NOT change `[\"IN_PROGRESS\", \"TICKET_OVERSIZED\", to(\"NEEDS_HUMAN\")]`. That edge bypasses the ladder deliberately and X-4″ (PRDR-102) gives the reason on the line above it: `No rung can make a ticket smaller`. A `sizing` finding confirmed at run time is exactly that case, and three sessions cannot resize a ticket. The ladder-first decision applies to findings a rung could plausibly resolve.", "Does NOT filter, threshold or rank AWAY any finding. All of them travel. The reproduction count is carried so the run phase can order what it chases, not so anything can be dropped: D-30 established that the 2-of-3 filter already excludes every weak finding, and tightening it further discards signal.", "Does NOT change `PLAN_REVIEW_SAMPLES`, the ⌈k/2⌉ threshold, `sampleReviewPlan`'s partition, or `revisionOutcome`. PRDR-270 settled the reporting; this ticket settles the destination.", "Does NOT remove `advice.md` or change what PRESENT shows. The human keeps the full list; this ticket adds a second consumer, it does not move the findings away from the first."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-209", "PRDR-267", "PRDR-269", "PRDR-270"]
depends_on: []
---

# PRDR-271 — plan findings never reach the run phase

## Where this came from

Four live arms on run 6's s07 and a $8.60 replay, measuring whether the review/revision loop produces
signal. It does. The revision resolves 75% of what it is handed against a filtered null of 25%,
outside the null's whole range across ten splits (D-30). Fourteen of sixteen distinct findings
reproduce at least three times in six reads of byte-identical text, and nothing sits at two of six,
so the 2-of-3 filter already excludes every weak finding: 0% of what reaches the human is noise.

Which moves the problem. The findings are real, reproducible criticism, and PRDR-269 projected ~310
of them at PRESENT. They cannot be filtered away without discarding signal, and today they are shown
to a human once and then cease to exist.

## What the code does

`plan.ts:345` assembles every held finding and hands it to the PLAN stage's outputs as
`review_findings`, which `writeCheckpoint` persists to `.detent/state/PLAN.json`. The structured
record exists. What consumes it is `renderHeldFindings`, and — past `ADVICE_INLINE_MAX` —
`writeAdvice` spilling to `.detent/state/advice.md`. Both are Markdown for a person to read.

Nothing under `src/kernel/` reads either. The kernel's own `findings` are the diff review's, a
different population produced by a different role at a different stage. `attemptInputs` hands an
`IN_PROGRESS` session `{ ticket }` and nothing more.

So a finding that says `t-s07-004 depends on a contract no ticket provides` is shown to a human, who
has no way to know whether it is true, and is then invisible to the one process that would find out
by trying.

## Why the run phase is the right consumer

The human at PRESENT is being asked to adjudicate 310 findings with no way to know which matter. The
implement session finds out empirically: it either satisfies the ticket's acceptance criteria or its
gate goes red. That is information no amount of review at PRESENT can produce.

It also makes the volume self-limiting without suppressing anything. Most findings will never
escalate, because most will not block a gate. The ones that do are, by construction, the ones that
mattered — and they arrive attached to a concrete failure with a dossier, rather than as one line in
a wall of 310. Deferring is not hiding.

## The ladder already exists

    ["IN_PROGRESS", "GATE_RED", guard("resolveRed")]

    resolveRed:  blind_fix_attempts  == 0  ->  BLIND_FIX
                 research_sessions   == 0  ->  RESEARCH
                 informed_fix_attempts == 0 -> INFORMED_FIX
                 otherwise                 ->  NEEDS_HUMAN

Three budgeted rungs before a person is asked, one slot consumed per rung. A confirmed plan finding
needs no new machinery to get this treatment — it needs to be in the session's inputs when the gate
goes red, and to still be readable at each rung afterwards.

## The count that is already computed

`sampleReviewPlan` builds `seen` as a Map of finding key to read count, then collapses it to a
boolean:

```ts
((seen.get(key) ?? 0) >= threshold ? findings : seenOnce).push(f);
```

Six reads of arm 4's revised s07, by how often each distinct `(ticket, tag)` was seen:

    6/6   2 keys
    5/6   3
    4/6   4
    3/6   5
    2/6   0
    1/6   2      — excluded by 2-of-3 by construction

About half of what survives the filter reproduces five or six times out of six and half reproduces
three or four. Those are different strengths of evidence and the integer that separates them is
thrown away one line after it is computed.

## Evidence

- D-29 and D-30 in `~/.detent-run-logs/ksar-run-issues.md`.
- `dfe9297`, `23d99a5` — PRDR-269's null and PRDR-270's reporting fix.
- `scripts/null-review.ts --root <copy> --slices s07 --together --runs 3`, 3 sessions, $8.60.
