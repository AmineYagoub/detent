---
id: PRDR-175
title: "Cross-driver parity was proven only on the all-green path, and the claim that closing the gap needed a harness build was false"
state: OPEN
severity: major
category: coverage
labels: ["prd-review", "found-by-audit", "coverage", "false-claim"]
surface: ["tests/plugin/parity.test.ts"]
prd_refs: ["ARCH-2", "X-1", "X-3"]
acceptance_criteria: ["ARCH-2 is asserted on the failure paths as well: a ticket that escalates to NEEDS_HUMAN, and a run that breaches its spend ceiling, produce byte-identical records from both drivers.", "The comparison covers the escalation DOSSIER, not only `transitions.jsonl` — the artifact a human actually reads is not in the journal.", "Both mutations that the audit and this ticket used are observed to fail."]
non_goals: ["Does not cover DRIFT_HALT cross-driver. The model driver's handler is exercised by no test still; it needs a drifted binding fixture and is named here rather than implied."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-140", "PRDR-174"]
depends_on: []
---

# PRDR-175 — the parity that only held when nothing went wrong

**Severity:** major · **Category:** coverage · **Found by:** the full-project audit of `0752fef`,
and the question "why was 5.4 not fixed?"

## Problem

The one model-driven-vs-headless comparison drove two tickets that both completed cleanly. The
model driver's BREACH, escalation and resume branches were exercised by no automated test at all:
planting a divergent BREACH-handler reason string left the whole suite green. That is the shape of
the historical PRDR-140 divergence — a ceiling one driver enforced and the other did not — which is
exactly the class parity exists to catch and exactly the class it could not see.

## The claim that was wrong

PRDR-174 recorded that closing this "needs the skill driver to execute its ladder rows against a
failing gate, which is a harness build rather than a test". That was carried forward from an
earlier commit and never checked against the code. `tests/plugin/skill-driver.ts` already
implements BREACH, DRIFT_HALT and resume in full — about fifty lines of complete handling. What was
missing was a caller passing it a failing script, and `modelDrive` hard-coding `GREEN_SCRIPT()` was
the only thing in the way. One parameter.

Recording a gap is the right move when a gap is real. Recording someone else's reason for it,
without reading the code, is how a false claim survives four commits.

## What the fix found

The escalation case initially passed while the model driver's `record dossier` call was deleted —
because the dossier lands in `runs/<id>/dossier.json` and the comparison stopped at
`transitions.jsonl`. A parity test that reads only the journal cannot see a driver that escalates
without writing the artifact the human reads. Both are compared now.
