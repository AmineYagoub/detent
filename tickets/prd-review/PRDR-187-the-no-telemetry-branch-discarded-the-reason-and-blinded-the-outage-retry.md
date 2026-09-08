---
id: PRDR-187
title: "The absent-telemetry branch discarded the failure reason, so a session limit with no usage surfaced as a bare 'session failed' and PRDR-185's retry could not see it"
state: OPEN
severity: critical
category: defect
labels: ["prd-review", "found-by-verification", "regression"]
surface: ["src/sessions/sdk.ts", "tests/sessions/sdk.test.ts"]
prd_refs: ["S-4", "PRDR-185", "PRDR-181"]
acceptance_criteria: ["A result carrying no telemetry still reports WHY it failed — the reason is not telemetry.", "The message `launchOnce` throws for such a result is one `isOutage` matches, so PRDR-185's retry is reachable for the shape it exists for.", "A result that genuinely carries no reason still reports an empty tail."]
non_goals: ["Does not loosen PRDR-181's telemetry check. An empty `modelUsage` is correctly not telemetry; it was never a reason to drop `result`."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-181", "PRDR-185", "PRDR-138"]
depends_on: []
---

# PRDR-187 — the retry could not see the one thing it exists for

**Severity:** critical · **Category:** defect · **Found by:** trying to prove PRDR-185 end to end

## Problem

`parseResultMessage`'s no-telemetry early return set `rawTail: ""`, discarding the SDK's `result`
string along with the usage it was actually about. So a session limit arriving **before any tokens
were spent** produced:

```
ok: false   telemetryParsed: false   rawTail: ""
→ launchOnce throws: "planner session failed"        (nothing after the colon)
→ isOutage("planner session failed") = false          → NO RETRY
```

PRDR-185 matches on that message. With the reason gone it was blind to the one shape it was built
for, and the operator was told a session failed without being told why — which is exactly what
T-140's comment beside that throw says it fixed.

**PRDR-181 caused it.** Before that commit, `total_cost_usd` with an empty `modelUsage` counted as
telemetry, so the tail was populated further down. Tightening the check was right — an empty
breakdown is not telemetry — and it moved this shape into a branch that threw the reason away.

## How it was found

Not by a test. By driving a raw SDK-shaped error result through the real `parseResultMessage` and
the real `isOutage`, to check the last synthetic link in PRDR-185's evidence: the existing test
hand-constructed `ok: false` rather than deriving it from `is_error`. The probe returned
`isOutage → false`, which is how a fix verified in four places turned out to have a fifth that was
broken.
