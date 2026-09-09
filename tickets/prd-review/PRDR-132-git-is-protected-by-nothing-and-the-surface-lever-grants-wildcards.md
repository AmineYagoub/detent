---
id: PRDR-132
title: "`.git` was in no protected set anywhere, and the surface lever granted wildcards that persisted onto the ticket"
state: DONE
severity: critical
category: gap
labels: ["prd-review", "found-by-audit", "security", "recovered"]
surface: ["src/kernel/referee-session.ts", "src/schemas/common.ts", "tests/sec/pack.test.ts"]
prd_refs: ["ARCH-1", "SEC-3", "F-1"]
acceptance_criteria: ["The structural floor is one shared list, living in `schemas/` so the grant path and the enforcement path cannot disagree.", "A surface request is checked against that floor, not only against `config.protected`.", "A request that is not a path is refused: `**`, `.git/**` and `/etc/**` are not grantable."]
non_goals: ["Does not remove the surface lever. PRDR-073 covers documenting it to its callers."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-073", "PRDR-192"]
depends_on: []
---

# PRDR-132 — the directory nobody protected

**Severity:** critical · **Category:** gap · **Found by:** the phase-1 audit (`e192c25`)

> **Recovered 2026-09-09 (PRDR-192).** This ticket was filed as an empty file: the
> filename carried the title and nothing else was ever written. Its reasoning survived in
> the commit that created it, and this body is that account. Fields the original never
> recorded are derived from evidence — `surface` from the files the commit changed,
> `state` from the id being cited in shipped code — not invented.

## Problem

`.git` was in no protected set anywhere, and the surface lever granted wildcards.
`handleSurfaceRequest` checked the model-supplied target against `config.protected` alone —
never the structural floor the same file builds for the policy — and never checked it was a
path, so `**`, `.git/**` and `/etc/**` were granted and **persisted onto the ticket for
every later generation.**

`.git` matters not because it is sensitive but because writing into it is executing:
`.gitattributes` plus a `filter.*.clean` entry runs a shell command on `git add`, which the
implement role holds and `finalizeDone` performs itself.

## Resolution

The floor is now one shared list. ARCH-1 forbids `src/kernel/**` importing `sessions/**`, and
`schemas` sits below every layer, so it lives there — which also means the grant path and the
enforcement path can no longer disagree. **They did:** a request for `.detent/config.json`
matched no default protected glob, so it was recorded as GRANTED while the write was
separately denied, leaving an audit trail that stated the opposite of what happened.
