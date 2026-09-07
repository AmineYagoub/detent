---
id: PRDR-131a
title: "The PRDR-127 test suite carries a macOS-only assertion about /tmp, which fails on the Linux runner CI actually uses"
state: DONE
severity: minor
category: testability
labels: ["prd-review", "found-by-audit", "self-inflicted"]
surface: ["tests/sessions/guard.test.ts"]
prd_refs: ["S-2⁗", "N-4"]
acceptance_criteria: ["The `realpathNearest` assertion tests the MECHANISM — that a symbolic link and its target resolve identically — using a link the test creates, not a platform's `/tmp` layout.", "The lexical-fallback assertion, which is host-independent, is kept.", "`npm test` passes on a filesystem where `/private` does not exist."]
non_goals: ["Does not change `src/sessions/guard.ts`. The implementation is correct on both platforms; only the assertion was written against one of them."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-127"]
depends_on: []
---

# PRDR-131a — a test that only passes where it was written

**Severity:** minor · **Category:** testability · **Found by:** the production-readiness audit
of 7 September 2026 · **Introduced by:** commit `e1f9f40`, the same day

`tests/sessions/guard.test.ts:73`:

```ts
expect(realpathNearest("/tmp")).toBe(realpathNearest("/private/tmp"));
```

On macOS `/tmp` is a symbolic link to `/private/tmp`, so both sides resolve to
`/private/tmp` and the assertion holds. On Linux `/tmp` resolves to `/tmp`, `/private` does
not exist, and `realpathNearest` correctly falls back to the lexical `/private/tmp` — so the
two differ and the assertion fails.

CI runs on `ubuntu-latest` (`.github/workflows/ci.yml:9`). The line landed hours before this
audit and has not yet been through Linux CI.

The intent was to prove that `realpathNearest` follows a link rather than returning the
lexical path. That is a real property and worth asserting; `/tmp` was simply a convenient
local instance of it, and convenience is why the assertion is not portable. Creating the link
inside the fixture tests the same property everywhere.

Filed against PRDR-127 rather than folded into it silently, because a self-inflicted defect
found by the audit that followed it is exactly the kind of thing this ledger exists to record.
