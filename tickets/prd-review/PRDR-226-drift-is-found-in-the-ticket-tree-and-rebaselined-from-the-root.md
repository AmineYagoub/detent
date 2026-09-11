---
id: PRDR-226
title: "Under worktrees, V-3 drift is found in the ticket's tree and the only sanctioned recovery re-baselines from the root, which never sees it — a legitimate verification change halts the run with no way through"
state: OPEN
severity: critical
category: defect
labels: ["prd-review", "V-3", "SEC-5", "drift", "worktree", "B-2″", "verify-sync", "gate-313"]
surface: ["src/kernel/referee-gate.ts", "src/kernel/referee-sweeps.ts", "src/cli/verify.ts", "src/adapter/drift.ts", "tests/kernel/drift-worktree.test.ts", "tests/cli/verify.test.ts", "detent-prd-v3.md"]
prd_refs: ["V-3", "V-3′", "SEC-5", "SEC-3", "D-23", "B-2″", "B-5", "P7", "V-6", "N-6", "PRDR-141", "PRDR-145b", "PRDR-165", "PRDR-218"]
acceptance_criteria: ["The drift check judges a ticket's tree against the baseline IN THAT TREE: the gate arm reads `.detent/bindings.json` from the work directory it discovers in, so a worktree that carries both a verification change and its re-baseline is clean, and one that carries only the change is drift-blocked exactly as today. Observed FIRST (V-6): the gate arm reads the ROOT's bindings and discovers in the worktree (`referee-gate.ts:112`), `verify sync` discovers and writes at the root (`verify.ts:71`), and the drift-requeue sweep checks the root (`referee-sweeps.ts:29`) — so on gate-313, t-s01-018's granted change to `scripts.lint` blocked the ticket, the run exited 2 telling the operator to run `detent verify sync`, and that command, run on the root, would find nothing to re-baseline and requeue the ticket into the same halt.", "`detent verify sync` accepts a ticket's WORKTREE as its root: it discovers there, executes the bound gates there with the same consent (`--yes` for CI), and writes that tree's `.detent/bindings.json` — a committed artifact the ticket's finalize carries to the run branch, so the root's baseline follows the merge and every later ticket branches from a tree whose config and baseline agree. The drift halt names the worktree path to sync.", "The drift-requeue sweep judges each drift-blocked ticket by ITS OWN tree — `assertNoDrift(readBindings(worktree), discover(worktree))` — and requeues only the tickets whose trees are clean; a ticket whose worktree is gone is left as it is. Observed FIRST: today one root-level check requeues all of them at once.", "SEC-5 stands: a session cannot write or remove `.detent/bindings.json` (SEC-3's structural floor), so the only way a tree's config and baseline agree after a change is an operator's `verify sync` that executed the gates — a re-baseline that reads the tree under test is not a re-baseline a session can forge.", "Non-worktree mode is unchanged: the work directory is the root, and every read above is the read it always was."]
non_goals: ["Does not accept a verification change automatically: the halt, the human judgement and the executed re-baseline stay (V-3, SEC-5).", "Does not change what counts as drift or which config regions are watched.", "Does not touch the bootstrap's baseline (V-3″)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-218", "PRDR-141", "PRDR-165", "PRDR-145b"]
depends_on: []
---

# PRDR-226 — a halt with no way through

**Severity:** critical · **Category:** defect · **Found by:** gate-313, take 9 — exit 2 at
11:46:22 on t-s01-018, the first verification change of the build

## Problem

V-3: when the verification config a bound gate depends on changes, the gate is not run — the
ticket blocks, the run halts, and the operator re-baselines with `detent verify sync` after
judging the change (SEC-5: a session must not be able to weaken its own gates). PRDR-141 wired
that command; PRDR-165 made it execute the gates before approving.

t-s01-018 was granted `package.json` (a kernel note records why) and changed the lint script
from `eslint .` to `eslint . && npm run rules:check` — the ticket's job. The gate arm
discovered in the worktree, compared the `lint` region's hash with the ROOT's stored baseline,
and halted:

> drift-blocked: lint: verification changed — re-baseline. Stored config_hash 8019c5e0…,
> current 3db79db4… (package.json). Run `detent verify sync` to accept it.

`verify sync` discovers on the root. The root is the run branch, whose `package.json` still
says `eslint .` — the change lives on `ticket/t-s01-018` until the merge that cannot happen
while the ticket is blocked. So the sanctioned recovery finds no drift, re-approves the hashes
it already has, the sweep requeues the ticket because the root is clean, the gate arm discovers
in the worktree again, and the run halts again. Under B-2″'s default, every ticket that
legitimately touches a gate's config region is a halt the operator cannot clear. The 3.1.0
gate never met this because it ran without worktrees, where the root is the tree.

## The shape

Read the baseline where the tree is. `.detent/bindings.json` is a committed artifact —
"the repository's shared memory" (F-1) — and every worktree carries its own copy, immutable
to sessions (SEC-3). The gate arm compares a tree's discovered config with the baseline in
that same tree; `verify sync` accepts a worktree as its root, executes the gates there and
rewrites that copy; the ticket's finalize carries the new baseline to the run branch with the
change it approves, so the root's copy follows the merge and later tickets branch from a tree
whose config and baseline agree. The sweep judges each blocked ticket by its own tree. Nothing
a session can do produces a tree whose config and baseline agree after a change — only an
operator's executed re-baseline does — so SEC-5 keeps exactly its meaning.

## What implementation changed

_(open)_
