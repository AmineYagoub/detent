---
id: PRDR-299
title: "Init sessions record no effort. The kernel's `start` event names the level a session was routed to (S-4‴) and its `effort_settled` event the level the turns ran at (S-4⁗), while `init` journals a bare `start` and drops the level the backend observed, so no run can show that the planner, or the specification phase S-5⁵ puts at `max`, ran at the effort the operator chose, and a silent downgrade passes unseen"
state: DONE
severity: major
category: defect
labels: ["prd-review", "S-4‴", "S-4⁗", "S-5⁵", "specification-phase", "doc-claim-drift"]
surface: ["src/init/session.ts", "src/init/session-effort.ts", "src/schemas/roles.ts", "tests/init/session-effort.test.ts"]
prd_refs: ["S-4‴", "S-4⁗", "S-5⁵", "P6′", "D-33"]
acceptance_criteria: ["Every init session's `start` event names the effort it was routed to, and `\"default\"` where none was routed, as the kernel's does (S-4‴, PRDR-235). Every init launch goes through `launchOnce`, so every one records it.", "After every init session the journal records `effort_settled` with the routed level and the active one, and `unobserved` when no tool call reported a level, as the kernel does (S-4⁗, PRDR-237). An unobserved level is never read as agreement.", "When the active level differs from a routed level other than `\"default\"`, `init` says so through its `note` seam, since there is no ticket to note. It neither refuses nor retries the session, which is PRDR-114's shape.", "`src/schemas/roles.ts` no longer says that init sessions record neither level. It is corrected in the same change.", "Falsifying test: an init session is routed to `max`, and a stub backend reports that its turns ran at `high`. Against HEAD the journal's `start` names no effort and no `effort_settled` is written. Fixed, both are recorded and the downgrade is announced. The ticket records the failure against HEAD."]
non_goals: ["Does NOT add the prompt hash to init's `start` event, though the kernel's carries it (`prompt: role@hash`). That is a separate parity gap, recorded below.", "Does NOT change the routing. S-5⁵'s defaults stand; this records what ran.", "Does NOT refuse a downgraded session. Effort is evidence, as PRDR-237 made it."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-197", "PRDR-235", "PRDR-237", "PRDR-263", "PRDR-278"]
depends_on: []
---

# PRDR-299 — init sessions record no effort

## Where this came from

PRDR-278 recorded the specification phase and the rebuilt planner in the PRD on 2026-09-26. Its
S-5⁵ routes `audit`, `spec_write` and `spec_review` to `claude-opus-5-5` at `max`
(specification decision 14), and `plan_review` and the planner to `claude-opus-5` at `max`.
Every one of those is an init session. Writing S-5⁵ meant reading how a configured effort is
observed, and `src/schemas/roles.ts` says it plainly:

> Init sessions are routed a level and record neither — ARCH-2 parity is owed there and is not
> paid.

PRDR-278 recorded this as not fixed, and the operator asked for it to be filed.

## Problem

The two halves of S-4‴ and S-4⁗ are built for kernel sessions only:
- **The kernel** (`src/kernel/referee-session.ts`) writes `start` with `effort: routedEffort`,
  `"default"` when none was routed. After the session it calls `recordEffort`
  (`src/kernel/session-effort.ts`), which journals `effort_settled` with the routed and the
  active level, and notes the ticket when they disagree.
- **`init`** (`launchOnce` in `src/init/session.ts`) writes
  `{ stage, event: "start", at }` and, after the session, an `end` with turns and cost. It
  routes a level (`effort: deps.effortRouting[role]` in the session spec) and never records it.
- **The backend observes it anyway.** `SdkBackend.runOnce` takes the level the D-21 hook reports
  and returns it as `result.effort`, for every session (`src/sessions/sdk.ts`). `init` receives
  the value and drops it.

S-4‴ says each session's `start` names the level it launched with, and gives the reason: the SDK
downgrades silently for a model that cannot serve a level. So a planner routed to `max` that ran
at a lower level today leaves a journal identical to one that ran at `max`. Once the
specification phase exists, the same holds for every session the operator chose Opus 5.5 at `max`
for. D-33 asks run-time outcomes to decide what stays, and an experiment on effort cannot be told
apart from one that did not happen.

## Design

The kernel's shape, at init's seam:
- `launchOnce` puts the routed level on `start`: `deps.effortRouting?.[role] ?? "default"`.
- After `backend.run`, it journals `effort_settled` with `routed` and
  `active: result.effort ?? "unobserved"`.
- A disagreement is announced through `deps.note`, the seam `init` already uses to speak to the
  operator. The kernel's `recordEffort` writes a ticket note through `appendNote`, and init has
  no ticket to write one to, so the shared part is the event's shape, not the function.
- `src/schemas/roles.ts`'s doc-block is corrected in the same change.

## Recorded, not fixed

- **The prompt hash.** The kernel's `start` carries `prompt: role@hash`, so its audit trail
  names the prompt that ran; init's does not. With the split prompts of C-4⁵ and the
  specification roles, that matters for attributing outcomes too (D-33). It is its own parity
  gap, and PRDR-297's build record covers part of it.

## Building it

An `init` session now records what a kernel session records of its effort, and of its model: the
level it was routed to on `start`, the level its turns ran at on `effort_settled`, and a routed model
the runtime could not serve as `model_fallback`. The PRD records it as S-4⁵, placed after S-4⁗, and
S-4‴ and S-4⁗ point to it.

The acceptance criteria, as built:
1. **`start` names the routed level** (`launchOnce`, `src/init/session.ts`):
   `deps.effortRouting?.[role] ?? "default"`, as the kernel's has since PRDR-235. Every init launch
   goes through `launchOnce`; the one other `backend.run` in the tree is `doctor --smoke`'s, which
   is no init session.
2. **`effort_settled` follows every session** (`recordRan`), with the routed level and
   `active: result.effort ?? "unobserved"`, in the kernel's order: after the session, before the
   ledger row and `end`. So a failed session records the level its turns ran at before its phase
   fails, and an unobserved level is never read as agreement.
3. **A downgrade is said through `deps.note`**, the seam `init` speaks to the operator through, since
   there is no ticket to note. It neither refuses nor retries the session (PRDR-114's shape).
4. **`src/schemas/roles.ts` is corrected** in the same change: every session records both levels, a
   kernel session noting its ticket and an `init` session saying so through the note seam.
5. **The falsifying test** is `tests/init/session-effort.test.ts`'s first case: an `audit` session
   routed to `max`, a backend that reports `high`. Its six cases fail against HEAD (below).

The shared part is the kernel module's, as the ticket's design says, and a little more than the
event's shape: `src/kernel/session-effort.ts` exports `settledLevels` (the event's two fields),
`effortDowngrade` (the three suppressors and the words) and `modelFallback` (PRDR-114's words), and
both drivers take them from there. `recordEffort` keeps its signature and its behaviour.

### Vetoable calls

1. **The model fallback is recorded too,** though the ticket names effort alone: the same
   paragraph of `roles.ts` says a fallback is "noted per session", and for `init`'s sessions, the
   ones S-5⁵ routes to Opus 5.5, nothing noted it. It is journaled as `model_fallback` and said
   through the note seam, with its runtime reason scrubbed (SEC-4), as the kernel does.
2. **The event order is the kernel's:** `effort_settled` (and `model_fallback`) after the session
   and before the ledger row and `end`, so a failed session's level is on record before the throw.
3. **The words are the kernel's,** `effort downgraded (PRDR-237): …` and
   `model fallback (PRDR-114): …`, from one module, rather than an init wording of their own.
4. **`recordEffort` stays the kernel's function** and takes the shared pieces, rather than taking a
   callback for the note: the ticket's design asked for the shape to be shared, and the kernel's
   note has an author and a ticket that `init`'s note seam does not.
5. **No new module in `src/init/`.** The ticket's surface named `src/init/session-effort.ts`;
   `recordRan` is ten lines and `session.ts` stays at 203 code lines of its 300.

## Falsification (verification protocol, item 1)

The final `tests/init/session-effort.test.ts` and `tests/kernel/effort-record.test.ts` were copied
into a `git archive` of HEAD `512dbd5` in the scratchpad and run there, against HEAD's source.
All six init cases fail, each on the record HEAD does not write:

```
 × AC 5: routed to max, the turns ran at high: `start` names max, `effort_settled` records both,
   and the downgrade is said
   → expected [ { stage: 'audit', …(2) } ] to deeply equal [ ObjectContaining{…} ]   (no effort on start)
 × no level routed: `start` names `default`, and a level no tool call reported is `unobserved`
   → expected [ { stage: 'audit', …(2) } ] to deeply equal [ ObjectContaining{…} ]
 × says nothing when the level held, when none was observed, or when none was routed
   → expected [] to deeply equal [ ObjectContaining{…} ]                             (no effort_settled)
 × a session that failed still records the level it ran at, before its phase is failed
   → expected [] to deeply equal [ ObjectContaining{…} ]
 × a routed model the runtime cannot serve is journaled and said (PRDR-114)
   → expected [] to deeply equal [ ObjectContaining{…} ]                             (no model_fallback)
 × the fallback's reason is a runtime string, scrubbed before the operator is told it (SEC-4)
   → expected [] to deeply equal [ Array(1) ]
 Test Files  1 failed | 1 passed (2)
      Tests  6 failed | 3 passed (9)
```

The kernel file's three cases pass against HEAD, as they should: its new case holds PRDR-237's
kernel half, which HEAD has and no test held (below), so it guards the refactor rather than
falsifying the ticket.

## Mutation battery (verification protocol, item 2)

20 mutants, one defect each, run against the new init suite and the kernel's effort and session
policy suites, and restored from a snapshot, never by `git checkout`; at the end all three files
matched it. They covered:
- **`init`'s launch:** the routing ignored; no `default` named; `start` naming no effort; nothing
  recorded; a failed session recording nothing; the settled event not journaled; the downgrade
  unsaid; the settled level read from the routing; the fallback not journaled, unsaid, or its
  reason not scrubbed.
- **The shared module:** an unobserved level read as agreement; each of the three suppressors
  gone; the kernel's note or its settled event gone; the fallback's words drifting; the downgrade
  naming the wrong level.
- **The kernel's session:** its fallback unnoted.

All 20 were killed on the first pass.

## Gates

`npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check` and
`test` all pass: 2145 tests passed and 2 skipped, across 184 files; seven cases are new, six in the
init suite and one in the kernel's. `npm run plugin` builds and changes nothing.

## Found along the way

- **The kernel's downgrade note had no test.** PRDR-237 built `effort_settled` and the note on the
  ticket; no test asserted either (the sessions suite covers the hook's report, not the kernel's
  record of it), so the note's three suppressors could each have been deleted unseen. The kernel's
  effort suite now holds both, for a downgraded session and an agreeing one.
- **`src/init/config.ts` tells a first `init` that a downgraded level is "noted per session".**
  Until this change that was true of `run`'s sessions only; it is true of every session now.

## Recorded, not fixed, found while building it

- **An MCP server that failed to connect.** One kind of init session is given one: a VALIDATE
  reviewer with a scratch directory gets the scratch tool as an in-process server (S-1⁗). If it
  failed to connect, `init` would drop the result's `mcpFailures` as it dropped `effort`, and the
  round would not say that its simulations could not run. The kernel notes the same failure for its
  symbol server (S-3‴, PRDR-123), in words about symbol intelligence, so this needs words of its own
  and is left for a ticket.
