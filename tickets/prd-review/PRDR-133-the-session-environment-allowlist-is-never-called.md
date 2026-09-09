---
id: PRDR-133
title: "SEC-4's session-environment allowlist had zero production callers, so every session carried the operator's cloud credentials"
state: DONE
severity: critical
category: gap
labels: ["prd-review", "found-by-audit", "security", "recovered"]
surface: ["src/sessions/sdk.ts", "tests/sessions/sdk.test.ts"]
prd_refs: ["SEC-4", "S-6", "V-1‴"]
acceptance_criteria: ["`buildOptions` sets `env`, so the allowlist is applied to the options a session is actually built with.", "The test asserts on those options rather than calling the filter directly.", "S-6's extended cache header reaches a real session."]
non_goals: ["Does not widen the allowlist. PRDR-148 covers what it must carry."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-148", "PRDR-192"]
depends_on: []
---

# PRDR-133 — the allowlist nobody called

**Severity:** critical · **Category:** gap · **Found by:** the phase-1 audit (`e192c25`)

> **Recovered 2026-09-09 (PRDR-192).** This ticket was filed as an empty file: the
> filename carried the title and nothing else was ever written. Its reasoning survived in
> the commit that created it, and this body is that account. Fields the original never
> recorded are derived from evidence — `surface` from the files the commit changed,
> `state` from the id being cited in shipped code — not invented.

## Problem

`buildSessionEnv` — SEC-4's session-environment allowlist, whose own header promises that
cloud credentials, tokens and deploy keys never cross into a session — **had zero production
callers.** `buildOptions` never set `env`, and the pinned SDK inherits `process.env` when it
is omitted, so every session held the operator's `AWS_SECRET_ACCESS_KEY`, `GITHUB_TOKEN` and
`KUBECONFIG` while carrying `Bash(git commit:*)`. Exfiltration is one command; the shell
expands it.

Its test called `buildSessionEnv` directly, proving the filter filters and nothing about
sessions. That is the third instance of this shape on the 3.1.1 line, after the invented
Serena flag and the undefined-only reminder test, so the replacement asserts on the options
a session is actually built with.

The same missing call also dropped `EXTENDED_CACHE_HEADER`, so S-6's extended prompt-cache
TTL had never once been requested by any run this project had done.
