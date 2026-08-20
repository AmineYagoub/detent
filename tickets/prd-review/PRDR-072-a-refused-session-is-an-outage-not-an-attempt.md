---
id: PRDR-072
title: "A refused session is an outage, not an attempt — and stale artifacts must not impersonate fresh ones"
state: DONE
severity: major
category: consistency
labels: ["prd-review", "found-by-execution"]
surface: ["src/kernel/referee-session.ts", "src/kernel/referee-context.ts"]
prd_refs: ["P2", "D-6", "X-1", "B-5", "D-25"]
acceptance_criteria:
  - "A session result with crashed=true and zero turns halts the run with a SessionRefusal naming ticket, role, and the backend's tail — no gate runs on its behalf, no ladder slot burns as an 'attempt'."
  - "A crash WITH turns keeps PRDR-053 semantics: partial work exists, the tree is judged as-is."
  - "The ledger's honest $0 crashed row is still recorded before the halt."
  - "Every real launch deletes the stage artifact it expects the session to write; a no-write session yields 'no artifact', never the previous round's replayed verdict."
  - "The B-5 crashed-resume skip path keeps its artifact — judging what a half-done session left is that path's purpose."
non_goals:
  - "No retry loop inside the kernel: the operator (or CI) re-fires; the run's job is to stop honestly."
  - "Does not reclassify gate results: a gate that greens an unchanged tree is telling the truth about the tree — the lie was upstream, in counting a never-run session as an attempt."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-053", "PRDR-071"]
depends_on: []
---

# PRDR-072 — a refused session is an outage, not an attempt

**Severity:** major · **Category:** consistency · **Found by:** T-140's live run — a
mid-run usage-limit outage.

## Problem

Four consecutive sessions returned crashed/$0/zero-turn (the account's usage limit):
t-110's review_fix, t-111's implement, review_fix, and re-review. The machine marched
through all four: the gate re-greened the unchanged tree and the flow recorded a "fix
attempted" that never ran; a real reviewer then correctly judged t-111's never-run
implement as "nothing implemented"; and the refused re-review READ THE PREVIOUS
review.json and replayed it as a fresh verdict one second after launch. Both tickets
escalated to NEEDS_HUMAN with reasons that misattribute an infrastructure outage as
work-quality history, burning X-1 ladder slots along the way.

## Resolution

Two guarantees in the session arm. (1) crashed + zero turns = the backend refused the
session: record the honest $0 ledger row, then halt the run with a `SessionRefusal`
naming ticket, role, and cause — an outage is retryable by the operator, not
convertible into fake history. A crash with turns keeps PRDR-053's judge-the-tree
behavior. (2) Every real launch first deletes the artifact it expects the session to
write (`rmSync(artifactOut)`), so no-write sessions of any cause yield "no artifact"
breakers instead of replayed verdicts; the B-5 crashed-resume skip path deliberately
keeps its artifact. The ANALYZE/PLAN stages already derived fresh (PRDR-067
amendment); this closes the same hole for every worker and stage session.
