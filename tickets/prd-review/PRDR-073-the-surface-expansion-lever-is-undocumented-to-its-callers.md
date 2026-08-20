---
id: PRDR-073
title: "The surface-expansion lever is undocumented to its callers"
state: DONE
severity: minor
category: consistency
labels: ["prd-review", "found-by-execution"]
surface: ["prompts/implement.md"]
prd_refs: ["SEC-3", "C-12", "X-4"]
acceptance_criteria:
  - "The implement prompt names the request file's exact JSON shape ({path, justification})."
  - "The prompt states when the grant lands (after the session) so workers end normally instead of falsifying over scope alone."
  - "The canary contract is untouched: protected paths still deny, the grant budget stays three, and the fix prompts still forbid widening."
non_goals:
  - "No new grant semantics — the kernel's handleSurfaceRequest is correct and tested (T-046); only its callers were blind."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-068"]
depends_on: []
---

# PRDR-073 — the surface-expansion lever is undocumented to its callers

**Severity:** minor · **Category:** consistency · **Found by:** T-140's live run — two
scope-canary escalations in one firing.

## Problem

Two live workers hit criteria requiring files outside their surface (t-112's README
golden path; t-113's scrub/env fixtures). Both did the right thing — refused to widen
silently, tried the lever or escalated — but the lever requests arrived with an empty
`path`: the prompt says "raise the surface-expansion request at the path given in your
inputs with a one-line justification" and never names the JSON keys the kernel parses.
`handleSurfaceRequest` denies empty targets by design, so every request from a
schema-blind worker dies as `surface DENIED:  (...)`, and legitimate expansions become
human stops.

## Resolution

The implement prompt now names the exact shape — `{"path": "<one file or glob>",
"justification": "<one line>"}` — and when the grant lands (after the session, next
session sees the widened surface), so workers end normally instead of falsifying over
scope alone. The fix prompts keep forbidding widening; protected paths and the
three-grant budget stand. SEC-3's canary outcome is unchanged: deny-or-escalate,
never silent widening — the fix only makes the escalation lever reachable.
