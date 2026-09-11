---
id: PRDR-235
title: "A configured effort is documented as `recorded per session rather than assumed to have been honoured`, and nothing records it — the run config event omits `effort_routing`, no session event carries the level, and the SDK's silent downgrade leaves no trace at all"
state: DONE
severity: major
category: defect
labels: ["prd-review", "PRDR-197", "PRDR-092", "PRDR-114", "journal", "observability", "effort"]
surface: ["src/kernel/run.ts", "src/kernel/referee-session.ts", "tests/kernel/run.test.ts", "detent-prd-v3.md"]
prd_refs: ["S-2″", "S-4", "D-21", "ARCH-2", "V-6", "N-6", "PRDR-197", "PRDR-114", "PRDR-092", "PRDR-129"]
acceptance_criteria: ["The run's config audit event records `effort_routing` beside `model_routing`. Observed FIRST (V-6): `src/kernel/run.ts:243-257` appends `{event: \"config\"}` carrying `budgets`, `model_routing`, `protected` and `risk`, and omits `effort_routing` — while PRDR-092's own comment above it states the contract as `the run records the configuration it actually loaded`. A run's journal therefore cannot answer what effort governed it.", "A session's `start` event records the effort it was launched with, or records that none was routed. Observed FIRST: `grep -c effort src/kernel/ledger.ts src/kernel/journal.ts src/schemas/records.ts` returns 0 — no ledger row, no journal event and no record schema carries the field, and the `start` event at `src/kernel/referee-session.ts:219-224` carries `stage`, `at`, `generation` and `prompt` only. The comment at `src/schemas/roles.ts:31-33` — `the SDK downgrades silently for a model that cannot serve one, which is why a configured effort is recorded per session rather than assumed to have been honoured` — describes a mechanism that does not exist.", "Both are proved by tests that fail on today's tree: one asserting the config event names the loaded `effort_routing`, one asserting a routed session's `start` event carries the level."]
non_goals: ["Does not add an `effort` column to `ledgerRowSchema` — it is a `z.strictObject` and the journal is the cheap, free-form place for an audit fact.", "Does not read the SDK's post-downgrade `effort.level` from the containment hook — a larger change, and the routed level is what the operator needs first.", "Does not change any routing, default or ceiling."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-197", "PRDR-092", "PRDR-234"]
depends_on: []
---

# PRDR-235 — the one routed dimension with no record

**Severity:** major · **Category:** defect · **Found by:** the effort-routing analysis, while
answering whether `effort_routing` should be raised on the gate-313 run

## Problem

PRDR-197 added per-role reasoning effort beside per-role model routing. The models half is fully
observed: `ledgerRowSchema` carries `models`, a fallback is detected at `src/sessions/sdk.ts:310`,
journaled as `model_fallback` at `src/kernel/referee-session.ts:236`, and noted on the ticket. So
a reader can always answer *which model actually ran*.

The effort half records nothing. Three places where it should appear and does not:

```
$ grep -c effort src/kernel/ledger.ts src/kernel/journal.ts src/schemas/records.ts
0
```

- The run's config audit event (`src/kernel/run.ts:243-257`) lists `budgets`, `model_routing`,
  `protected`, `risk` — and not `effort_routing`. PRDR-092 wrote that event so that *"a setting
  that stops applying between runs is a diff between two journal lines rather than silence."*
  For effort it is silence.
- The session `start` event (`src/kernel/referee-session.ts:219-224`) carries `stage`, `at`,
  `generation`, `prompt`. Not the level it launched with.
- Nothing reads the SDK's post-downgrade level, which it hands to hooks as `effort.level` and to
  Bash as `CLAUDE_EFFORT`.

And `src/schemas/roles.ts:31-33` states the contract that none of this implements:

> `xhigh` and `max` are not served by every model. The SDK downgrades silently for a model that
> cannot serve one, **which is why a configured effort is recorded per session rather than assumed
> to have been honoured.**

That sentence is the justification for mirroring the SDK's closed set. The recording it justifies
was never written. The comment reads as a description of behaviour and is a description of an
intention.

## Why this blocks the decision it was found by

gate-313 is about to raise `effort_routing.implement`. The whole point is to measure whether more
reasoning reduces review churn. With no record:

- a run cannot be told apart from one with `effort_routing: {}`, after the fact;
- a level the routed model cannot serve is downgraded silently, so the experiment may measure the
  default while believing it measured `max`;
- and the 188 sessions already in `.detent/ledger.jsonl` cannot be established as a clean
  baseline, because nothing says what effort governed them either.

An unmeasurable knob is not a knob. This lands before the effort change, not after it.

## Scope

Two appends. `effort_routing` onto the config event; the routed level onto the session `start`
event, explicitly naming the unrouted case so a reader distinguishes *"ran at the SDK default"*
from *"this build did not record it"*. Both are free-form journal events, so neither touches a
strict schema.

## What implementation changed

**`src/kernel/run.ts`** — the config audit event carries `effort_routing` beside `model_routing`.
PRDR-092 wrote that event so a setting which stops applying between runs is a diff between two
journal lines rather than silence; effort was the one routed dimension it did not name.

**`src/kernel/referee-session.ts`** — the session `start` event carries `effort`. `"default"`
where no level was routed, rather than an omitted key, because the two facts a reader has to tell
apart are *"nothing was routed, so the SDK's own default governed"* and *"this build did not
record it"* — and an absent field says both at once.

**`tests/kernel/run.test.ts`** — two tests, observed failing first (V-6): the config event names
the loaded `effort_routing`, and a routed session's `start` names its level while an unrouted one
says `"default"`.

**Scope held:** no `effort` column on `ledgerRowSchema` — it is a `z.strictObject`, so that is a
schema change, and the journal is the free-form place for an audit fact. The SDK's post-downgrade
`effort.level`, which it hands to hooks and exposes to Bash as `CLAUDE_EFFORT`, is still unread;
the routed level is what an operator needs first, and reading the settled one is a larger change
against the containment hook.

**Found while amending:** `grep -n effort detent-prd-v3.md detent-prd-v2.md` returns nothing.
PRDR-197 shipped per-role effort routing — an operator-facing knob, validated at config load,
wired through both drivers — with no PRD entry in either document. S-4‴ is the first, and it
covers only the recording this ticket adds, not the routing itself. That gap is worth its own
ticket.
