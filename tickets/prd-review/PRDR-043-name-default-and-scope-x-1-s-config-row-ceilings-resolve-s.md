---
id: PRDR-043
title: "Name, default, and scope X-1's config-row ceilings; resolve per-ticket vs per-run spend"
state: DONE
severity: major
category: gap
labels: ["prd-review"]
surface: ["detent-prd-v2.md"]
prd_refs: ["X-1", "X-8", "C-3a", "F-1", "P6", "S-4"]
acceptance_criteria: ["Every ceiling in X-1's config row appears as a named config key with a unit and a v1 default, in the same form C-3a already uses for `planning_research_tool_calls` (default 16 per init).", "Each ceiling states its scope — per ticket per generation, per ticket cumulative, or per run — and X-1's header and X-8's spend sentence agree on which scope the spend ceiling has.", "X-1's config-load AC is satisfiable: a reader can determine, from the PRD alone, the complete set of keys `config.json`'s budgets object must validate, without consulting an implementation.", "`planning_research_tool_calls` appears in X-1's budget table rather than only in C-3a's prose, so all budgets are enumerable from one place.", "P6's \"every counter has a ceiling; every ceiling routes to a human\" holds constructively: each named key states its breach target."]
non_goals: ["Does not change any ceiling's numeric value, including the ≤8 and 1 already stated inline, nor the net sessions figure of 14.", "Does not add new ceilings beyond those X-1 and C-3a already name.", "Does not specify config-file syntax or a JSON Schema; naming keys, units, defaults, and scopes is sufficient."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-043 — Name, default, and scope X-1's config-row ceilings; resolve per-ticket vs per-run spend

**Severity:** major · **Category:** gap · **Amends:** X-1, X-8, C-3a

**Applied in 2.0-draft.5.** See the PRD's draft.5 amendment note for where this ticket was reconciled against another.

## Problem

X-1's final table row collapses five distinct ceilings into one cell: "wall-clock / spend / turns-per-stage / failure-research tool calls (≤8) / flake reruns (1) | config | NEEDS_HUMAN". Two carry inline values; three carry only the word "config" — no key name, no unit, no default. C-3a demonstrates the intended form elsewhere in the same document, naming `planning_research_tool_calls` with a default of 16 per init, but that counter never appears in X-1's table, so the budget set is not enumerable from any single place.

This is not cosmetic, because X-1 makes config validation normative: the implementation must assert `sessions_net > maxPossibleSessions(state_machine, budgets)` **at config load** and reject a violating configuration before any run. A load-time validator needs to know the complete key set it is validating. As written, an implementer must invent key names, units (is wall-clock in seconds or milliseconds? is spend in USD or tokens?), and defaults, then assert against them — which is precisely the in-flight architecture invention N-6's no-deviation rule forbids.

There is also a scope contradiction. X-1's header declares the whole table "per ticket, hard". X-8 states that "the run-level spend ceiling remains the cumulative financial backstop regardless of generation count", making spend a per-run ceiling. Both statements cannot hold for the same counter. The distinction matters operationally: a per-ticket spend ceiling cannot be a backstop against unbounded requeues, which is the exact job X-8 assigns it.

P6 states that every counter has a ceiling and every ceiling routes to a human. Three ceilings currently have no name to route.

## Evidence (verbatim from foreman-prd-v2.md)

- X-1 header: "**X-1 Budgets** (per ticket, hard):"
- X-1 config row: "| wall-clock / spend / turns-per-stage / failure-research tool calls (≤8) / flake reruns (1) | config | NEEDS_HUMAN |"
- X-1: "the implementation derives `maxPossibleSessions(state_machine, budgets)` from the transition table and asserts `sessions_net > computed` both in the test suite **and at config load** — a configuration violating it is rejected before any run."
- C-3a: "Budget: `planning_research_tool_calls` (default 16 per init); exhausting it without an answer adds the open question to the AWAIT_INFO batch"
- X-8: "the run-level spend ceiling remains the cumulative financial backstop regardless of generation count"
- P6: "**Budgets are hard.** Every loop has a counter; every counter has a ceiling; every ceiling routes to a human."
- F-1: "`config.json` (schema_version, budgets, protected/risk globs, model routing, pinned SDK/CLI versions)"

## Proposed change

Replace X-1's single config row with named rows, and add a scope column to the whole table:

```
| Counter | Max | Scope | Breach target |
|---|---|---|---|
| `blind_fix_attempts` (D-12) | 1 | ticket/generation | resolver → next slot / NEEDS_HUMAN |
| `informed_fix_attempts` (D-12) | 1 | ticket/generation | NEEDS_HUMAN (X-2 scope) |
| `review_fix_attempts` (D-6, D-12) | 1 | ticket/generation | NEEDS_HUMAN |
| `research_sessions` | 1 | ticket/generation | NEEDS_HUMAN |
| `hypotheses` | 2 | ticket/generation | >2 → NEEDS_HUMAN |
| `sessions` (net) | 14 | ticket/generation | NEEDS_HUMAN |
| `ticket_wall_clock_ms` | 3_600_000 | ticket/generation | NEEDS_HUMAN |
| `turns_per_stage` | 30 | session | NEEDS_HUMAN |
| `failure_research_tool_calls` | 8 | research session | RESEARCH_DRY → NEEDS_HUMAN |
| `planning_research_tool_calls` (C-3a) | 16 | init | question joins AWAIT_INFO batch |
| `flake_reruns` | 1 | red gate | ladder entry (X-5) |
| `run_spend_usd` | config, no default | **run** (cumulative, X-8) | NEEDS_HUMAN |
```

Amend the header to "(scope per the table; all hard)" and add after it: "`run_spend_usd` is the only run-scoped ceiling and is the cross-generation backstop of X-8; it has no v1 default because there is no defensible universal figure — `init` requires an explicit value and refuses to write a config without one."

Delete the "(per ticket, hard)" claim from the header so it no longer contradicts X-8.

## Acceptance criteria

1. Every ceiling in X-1's config row appears as a named config key with a unit and a v1 default, in the same form C-3a already uses for `planning_research_tool_calls` (default 16 per init).
2. Each ceiling states its scope — per ticket per generation, per ticket cumulative, or per run — and X-1's header and X-8's spend sentence agree on which scope the spend ceiling has.
3. X-1's config-load AC is satisfiable: a reader can determine, from the PRD alone, the complete set of keys `config.json`'s budgets object must validate, without consulting an implementation.
4. `planning_research_tool_calls` appears in X-1's budget table rather than only in C-3a's prose, so all budgets are enumerable from one place.
5. P6's "every counter has a ceiling; every ceiling routes to a human" holds constructively: each named key states its breach target.

## Non-goals

- Does not change any ceiling's numeric value, including the ≤8 and 1 already stated inline, nor the net sessions figure of 14.
- Does not add new ceilings beyond those X-1 and C-3a already name.
- Does not specify config-file syntax or a JSON Schema; naming keys, units, defaults, and scopes is sufficient.
