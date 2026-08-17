---
id: PRDR-045
title: "Define the claim interaction between C-12 state-mutating plumbing and a live run"
state: DONE
severity: major
category: gap
labels: ["prd-review"]
surface: ["foreman-prd-v2.md"]
prd_refs: ["C-12", "C-9", "C-10", "C-11", "X-3", "X-8", "F-1", "NG4"]
acceptance_criteria: ["C-12 states whether `approve <id>` and `requeue <id>` must respect the C-9 claim, and names the outcome when the ticket is claimed — refusal or acquisition — with no third reading available.", "If refusal is chosen, C-11's exit-code list covers the case; if a new code is needed, C-11 is amended rather than overloaded silently.", "The PRD states which X-3 rows plumbing may drive and from which states, so a reader can determine whether `approve` on an IN_PROGRESS ticket is legal without consulting an implementation.", "A stale claim (crashed run) is distinguishable from a live one, and the PRD says how — otherwise the refusal path deadlocks the operator after any crash.", "NG4's single-worker statement is qualified to say whether plumbing counts as a second writer of ticket state."]
non_goals: ["Does not lift NG4 or introduce parallel ticket execution.", "Does not add plumbing commands beyond C-12's existing six, nor move any of them onto the golden path (C-14 unaffected).", "Does not specify a claim file format or locking primitive."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-045 — Define the claim interaction between C-12 state-mutating plumbing and a live run

**Severity:** major · **Category:** gap · **Amends:** C-12, C-9, C-11, NG4

**Applied in 2.0-draft.5.** See the PRD's draft.5 amendment note for where this ticket was reconciled against another.

## Problem

Four of C-12's six plumbing commands are read-only or run-scoped. Two — `approve <id>` and `requeue <id>` — mutate ticket state, driving the X-3 rows `NEEDS_HUMAN → HUMAN_APPROVED → APPROVED` and `NEEDS_HUMAN / BLOCKED → HUMAN_REQUEUE → READY`. C-9 requires `run` to claim tickets atomically and F-1 provisions `claims/` for the purpose. The PRD never says whether plumbing must respect that claim.

The gap is reachable in normal operation. C-10 specifies that on a TTY escalations resolve inside `run`, but non-TTY exits 10 with a machine summary — so the intended CI flow is that `run` exits, an operator or script inspects, and plumbing resolves the escalation out of band. That flow is fine. The undefined case is the overlapping one: `run` is live in one terminal, holding a claim on `t-014` and awaiting a session, while an operator in another terminal issues `foreman requeue t-014`. Under X-8 that opens a new generation and zeroes every counter — while the current generation still has a session in flight whose telemetry will be charged on return. The result is a ticket whose budget state does not describe the work being done, which is the exact failure P6 exists to prevent.

`approve` has a milder version of the same problem: it re-enters APPROVED for kernel re-verification, which is a state the live run may already be driving.

NG4 declares single-worker operation, but it scopes that to *ticket execution* — "parallel ticket execution ... v1 documents single-worker operation". Plumbing is not a ticket-execution worker, so NG4 does not cover this case, and an operator running one `run` and one `requeue` is not violating any stated non-goal.

Finally, if the resolution is that plumbing refuses on a claimed ticket, the PRD must also say how a *stale* claim is recognised. C-9's resumable pool exists precisely because runs crash; after a crash the claim file outlives the process, and a refusal rule with no staleness rule leaves the operator unable to requeue anything until they hand-delete a file the PRD never describes.

## Evidence (verbatim from foreman-prd-v2.md)

- C-12: "Plumbing (documented, scriptable, never required on the golden path): `status`, `approve <id>`, `requeue <id>`, `verify sync`, `doctor` (env + pin + one live smoke session), `report`."
- C-9: "Claims tickets atomically; resumable pool includes all non-terminal in-flight states, so crash/interrupt/escalation resume by re-running `run`."
- C-10: "Non-TTY: exit 10 with a machine-readable summary on stdout."
- C-11: "`0` plan complete; `10` human-gated items remain; `2` not ready (no/unapproved plan, binding drift); `1` error."
- X-3: "| NEEDS_HUMAN / BLOCKED | HUMAN_REQUEUE | READY (new attempt generation — X-8) |"
- X-8: "every X-1 counter restarts at zero for the new generation"
- F-1 local set: "`claims/`"
- NG4: "parallel ticket execution (claims are atomic and worktrees exist behind a flag, but v1 documents single-worker operation; concurrent merge to the run branch is untested)"

## Proposed change

Add to C-12, after the command list:

"**Claim discipline.** `approve` and `requeue` mutate ticket state and therefore respect the C-9 claim. Both refuse with exit `2` when the target ticket is claimed by a live run, naming the claiming pid and the claim's age; the operator resolves the escalation inside `run` (C-10) or stops the run first. A claim whose owning process is no longer alive is stale: plumbing may break a stale claim, and doing so is recorded in `transitions.jsonl` as an operator action with the broken claim's pid. The remaining four plumbing commands are read-only with respect to ticket state and are always safe to run concurrently.

Legality is otherwise governed by X-3: `approve` is admissible only from `NEEDS_HUMAN`, `requeue` only from `NEEDS_HUMAN` or `BLOCKED`. Invoked from any other state, both exit `2` naming the current state — plumbing cannot reach an X-3 row that the table does not offer."

Amend NG4 to close the ambiguity: "...v1 documents single-worker operation for ticket execution; state-mutating plumbing (C-12) is a second potential writer and is serialized against the run by claim discipline, not by this non-goal."

## Acceptance criteria

1. C-12 states whether `approve <id>` and `requeue <id>` must respect the C-9 claim, and names the outcome when the ticket is claimed — refusal or acquisition — with no third reading available.
2. If refusal is chosen, C-11's exit-code list covers the case; if a new code is needed, C-11 is amended rather than overloaded silently.
3. The PRD states which X-3 rows plumbing may drive and from which states, so a reader can determine whether `approve` on an IN_PROGRESS ticket is legal without consulting an implementation.
4. A stale claim (crashed run) is distinguishable from a live one, and the PRD says how — otherwise the refusal path deadlocks the operator after any crash.
5. NG4's single-worker statement is qualified to say whether plumbing counts as a second writer of ticket state.

## Non-goals

- Does not lift NG4 or introduce parallel ticket execution.
- Does not add plumbing commands beyond C-12's existing six, nor move any of them onto the golden path (C-14 unaffected).
- Does not specify a claim file format or locking primitive.
