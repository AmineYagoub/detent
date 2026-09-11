---
id: PRDR-231
title: "A fork commit's gate configuration is trusted as a baseline without any record that it was ever executed and approved"
state: DONE
severity: critical
category: defect
labels: ["prd-review", "V-3", "SEC-5", "drift", "hardening", "design-panel"]
surface: ["src/adapter/approvals.ts", "src/adapter/drift.ts", "src/kernel/drift-base.ts", "tests/kernel/drift-worktree.test.ts", "detent-prd-v3.md"]
prd_refs: ["V-3", "V-3⁗", "SEC-5", "V-1", "N-6", "PRDR-230"]
acceptance_criteria: ["Every `(slot, adapter, ref, resolved, config_hash)` that is written into an APPROVED binding — at init's binding, at `verify sync`, at `verify sync --ticket`, and at the bootstrap's C-4 finalize — is appended to a ledger under `.detent/state/`, which no session surface admits.", "`bindingsForTree` adopts a fork commit's `config_hash` as a tree's baseline only when that hash appears in the ledger; a fork hash with no ledger entry halts with a message saying the configuration at that branch point was never executed and approved, naming `detent verify sync <root> --ticket <id>`, which executes the gates in that tree and mints the entry.", "A root with no ledger yet — every root that exists today — is migrated by seeding it from the current approved bindings at first read, so no existing root halts on a hash it has been running all along."]
non_goals: ["Does not change which commit is the baseline: V-3⁗'s fork commit stands.", "Does not make the ledger a source of truth for what EXECUTES — the root's approved `resolved` strings remain that."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-230", "PRDR-232"]
depends_on: ["PRDR-230", "PRDR-232"]
---

# PRDR-231 — a baseline trusted by induction

**Severity:** critical · **Category:** defect · **Found by:** the four-design panel that settled
PRDR-230, as the one verdict that survives its recommendation

## Severity, re-graded

Filed as minor hardening on the strength of the induction below. The PRDR-230 audit graded the
same gap CRITICAL, on a reading worth recording: under B-2″'s default worktrees the gate arm is
the only production drift assertion, and V-3⁗ judges a tree against its fork — so for every slot
the fork defines, `.detent/bindings.json` has no enforcement role at all. The induction is what
carries SEC-5 there, and an induction is not a control. Re-graded, and next.

## Problem

V-3⁗ judges a ticket's tree against the config at its fork commit, reconstructed from that
commit's blobs. Nothing checks that the reconstructed configuration was ever executed and
approved. It is safe *by induction*: a change to the run branch's config blocks its own ticket
until an operator accepts it, so a fork commit on that branch can only carry accepted config.

The induction is only as strong as the set of ways config can reach the run branch. The panel's
verdict names one that does not go through a drift check at all — a config key no adapter binds
(PRDR-232's lifecycle scripts) — and any future one would be equally invisible. A ledger turns
the inductive argument into a checkable fact, at the cost of one append per approval.

## The shape

An append-only `approvals.jsonl` under `.detent/state/`, written wherever an approved hash is
minted, and consulted before a fork hash becomes a tree's baseline. Seeded from the current
bindings for roots that predate it.

## What implementation changed

**One funnel.** `src/adapter/approvals.ts` holds the record: `recordApprovals` appends a row per
approved binding — slot, adapter, ref, resolved, hash, who approved it, when — and
`approvedHashes` reads them back, skipping a torn last line the way the spend ledger does.
`writeBindings` in `src/adapter/drift.ts` calls it, and every route that mints an approved
binding writes through that one function, so none of them needed a new argument and none can
forget. `acceptDrift` records too, because the accept verb executes the gates in the ticket's
tree before calling it — otherwise an operator's own acceptance would be inadmissible until the
merge.

**Admissibility, not a new halt.** In `bindingsForTree` the candidate baselines — the
operator's accepted hash and the fork's — are filtered by the ledger. An unrecorded hash drops
out; when none survives, the existing line returns the root's binding, which produces an
ordinary `drifted` check on the path that already ends in the `--ticket` remedy. No new
`DriftStatus`, no new message, no change to either caller's signature.

**Seeded once, bounded, stated.** `seedApprovals` runs when the ledger is absent and records the
root's approved bindings plus, for every standing worktree, the configuration it was cut with —
computed from its fork commit, not from any file a session can write. Roots created after this
have a ledger from their first binding and never seed.

**V-6.** The decisive test — a config that reaches the run branch through no approval, then a
worktree cut at that commit — passes with the filter and fails without it, verified by mutation.
Two further tests pin the seed and the acceptance. Then, on the live halted root: seeded 16 rows
and every standing worktree reports no halting drift.

