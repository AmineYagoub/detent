---
id: PRDR-049
title: "Scope V-3's drift halt: name the ticket outcome, the claim, and the multi-worker case"
state: READY
severity: major
category: security
labels: ["prd-review"]
surface: ["foreman-prd-v2.md"]
prd_refs: ["V-3", "SEC-5", "ARCH-1", "X-3", "C-9", "C-11", "F-1", "NG4"]
acceptance_criteria: ["A drift halt is representable in the X-3 machine — either an event exists for it or V-3 states explicitly that the halt is outside the machine and why that does not violate ARCH-1.", "V-3 names what happens to the in-flight ticket's persisted state and its claim, so `run` re-invocation after a halt has one defined behaviour rather than two.", "The halt's blast radius is stated: whether it stops the current ticket only or the whole run, and the answer is consistent with SEC-5's tampering posture.", "A drift halt is distinguishable in `transitions.jsonl` from a crash, satisfying N-5's reconstruction guarantee for a halt that is a security event.", "NG4's lifting conditions name cross-worker halt propagation, since SEC-5's tampering posture cannot be satisfied by letting sibling workers finish."]
non_goals: ["Does not weaken V-3's halting posture or make drift a warning; the halt stays mandatory and stays a security control per SEC-5.", "Does not change `verify sync` as the re-baselining path (C-12), nor the provisional-binding exemption of C-4.", "Does not lift NG4 or design the cross-worker propagation mechanism; naming it as a lifting condition is sufficient."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-049 — Scope V-3's drift halt: name the ticket outcome, the claim, and the multi-worker case

**Severity:** major · **Category:** security · **Amends:** V-3, X-3, NG4

## Problem

V-3 mandates a halt on gate-definition drift and SEC-5 elevates it from convenience to security control — gate redefinition mid-run is *tampering* until a human re-baselines. Three things about that halt are unstated, and the first is structural.

**The halt has no representation in the state machine.** X-3's event list is closed and enumerated, and it contains no drift event. So a drift halt is a process exit that bypasses the transition table entirely. ARCH-1 states that the kernel alone validates artifacts, applies events, and decides what happens next; a control-flow path that terminates a run without applying an event is a hole in exactly that claim. Every other terminal condition in the document — budget breach, review rejection, upstream bug, human requeue — is an event with a row. Drift is the exception, and it is the one designated a security control.

**The in-flight ticket's state and claim are undefined.** V-3 says the run halts before the next gate with exit 2. It does not say whether the ticket that was mid-flight returns to READY, stays in its current writing state, or is marked. Nor whether its claim is released. C-9 provisions the resumable pool for exactly this class of interruption, and F-1 provisions `claims/`, but a deliberate security halt is not a crash: on re-invocation after the operator runs `verify sync`, does `run` resume that ticket where it stopped, or re-claim it fresh? Both are implementable and they differ in whether budget already consumed in that generation is honoured.

**The blast radius is unstated even single-worker, and unsatisfiable multi-worker.** V-3 detects drift per gate slot ("before every gate") but halts at run scope (exit 2, and C-11 glosses code 2 as "binding drift"). With N workers the posture becomes incoherent: worker A detects tampering while B, C and D hold claims and have sessions in flight. SEC-5's framing forbids letting them finish — the gate definitions they are about to run against are the ones under suspicion — but no cross-worker halt primitive exists, and NG4's list of what lifting it requires does not mention one. This is the security-shaped counterpart to the append-protocol and merge-path items already recorded there.

## Evidence (verbatim from foreman-prd-v2.md)

- V-3: "Before every gate, re-resolve and compare with the stored record. Any drift in a gate definition is a halting event (exit 2, "verification changed — re-baseline"), never a silent re-resolve."
- SEC-5: "Drift halting (V-3) is a security control, not a convenience: gate redefinition mid-run is treated as tampering until a human re-baselines."
- X-3: "Events: `CLAIMED, REPRO_AS_PREDICTED, REPRO_WRONG, PREMISE_FALSIFIED, GATE_GREEN, GATE_RED, RESEARCH_VALID, RESEARCH_DRY, UPSTREAM_BUG, REVIEW_APPROVE, REVIEW_CHANGES, RISK_LABEL_REQUIRED, HUMAN_APPROVED, HUMAN_REQUEUE, BUDGET_BREACH`."
- ARCH-1: "the kernel alone validates artifacts, applies events, and decides what happens next (P2)"
- C-9: "Claims tickets atomically; resumable pool includes all non-terminal in-flight states, so crash/interrupt/escalation resume by re-running `run`."
- C-11: "`2` not ready (no/unapproved plan, binding drift)"
- N-5: "`transitions.jsonl` + ledger + journals reconstruct any run without model output."
- NG4: "Lifting NG4 requires a defined append protocol for the run-level artifacts of F-1 — per-worker shard files reconciled at read time, an exclusive append lock, or a single serializing writer — in addition to a tested concurrent-merge path."

## Proposed change

**1. Give drift an event.** Add `GATE_DRIFT` to X-3's event list and a row: "| any non-`DONE` state | GATE_DRIFT | BLOCKED (binding under suspicion; `verify sync` + human re-baseline required) |". `BLOCKED` is the correct target rather than NEEDS_HUMAN: the ticket is not awaiting a judgement about its own work, it is awaiting an external re-baseline, which is the same shape as the `UPSTREAM_BUG` row. This also makes the halt reconstructable from `transitions.jsonl` (N-5) and distinguishable from a crash, which leaves no such row.

**2. State the outcome and the claim.** Add to V-3: "On drift the kernel applies `GATE_DRIFT` to every non-terminal claimed ticket, releases their claims, and exits `2`. Budget consumed in the current generation is retained — drift is not the ticket's fault, but re-running its consumed sessions would be unbudgeted work. After `verify sync` re-baselines, `run` re-claims the ticket from `BLOCKED` via `HUMAN_REQUEUE`, opening a new generation (X-8) with the drift recorded as that generation's opening reason."

**3. Add the fourth lifting condition to NG4.** Amend the closing sentence to add: "...and a cross-worker halt propagation path — SEC-5 treats mid-run gate redefinition as tampering, so a drift detected by one worker must stop its siblings before their next gate rather than letting in-flight work complete against bindings under suspicion."

## Acceptance criteria

1. A drift halt is representable in the X-3 machine — either an event exists for it or V-3 states explicitly that the halt is outside the machine and why that does not violate ARCH-1.
2. V-3 names what happens to the in-flight ticket's persisted state and its claim, so `run` re-invocation after a halt has one defined behaviour rather than two.
3. The halt's blast radius is stated: whether it stops the current ticket only or the whole run, and the answer is consistent with SEC-5's tampering posture.
4. A drift halt is distinguishable in `transitions.jsonl` from a crash, satisfying N-5's reconstruction guarantee for a halt that is a security event.
5. NG4's lifting conditions name cross-worker halt propagation, since SEC-5's tampering posture cannot be satisfied by letting sibling workers finish.

## Non-goals

- Does not weaken V-3's halting posture or make drift a warning; the halt stays mandatory and stays a security control per SEC-5.
- Does not change `verify sync` as the re-baselining path (C-12), nor the provisional-binding exemption of C-4.
- Does not lift NG4 or design the cross-worker propagation mechanism; naming it as a lifting condition is sufficient.
