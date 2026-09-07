---
id: PRDR-155
title: "Detent will bind a gate that exits 0 having done nothing, and every ticket then goes green against it"
state: DONE
severity: major
category: gap
labels: ["prd-review", "found-by-audit"]
surface: ["src/adapter/bind.ts", "src/init/bind.ts", "detent-prd-v3.md"]
prd_refs: ["V-1", "V-1″", "P2", "A-1⁗"]
acceptance_criteria: ["A bound gate that verifies nothing is named to the operator at the moment the binding is chosen.", "It is evidence and not a refusal: a fast zero-exit command is ambiguous, and refusing it would make `init` unusable on the projects it should serve."]
non_goals: ["Does not refuse the binding.", "Does not attempt to detect semantic vacuity — V-6 covers that at review time, where a diff exists to revert."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-135", "PRDR-150", "PRDR-156"]
depends_on: []
---

# PRDR-155 — a gate that always passes makes P2 vacuous

**Severity:** major · **Category:** gap · **Found by:** generalising a monorepo-specific critical
from the 7 September audit rather than accepting its framing

## Problem

`bindSlot` refuses a command that will not terminate (watch mode) and one that cannot execute. A
command that exits 0 having done nothing is neither, so `"test": "echo no tests here"` binds as an
approved gate and passes for the life of the project. P2 says only exit codes count; a gate that
always exits 0 makes P2 vacuous. V-1″ closed the adjacent case of NO bound gate; this is the same
hole one step in.

## Outcome

Shipped in `19d68f7` and immediately found to be three defects at once by the audit of that commit
— unreachable, unscrubbed, and keyed on a signal that does not discriminate. **PRDR-156** carries
the correction; the rule itself stands.
