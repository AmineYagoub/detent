---
id: PRDR-248
title: "The flat `usage` field admits the exact half-formed shape PRDR-181 closed on `modelUsage`, so a cost with no tokens is still telemetry"
state: DONE
severity: major
category: defect
labels: ["prd-review", "found-by-audit", "telemetry", "spend", "S-4"]
surface: ["src/sessions/sdk.ts", "tests/sessions/sdk.test.ts"]
prd_refs: ["S-4", "S-4′", "X-1", "D-25"]
acceptance_criteria: ["A result message whose `usage` carries no token field — `{}`, `null`, or an object with only cache keys — is NOT telemetry, exactly as an empty `modelUsage` is not.", "A crash result whose `usage` carries ZEROED token fields IS telemetry, so PRDR-053's \"zeroed, not absent\" rule and the `crashed` flag are unchanged.", "A flat `usage` carrying real token counts is still telemetry, and a real `modelUsage` breakdown still takes precedence over it.", "A test covers each of those four shapes and fails on today's tree for the first."]
non_goals: ["Does not change what happens once telemetry is judged absent; S-4's breaker already routes that to BUDGET_BREACH and T-046 covers it end to end.", "Does not add end-to-end coverage for a raw half-formed message reaching the ledger — `MockBackend` returns a `SessionResult` and never goes through the parser, so that gap is real and is recorded below rather than closed here.", "Does not touch the `modelUsage` branch, which PRDR-181 got right."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-181", "PRDR-053", "PRDR-185", "PRDR-187"]
depends_on: []
---

# PRDR-248 — the same defect, on the sibling field

## Problem

PRDR-181 closed this exact shape for `modelUsage`. Its fix and the doc-block above it
read:

> S-4 (PRDR-181): telemetry is present only when it carries USAGE, not merely a
> `modelUsage` key. `total_cost_usd` plus an EMPTY `modelUsage: {}` satisfied this and
> parsed as telemetry present with zero tokens — a partial or truncated result message
> became a ledger row of $0 and a session the spend ceiling never saw.

The predicate it shipped is:

```ts
const hasTelemetry = m.total_cost_usd !== undefined && (usageEntries > 0 || m.usage !== undefined);
```

`usageEntries > 0` closes the `modelUsage` half. The second disjunct is `!== undefined`,
which is presence of the KEY — the very test the first half was tightened away from. So
`usage: {}`, `usage: null` and `usage: { cache_read_input_tokens: 5 }` all parse as
telemetry present with zero tokens, and the block's own first sentence is false for the
field it names.

The parser reads exactly two keys off a flat usage — `input_tokens` and `output_tokens`
(the non-breakdown path hardcodes both cache figures to 0) — so a `usage` carrying
neither contributes nothing the ledger can bound anything with, which is the same
argument PRDR-181 made about an empty breakdown.

## Severity, stated plainly

`major` rather than `critical`, and the difference is worth writing down. The
consequence is identical to PRDR-181's — a session the spend ceiling never sees — but
the triggering shape is off-contract for the pinned SDK (0.3.258 always sends both token
fields in a real usage block) and is not reachable from session-controlled input. It is a
truncation and transport-death shape, which is precisely what S-4's breaker exists for,
so it is worth closing before a gate run and is not an open door.

## The constraint the fix must not break

PRDR-053 requires crash telemetry to be **zeroed, not absent**. The live backend mints
exactly that on a transport death:

```ts
usage: { input_tokens: 0, output_tokens: 0 }
```

So the predicate must key on the token fields being PRESENT, never on their being
non-zero. A value check would turn every crash into absent telemetry and lose the
`crashed` flag that `zeroed` derives.

## Coverage gap this does not close

`MockBackend` returns a `SessionResult` directly and never goes through
`parseResultMessage`, so the end-to-end S-4 test (T-046) reaches the breaker with a
hand-injected `telemetryParsed: false` rather than with a half-formed message. PRDR-181's
own doc-block already names that as the reason its defect survived. Nothing in this
ticket changes it: the parser is tested at the parser, and no test drives a raw
half-formed SDK message to a NEEDS_HUMAN ticket. That belongs with PRDR-240's
production-entry-point contracts.

## Falsification (verification protocol, item 1)

`tests/sessions/sdk.test.ts`, extending PRDR-181's own describe block, run against `4b4dd39`:

```
✓ refuses a cost with no usage breakdown at all
✓ still accepts a real breakdown, and a flat usage block
× refuses a flat usage that carries no token field
  → an empty usage carries no tokens: expected true to be false
✓ still accepts a crash result whose token fields are zeroed
```

The PRDR-053 crash case passed BEFORE the fix as well as after, which is the point of
including it: it is the constraint, not the defect, and it proves the tightened predicate
did not buy the refusal by breaking "zeroed, not absent".

## What changed

```ts
const usage = (m.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
const usageCarriesTokens = typeof usage.input_tokens === "number" || typeof usage.output_tokens === "number";
const hasTelemetry = m.total_cost_usd !== undefined && (usageEntries > 0 || usageCarriesTokens);
```

The `usage` binding moved up from the token-summing block below, which already declared
the identical cast; there is now one declaration rather than two. `modelUsage` is
untouched.
