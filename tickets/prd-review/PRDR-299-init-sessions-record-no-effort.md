---
id: PRDR-299
title: "Init sessions record no effort. The kernel's `start` event names the level a session was routed to (S-4‴) and its `effort_settled` event the level the turns ran at (S-4⁗), while `init` journals a bare `start` and drops the level the backend observed, so no run can show that the planner, or the specification phase S-5⁵ puts at `max`, ran at the effort the operator chose, and a silent downgrade passes unseen"
state: OPEN
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
