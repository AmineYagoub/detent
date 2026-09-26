---
id: PRDR-281
title: "Contradictions inside the documents and wrong external facts reach planning unexamined. ksarjs's raw PRD put negotiation both in the MVP and in phase 2, and never knew that Medusa 2.21's store routes drop a linked field unless it is allow-listed. An AUDIT phase finds contradictions and gaps, checks each external claim against a primary source at the pinned version, and, in an existing project, checks the documents against the code"
state: OPEN
severity: major
category: capability
labels: ["prd-review", "specification-phase", "operator-decision", "C-3″", "research"]
surface: ["src/init/audit.ts", "src/init/pipeline.ts", "src/init/machine.ts", "src/schemas/init.ts", "src/schemas/roles.ts", "prompts/research.md", "prompts/manifest.json", "tests/init/audit.test.ts"]
prd_refs: ["C-3″", "C-3a", "F-4", "S-1′", "X-1⁵", "PRDR-119", "PRDR-278"]
acceptance_criteria: ["AUDIT runs after DISCOVER on a document set that is not a conforming pack. Its checkpoint lists contradictions, each with both passages quoted at their `file:line`; gaps; and external claims.", "Each external claim carries its source (a link, or a dependency path at the pinned version) and a verdict: confirmed, wrong or unverified. An unverified claim is never recorded as a fact.", "In an existing project, the documents are also checked against the code, and a document that states as built what the code does not do is a finding.", "Its sessions are read-only (S-1′). Network access follows the research role's rules.", "Its checkpoint is keyed by the discovered documents and the code, never by the decision log, so answering DECIDE's questions never re-runs AUDIT.", "A completed AUDIT is a progress mark for the no-progress breaker (X-1⁵, PRDR-284).", "A test drives AUDIT with a stub session over a two-document fixture that contradicts itself, and asserts that both passages reach the checkpoint."]
non_goals: ["Does NOT decide anything; DECIDE does (PRDR-282).", "Does NOT settle whether AUDIT reuses the research role or gets its own. That is an open question in the plan's §10, and this ticket records the choice once it is made.", "Does NOT run on a conforming pack (decision 6)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-282", "PRDR-266"]
depends_on: ["PRDR-278"]
---

# PRDR-281 — AUDIT

## Where this came from

The ksarjs audit was the first step, and the cheapest place a defect was found. It found
contradictions inside the raw PRD. Negotiation was in the MVP according to the summary, the
endpoint list and an acceptance test, and in phase 2 according to the roadmap and the modules
table. It also found facts the PRD never knew: since Medusa 2.21.0, store routes drop a linked
field unless it is allow-listed, so a product's vendor would silently vanish from responses.
Every fact went into `research/verified-facts.md` with its source.

## Problem

ANALYZE reads the documents to plan from them, not to doubt them. A contradiction becomes an
assumption (C-3″), and an external claim is taken as written. Neither is looked at again until
a session meets it.

## Design

The plan's §3. AUDIT's checkpoint is the input DECIDE works from: every contradiction becomes a
question or a default there, and every external claim goes into the facts file with its verdict.
In an existing project, AUDIT is also where the documents meet the code already built.
