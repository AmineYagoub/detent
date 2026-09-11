---
id: PRDR-231
title: "A fork commit's gate configuration is trusted as a baseline without any record that it was ever executed and approved"
state: OPEN
severity: minor
category: hardening
labels: ["prd-review", "V-3", "SEC-5", "drift", "hardening", "design-panel"]
surface: ["src/kernel/drift-base.ts", "src/cli/verify.ts", "src/adapter/bind.ts", "src/fs/layout.ts", "tests/kernel/drift-worktree.test.ts", "detent-prd-v3.md"]
prd_refs: ["V-3", "V-3⁗", "SEC-5", "V-1", "N-6", "PRDR-230"]
acceptance_criteria: ["Every `(slot, adapter, ref, resolved, config_hash)` that is written into an APPROVED binding — at init's binding, at `verify sync`, at `verify sync --ticket`, and at the bootstrap's C-4 finalize — is appended to a ledger under `.detent/state/`, which no session surface admits.", "`bindingsForTree` adopts a fork commit's `config_hash` as a tree's baseline only when that hash appears in the ledger; a fork hash with no ledger entry halts with a message saying the configuration at that branch point was never executed and approved, naming `detent verify sync <root> --ticket <id>`, which executes the gates in that tree and mints the entry.", "A root with no ledger yet — every root that exists today — is migrated by seeding it from the current approved bindings at first read, so no existing root halts on a hash it has been running all along."]
non_goals: ["Does not change which commit is the baseline: V-3⁗'s fork commit stands.", "Does not make the ledger a source of truth for what EXECUTES — the root's approved `resolved` strings remain that."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-230", "PRDR-232"]
depends_on: ["PRDR-230"]
---

# PRDR-231 — a baseline trusted by induction

**Severity:** minor · **Category:** hardening · **Found by:** the four-design panel that settled
PRDR-230, as the one verdict that survives its recommendation

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

_(open)_
