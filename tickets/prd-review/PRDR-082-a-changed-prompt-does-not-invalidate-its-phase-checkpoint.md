---
id: PRDR-082
title: "A changed prompt does not invalidate its phase checkpoint"
state: DONE
severity: major
category: consistency
labels: ["prd-review", "found-by-execution"]
surface: ["src/init/pipeline.ts"]
prd_refs: ["C-8", "F-4", "S-6", "P9"]
acceptance_criteria:
  - "ANALYZE and PLAN fold the planner prompt's S-6 hash into their C-8 digest, so a prompt change re-derives them."
  - "The invalidation is per-role, not global: an unrelated role's prompt change does not re-run planning."
  - "A test pins the property — same inputs plus a different planner hash yields a different digest."
non_goals:
  - "No new state and no config: the hash already exists in the S-6 manifest the pipeline already carries."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-081"]
depends_on: []
---

# PRDR-082 — a changed prompt does not invalidate its phase checkpoint

**Severity:** major · **Category:** consistency · **Found by:** shipping PRDR-081 and
watching it do nothing.

## Problem

P9 says stale state is unconsumable and C-8 content-addresses every checkpoint to its
inputs. But a phase's inputs were read as *the user's* inputs only — documents, bindings,
prior outputs. The **prompt that reasons over them** was not among them. So immediately
after PRDR-081 taught the planner to size tickets against the session budget, a
`detent init --replan` on the project that motivated the fix replayed its old plan
verbatim: `reused: … PLAN`. The new behaviour was real, committed, and unreachable.

`--replan` does not help — it lifts C-8's approved-plan guard so the pipeline may
proceed, then each phase consults its own unchanged digest. The failure is silent and
survives upgrades: every existing project keeps planning by the old rules forever, and
the only workaround is deleting checkpoint files by hand.

PREPARE_AGENTS already had this right — its digest folds `prompts.hashes`, which is why
it alone re-ran. The precedent existed one function away.

## Resolution

ANALYZE and PLAN fold `prompts.hashes.planner` — the S-6 pinned hash the pipeline
already carries — into their digests, joining the doc contents, the analysis and the
bindings as the inputs that actually determine the output. Per-role, not the whole
manifest: a review-prompt change must not re-derive a plan. No new state, no config, no
schema change; a prompt edit now invalidates exactly the phases that prompt drives.
