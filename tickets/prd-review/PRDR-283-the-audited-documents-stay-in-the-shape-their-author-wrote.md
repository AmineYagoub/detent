---
id: PRDR-283
title: "An audited and decided document set is still in the shape its author wrote: requirements without ids, criteria without values, decisions in prose. WRITE produces the pack in the fixed schema, moves the originals to `archive/`, and hands the pack, not the originals, to what follows"
state: OPEN
severity: major
category: capability
labels: ["prd-review", "specification-phase", "operator-decision", "S-1′", "containment"]
surface: ["src/init/write-pack.ts", "src/init/pipeline.ts", "src/init/machine.ts", "src/init/discover-docs.ts", "src/init/session.ts", "src/schemas/roles.ts", "prompts/manifest.json", "tests/init/write-pack.test.ts"]
prd_refs: ["C-2‴", "C-2⁗", "F-4", "S-1′", "X-1⁵", "PRDR-166", "PRDR-278", "PRDR-279", "PRDR-282"]
acceptance_criteria: ["WRITE reads the documents, AUDIT's checkpoint and the decision log, and writes the pack in PRDR-279's schema. Every decision and default the pack relies on is cited by id where it is used.", "The originals move to `archive/`, which no discovery glob reaches. Nothing is deleted.", "The pack states nothing unbuilt in the present indicative. Requirements use MUST and SHOULD.", "VALIDATE's last step discovers the pack with DISCOVER's recorded patterns (PRDR-166) and hands the checker's parse of it to the planning phases (PRDR-290). No phase runs twice under one name (F-4).", "WRITE's session writes only the pack's paths and `archive/`. The containment hook enforces this, and the write surface is declared, as an implement session's is.", "A completed WRITE is a progress mark for the no-progress breaker (X-1⁵).", "A test drives WRITE with a stub session and asserts the move, the pack's shape, and that the next DISCOVER finds only the pack.", "WRITE's session runs as the `spec_write` role (decision 15), routed to `claude-opus-5-5` at `max` (decision 14)."]
non_goals: ["Does NOT validate; VALIDATE does (PRDR-284).", "Does NOT rewrite a conforming pack (decision 6).", "Does NOT touch the project's code."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-279", "PRDR-282", "PRDR-284"]
depends_on: ["PRDR-279", "PRDR-282"]
---

# PRDR-283 — WRITE, and handing the pack to planning

## Where this came from

The ksarjs writing step turned an audited PRD and 68 decisions into 13 module PRDs, design
documents, ADRs and a facts file. It moved the original PRD to `archive/ksar-PRD-original.md`,
so nothing would plan from it. The brief that drove it is kept as `~/ksar-spec-tools/prd-brief.md`.

## Problem

After AUDIT and DECIDE, the documents are still in their author's shape. PLAN can only trace
what has an id, and review can only check a criterion that states values.

## Design

The plan's §3 and §4. Checkpoints are keyed by phase name (F-4), so DISCOVER cannot run a second
time. VALIDATE hands the planning phases the checker's parse of the pack, discovered with
DISCOVER's own recorded patterns, and a later `init` finds the conforming pack at DISCOVER.

WRITE is the first `init` session that writes documents. S-1′ gives `init` sessions a read-only
surface plus one write rule, so the pack's paths become a declared write surface, enforced by
the hook.
