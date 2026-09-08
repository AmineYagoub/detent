---
id: PRDR-181
title: "attempt launched a session on an unclaimed ticket, the plugin referee had no lock, no gate preflight and a casting approval reader, run never checked the pin, and half-formed telemetry parsed as present"
state: OPEN
severity: critical
category: defect
labels: ["prd-review", "found-by-audit", "spend", "security", "arch-2"]
surface: ["src/kernel/referee.ts", "src/cli/referee.ts", "src/init/machine.ts", "src/kernel/run.ts", "src/sessions/sdk.ts"]
prd_refs: ["D-19", "ARCH-2", "C-9", "V-1″", "X-1‴", "S-4", "S-5"]
acceptance_criteria: ["`attempt` launches only on a ticket this worker holds, and never on a terminal one.", "The plugin referee refuses a root another process holds, refuses to serve with no bound `test` gate, and reads an approval through the same schema `run` does.", "`run` verifies the pinned CLI version before it spends.", "A result message carrying a cost but no usage is not telemetry."]
non_goals: ["Does not make `attempt` re-derive the ladder. Demanding `ticket.state === state` was wrong — the attempt EARNS the transition, it does not follow it — and the first version of this fix broke fifteen tests by asserting otherwise."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-147", "PRDR-135", "PRDR-168", "PRDR-180"]
depends_on: []
---

# PRDR-181 — six controls wired to one driver, or to none

**Severity:** critical · **Category:** defect · **Found by:** the full-project audit of `90a5051`,
findings #3, #2, #8 and three others

Every one of these is ARCH-2's shape: *"a move legal under one driver is legal under the other"*,
with a control living on one side only.

- **`attempt` launched on an unclaimed ticket.** It is driver-facing and read neither the claim nor
  the state, so calling it on a READY, unclaimed ticket started a real billed session from the root
  checkout — with the claim's work directory, base snapshot and hook policy all absent, because
  `acquire` is what establishes them. D-19 calls "no transition on an unverified claim" the single
  most important property the referee holds, and a launch is how a transition is earned.
- **The plugin referee took no run lock.** `acquireRunLock` was wired to `kernel/run.ts` and then
  to `cli/init.ts`, and not here: two referees could serve one root, each enforcing
  `run_spend_usd` against its own view — PRDR-147's exact shape, third occurrence.
- **It also served with no bound `test` gate.** `run` refuses this "before spending rather than at
  the first gate"; the referee let the driver claim and launch first.
- **And it read approvals with a cast.** `approvalState` treated any object with a matching
  `plan_hash` as approved while `run` parses the same file through `approvalSchema`, so
  `{"plan_hash": "…"}` — no approver, no timestamp, no schema version — was refused by one driver
  and accepted by the other.
- **`run` never checked the pinned version.** `checkVersion` had one production caller — `doctor`,
  behind `--smoke` — while `doctor` without `--smoke` reports the pin as "checked at run time". It
  was checked nowhere.
- **Half-formed telemetry parsed as present.** `total_cost_usd` with an EMPTY `modelUsage: {}`
  satisfied the presence check, so a truncated result became a $0 ledger row and a session the
  ceiling never saw. The existing tests covered telemetry entirely absent and an injected
  `telemetryParsed: false`; neither is this shape.

## What the first attempt got wrong

The claim check shipped alongside `ticket.state === state`, which is not the lifecycle: `attempt`
is called with `IN_PROGRESS` while the ticket is READY, because the attempt earns the transition.
Fifteen tests said so immediately. The check that survives is the one that is true — a terminal
ticket has no session left to run.
