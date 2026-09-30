---
id: PRDR-318
title: "The PRD has no rule for cutting cost or time without cutting quality. Tabachir's test init spent $833 before it was stopped in VALIDATE's first round, and finished on the current build it would cost about $1,500 and run about 27 hours. On 2026-09-30 the user asked for a strategy that cuts both without compromising quality, and decided that the whole project is checked and planned before anything is built, and that every role runs on Opus 5.5 or Sonnet 5.5. docs/plan-cost-strategy.md is the plan. N-6 forbids building it before the PRD says so, so this records it: D-35 in the decision log, and the rules PRDR-319 to PRDR-328 build, each under its family's next free mark"
state: DONE
severity: major
category: decision
labels: ["prd-review", "cost-strategy", "D-35", "user-decision", "N-6"]
surface: ["detent-prd-v3.md", "docs/plan-cost-strategy.md"]
prd_refs: ["N-6", "D-33", "D-34′", "S-5′", "S-5‴", "S-5⁵", "S-6", "S-6′", "X-8′", "X-1⁷", "C-2¹⁴", "C-2¹⁶", "C-2²³", "C-2²⁴", "N-5‴", "B-4′", "S-4⁵"]
acceptance_criteria: ["The decision log gains D-35: cost and time are cut only where the quality floor holds. D-35 lists the floor: code checks every artifact a session writes; every claim the triage sends to a check gets a session of its own; every VALIDATE round reviews every area in its scope, with the stop rule and the ceiling as they are, and a blocker is fixed and verified before anything plans from the pack; what is left open is shown to the user and never dropped; every ticket passes its gates and a review, and the user approves the plan; and the whole project is checked and planned before anything is built.", "D-35 separates the two kinds of lever. One that changes neither what a session is asked nor its model or effort is built directly and measured by the ledger. One that lowers a model or an effort level is adopted only after it passes the bar on the evaluation sets (N-8), and its result is recorded whether it passes or not.", "A dated block, placed before the first rule it changes, records the rules PRDR-319 to PRDR-328 build, one mark per rule and each its family's next free mark: S-5⁶, S-6″, X-8″, S-6‴, C-2²⁷, X-1⁸, N-5⁗, N-8, S-5⁷ and S-5⁸, or the next free marks when this lands. Each rule it amends ends with a pointer to the rule that amends it, as PRDR-278's block did.", "The block cites the user's three decisions of 2026-09-30 and docs/plan-cost-strategy.md. It says that until each ticket lands, the code does what the rules it amends describe.", "The block records the plan's four open questions as open: the measuring budget, existing configs, the bar when today's setup misses on a second run, and minor findings.", "The plan's status line names the marks the block gave. Nothing outside detent-prd-v3.md and docs/plan-cost-strategy.md changes, and tickets:check stays clean.", "Falsifying check, against HEAD: the decision log ends at D-34, and no rule names a per-session cache lifetime, claude-sonnet-5-5, or an evaluation bar."]
non_goals: ["Does NOT change any code, prompt, routing or config.", "Does NOT record a rule for narrower later VALIDATE rounds (the plan's §7). That needs a real second round first.", "Does NOT settle the plan's four open questions."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-278", "PRDR-317", "PRDR-319", "PRDR-320", "PRDR-321", "PRDR-322", "PRDR-323", "PRDR-324", "PRDR-325", "PRDR-326", "PRDR-327", "PRDR-328"]
depends_on: []
---

# PRDR-318 — the PRD records the cost and time strategy

## Where this came from

On 2026-09-30 the user said that Detent "takes a long time and consumes a vast number of tokens
far exceeding the capacity of 99% of users", and asked for "a balanced strategy that does not
compromise our concept of quality". The discussion settled three things:
- quality comes before cost, as the user had said for PRDR-317;
- the whole project is checked and planned before anything is built. Milestone-scoped `init` was
  proposed and refused: "A later milestone could conflict with something already built, I can't
  accept this.";
- every role runs on the newest models, Opus 5.5 and Sonnet 5.5.

`docs/plan-cost-strategy.md` is the plan, with the measurements it rests on.

## Problem

The PRD says how much each phase must check, and nowhere says what may be traded to make that
cheaper or faster. So every saving so far has been argued case by case. D-34's grouping of claim
checks looked like a saving and cost three wrong claims found (PRDR-317). A strategy that touches
routing, the cache, the writer, the session count and effort needs its rule written first, as N-6
requires.

## Design

**D-35, in the decision log.** Cost and time are cut only where the quality floor holds.
- The floor, as the plan's §2 lists it.
- Two kinds of lever:
  - one that changes neither what a session is asked nor its model or effort is built directly and
    measured by the ledger;
  - one that lowers a model or an effort level is adopted only after it passes the bar on the
    evaluation sets, and its result is recorded either way.
- Spend caps stay advisory (PRDR-191, PRDR-265), and an estimate never stops anything.

**The block**, one rule per ticket:

| Mark | Ticket | Rule |
|---|---|---|
| S-5⁶ | PRDR-319 | every role on Opus 5.5 or Sonnet 5.5; the SDK pin at 0.3.285; a routed model the runtime cannot serve is named; an existing config is told, not rewritten |
| S-6″ | PRDR-320 | the cache's lifetime is chosen per kind of session, from measured gaps |
| X-8″ | PRDR-321 | a usage limit costs no finished work: `run` waits for the stated reset, a stopped session resumes, and what it spent is recorded |
| S-6‴ | PRDR-322 | a round's reviewers share one cached prefix, if the review set passes with it |
| C-2²⁷ | PRDR-323 | the writer takes a place's findings together, most severe first |
| X-1⁸ | PRDR-324 | how many sessions `init` runs at once is a budget |
| N-5⁗ | PRDR-325 | estimates before costly steps, and progress in `detent status` |
| N-8 | PRDR-326 | the evaluation sets, their runner, and D-35's bar |
| S-5⁷ | PRDR-327 | a level or model moves below S-5⁶ only through a passing measurement, which the routing names |
| S-5⁸ | PRDR-328 | in `run`, risk sets where effort starts and evidence moves it, only up |

## Vetoable calls

1. **One block, before any code.** PRDR-278 did the same for the specification phase. The rules
   are independent enough to land one by one, but D-35 must come first, and one block keeps the
   marks together.
2. **The narrower later rounds are left out.** They are a Layer 3 question that needs a real
   round 2 to answer.
3. **The open questions stay open in the PRD.** The block names them, so no rule reads as settled
   when it is not.

4. **The block sits last among §4's dated entries, before the pipeline line.** AC 3 says "placed
   before the first rule it changes", and names PRDR-278's block as the model. That block was placed
   before the pipeline line it rewrote, and every block and entry since has been appended at the
   same place, so §4 reads in the order its rules were recorded. The earliest rule this block
   amends is B-4′, 3,400 lines earlier among 3.1.0's entries; putting a 2026-09-30 block there would
   break that order. B-4′ and the other thirteen amended rules each end with a pointer, so a reader
   who lands on one is sent here, which is what the placement was for.
5. **The first open question is recorded as settled.** AC 5 asked for the plan's four questions to
   be recorded as open. Before this landed, the user answered the first: "Evaluation budget is
   $500". The block records it as settled, with the date, and the other three as open. For each
   open one it states what holds meanwhile, each the reading that risks no quality: an existing
   config is told and not moved; no routing moves on a bar today's setup misses on a second run
   (PRDR-327's AC 6 says the same); and minors are still fixed.
6. **S-6‴'s check runs at the reviewers' routed level, not "at max".** PRDR-322's AC 5 says the
   review set is reviewed with the shared prefix "on Opus 5.5 at max". The rule says "at the level
   the reviewers are routed to": what becomes the default must pass at the level the default runs
   at, which is `max` unless S-5⁷ moves the reviews after a passing measurement. Where the two
   differ, PRDR-322 will say which it ran.
7. **"First runtime to serve Sonnet 5.5" is not claimed.** Only 2.1.280, 2.1.281, 2.1.284 and
   2.1.285 were read. S-5⁶ says what 0.3.280's and 0.3.285's runtimes serve; PRDR-319's table of
   first runtimes reads the versions between.
8. **No doc test.** AC 6 limits the change to the PRD and the plan. The falsifying check below is a
   script, kept in this ticket; each rule's own ticket adds the doc test that pins what it builds,
   as PRDR-319 does for S-5⁶ against `prd-specification-phase.test.ts`.

## What changed

- **`detent-prd-v3.md`.**
  - D-35 in the decision log: the floor, the two kinds of lever, caps advisory, and why.
  - A dated block after D-34′, before the pipeline line: its introduction (the three decisions,
    the plan, the tickets that build it, the open questions and what holds meanwhile), then S-5⁶,
    S-6″, X-8″, S-6‴, C-2²⁷, X-1⁸, N-5⁗, N-8, S-5⁷ and S-5⁸.
  - Sixteen forward pointers at the end of the fourteen rules they amend: B-4′ (S-5⁸), X-8′
    (X-8″), S-5′ and S-5‴ (S-5⁶), SEC-4′ (S-6″), S-4⁗ (S-5⁸), S-6′ (S-6‴), S-5⁵ (S-5⁶, S-5⁷,
    S-5⁸), N-5″ (N-5⁗), C-2¹⁴ (S-6‴), C-2¹⁶, C-2²³ and D-34′ (X-1⁸), C-2²⁴ (C-2²⁷). S-6 and X-1
    are v2's, which stays frozen; S-6″ and X-1⁸ name them.
- **`docs/plan-cost-strategy.md`.** The status line names the marks; the prerequisite is met;
  §5 and §10 record the $500 budget.

## Falsification

The check, run against HEAD `65bc380` (`git show HEAD:detent-prd-v3.md`):

    decision log's last row: D-34
    rules defined by PRDR-318: 0 of 10 {'S-5⁶': False, 'S-6″': False, 'X-8″': False, 'S-6‴': False, 'C-2²⁷': False, 'X-1⁸': False, 'N-5⁗': False, 'N-8': False, 'S-5⁷': False, 'S-5⁸': False}
    a rule names a per-session cache lifetime (CLAUDE_CODE_PROMPT_CACHE_TTL): False
    a rule names claude-sonnet-5-5: False
    a rule states an evaluation bar (N-8): False
    D-35 states the floor: False (no D-35)
    amended rules pointing forward: 0 of 16 ['B-4′→S-5⁸', 'X-8′→X-8″', 'S-5′→S-5⁶', 'S-5‴→S-5⁶', 'SEC-4′→S-6″', 'S-4⁗→S-5⁸', 'S-6′→S-6‴', 'S-5⁵→S-5⁶', 'S-5⁵→S-5⁷', 'S-5⁵→S-5⁸', 'N-5″→N-5⁗', 'C-2¹⁴→S-6‴', 'C-2¹⁶→X-1⁸', 'C-2²³→X-1⁸', 'C-2²⁴→C-2²⁷', 'D-34′→X-1⁸']
    the block cites the plan and the decisions: False
    the block says the code keeps the amended rules until each lands: False
    the block names the open questions: False

After the change every line reads the other way: D-35 is the last row, 10 of 10 rules are defined,
16 of 16 pointers are in place, and D-35 holds each clause of the floor.

The check reads a rule's text as `tests/docs/prd-marks.ts` does (its line, and each line after it up
to a blank line, the next bullet, a heading or a table row), so a pointer detached by a blank line
counts as missing.

## Mutation battery

Each mutant was applied to the PRD, the check and the two PRD doc tests were run, and the PRD was
restored from a copy taken before the battery (`cmp` confirmed it).

| Mutant | Result |
|---|---|
| M1 D-35 drops "what is left open is shown to the user and never dropped" | killed: the floor check names the missing clause |
| M2 C-2²⁷'s head reads C-2²⁶, which C-2²⁶ already defines | killed: `prd-requirement-ids.test.ts`, and 9 of 10 |
| M3 C-2²⁴ loses its pointer | killed: 15 of 16, `C-2²⁴→C-2²⁷` |
| M4 S-5⁵'s pointer states a role's routing in S-5⁵'s own form | killed: `prd-specification-phase.test.ts`, S-5⁵ no longer states the code's routing |
| M5 a blank line detaches S-5⁵'s three pointers | killed: 13 of 16 |
| M6 N-8 is deleted | killed: 9 of 10, no evaluation bar |

M4 is the one to remember when S-5⁶ lands: a pointer on S-5⁵ must not state a routing in the
`` `role`: `model` at `level` `` form, or S-5⁵'s test reads it as S-5⁵'s.

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: 193 files, 2,209 passed and 2 skipped (2,211).
- `npm run plugin`: wrote nothing that changed.

## Recorded, not fixed

- **Until each ticket lands, the PRD states rules the code does not follow.** The block says so, as
  PRDR-278's did, and each amended rule points to it. Each ticket's pointer or note records the
  build when it lands.
- **The three open questions.** Existing configs, the bar when today's setup misses on a second
  run, and minor findings stay the user's to decide.
