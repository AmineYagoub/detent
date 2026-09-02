---
id: PRDR-110
title: "Dry research routes straight to a human — eight of nine research sessions on the gate, each cleared by a requeue that added nothing"
state: READY
severity: major
category: decision
labels: ["prd-review", "user-raised", "found-by-execution"]
surface: ["src/kernel/machine.ts", "prompts/informed_fix.md", "detent-prd-v3.md"]
prd_refs: ["X-2", "X-3", "D-13", "X-6"]
acceptance_criteria: ["`RESEARCH_DRY` enters `INFORMED_FIX` through the same guard `RESEARCH_VALID` uses, consuming the informed slot; the ladder still cannot reopen after it (D-13).", "The informed-fix prompt says what an absent brief means — no external cause found — and what to do with that.", "The worst-case figure does not grow: the informed entry was already on the worst path."]
non_goals: ["Does not change what makes research dry, nor X-6's cache.", "Does not add a second blind fix. The informed slot is the one that exists; dry research is the information it carries."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-107", "PRDR-108", "PRDR-109"]
depends_on: []
---

# PRDR-110 — dry research buys the informed attempt

**Severity:** major · **Category:** decision · **Raised by:** the user · **Found by:**
`RESEARCH_DRY → NEEDS_HUMAN` eight times on the certification gate

## The measurement

The ladder is blind fix → research → informed fix → human. Research ran nine times on the
gate and was dry eight times: no external cause, nothing to cite. Dry is a direct table
edge to `NEEDS_HUMAN`, so `INFORMED_FIX` ran once all gate, and eight red gates became
stops a person cleared by requeueing with nothing new to say.

A dry brief is not the absence of information. It says the cause is inside the ticket's own
change — which is the most useful thing the next fix session can know.

## Resolution

One table row: `["RESEARCH", "RESEARCH_DRY", guard("enterInformed")]`. The informed prompt
gains a sentence for the absent-brief case. D-13 holds: the informed attempt's red gate is
still a direct edge to a human. The worst path already went through `INFORMED_FIX` via the
valid edge, so the computed figure is unchanged by this ticket.
