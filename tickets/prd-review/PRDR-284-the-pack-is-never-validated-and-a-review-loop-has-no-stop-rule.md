---
id: PRDR-284
title: "A written pack still carries the defects reading misses, and fixing them introduces new ones: ksarjs needed seven rounds, and with no stop rule the loop ran until the operator asked why. VALIDATE runs the checker, then review rounds by area, until a round finds no blocker and no major, under a ceiling that hands what is left to the operator"
state: OPEN
severity: major
category: capability
labels: ["prd-review", "specification-phase", "operator-decision", "X-1⁵", "ceiling", "AWAIT_INFO"]
surface: ["src/init/validate.ts", "src/init/validate-round.ts", "src/init/pipeline.ts", "src/init/plan-slices.ts", "src/kernel/ledger.ts", "src/schemas/budgets.ts", "src/schemas/init.ts", "src/schemas/roles.ts", "prompts/spec_review.md", "prompts/manifest.json", "tests/init/validate.test.ts"]
prd_refs: ["C-3′", "C-5", "X-1⁵", "PRDR-191", "PRDR-265", "PRDR-278", "PRDR-279", "PRDR-280", "PRDR-283"]
acceptance_criteria: ["The checker runs first, and a red checker is fixed before any review round starts.", "A round runs one reviewer per area of the pack. Each finding carries its severity (blocker, major or minor), its `file:line`, a quote and the exact fix. A writer applies the round's findings, and the next round verifies those fixes and looks for the defects they introduced.", "Stop rule: a round with no blocker and no major ends the loop, and its minor findings are fixed without another round (decision 3). A test with scripted reviewers asserts that the loop ends on the first such round and launches nothing after it.", "Ceiling: `spec_validation_rounds` (default 8, decision 13) bounds the loop, as a ceiling and never a retry. At the ceiling the last round's majors reach PRESENT as recorded risks, listed beside the defaults, and planning goes on. A blocker stops `init` at VALIDATE with AWAIT_INFO, and `detent init` resumes VALIDATE once the operator settles it.", "The conformance record gets every round's counts by severity and the findings left open (PRDR-279).", "Progress: each completed specification phase and each completed round calls the progress mark `src/init/plan-slices.ts` calls after a slice's checkpoint (X-1⁵). The doc-block there that calls a slice's write the only thing that resets the no-progress breaker is corrected in the same change.", "A re-validation after an edit or an amendment is scoped to the changed documents and whatever cites them (plan §4.3).", "VALIDATE's reviewers run as the `spec_review` role, read-only plus PRDR-285's sandbox, and its fixes as `spec_write` (decision 15), all routed to `claude-opus-5-5` at `max` (decision 14)."]
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
