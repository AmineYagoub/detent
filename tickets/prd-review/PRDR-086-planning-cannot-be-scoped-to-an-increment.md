---
id: PRDR-086
title: "Planning cannot be scoped to an increment"
state: DONE
severity: major
category: gap
labels: ["prd-review", "found-by-execution"]
surface: ["src/kernel/worstcase.ts", "src/init/pipeline.ts", "src/cli/init.ts"]
prd_refs: ["C-2", "C-8", "C-4"]
acceptance_criteria:
  - "`config.plan_docs` narrows C-2 discovery to the documents this increment plans from."
  - "Empty (the default) keeps the full discovery — unchanged behaviour for projects one plan can hold."
  - "Narrowing changes DISCOVER's listing digest, so the next init re-derives against the new scope."
non_goals:
  - "No new interrupt and no new command: this is configuration, like `protected` and `risk`, not a sixth decision."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-081", "PRDR-085"]
depends_on: []
---

# PRDR-086 — planning cannot be scoped to an increment

**Severity:** major · **Category:** gap · **Found by:** trying to replan a large product
one slice at a time, which the README promises and the pipeline could not do.

## Problem

C-2 discovers planning documents by family, and `docs/**/*.md` takes the whole tree.
For a product one plan can hold, that is exactly right. For a large one it is a trap:
the README documents planning "increment by increment", and PRDR-085 made `--replan`
re-derive properly — but every replan rediscovered all 27 documents of the motivating
project and tried to plan the entire platform again, which is the failure that produced
no draft artifact at all.

Writing a scoped slice document does not help: it lands in `docs/`, joins the other 27,
and the planner reads all of them. The only workarounds were moving the rest of the
user's documentation out of its own `docs/` tree, or hand-editing tickets afterwards.
The workflow the product recommends had no mechanism behind it.

## Resolution

`config.plan_docs` — a glob list naming the documents the current increment plans from,
sitting beside `protected` and `risk` as project configuration rather than a new
decision or command. Empty (the default) preserves today's full discovery exactly.
When set, it replaces the C-2 family patterns for DISCOVER, so ANALYZE and PLAN see the
slice and nothing else; because DISCOVER's digest is a listing of what it found,
changing the scope re-derives the planning phases on the next init by the existing C-8
rule, with no special case.
