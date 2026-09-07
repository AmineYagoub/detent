---
id: PRDR-162
title: "The doctor test rewritten to remove a fixture from the spend-safety path now depends on that fixture harder, on every machine including CI"
state: OPEN
severity: critical
category: defect
labels: ["prd-review", "found-by-audit", "spend"]
surface: ["tests/cli/doctor.test.ts"]
prd_refs: ["R-10", "X-1"]
acceptance_criteria: ["No path exists from `npm test` to a billed session through `doctor`, and the thing that prevents it is structural rather than a fixture that happens to be corrupt.", "The PRDR-158 property still holds: the test exercises `buildLiveBackend` for real, on every machine, and fails if PRDR-154's try/catch is reverted."]
non_goals: ["Does not revert PRDR-158's seams. They are correct and necessary; the test built on them is what is wrong."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-158", "PRDR-154"]
depends_on: []
---

# PRDR-162 — the fix made the coincidence load-bearing on more machines, not fewer

**Severity:** critical · **Category:** defect · **Found by:** the audit of `bdafdb5`

## Problem

PRDR-158's stated fix was: "A dependency is a seam; a fixture detail is a coincidence." The test it
produced is

```ts
await main([root, "--smoke"], { hasAuth: () => true, buildBackend: buildLiveBackend });
```

which forces the auth branch true and hands `main` the **real** builder. Measured:

```
corrupt bindings ({"schema_version":99}) -> threw
valid   bindings                          -> NO THROW, real ClaudeCodeBackend constructed
no bindings.json at all                   -> NO THROW, real ClaudeCodeBackend constructed
```

So the only thing between `npm test` and `deps.backend.run({ maxTurns: 1, … })` is, again, the
`writeFileSync(…, '{"schema_version":99}')` line above it.

It is now **worse than what it replaced**. Before, `hasLiveBackendAuth()` returned false under
`DETENT_NO_LIVE=1` and CI never entered the branch at all. With `hasAuth: () => true` every machine
enters it, CI included — and the spend would occur *before* the assertion that fails.

Three plausible ways it realises: someone makes `readBindings` tolerant of newer schema versions (a
natural follow-up to "doctor should survive a broken state dir"), someone tidies the fixture, or
`SCHEMA_VERSION` reaches 99.
