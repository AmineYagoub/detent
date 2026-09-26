---
id: PRDR-284
title: "A written pack still carries the defects reading misses, and fixing them introduces new ones: ksarjs needed seven rounds, and with no stop rule the loop ran until the operator asked why. VALIDATE runs the checker, then review rounds by area, until a round finds no blocker and no major, under a ceiling that hands what is left to the operator"
state: OPEN
severity: major
category: capability
labels: ["prd-review", "specification-phase", "operator-decision", "X-1⁵", "ceiling", "AWAIT_INFO"]
surface: ["src/init/validate.ts", "src/init/validate-round.ts", "src/init/pipeline.ts", "src/init/plan-slices.ts", "src/kernel/ledger.ts", "src/schemas/budgets.ts", "src/schemas/init.ts", "src/schemas/roles.ts", "prompts/spec_review.md", "prompts/manifest.json", "tests/init/validate.test.ts"]
prd_refs: ["C-2¹⁰", "C-3′", "C-5", "X-1⁵", "PRDR-191", "PRDR-265", "PRDR-278", "PRDR-279", "PRDR-280", "PRDR-283"]
acceptance_criteria: ["The checker runs first, and a red checker is fixed before any review round starts.", "A round runs one reviewer per area of the pack. Each finding carries its severity (blocker, major or minor), its `file:line`, a quote and the exact fix. A writer applies the round's findings, and the next round verifies those fixes and looks for the defects they introduced.", "Stop rule: a round with no blocker and no major ends the loop, and its minor findings are fixed without another round (decision 3). A test with scripted reviewers asserts that the loop ends on the first such round and launches nothing after it.", "Ceiling: `spec_validation_rounds` (default 8, decision 13) bounds the loop, as a ceiling and never a retry. At the ceiling the last round's majors reach PRESENT as recorded risks, listed beside the defaults, and planning goes on. A blocker stops `init` at VALIDATE with AWAIT_INFO, and `detent init` resumes VALIDATE once the operator settles it.", "The conformance record gets every round's counts by severity and the findings left open (PRDR-279).", "Progress: each completed specification phase and each completed round calls the progress mark `src/init/plan-slices.ts` calls after a slice's checkpoint (X-1⁵). The doc-block there that calls a slice's write the only thing that resets the no-progress breaker is corrected in the same change.", "A re-validation after an edit or an amendment is scoped to the changed documents and whatever cites them (plan §4.3).", "On a pack DISCOVER classifies as conforming (PRDR-279, C-2⁹), AUDIT, DECIDE and WRITE do not run, and VALIDATE runs only the checker (decision 6). A test drives a fixture pack down that path and asserts that no specification session is launched. Moved here from PRDR-279 on 2026-09-26: until this ticket lands, no specification session exists to launch, so the test could not fail.", "VALIDATE's reviewers run as the `spec_review` role, read-only plus PRDR-285's sandbox, and its fixes as `spec_write` (decision 15), all routed to `claude-opus-5-5` at `max` (decision 14).", "A red checker blocks every phase after VALIDATE, under either driver: with a blocking finding left, DETERMINE_VERIFICATION, SLICE and PLAN do not run. A test drives a pack whose checker stays red and asserts that none of them starts. Moved here from PRDR-280 on 2026-09-26: until VALIDATE exists, nothing runs after it to block.", "The checker's heuristic reports (its findings with `blocks: false`, the present-indicative rule's, C-2¹⁰) reach VALIDATE's reviewers with the pack, marked as a heuristic's, and never stop the loop on their own. Moved here from PRDR-280 on 2026-09-26, for the same reason.", "VALIDATE's last step discovers the pack with DISCOVER's recorded patterns (PRDR-166) and hands the checker's parse of it to the planning phases (PRDR-290). No phase runs twice under one name (F-4). Moved here from PRDR-283, whose WRITE makes this handoff until VALIDATE is built."]
non_goals: ["Does NOT run code; simulations are PRDR-285's.", "Does NOT fix a list of areas. The areas come from the pack's modules; ksarjs's five are an example, not a default.", "Does NOT stop for spend. The breaker announces, as PRDR-265 made it."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-191", "PRDR-265", "PRDR-285"]
depends_on: ["PRDR-280", "PRDR-283"]
---

# PRDR-284 — VALIDATE

## Where this came from

The ksarjs validation. The first round ran five adversarial reviewers, one per area: money and
orders; identity, security and surfaces; catalog, shipping, search and analytics; plugins and
notifications; facts and design consistency. Verification passes over each round's fixes
followed, seven rounds in all. Each round's fixes introduced new, smaller defects. After six
rounds the operator asked why the work was still running, and the seventh found only minor
defects. The briefs are kept as `~/ksar-spec-tools/review-brief.md` and `verify6-brief.md`.

## Problem

A loop that reviews until clean does not end on its own, because fixes introduce defects. One
that stops at a fixed count stops wherever it happens to be. The loop needs a rule, and a
ceiling for when the rule is not met.

## Design

The plan's §7. The ceiling's default, 8 (decision 13), sits above ksarjs's seven. A ceiling of 6
would have stopped on round 6's three majors, fixed but never verified:
- a forfeiture that swept the vendor's fees with its earnings;
- a re-refund that charged the vendor on a platform-liable loss;
- an invitation that let the next holder of an email address take over a vendor account.

Today a slice's checkpoint write is the only progress mark in `init`. Without marks of its own, a
healthy specification phase would have the no-progress breaker announcing throughout it.

## From PRDR-281

AUDIT does not audit a changed pack (C-2¹¹), and until VALIDATE exists nothing re-validates one:
it goes to planning unaudited, and AUDIT's note says "this build has no VALIDATE". That note, in
`auditPhase` in `src/init/audit.ts`, and the module's doc-block become false the day VALIDATE lands.

## From PRDR-282

`INTERRUPT_PHASE` is now a list of phases per interrupt, and the machine refuses an interrupt
raised at a phase its list does not name (C-2¹²). VALIDATE's AWAIT_INFO for a blocker at the
ceiling needs VALIDATE added to `AWAIT_INFO`'s list in `src/schemas/init.ts`, or the machine throws.
DECIDE's note on a changed pack names VALIDATE as unbuilt (`decidePhase` in `src/init/decide.ts`),
and becomes false the day it lands.

## From PRDR-283

WRITE is built (C-2¹³), and five things in it are VALIDATE's to extend or change:

- **The record.** `docs/conformance.json` gains `validated`, required. WRITE writes it `false`
  (`apply` in `src/init/write.ts`); VALIDATE writes `true` when it finishes, through
  `conformanceRecord(root, { …, validated: true })` in `src/init/pack.ts`.
- **A written pack.** DISCOVER classifies a pack whose record is not validated as `written`, with
  the checker's blocking count, whatever changed in it since (`classifyPack`). VALIDATE runs on a
  written pack, the whole of it, as it runs on a changed pack's change. WRITE, AUDIT and DECIDE
  skip both, and their notes name VALIDATE as not built: `skipNote` in `src/init/write.ts`,
  `packNote` in `src/init/pack.ts`, and the notes in `auditPhase` and `decidePhase`. Each becomes
  false the day this lands.
- **A red checker.** WRITE relaunches its session once on a blocking finding and then records the
  checker red, and planning goes on: nothing blocks on red until VALIDATE fixes the checker
  before its first round (C-2⁶).
- **The chain.** WRITE restarts C-8's chain (`restartsChain`) and is keyed after it runs. VALIDATE,
  after it, writes the pack its own digest would read, so it is keyed after it runs too; either it
  chains from WRITE's key, or it restarts the chain itself, in which case WRITE's key must stop
  reaching the planning phases. C-8″'s scan resumes at a phase that restarts the chain, and the
  second ask is made before it runs (`replansAt` in `src/init/replan-guard.ts`).
- **The handoff.** WRITE hands the planning phases what DISCOVER's patterns find, the log among
  them, with the stack markers and the log's entries: `planningDocs` in `src/init/decide.ts`,
  `planningMarkers` in `src/init/write.ts`, and PRESENT's `logged` read WRITE's outputs first.
  The criterion added above moves that handoff to VALIDATE's last step. A planning digest must
  read only the handing phase's outputs and the disk, or the scan, which cannot read DISCOVER's
  outputs after its re-run, reads every re-init as a re-plan.
