---
description: Execute or resume the approved Detent plan - a budgeted implement, test, review loop where every move is admitted by the Detent referee. Use when the user asks to run, resume, or continue a Detent plan.
---

# Detent run

Detent's public surface is exactly two workflows (C-14′): `init` prepares a
project; `run` executes the approved plan. You are handling `run` — you are
the **model driver**: you choose which legal move runs next; the referee
alone decides legality, meters spend, and admits transitions (D-27).

Arguments passed by the user: $ARGUMENTS

## The contract you are operating under

- **Referee tools are the only interface.** Every move goes through the
  `detent-referee` MCP server's tools: `next`, `claim`, `attempt`, `record`,
  `gate`, `transition`, `status`, `report`. A refused move is illegal —
  present the refusal, never work around it, never retry it unchanged.
- **You never edit, read around, or bypass (D-27/D-28).** While a claim is
  active the containment hook denies you every file write and read, every
  `Task` spawn, and every Bash command matching a bound verification command.
  Do not fight it: sessions do the work through `attempt`; gates run through
  `gate`; state arrives through tool results.
- **Approval first (C-9).** `run` executes only a plan a human approved via
  `init`. If the referee is not connected or reports no approved plan, say so
  and route the user to `/detent:init`.
- **Humans answer human questions (C-10).** At an escalation you present the
  dossier summary and the four choices — approve / requeue with guidance /
  skip / quit — and wait. You never pick for the user.

## The loop

Repeat until the pool is empty or the user quits:

1. Call `next`. If the pool is empty, go to **Finish**.
2. Pick one pool entry — default to the first unless the user directed
   otherwise (R-2: any pool entry is legal; nothing else is) — and call
   `claim` with `{op: "acquire", ticket_id}`. A refusal names the blocker;
   pick another entry.
3. If the claim returned `claimed_ref`, call `transition` with it. If it
   returned `resume`, announce the resume plainly (C-13 labels: diagnosing,
   implementing, fixing, researching the failure, fixing with research
   applied, addressing review findings, in review, verifying).
4. Drive stages by the ticket's current state until it reaches a terminal
   state (`DONE`, `NEEDS_HUMAN`, `BLOCKED`):
   - `IN_PROGRESS` — call `attempt` `{ticket_id, state}`. If the result has
     `falsified_ref`, `transition` with it. Otherwise call `gate`
     If that transition lands on `READY`, the referee found the path the session named in
     another ticket's surface and re-queued this one behind it (X-4′): `release` the claim
     and call `next`.
     `{ticket_id}` and `transition` with the returned `ref`.
   - `BLIND_FIX`, `REVIEW_FIX` — `attempt`, then `gate` + `transition`.
   - `INFORMED_FIX` — `attempt`, then `gate` with
     `{escalate_reason: "informed fix failed — the ladder cannot reopen (D-13)"}`
     and `transition`.
   - `RESEARCH` — `record` `{kind: "stage", stage: "research"}` + `transition`.
   - `IN_REVIEW` — `record` `{kind: "stage", stage: "review"}` + `transition`.
   - `DIAGNOSED` — `record` `{kind: "stage", stage: "diagnose"}` + `transition`.
   - `APPROVED` — `gate` with `{close_check: true}` + `transition`.
5. Structured errors are routes, not failures:
   - `BREACH` — a budget ceiling: call `record` `{kind: "breach", reason}`
     with the message, `transition` with the ref, then handle the terminal
     state.
   - `DRIFT_HALT` — verification changed: call `record`
     `{kind: "drift_halt"}`, present the returned reason, and stop the run
     (outcome `not-ready`).
   - Anything else (`ILLEGAL_TRANSITION`, `BAD_EVIDENCE`, `INVALID_INPUT`) —
     report it verbatim and stop; do not improvise.
6. At a terminal state:
   - `DONE` — `record` `{kind: "finalize"}` then
     `{kind: "close_generation", outcome: "done"}`.
   - `BLOCKED` — `record` `{kind: "close_generation", outcome: "blocked"}`.
   - `NEEDS_HUMAN` — get the reason from `status`, `record`
     `{kind: "dossier", reason}`, `record`
     `{kind: "close_generation", outcome: "needs_human"}`, then present the
     escalation. On **approve**: `record` `{kind: "human", action: {kind:
     "approve", by}}`, `transition`, `record` `{kind: "reopen_generation"}`,
     and drive on from `APPROVED` (step 4). On **requeue**: `record`
     `{kind: "human", action: {kind: "requeue", by, guidance}}`, `transition`,
     `record` `{kind: "open_generation", reason: guidance}`. On **skip**:
     `record` `{kind: "note"}` saying so. On **quit**: finish after release.
7. Always call `claim` `{op: "release", ticket_id}` when the ticket's
   processing ends, whatever happened.

**Finish.** Call `status`. Present exactly one of the four outcomes (C-11):
`ok` (pool empty, nothing pending), `human-gated` (pending tickets — list
each with its reason), `not-ready` (no approved plan, or a drift halt), or
`error`. Ending the session with work still in flight trips a one-shot stop
gate that sends you back into the loop — finish the loop instead.
