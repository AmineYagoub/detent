---
id: PRDR-230
title: "Verification drift is anchored to a stored hash the root moves past, so every worktree cut before an accepted config change is falsely blocked — and the acceptance record sits in a directory its own session may write"
state: DONE
severity: critical
category: defect
labels: ["prd-review", "V-3", "SEC-5", "drift", "worktree", "B-2″", "gate-313", "regression"]
surface: ["src/kernel/drift-base.ts", "src/kernel/referee-gate.ts", "src/kernel/referee.ts", "src/cli/verify.ts", "src/adapter/drift.ts", "src/adapter/discover/index.ts", "tests/kernel/drift-worktree.test.ts", "tests/kernel/session-policy.test.ts", "detent-prd-v3.md"]
prd_refs: ["V-3", "V-3‴", "SEC-5", "SEC-3", "B-2″", "C-4", "P7", "V-6", "N-6", "PRDR-226", "PRDR-228", "PRDR-149"]
acceptance_criteria: ["A ticket's tree is judged against the config at the commit its branch was CUT FROM, derived live as `git merge-base HEAD <run branch>` in the work directory — never against a hash captured from the root at some later moment. A bound gate has drifted for that ticket only when the region in its working tree differs from the region at its fork commit. Observed FIRST (V-6): on gate-313, t-s01-003's tree and its fork commit both carry `\"lint\": \"eslint .\"` and its own commits touched only its two source files, yet `drift_base.json` holds the root's post-acceptance hash `3db79db4` and the ticket is BLOCKED with `Stored config_hash 3db79db4…, current 8019c5e0…`.", "The fork's configuration is read by materialising that commit's root-level marker files into a scratch directory and running the ordinary discovery over them, so the comparison is region-level and uses one discovery implementation. A fork that cannot be resolved, or that defines no candidate for a bound slot, falls back to today's check against the root's approved binding — never to a weaker answer.", "`drift_base.json` and `recordGenerationBaseline` are deleted: the record is derivable, and a stored one is wrong twice over — it holds whatever the root held when it was written, and its write-once guard keys on a file that did not exist for worktrees cut before PRDR-226, so it was written late against a root that had moved. Verified on all four live worktrees: `claim_base.json`'s sha equals `git merge-base HEAD <run branch>` exactly, and all four fork at commits carrying the OLD lint region.", "The acceptance record moves out of the ticket's artifact directory. `.detent/runs/<id>/drift_accept.json` sits inside `artifactRoot`, which the containment guard admits for mutation, so a session could forge acceptance of its own gate weakening (SEC-5). It moves under `.detent/state/`, which no session surface and no artifact root admits. Observed FIRST: `guardToolUse(\"Write\", {file_path: <runs>/<id>/drift_accept.json}, policy)` allows.", "Non-worktree mode is byte-identical to today: there is no ticket branch, so the fork comparison is skipped and the root's bindings decide, exactly as before.", "The three other live worktrees — t-s01-005, t-s01-006, t-s01-012 — each fork at a commit carrying the old lint region and each would block on its next claim under today's code; after this, none of them does, and t-s01-018's real change would still have been charged and blocked. Both directions proved on the real repository."]
non_goals: ["Does not add the approvals ledger the design panel recommended for proving a fork hash was once executed — the run branch's config is accepted-by-induction because a change to it blocks its own ticket, and the ledger guards holes that live elsewhere. Filed separately with the panel's evidence rather than bundled into a fix for the subsystem this ticket is repairing.", "Does not address the referee's `npm install` running a worktree's own prepare/postinstall scripts, nor the package-manager flip a written lockfile can cause. Filed separately.", "Does not rebase stale worktrees onto the run branch: a tree still runs the gate definitions it was cut with, which is now recorded rather than hidden."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-226", "PRDR-228", "PRDR-231", "PRDR-232"]
depends_on: []
---

# PRDR-230 — a baseline that moves, and an acceptance the accused can sign

**Severity:** critical · **Category:** defect · **Found by:** gate-313, take 11 — t-s01-003
blocked at 15:11 having changed nothing; then by a four-design panel with three adversarial
lenses each, which found the second defect

## Problem

**One: the base moves.** PRDR-226 gave each ticket a `drift_base.json`, written once at first
claim from the root's current bindings, meant to be "the baseline this tree branched from". It
is not. It holds whatever the ROOT held at the instant of writing, and its write-once guard
keys on the file existing — so for every worktree cut before PRDR-226 shipped, the first write
happened long after the root had moved. t-s01-003 forked at `c202faf2`, whose `scripts.lint` is
`eslint .`; its tree still carries `eslint .`; its own commits touched only
`src/kernel/store/tickets.ts` and its test. Its base was written after t-s01-018's change was
accepted and merged, so it holds `3db79db4`, and the ticket is blocked for a change the run
branch made, not it. Three more worktrees — t-s01-005, t-s01-006, t-s01-012 — fork at commits
carrying the old region and have no base file yet, so each blocks the same way on its next
claim. The failure is already spreading.

The obvious repair — capture the base by discovering in the tree at first claim — is a real
SEC-5 hole, not an acceptable one: the base would come from a directory the session writes, and
it coincides with the branch point only when the first claim IS the creation claim, which is
exactly the coincidence that broke here.

**Two: the accused can sign the acceptance.** `drift_accept.json` lives in
`.detent/runs/<id>/`, which is the session's `artifactRoot`; the containment guard admits
mutating writes there so a session can produce its artifact. So a session that weakens its own
gate can also write the record that accepts the weakening. PRDR-226 introduced that an hour
before this ticket was filed.

## The shape

The base is a COMMIT, not a hash. `git merge-base HEAD <run branch>`, computed in the work
directory at check time, names the tree the ticket was cut from; nothing can edit it, no record
can go stale, and it is derivable for any worktree at any time — verified equal to the
long-standing `claim_base.json` sha on all four live worktrees. The fork's configuration is
read by materialising that commit's root-level markers into a scratch directory and running the
ordinary discovery over them, so one implementation produces both sides of a region-level
comparison. Anything the fork cannot answer falls back to today's check against the root's
approved binding. And the acceptance record moves to `.detent/state/`, where no surface and no
artifact root reaches.

## What implementation changed

**The base is a commit.** `forkCommit(workDir, runBranch)` is `git merge-base HEAD <run
branch>`, null when git cannot answer. `discoverAtCommit(workDir, sha)` materialises that
commit's root-level marker blobs into a scratch directory and runs the ordinary `discover()`
over them, so the fork's config regions are hashed by the same code as the tree's; the scratch
directory is removed in a `finally`. `bindingsForTree(root, id, workDir, runBranch)` returns the
root's bindings with each slot's `config_hash` replaced by the fork's, and by an operator's
acceptance over that — and returns the root's bindings untouched when the work directory IS the
root, so non-worktree mode is byte-identical. `MARKERS` and `currentFor` are exported so one
definition serves both sides rather than a second copy.

**The stored base is gone.** `recordGenerationBaseline`, `readGenerationBaseline` and
`drift_base.json` are deleted, with the call in `RefereeCore.acquire`. Existing files are inert.

**The acceptance moves out of reach.** `driftAcceptPath(root, id)` is
`.detent/state/drift-accepts/<id>.json`; `acceptDrift`, `readAcceptedDrift`, `hasAcceptedDrift`
and `rebaselineAccepted` all use it. No session surface and no artifact root admits `state/`.

**V-6, in order.** Observed on the tree as it was: a worktree cut before another ticket's
accepted config change, whose own commits changed nothing, was BLOCKED and its run exited 2 —
the live t-s01-003 shape, reproduced end to end; and `guardToolUse("Write", …drift_accept.json)`
answered `allow` under the production policy while the `state/` path answered `deny`. Then the
change; then the stale ticket runs to DONE while the ticket that really changed the gate is
still charged, blocked and named the `--ticket` verb in the same test; the acceptance is
recorded and consumed at the protected path; a root re-baseline does not move a tree's
baseline; an unresolvable run branch yields no fork; and the guard denies the acceptance path.

