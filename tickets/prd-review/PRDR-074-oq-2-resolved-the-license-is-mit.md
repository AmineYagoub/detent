---
id: PRDR-074
title: "OQ-2 resolved: the license is MIT"
state: DONE
severity: minor
category: decision
labels: ["prd-review", "user-decision"]
surface: ["detent-prd-v3.md", "LICENSE", "README.md"]
prd_refs: ["OQ-2", "N-6"]
acceptance_criteria:
  - "A LICENSE file at the repo root carries the MIT text with the author's copyright line."
  - "The v3 PRD records the resolution as a draft.6 delta; the frozen v2 document keeps OQ-2 as it stood."
  - "The README's License section names MIT and links the file."
non_goals:
  - "No CLA, no dual licensing, no per-file headers — MIT's single root file is the whole mechanism."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-074 — OQ-2 resolved: the license is MIT

**Severity:** minor · **Category:** decision · **Found by:** the user's call, 2026-08-20,
during T-141 publish preparation.

## Problem

v2 §16 posed **OQ-2** — "License: MIT vs Apache-2.0 (patent grant). Blocks M4 only" —
and the README shipped with "Not yet chosen." Publishing any channel (public repo,
community marketplace, claude.com listing) without a license blocks reuse and the
marketplace review itself.

## Resolution

**MIT**, chosen by the user. It matches the PRD header's "public, open source" delivery,
the Claude Code plugin ecosystem's norm, and the project's minimal-surface posture
(OQ-2's alternative, Apache-2.0, buys an explicit patent grant at the cost of a longer
instrument; the user weighed and declined it). Recorded as a v3 draft.6 delta per the
OQ-1 precedent (an open question resolves through a PRDR and a PRD amendment); the v2
document stays frozen.
