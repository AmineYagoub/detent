---
id: PRDR-104
title: "The Stop re-feed tells a bystander session to drive a loop a headless process already owns"
state: READY
severity: minor
category: correctness
labels: ["prd-review", "found-by-execution"]
surface: ["src/kernel/hook-policy.ts", "src/plugin/hook.ts", "src/kernel/referee.ts"]
prd_refs: ["C-9", "C-12", "D-28", "P2"]
acceptance_criteria: ["A Stop in a session that does NOT own the run's claim receives no instruction to enter the loop — the re-feed reaches the driver or nobody.", "The CLI driver path either does not publish `run_refeed`, or publishes it in a form the Stop hook can tell apart from the plugin path's, so `stage: \"driver\"` stops being written and then ignored.", "A regression test asserts silence: a stage file with `run_refeed` set, a live claim held by another pid, and a Stop payload whose cwd is the run root — the decision is allow, not block.", "Nothing weakens T-120 on the plugin path, where the model IS the driver and the nudge is the mechanism that keeps the loop alive."]
non_goals: ["Does not remove the expiry. `expires_at_ms` is what keeps eleven abandoned experiment folders inert, and it is the part of this design that works.", "Does not make the hook probe liveness of an arbitrary pid as its primary test — the claim file already records the owner, and PRDR-079's breakability predicate already exists for exactly this question.", "Does not touch the PreToolUse containment policy. D-21/S-2'' write denial is unaffected; this is only the Stop decision."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-099", "PRDR-100"]
depends_on: []
---

# PRDR-104 — the loop re-feed has no recipient on the CLI driver path

**Severity:** minor · **Category:** correctness · **Found by:** the hook firing on the
operator's own monitoring session, mid-certification-gate

## Problem

`refreshRunRefeed` is called from `referee.pool()` whenever work remains, and writes
`run_refeed` into `<root>/.detent/stage.json`. The Stop hook reads that file from the
session's cwd and blocks the stop with:

> "Detent run in flight … Continue the loop — call the referee's `next` tool and proceed
> with the next legal move"

That is T-120's loop persistence, and on the **plugin path** (C-1′) it is right: the model
is the driver, and the nudge is what keeps it in the loop.

On the **CLI driver path** there is no model in the loop at all. `detent run` is a headless
`for(;;)` in `driver.ts` that needs no encouragement and cannot receive any. The file even
says so — `refreshRunRefeed` writes `stage: "driver"`, and `publishClaimPolicy` writes
`driver: true` — and the Stop decision never consults either. So the nudge is published with
no recipient, and lands on whatever Claude session happens to have that folder as its cwd.

Observed: an operator session monitoring the N-7 gate. `cd`-ing into the run root to read the
ledger was enough to inherit it.

## Why the instruction is wrong for that session, not merely useless

The nudge does not say "wait". It says call `next` and take the next legal move. A session
that complied would call `claim`/`acquire` against a plan a live driver is already stepping —
two drivers on one plan, which is precisely the condition C-12's claim discipline exists to
prevent. The claim would either be refused (noise) or, on a ticket the driver has not yet
reached, granted — and then two processes hold generations on the same plan.

It survives here only because the referee MCP server was not connected in that session and
the operator declined the instruction. Neither is a mechanism.

## What already works, and should not be touched

`expires_at_ms` bounds the blast radius, and it does its job. Twelve `stage.json` files exist
under the home directory — eleven from abandoned A/B arms, archived runs, and one real
project (`ksar-cloud`), every one of them left behind by a run killed with SIGTERM before
`refreshRunRefeed(root, false)` could remove it. All eleven are expired and therefore inert;
only the live gate's is live. The cleanup path is best-effort and the expiry is the actual
guarantee, which is the correct division.

## Direction (not a decision)

The claim file already records the owning pid, and PRDR-079 already ships a breakability
predicate — verifiably dead owner, on this host, readable claim — used by the pool's
self-heal. A Stop in a session that does not hold the claim, while a live owner does, is
answerable from state that exists. The cheaper alternative is not to write `run_refeed` on
the driver path at all: `refreshRunRefeed` knows which path it is on, and the driver has
never needed the nudge.

## Family

Third instance of one shape: a policy written for a session applied to a bystander.
PRDR-099 is the first; the D-28 aside in PRDR-100 — a `git commit` denied because the
message text contained the gate command as a substring — is the second. Each is individually
minor. The pattern is that the hook surface tests the *project's* state and not *this
session's role in it*, and that generalisation is worth stating once somewhere durable.
