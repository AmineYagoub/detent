---
id: PRDR-290
title: "ANALYZE turns a validated pack back into prose: a 24K-character summary that SLICE and PLAN must re-read, and a greenfield stack chosen by a model where the founder's decision log should hold it. The operator's decision: the phase is removed, `greenfield` stays code's, the stack becomes a DECIDE decision the pack carries, and the pack's parse replaces the summary"
state: OPEN
severity: major
category: capability
labels: ["prd-review", "planning-redesign", "operator-decision", "D-10", "F-3"]
surface: ["src/init/analyze.ts", "src/init/pipeline.ts", "src/init/machine.ts", "src/init/bind.ts", "src/schemas/init.ts", "src/init/decide.ts", "detent-prd-v3.md", "tests/init/stages.test.ts", "tests/init/fold-analyze.test.ts"]
prd_refs: ["D-10", "C-3", "C-3′", "C-3b", "F-3", "F-4", "PRDR-115", "PRDR-278", "PRDR-282"]
acceptance_criteria: ["`INIT_PHASES` no longer holds ANALYZE. Checkpoints written under the old list are read under F-3's rule, and an `init` resumed from an ANALYZE checkpoint re-runs from DECIDE and says why.", "`greenfield` is computed by code from the stack markers, as `isGreenfield` does now, and reaches DETERMINE_VERIFICATION, SLICE and PLAN without a model session.", "In greenfield, DECIDE records the stack as a decision (asked when C-3″ applies, a vetoable `X-n` otherwise) in a structured entry: the language, the toolchain, the documented gate command for each slot, and the scaffold files. DETERMINE_VERIFICATION binds from that entry, and documented commands remain the bindings (PRDR-115).", "A greenfield pack with no stack entry fails the checker (PRDR-279's schema), and the failure names the missing entry.", "D-10's order names DECIDE where it named ANALYZE, and keeps its reason: nothing binds before a stack exists.", "SLICE and PLAN receive the checker's parse of the pack instead of `analysis`, and no phase reads `outputs.ANALYZE`."]
non_goals: ["Does NOT change how an existing project's stack is found: it is still read from the repository.", "Does NOT move ANALYZE's questions anywhere new; DECIDE already owns them (PRDR-282).", "Does NOT delete the research engine; AUDIT reuses it (PRDR-298)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-282", "PRDR-115"]
depends_on: ["PRDR-278", "PRDR-282"]
---

# PRDR-290 — ANALYZE folds into DECIDE

## Where this came from

The planning audit of 2026-09-26 (`docs/planning-phase-audit-2026-09-26.md`), and the operator's
decision 5 in `docs/plan-planning-redesign.md`.

## Problem

ANALYZE hands later phases three things (`src/init/pipeline.ts:249-325`):
- `greenfield`, which code already computes (`isGreenfield`, `src/init/analyze.ts:45`);
- in greenfield, the stack with its scaffold files, which `bind.ts` turns into bindings;
- `analysis`, a prose summary of about 24K characters that SLICE and PLAN re-read.

Once the specification phase exists, the pack holds all of it in a better form. The stack is a
decision, and the founder's decision log is where decisions live. The summary is a model's
paraphrase of documents a checker has already parsed.

## Design

The redesign plan's §3. D-10's reason for putting analysis before verification survives: the stack
still exists before DETERMINE_VERIFICATION, because DECIDE precedes it.
