---
id: PRDR-318
title: "The PRD has no rule for cutting cost or time without cutting quality. Tabachir's test init spent $833 before it was stopped in VALIDATE's first round, and finished on the current build it would cost about $1,500 and run about 27 hours. On 2026-09-30 the user asked for a strategy that cuts both without compromising quality, and decided that the whole project is checked and planned before anything is built, and that every role runs on Opus 5.5 or Sonnet 5.5. docs/plan-cost-strategy.md is the plan. N-6 forbids building it before the PRD says so, so this records it: D-35 in the decision log, and the rules PRDR-319 to PRDR-328 build, each under its family's next free mark"
state: OPEN
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
