---
id: PRDR-184
title: "Adding .detent/state/** to the structural floor denied every init session its own artifact, and init has been dead at ANALYZE ever since"
state: DONE
severity: critical
category: defect
labels: ["prd-review", "found-by-live-run", "containment", "regression"]
surface: ["src/init/session.ts", "tests/init/stages.test.ts"]
prd_refs: ["SEC-3", "S-1′", "C-3"]
acceptance_criteria: ["An init session may write the artifact it exists to produce, and nothing else under the floor — asserted against the REAL guard with the REAL policy, not a mock.", "Every other file in `.detent/state/` stays immutable to the session: the other checkpoints, the run lock, the ledger, `.git`."]
non_goals: ["Does not remove `.detent/state/**` from the floor. PRDR-149 put it there correctly — it holds the checkpoints, the run lock and the containment files.", "Does not exempt the artifact's DIRECTORY. The file alone; a sibling checkpoint resolves outside it and falls through to the floor."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-149", "PRDR-180", "PRDR-182"]
depends_on: []
---

# PRDR-184 — the write init exists to make, denied by init's own floor

**Severity:** critical · **Category:** defect · **Found by:** the live gate run, and by nothing else

## Problem

`analysisPath(root)` is `.detent/state/analysis.json`. PRDR-149 added `.detent/state/**` to
`STRUCTURAL_PROTECTED` — correctly: it holds the checkpoints, the run lock and the containment
files. `guardToolUse` consults `protectedGlobs` **before** the surface, so from that commit the
per-request init policy — whose surface is exactly the artifact path — denied the one write the
session exists to make.

`detent init` has died at ANALYZE ever since:

```
init failed: ANALYZE produced no analysis artifact
```

The session itself said so, in its own last words before the run collapsed:

> *"Say the word and I'll print the full artifact JSON for manual placement, or re-run the write
> once the surface is corrected."*

It did the analysis — eleven turns, $1.69, a coherent reading of the PRD — and could not write it
down.

## Why no test caught it

Every init test drives `MockBackend`, which writes artifacts with `fs` directly and never runs the
PreToolUse hook. PRDR-182 recorded that limitation in as many words two commits ago — *"whether the
two agree in a live session is a question only a live session answers"* — and this is the answer
arriving. The new test asks the real guard, with the policy the init arm actually publishes.

## The fix

`artifactRoot`, the mechanism PRDR-180 built for the kernel path, pointed at the FILE rather than
its directory: `path.relative(file, file)` is `""` so the exact path is allowed, while a sibling
resolves to `../PLAN.json` and falls through to the floor. The rest of `.detent/state/` — every
other checkpoint, the run lock — stays immutable to the session.
