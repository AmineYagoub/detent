---
id: PRDR-304
title: "AUDIT checks its claims one at a time. Each external claim the survey finds gets a `verify_claim` session of its own, and `checkClaims` awaits each before launching the next, so tabachir's 132 claims, at about six minutes each on the audit role's routing, would take some thirteen hours before DECIDE could start. The claims are independent and each writes its own brief, so a bounded batch of them runs at once"
state: DONE
severity: major
category: capability
labels: ["prd-review", "specification-phase", "C-2¹¹", "D-28′", "live-run", "wall-clock"]
surface: ["src/init/audit-claims.ts", "src/init/audit.ts", "detent-prd-v3.md", "tests/init/audit-claims-batch.test.ts"]
prd_refs: ["C-2¹¹", "D-28′", "D-25", "X-1⁵", "PRDR-203"]
acceptance_criteria: ["AUDIT checks up to `AUDIT_CLAIM_BATCH` claims at once (four), and starts the next as each one ends, so the phase's wall clock is about the slowest of each batch rather than the sum of every claim.", "Each claim is still checked once, by its hash: two places that rely on one claim share one session and one verdict, and neither launches a second.", "The verdicts are recorded in the survey's order whatever order the sessions end in, so the checkpoint and what WRITE is given do not depend on scheduling.", "A cached brief is still answered without a session, and a claim no session could check is still recorded as unverified and unchecked; neither ends the phase.", "The PRD records the batch under C-2¹¹, and D-28′'s bound: the overshoot past a spend reading is at most one batch.", "Falsifying test: a backend that holds every session until released sees four in flight at once, never five, and the verdicts come back in the survey's order. Against HEAD it sees one. The ticket records the failure against HEAD."]
non_goals: ["Does NOT change what a claim session is given, its role, routing or prompt.", "Does NOT make the batch size a config key. It is a constant until a run-time outcome asks for more (D-33).", "Does NOT batch any other phase's sessions. VALIDATE's reviewers still run in sequence (C-2¹⁴)."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-203", "PRDR-281"]
depends_on: []
---

# PRDR-304 — AUDIT checks its claims one at a time

## Where this came from

The tabachir test run (2026-09-28, binary `f4f8da1`). AUDIT's survey of 23 documents found 25
contradictions, 35 gaps and 132 external claims: licences, Android and F-Droid behaviour, GitHub's,
domain registrations, Algerian law. Each claim is checked by a `verify_claim` session on the `audit`
role (S-5⁵: claude-opus-5-5 at `max`). The first took 17 turns and six minutes. The next began only
when it ended.

## Problem

`checkClaims` (`src/init/audit-claims.ts`) walks the survey's claims in a `for` loop and awaits each
check before the next. The claims are independent: each session is given one claim, writes one
brief to its own path under its own surface (S-1″), and its brief is committed under its hash.
PRDR-203 made a phase's launches safe to overlap (one journal per phase, the ledger re-read at each
launch), and D-28′ bounds what overlapping costs past a spend reading at one batch. Nothing
batches them, so AUDIT's wall clock is the sum of every claim's: about thirteen hours here before
DECIDE can ask a single question.

## Design

`checkClaims` groups the claims by hash, keeps the first place of each, and runs the checks through
a pool of `AUDIT_CLAIM_BATCH` workers that each take the next unchecked hash. The verdicts are
collected by hash and the output is built in the survey's order afterwards. Spend is still read at
each launch (D-25), and the no-progress breaker still counts a brief as a unit of work.

## Building it

`checkClaims` (`src/init/audit-claims.ts`) groups the survey's claims by hash, each group keeping
its first place's claim for the check and every place's index, and hands the groups to
`inBatches`: `AUDIT_CLAIM_BATCH` workers (four) that each take the next group as the last one they
took ends. A worker's verdict is written to every place of its group by index, so the output is in
the survey's order whatever order the checks end in, and nothing reads a verdict back out of a map.
A check that throws stops the taking: each worker finishes the check it has and takes no other,
and when all have ended the first failure is raised. `check` itself is unchanged: the cache read,
the one relaunch, the brief's commit and the progress mark all happen per claim, as before.

What had to hold first did hold. `launchInitSession` reads spend at launch and appends ledger rows
and journal events with `appendFileSync`, and the phase's launches share its one journal
(PRDR-203); `noteUnitComplete` and `writeArtifact` are synchronous; the SDK backend keeps no
per-session state on the instance but the unavailable-model map. So nothing a check writes can
interleave with another's.

The PRD records it as C-2¹⁶, with amendment lines on C-2¹¹, on D-28′ (which bounds it), and on
S-6′ and C-4⁗⁵, whose notes gave "no launch is batched" as their reason. `audit.ts`'s doc-block and
the README's AUDIT line say four at a time.

### Vetoable calls

1. **Four.** A constant, not a config key, until a run-time outcome asks for another (D-33). The
   spend is the same at any size; only the wall clock changes, and a larger batch meets a usage
   limit sooner. Four takes tabachir's 132 claims from about thirteen hours to about three and a
   half.
2. **Dedupe before scheduling**, rather than one shared promise per hash: a place waiting on
   another's check would hold a worker and run fewer than four sessions.
3. **A failure lets the batch finish.** The backend has no abort seam, and aborting would throw
   away work already paid for; letting it end commits its briefs, so a re-run pays for none of
   them again. The checks not yet started stay unstarted.
4. **The first failure is the one raised.** A second failure in the same batch is still journaled
   by its session's `end` event, and is not said.
5. **No stagger.** The first four launch together, so none of them reads a prompt cache another
   wrote. C-4⁗⁵'s first-response signal was deleted by PRDR-298, and the checks after the first
   batch start as others end, with the cache warm. The first batch's cost is not measured here.
6. **Tested through the real pipeline**, on a backend that holds every claim session until none
   has started for 10 ms and then ends the held ones last-first. That shows the whole path
   (`audit.ts`, `launchInitSession`, the journal and the ledger) running four at once, rather than
   `checkClaims` alone.
7. **The progress-mark test's premise was the sequence.** "The second check starts from the first
   one's brief" held only because the checks ran one at a time. It now runs one claim more than a
   batch, and the last check starts from a brief an earlier one wrote. It still kills the mutant
   that drops the per-brief mark.
8. **A duplicate's check is given its first place's passage.** The sequential loop did this
   without saying so. The new test pins it.

## Falsification

Against HEAD (`f4f8da1`), in a `git archive` with the new test copied in:

```
× checks four claims at once and never five, and starts the next as each one ends
  → expected 1 to be 4
✓ records the verdicts in the survey's order whatever order they end in, and checks a claim relied on twice once
× fails the phase for a session that failed, once every check in flight has ended with its brief committed, and starts no other
  → the failure met a whole batch in flight: expected 1 to be undefined
```

HEAD holds one claim session at a time. The order-and-dedupe test passes against HEAD, since the
sequential loop kept both, and it guards the batch: it kills the mutants that record verdicts in
completion order, check a claim twice, or check it as its last place states it (below). With the
fix, all three pass, and `tests/init/audit.test.ts` passes 31 of 31 once its progress-mark test is
reworked (vetoable call 7).

## Mutation battery

Ten mutants of `src/init/audit-claims.ts`, each against `tests/init/audit-claims-batch.test.ts` and
`tests/init/audit.test.ts`, restored from a snapshot copy after each (byte-identical after the last):

| Mutant | Result |
|---|---|
| M1 batch of one | killed: four in flight |
| M2 batch of five | killed: four in flight; the failure test |
| M3 no dedupe, a pool over places | killed: the dedupe test; PRDR-281's "checks a claim once" |
| M4 verdicts in completion order | killed: the order test |
| M5 the first failure rejects at once | killed: sessions still in flight when the phase failed |
| M6 a failure does not stop the taking | killed: every claim launched |
| M7 a failure swallowed | killed: the phase did not fail |
| M8 no progress mark per brief | killed: the reworked progress-mark test |
| M9 a duplicate checked as its last place states it | killed: the passage pin |
| M10 as many workers as claims | killed: four in flight; the failure test; the progress-mark test |

10 of 10 killed.

## Gates

- `npm run lint`: pass.
- `npm run typecheck`: pass. The first run refused the new test's spread of a possibly-undefined
  element (TS7053); the element is typed `Json` now.
- `npm run parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: 187 files, 2,157 passed and 2 skipped (2,159).
- `npm run plugin`: wrote nothing that changed.

## Found along the way

- The live numbers behind the ticket, from tabachir's run on `f4f8da1`: the survey took 38 turns
  and $9.10, and the first three briefs landed about six minutes apart (17 turns and $1.40 for
  the first).

## Recorded, not fixed

- **A usage limit is waited out once per session in flight.** Each of the four sessions meets it
  and waits on its own, so the operator is told up to four times. The waits end at the same reset.
- **A kill mid-batch loses up to four sessions' spend** where it lost one: a session's ledger row
  is written when it ends (S-4). D-28′'s bound is one batch, and this is that bound.
- **The first batch's prompt-cache cost** (vetoable call 5) is unmeasured.
