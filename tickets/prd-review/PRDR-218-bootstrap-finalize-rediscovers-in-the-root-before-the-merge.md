---
id: PRDR-218
title: "Bootstrap finalize rediscovers in the root before the merge, so under worktrees — the default — every provisional binding stays provisional and V-3 is exempt for the whole run"
state: DONE
severity: critical
category: defect
labels: ["prd-review", "C-4", "V-3", "bindings", "worktree", "B-2″", "gate-313"]
surface: ["src/kernel/referee.ts", "src/kernel/referee-sweeps.ts", "src/init/plan.ts", "tests/kernel/bootstrap-worktree.test.ts", "detent-prd-v3.md"]
prd_refs: ["C-4", "V-1′", "V-3", "B-2″", "D-30", "P2", "V-6", "N-6", "PRDR-145b", "PRDR-217"]
acceptance_criteria: ["`finalizeDone` rediscovers in the ticket's WORK DIRECTORY — the tree that passed the gates — not in the root, so under worktree mode the scaffold bootstrap #1 created is found and every provisional slot it backs is promoted with a real baseline. Observed FIRST (V-6) on gate-313: two finalizes of the bootstrap (07:51:06 and the resumed one at 08:04:33) both noted `0 provisional binding(s) finalized … test, lint, typecheck, build stayed provisional — nothing discoverable backs them`, while the 3.1.0 gate, run without worktrees, promoted 4 of 4. An E2E in worktree mode (greenfield fixture, provisional bindings, a mock bootstrap that writes the scaffold into its worktree) ends with all four slots `approved` on `node-scripts`.", "A provisional binding left behind after the bootstrap ticket is DONE is promoted at the next pool, from the root — which by then carries the merge — with the same kernel note; so a root that finalized under the defective build heals at its next run without hand surgery (D-30), and a crash between the merge and the bindings write heals the same way. gate-313's four bindings are the live falsification at the next restart.", "Nothing changes for non-worktree mode, where the work directory IS the root."]
non_goals: ["Does not touch `verify sync`, which re-executes and re-approves on request (V-3).", "Does not promote a slot nothing discoverable backs: that stays provisional, as C-4 says.", "Does not move `finalizeBootstrap` after the merge: a conflict must not cost the baseline."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-217", "PRDR-145b", "PRDR-115"]
depends_on: ["PRDR-217"]
---

# PRDR-218 — a baseline taken from the wrong tree

**Severity:** critical · **Category:** defect · **Found by:** gate-313's walking skeleton, take 4
— the resumed finalize's own note

## Problem

C-4: greenfield bindings are provisional at init and finalized — drift baseline set — when
bootstrap #1's gates pass. `finalizeDone` does it: `finalizeBootstrap(root, …, { rediscover:
() => discover(this.root).candidates })`, before it stages, commits and merges the worktree.

B-2″ (PRDR-145b) made per-ticket worktrees the default. The bootstrap's scaffold now lives in
`.detent/worktrees/t-001-bootstrap` until the merge, and `discover(this.root)` runs BEFORE the
merge, on a root that has the PRD and the rules file and nothing else. Discovery finds no
`package.json`; every slot "stays provisional — nothing discoverable backs them"; the note is
written; the merge happens one call later. On gate-313 it happened twice — the crashed finalize
of take 3 and PRDR-217's resumed one — with the same note both times:

> bootstrap complete: 0 provisional binding(s) finalized with drift baselines (C-4); test, lint,
> typecheck, build stayed provisional — nothing discoverable backs them

The 3.1.0 gate, run without worktrees, promoted 4 of 4 at the same moment.

The cost is V-3. `checkBinding` exempts a provisional binding from drift — rightly, it has no
baseline — so for the whole 252-ticket build no gate command's config region is watched: a
session may rewrite `vitest.config.ts` or the `test` script and no drift halt fires. The gates
still RUN (PRDR-149 made the command check status-blind), which is why nothing else looked
wrong.

## The shape

Rediscover where the gates ran: the ticket's work directory. Its tree is the one that passed,
and its hashes are the merged result's hashes. And because a root can already carry the
defect's aftermath — gate-313 does — the pool heals it: a provisional binding after the
bootstrap is DONE is promoted from the root at the next pool, with the same note, the same way
PRDR-217 finalizes a stranded ticket.

## What implementation changed

**Rediscovery where the gates ran.** `bootstrapFinalizeDeps(root, workDir, note)` in
`referee-sweeps.ts` builds the C-4 finalize's dependencies with `rediscover` bound to the WORK
DIRECTORY; `finalizeDone` passes the ticket's, which is the worktree under B-2″ and the root
otherwise. The bindings file is still read and written at the root. `referee.ts` lost three
imports and five lines to it.

**The pool heals what the defect left.** `promoteBootstrapBindings(root, note)` runs in
`pool()` after the stranded-finalize sweep: when the bootstrap ticket is DONE and a provisional
binding remains, the same finalize runs from the root — which by then carries the merge — with
its note prefixed `late (PRDR-218)`. Nothing else in the pool changed.

**V-6, in order.** Observed on the tree as it was: a greenfield fixture with four provisional
bindings and a mock bootstrap that writes the scaffold into its worktree ended DONE with all
four still `provisional:greenfield:typescript`; a root built as the aftermath (DONE bootstrap,
merged scaffold, provisional bindings) ran to an empty pool with the bindings untouched. Then
the change; then both green — all four `approved:node-scripts`, the ticket noting `4
provisional binding(s) finalized` in the first case and a `PRDR-218` note in the second — with
the stranded-finalize and init back-half suites unchanged.


## Audit

Cold re-read of the late promotion. It ran the C-4 finalize on every pool while any provisional
binding remained — and a slot nothing discoverable backs stays provisional by design, so on
such a root every pool appended *"late (PRDR-218): bootstrap complete: 0 provisional
binding(s) finalized … stayed provisional"* to the bootstrap ticket, forever. Now the sweep
asks discovery once, finalizes only when a provisional slot is among what it found, and hands
those candidates to the finalize so nothing is discovered twice. Pinned on a scaffold that
backs two of four slots: one note on the first pool, none on the second — observed at two
before the fix. Also checked: `finalizeDone` under non-worktree mode passes the root as the
work directory, so its discovery is byte-for-byte what it was; and `pool()`'s new call sits
after the stranded-finalize sweep, so a bootstrap merged by B-2‴ in the same pool is promoted
in the same pool.
