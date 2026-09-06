---
id: PRDR-125
title: "A 36-ticket slice emitted 176,391 output tokens in one session and that draft is where a session limit killed the run: the slice band belongs in configuration, and the planner belongs on Opus"
state: DONE
severity: normal
category: decision
labels: ["prd-review", "found-by-execution"]
surface: ["src/kernel/worstcase.ts", "src/init/slice.ts", "src/init/pipeline.ts", "src/cli/init.ts", "src/schemas/roles.ts", "prompts/planner.md", "detent-prd-v3.md"]
prd_refs: ["C-2‴", "S-5′", "X-1"]
acceptance_criteria: ["`slice_size` is configuration with a `{min, max}` band, defaulting to 12–18, refused at load when max is below min, and folded into SLICE's digest so changing it re-cuts the product.", "The SLICE instruction names the configured band and says why the ceiling matters — one slice is drafted by one session into one artifact — so tuning it needs no prompt edit.", "`DEFAULT_MODEL_ROUTING.planner` is `claude-opus-5`, and the routing the CLI announces says so."]
non_goals: ["Does not claim smaller slices are cheaper. Drafting is the same work; the review, revision and re-review around each slice are paid per slice, so the total goes up. What they buy is a failure you can afford.", "Does not change the other roles. Review, diagnose and the informed attempt were already on Opus; implement, the fixes and research stay on Sonnet.", "Does not enforce the band. `expected_tickets` remains planning judgement (A-1); the band is guidance the reviewer can fault under `sizing`."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-114", "PRDR-117", "PRDR-120"]
depends_on: []
---

# PRDR-125 — the slice band is configuration, and the planner runs on Opus

**Severity:** normal · **Category:** decision · **Found by:** the first self-build gate init on
the 3.1.1 line, 6 September 2026

## What happened

`s01` of the gate's plan held 36 tickets — the top of the prompt's stated 15–40 band — and its
draft session emitted **176,391 output tokens**, about 4,900 per ticket. That is not a
regression: a ticket now carries its `provides` and `consumes` with the notes a consumer is
bound by (A-1‴), and the notes are the feature. But the band's top was written before contracts
existed, and it was never re-measured after.

That draft is where the run died, on a plan session limit. It was the fourth death of this run
— after a session teardown, a reboot and a stray SIGTERM — and the first that was about size
rather than environment.

A slice is drafted by ONE session into ONE artifact (S-1″), so slice size is the size of the
largest thing this pipeline must ever produce without failing. That makes it a real operational
parameter, and it was a number inside a prompt.

## The trade, stated honestly

Smaller slices do not save money. The drafting is the same total work, and the review, revision
and re-review are paid per slice, so halving the slice size roughly doubles that overhead —
expect the total to rise. What they buy is a failure you can afford: half the tokens in the
largest session, and half the loss when one dies. On a run that has died four times, that is
worth more than the overhead costs.

## Resolution

`slice_size` becomes a `{min, max}` band in config, defaulting to 12–18, folded into SLICE's
digest so a changed band re-cuts the product. The instruction names the configured numbers and
says why the ceiling exists, so the planner can respect the reason rather than the digit, and
tuning needs no prompt edit.

The planner default moves to `claude-opus-5`. Fable was chosen on a probe (PRDR-114) and has
now been measured in earnest on real work; the operator's call is that it is not the right seat
for this role. Review, diagnose and the informed attempt were already there; the volume roles
stay on Sonnet.
