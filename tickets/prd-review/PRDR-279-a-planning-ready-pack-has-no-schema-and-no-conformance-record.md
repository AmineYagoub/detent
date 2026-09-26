---
id: PRDR-279
title: "Nothing defines a planning-ready document set, so neither `init` nor the operator can tell a pack that was specified and validated from a raw PRD, and a validated pack would be audited all over again. The pack gets a fixed schema and a committed conformance record, and a conforming pack goes through the checker only, straight to ANALYZE"
state: OPEN
severity: major
category: capability
labels: ["prd-review", "specification-phase", "operator-decision", "F-3", "traceability"]
surface: ["src/schemas/pack.ts", "src/init/pack.ts", "src/init/discover-docs.ts", "src/init/machine.ts", "src/schemas/init.ts", "prompts/planner.md", "prompts/manifest.json", "docs/release-checklist.md", "tests/init/pack.test.ts"]
prd_refs: ["C-2‴", "C-2⁗", "A-1", "F-3", "F-3′", "F-4", "PRDR-166", "PRDR-278"]
acceptance_criteria: ["The schema is written once, as a versioned zod schema under `src/schemas/`. It covers the layout and precedence (decisions, facts, design, ADRs, PRDs); the id grammar `<CODE>-F-<nnn>` and `<CODE>-N-<nnn>`, with registered codes and milestone tags; MUST and SHOULD wording; criteria in Given / When / Then with exact values; milestone order; and optional catalogues of error codes, events, settings, jobs and routes.", "The conformance record holds the schema version, a hash of the pack's documents excluding the record, the checker's result, every validation round with its counts by severity and the findings it left open, and the date. It is committed with the pack, at a path this ticket fixes.", "A pack conforms when its hash matches its documents and the checker is green. `init` on a conforming pack skips AUDIT, DECIDE and WRITE, and VALIDATE runs only the checker (decision 6). A test drives a fixture pack down that path and asserts that no specification session is launched.", "A pack whose documents no longer match the hash is re-validated for the change only (plan §4.3), and `init` names the documents that changed. It is never treated as a raw PRD.", "`archive/` is outside every discovery glob. An archived original is never planned from, and a test puts one there to prove it.", "Traceability: every ticket's `requirement_ids` resolve in the pack, checked when the plan is written, and the planner prompt carries each requirement's criterion ids into the ticket's acceptance criteria.", "The record and every new artifact are versioned persisted shapes under F-3, and release-checklist item 8 names them."]
non_goals: ["Does NOT implement the checker's rules; PRDR-280 does. This ticket fixes the schema they check and the record they write.", "Does NOT ask an operator to reshape documents by hand; WRITE produces the pack (PRDR-283).", "Does NOT make catalogues mandatory. A pack without one conforms, and the checker skips its rules."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-166", "PRDR-280", "PRDR-283"]
depends_on: ["PRDR-278"]
---

# PRDR-279 — the pack's schema and its conformance record

## Problem

`init` discovers whatever documents it finds (DISCOVER, PRDR-166) and treats every set the same
way. The specification phase has to know what it is looking at. A raw PRD is audited. A pack that
was already specified and validated is not. `~/ksar/docs` after its seven rounds is the example
(decision 6). Nothing defines the difference today, and nothing records that a validation
happened.

## Design

The plan's §4. The schema is the shape of the ksarjs pack, generalized: a decision log, a facts
file with a source for every fact, design documents, ADRs, and module PRDs whose requirements
and criteria have ids. Precedence settles every disagreement in favour of the higher document,
and the fix lands in the lower one.

The record makes "conforming" decidable: a hash that matches and a checker that is green, not a
person's say-so. An edit breaks the hash, and the pack is then re-validated for what changed,
not from scratch.
