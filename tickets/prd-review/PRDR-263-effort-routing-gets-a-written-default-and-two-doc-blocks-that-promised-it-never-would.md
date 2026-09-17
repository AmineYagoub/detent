---
id: PRDR-263
title: "Effort routing gets a written default — the planner at max, every other role at xhigh — and the two doc-blocks that promised it never would"
state: DONE
severity: major
category: decision
labels: ["prd-review", "doc-claim-drift", "PRDR-197", "PRDR-237", "S-4‴", "defaults", "operator-signal"]
surface: ["src/schemas/roles.ts", "src/init/config.ts", "src/cli/init.ts", "src/kernel/session-effort.ts", "tests/init/config-defaults.test.ts"]
prd_refs: ["S-4‴", "S-5″", "ARCH-2", "PRDR-114", "PRDR-142", "PRDR-197", "PRDR-237"]
acceptance_criteria: ["`DEFAULT_EFFORT_ROUTING` exists in `src/schemas/roles.ts`, typed `Readonly<Record<RoleId, string>>` so a ninth role is a compile error here rather than a silent omission, with `planner: \"max\"` and the other seven roles at `\"xhigh\"`. It sits beside `DEFAULT_MODEL_ROUTING` because the two are one decision: a level is only meaningful against the model that must serve it.", "Every (role, model, level) pair the two default tables produce is servable. The SDK's own declaration is the oracle: `xhigh` is Fable 5, Opus 4.7+ and Sonnet 5; `max` is Fable 5, Opus 4.6+ and Sonnet 4.6+. `planner` is routed to `claude-opus-5` at `max`, the three other judgement roles to `claude-opus-5` at `xhigh`, and the four volume roles to `claude-sonnet-5` at `xhigh`. No pair relies on a silent downgrade, and the test asserts the pairing rather than the two tables separately.", "A first `init` writes the routing into `.detent/config.json` — all eight roles, explicitly, not an empty object. The knob was already PRESENT-but-empty by PRDR-197's argument that an invisible knob is one the operator does not have; it is now present and populated, which is the same argument carried one step further.", "The SCHEMA default stays `{}`. A config written before this ticket, or one that deletes the key, loads exactly as it did and produces exactly the sessions it produced before — `worstcase.ts`'s `.default({})` is untouched. The test that covers this no longer reads a config `ensureConfig` just wrote, because that config now carries the key and could no longer tell the schema default apart from the written one.", "`detent init` announces the effort routing on a first init, next to the model-routing line it already prints, naming the levels and saying that a model which cannot serve a level is downgraded silently by the SDK and noted per session. A default an operator cannot see is the failure PRDR-142 recorded for `model_routing`.", "The doc-block at `src/init/config.ts` no longer says the default is empty and must change nothing. Its rationale inverts with this ticket and the comment says what the code now does.", "The doc-block at `src/kernel/session-effort.ts` no longer says `detent init` writes `effort_routing: {}` and that the downgrade-note branch therefore cannot execute on a default install. That sentence becomes false the moment this ticket lands, and leaving it is precisely the drift this repository exists to catch.", "PRDR-237's silent-downgrade detector is reachable on a default install. Its third suppressor — a role routed to `\"default\"` — no longer covers every role on a fresh project, so a model that cannot serve its routed level now produces the note the detector was built to produce."]
non_goals: ["Does NOT change `worstcase.ts`'s `effort_routing: z.record(...).default({})`. Every config already committed in a project omits the key or sets it deliberately, and defaulting at LOAD would re-price sessions for projects that never asked. `model_routing` draws the line in exactly this place — it also loads as `{}` and is written populated by `ensureConfig` — and the two knobs stay symmetric.", "Does NOT change `DEFAULT_MODEL_ROUTING`. Which model runs a role and how hard it thinks are separable, and only the second is being decided here.", "Does NOT add a `--effort` CLI flag or a per-role prompt. `--spend-cap-usd` exists because a ceiling has no defensible universal default (X-1); an effort level does, and the file is the place to change it.", "Does NOT teach `doctor` to verify that a routed model can serve its routed level. The SDK exposes `supportsEffort` and an available-levels list per model, so a real check is possible and would be better than a post-hoc note — but it is a new probe with a new failure mode, and PRDR-237's per-session note already reports the downgrade where it happens. Separate ticket.", "Does NOT change what effort the roles ran at historically or re-price any existing ledger. Sessions before this ticket ran at the SDK's own default, which its declaration gives as `high`.", "Does NOT touch `effort` handling in `src/sessions/sdk.ts`. The spread there already omits an absent or empty level and casts a present one to the SDK's union; a populated routing exercises the path that was already built and tested."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-114", "PRDR-142", "PRDR-197", "PRDR-237"]
depends_on: []
---

# PRDR-263 — effort routing gets a written default, and two doc-blocks that promised it never would

## Where this came from

Asked directly what effort Detent's sessions run at. The answer, traced through the code, was:
none. `ensureConfig` writes `effort_routing: {}` (`src/init/config.ts:68`); both drivers spread
the field conditionally and omit it when a role is absent — `src/init/session.ts:147` and
`src/kernel/referee-session.ts:132` — and `src/sessions/sdk.ts:187` omits it again. No `effort`
option has ever reached the Agent SDK from a default install. Every planner, review, implement
and research session Detent has ever launched ran at the SDK's own default, which its
declaration gives as `high`.

That was a deliberate choice and PRDR-197 argued it in the file: *"empty, and PRESENT. The
default must change nothing, but a knob an operator cannot see in the file they edit is one they
do not have."* The knob was shipped visible and inert on purpose.

This ticket takes the second half of that argument and drops the first. The planner drafts a
whole product plan in one session — the run that motivated S-5″ produced a single slice draft of
176,391 output tokens — and it is the one role whose output every later role is measured
against. It runs at `max`. Everything else runs at `xhigh`.

## The pairing is the claim, not the level

A level means nothing without the model that must serve it. The SDK declares its own support
(`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1751-1754`):

```
- 'high'  — Deep reasoning (default)
- 'xhigh' — Deeper than high (Fable 5, Opus 4.7+, Sonnet 5)
- 'max'   — Maximum effort (Fable 5, Opus 4.6+, Sonnet 4.6+)
```

Against `DEFAULT_MODEL_ROUTING` that gives eight pairs and every one is servable:

| role | model | level | servable |
|---|---|---|---|
| planner | claude-opus-5 | max | Opus 4.6+ |
| review, diagnose, informed_fix | claude-opus-5 | xhigh | Opus 4.7+ |
| implement, blind_fix, review_fix, research | claude-sonnet-5 | xhigh | Sonnet 5 |

So this default does not rely on a silent downgrade anywhere, and the test asserts the PAIR —
model and level together — rather than checking the two tables independently and leaving the
join to a reader.

## What this falsifies

Two comments become false the moment the default is written, and both are load-bearing.

`src/init/config.ts`:

> PRDR-197: empty, and PRESENT. The default must change nothing, but a knob an operator cannot
> see in the file they edit is one they do not have.

`src/kernel/session-effort.ts`:

> The note has a THIRD suppressor beside the unobserved case above: a role routed to `"default"`
> never produces one, however far the model settles below it. `detent init` writes
> `effort_routing: {}`, so on a default install this branch cannot execute at all.

That second one is the interesting one. It is an honest comment describing dead code — PRDR-237
built a detector for the SDK silently downgrading effort, and then documented that on a default
install the detector can never fire, because nothing is routed. Writing a real routing is what
arms it. The detector stops being decorative, and the comment has to stop saying it is.

Leaving either sentence in place would be the exact defect class this repository exists to
catch: a doc-block stating a mechanism in the present indicative while the code does something
else, with tests covering the code and nobody reading the comment.

## Falsification against HEAD

`npx vitest run tests/init/config-defaults.test.ts tests/cli/init.test.ts` against HEAD
`b26fdce`, before any `src/` change. **4 failed, 13 passed.**

```
× PRDR-263 the CLI announces the effort routing > names the levels on a first init
  → a default an operator cannot see is one they do not have:
    expected 'import { parseArgs } from "node:util"…' to contain 'effort routing defaulted'

× PRDR-197 effort_routing is validated on both axes > a first init writes the key
  → an operator must be able to see, in the file they edit, the level each role runs at:
    expected {} to deeply equal { planner: 'max', …(7) }

× PRDR-263 init writes the effort routing > routes every role — planner at max, the rest at xhigh
  → a role left out of the routing silently runs at the SDK default instead:
    expected [] to deeply equal [ 'blind_fix', 'diagnose', …(6) ]

× PRDR-263 init writes the effort routing > never routes a role to a level its own model cannot serve
  → an empty routing would make every assertion below vacuous: expected +0 to be 8

Test Files  2 failed (2)
     Tests  4 failed | 13 passed (17)
```

`expected [] to deeply equal [...]` is the defect stated plainly: the written routing is the
empty array of keys, and every role therefore takes the SDK's own default with nothing recorded.

The last case is worth reading twice. The pairing assertion would have passed VACUOUSLY on HEAD
— iterating an empty routing checks nothing — so it opens by asserting the routing is the size
of `ROLE_IDS`. Without that line the test would have been green on a tree with the defect in it,
which is the same failure mode as a doc-block vouching for code.

**Regression guard, not evidence.** `defaults to empty when the key is absent, so a config
predating it is unchanged` passes before and after. It was rewritten by this ticket rather than
added: it previously asserted `{}` against a config `ensureConfig` had just written, which after
this change could no longer distinguish the SCHEMA default from the WRITTEN one — it would have
gone on passing while testing the wrong thing. It now deletes the key first, so it tests the
back-compat invariant it was always meant to test.

## What changed

`src/schemas/roles.ts` (+11 code lines) — `DEFAULT_EFFORT_ROUTING`, typed
`Readonly<Record<RoleId, string>>` and placed directly beneath `DEFAULT_MODEL_ROUTING`, because
the two are one decision. `planner: "max"`, the other seven `"xhigh"`.

`src/init/config.ts` (+1 code line, doc-block rewritten) — `effort_routing: { ...DEFAULT_EFFORT_ROUTING }`.
The comment above it no longer argues for an empty default; it records that PRDR-197 shipped the
knob visible and inert and that only the second half of that argument survives.

`src/cli/init.ts` (+5 code lines) — a first `init` now prints the effort routing beside the model
routing, names the levels, and says a level the routed model cannot serve is downgraded silently
by the SDK and noted per session. PRDR-142 recorded what an unannounced default costs.

`src/kernel/session-effort.ts` (doc-block only) — the sentence *"`detent init` writes
`effort_routing: {}`, so on a default install this branch cannot execute at all"* was true when
written and false as of this commit. It now records that the suppressor no longer covers a
default install, that the detector has stopped being documentation, and that a role still routes
to `"default"` on a config predating this ticket.

Not changed, deliberately: `worstcase.ts`'s `effort_routing: z.record(...).default({})`. Every
config already committed in a project omits the key or sets it on purpose, and defaulting at LOAD
would re-price sessions for projects that never asked. `model_routing` draws the line in exactly
the same place — `{}` at load, populated by `ensureConfig` — and the two knobs stay symmetric.

**No existing test was deleted; one was rewritten and is labelled above.** 125 files, 1275
passed, 2 skipped.

## Mutation battery (verification protocol, item 2)

Seven mutations against the fixed tree. Every one caught.

| # | AC | mutation | caught by |
|---:|---|---|---|
| M1 | 1 | planner demoted to `xhigh` | 2 failed — the level and the written config |
| M2 | 1 | one role left at the SDK default `high` | 2 failed |
| M3 | 1 | a role dropped from the table entirely | 3 failed — key-set, written config, pairing |
| M4 | 3 | revert: `ensureConfig` writes `{}` again | 3 failed — the original defect, re-detected |
| M5 | 2 | the MODEL table written into the effort key | 3 failed — pairing rejects `claude-sonnet-5` as a level |
| M6 | 5 | announcement stops naming the planner's level | 1 failed |
| M7 | 5 | announcement removed entirely | 1 failed |

M5 is the one worth keeping. Writing `DEFAULT_MODEL_ROUTING` into `effort_routing` is a plausible
copy-paste slip, it type-checks, and it produces a config that looks populated and correct at a
glance. The pairing test catches it because it asserts model and level TOGETHER.

**Holes, stated rather than hidden.**

- **AC 7 — that PRDR-237's downgrade note is now reachable — has no test.** Reaching it needs a
  model that cannot serve its routed level, and by AC 2 no such pair exists in the defaults.
  Constructing one means routing a role to a model the SDK downgrades, which is a live-backend
  fact this suite cannot assert. The claim rests on reading `recordEffort`: its three suppressors
  are an unobserved settle, `routed === "default"`, and agreement, and only the second was
  load-bearing on a default install.
- **AC 5 is covered only by a source grep.** `main` builds its own live backend and cannot be
  driven to a session in a unit test, so the announcement is asserted by reading the module —
  the precedent `tests/oracle/budgets.test.ts` set and the same weak-but-real evidence
  `tests/cli/init.test.ts` already uses one describe above. It would catch a deletion; it would
  not catch the line being printed on the wrong branch.
- **The effort levels themselves are asserted against a table transcribed from the SDK's
  declaration, not against the SDK.** If Anthropic changes which models serve `xhigh`, this suite
  goes on passing. The transcription cites its source file and line so the next reader can check
  it, which is the most a unit test can do here.
