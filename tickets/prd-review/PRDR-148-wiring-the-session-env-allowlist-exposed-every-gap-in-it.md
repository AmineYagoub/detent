---
id: PRDR-148
title: "The allowlist carried ANTHROPIC_API_KEY and not CLAUDE_CODE_OAUTH_TOKEN, so wiring it would have cut every session's credential on the documented CI machine"
state: DONE
severity: critical
category: bug
labels: ["prd-review", "found-by-audit", "security", "recovered"]
surface: ["src/sessions/env.ts", "tests/sec/pack.test.ts"]
prd_refs: ["SEC-4", "X-6"]
acceptance_criteria: ["The allowlist carries every transport `hasLiveBackendAuth` names.", "A test ties the allowlist to `live.ts`'s transports BY READING THE SOURCE, so a fourth cannot be added to one and forgotten in the other.", "Proxy and CA variables are carried, with the credential-in-proxy-URL trade stated in the code rather than decided by omission.", "`LOGNAME` beside `USER`: the CLI's auth probe reads both."]
non_goals: ["Does not widen the allowlist beyond what a session demonstrably needs."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-133", "PRDR-141", "PRDR-192"]
depends_on: ["PRDR-133"]
---

# PRDR-148 — wiring a dead control exposes every gap in it

**Severity:** critical · **Category:** bug · **Found by:** auditing PRDR-133 an hour after it landed (`a4991b0`)

> **Recovered 2026-09-09 (PRDR-192).** Filed as an empty file — the filename carried the
> title and nothing else was ever written. Its reasoning survived in the commit that created
> it, and this body is that account. Fields the original never recorded are derived from
> evidence, not invented.

## Problem

`SESSION_ENV_ALLOWLIST` carried `ANTHROPIC_API_KEY` and **not** `CLAUDE_CODE_OAUTH_TOKEN`,
while `hasLiveBackendAuth` names three transports and records that all three were proven by
execution. PRDR-140 broadened the transports; the allowlist was written before that and never
followed.

While `buildSessionEnv` had no caller the gap was inert — sessions inherited the token from
`process.env` and worked. **Wiring the allowlist turned a harmless staleness into an outage:**
on the documented subscription-CI machine, every session would now lose its credential.

## The general lesson, which is worth more than the fix

**Wiring a dead control exposes every latent defect in it, at once, in production.** The
audit's headline was four features implemented, tested, green and unreachable, and the
tempting reading is "just connect them". This is the counter-example. PRDR-141 wires three
more; each should be treated as this was — assume the dead code has drifted, and check what it
claims against what the rest of the system now does, *before* switching it on.
