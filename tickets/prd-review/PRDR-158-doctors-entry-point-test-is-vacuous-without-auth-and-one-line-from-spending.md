---
id: PRDR-158
title: "Doctor's entry-point test proves nothing on a machine without live auth, and is one line from billing every developer who runs npm test"
state: OPEN
severity: critical
category: weak-test
labels: ["prd-review", "found-by-audit", "vacuous-test", "spend"]
surface: ["src/cli/doctor.ts", "tests/cli/doctor.test.ts"]
prd_refs: ["R-10", "X-1", "S-5"]
acceptance_criteria: ["The test that asserts `doctor` survives an unreadable `bindings.json` exercises that path regardless of whether the machine running it has live-backend auth — proven by observing it FAIL against the reverted fix under `DETENT_NO_LIVE=1`, the environment CI runs in.", "`npm test` cannot reach a real billed session through `doctor` even if the corrupt fixture is later replaced with a valid one. The seam that prevents it is a dependency, not a fixture detail.", "`main`'s auth decision is injectable on the same terms `hasLiveBackendAuth` already accepts a probe, so no test depends on the state of the developer's `claude` login."]
non_goals: ["Does not change R-10's gate. Consent plus a cap is unchanged; this is about which code the SUITE reaches.", "Does not remove the `--smoke` flag or the live smoke session. Both are correct — PRDR-154 put them there."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-154", "PRDR-143", "PRDR-141"]
depends_on: []
---

# PRDR-158 — the guard exists only on machines that do not need it

**Severity:** critical · **Category:** weak-test · **Found by:** the audit of `7d9526c`

## Problem

PRDR-154 found that `doctor` — the command you reach for when the state directory is broken —
could not survive a broken state directory, because `buildLiveBackend` reads `bindings.json` and
throws. The fix wrapped it in a try. The test written to lock the fix asserts that
`main([root, "--smoke"])` still prints its offline checks with a `{"schema_version":99}` bindings
file on disk.

`doctor()` itself never reads `bindings.json`. The file is reached only via `buildLiveBackend`,
which `main` calls only when `hasLiveBackendAuth()` returns true. Reverting the fix:

| environment | result |
|---|---|
| a machine with a logged-in `claude` CLI | **FAILS**, as intended |
| `DETENT_NO_LIVE=1` — i.e. CI, no key, no token, no login | **PASSES**, 136 ms |

On any runner without `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` or a logged-in CLI, the
short-circuit means the corrupt fixture is never read and the guard the test exists to be does not
exist. It is the same defect class the commit that contains it was written to remove.

## The second half, which is worse

That test is the first call in the suite to invoke `hasLiveBackendAuth()` and `buildLiveBackend()`
un-injected. On a logged-in machine `hasLiveBackendAuth()` returns true, and on the pristine
`makeRunRepo()` fixture — which writes a *valid* `bindings.json` — `buildLiveBackend(root)`
succeeds and returns the real `claude-code` backend.

The only thing standing between `npm test` and `deps.backend.run({ maxTurns: 1, … })` against a
live model is the `writeFileSync(…, '{"schema_version":99}')` on the line above. Anyone who
"tidies" that fixture into a valid one turns the test suite into a billable operation on every
logged-in developer machine — with no consent, no cap and no ledger row, which is precisely the
hazard PRDR-154 put `--smoke` there to close.

The fixture is load-bearing for spend safety and nothing says so.
