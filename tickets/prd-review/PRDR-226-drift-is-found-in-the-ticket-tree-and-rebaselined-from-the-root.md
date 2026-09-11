---
id: PRDR-226
title: "Under worktrees, V-3 drift is found in the ticket's tree and the only sanctioned recovery re-baselines from the root, which never sees it — a legitimate verification change halts the run with no way through"
state: DONE
severity: critical
category: defect
labels: ["prd-review", "V-3", "SEC-5", "drift", "worktree", "B-2″", "verify-sync", "gate-313"]
surface: ["src/kernel/drift-base.ts", "src/kernel/referee-gate.ts", "src/kernel/referee-sweeps.ts", "src/kernel/referee.ts", "src/cli/verify.ts", "tests/kernel/drift-worktree.test.ts", "detent-prd-v3.md"]
prd_refs: ["V-3", "V-3′", "SEC-5", "SEC-3", "D-23", "B-2″", "B-5", "P7", "V-6", "N-6", "PRDR-141", "PRDR-145b", "PRDR-165", "PRDR-218"]
acceptance_criteria: ["A worktree is judged against the verification baseline it BRANCHED FROM: at a ticket's first claim the root's config hashes are recorded once under the ticket's runs directory (`drift_base.json`), and the gate arm judges the ticket's tree against those hashes plus any an operator accepted for that ticket. Observed FIRST (V-6): the gate arm read the ROOT's current bindings and discovered in the worktree (`referee-gate.ts:112`), so on gate-313 t-s01-018's granted change to `scripts.lint` blocked the ticket and the run exited 2; the run branch's `.detent/` is not tracked, so a worktree carries no baseline of its own to read.", "`detent verify sync <root> --ticket <id>` accepts ONE ticket's change: it judges that ticket's tree against its base, executes the bound gates there with the same consent the root sync takes (`--yes` for CI; PRDR-165: never an unexecuted acceptance), records the accepted hashes on the ticket (`drift_accept.json`) and requeues it. The drift halt names this verb. Observed FIRST: `verify sync` on the root found nothing to re-baseline, and a rerun requeued the ticket into the same halt — a loop.", "The ticket's merge carries the change, and `finalizeDone` re-baselines the ROOT from the merged tree and consumes the acceptance, so later tickets branch from a run branch whose config and baseline agree. The drift-requeue sweep leaves a ticket blocked for its own tree's change to the `--ticket` verb instead of requeuing it on a clean root.", "SEC-5 stands: a session writes none of these files — the runs directory is off every surface and `.detent/**` is SEC-3's floor — so only an operator's executed re-baseline makes a changed tree agree with its base.", "Non-worktree mode is unchanged: the tree is the root, the base is read from the root, and `verify sync` on the root is the recovery it always was."]
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

The filed shape — read the baseline from the tree's own `.detent/bindings.json` — was wrong on
a fact checked during implementation: the run branch does not track `.detent/`, so a worktree
carries no baseline of its own. What a tree does have is a base: the root's hashes at the
moment it branched. Two small records under the ticket's runs directory carry what the tree
cannot — the base, written once at the first claim, and the hashes an operator accepted for
this ticket after the gates ran in its tree. The gate arm judges a worktree against those; the
halt names `verify sync --ticket`; the merge carries the change and the root's baseline
follows it there, consuming the acceptance. Nothing a session can write reaches either file.

## What implementation changed

**Two records per ticket.** `src/kernel/drift-base.ts`: `recordGenerationBaseline` writes
`drift_base.json` (the root's slot hashes) once, at the first claim; `acceptDrift` writes
`drift_accept.json`; `bindingsForTree` returns the root's bindings with the base and any
accepted hashes laid over them; `rebaselineAccepted` re-reads the root after the merge, moves
the root's baseline to what the merged tree has, and removes the acceptance.

**Judged where it branched from.** The gate arm judges a worktree with `bindingsForTree` and
the root with the root's bindings as before; its halt message names
`detent verify sync <root> --ticket <id>` for a worktree. `RefereeCore.acquire` records the
base; `finalizeDone` re-baselines and notes it on the ticket.

**The verb.** `verify sync --ticket <id>` (`acceptTicketDrift` in `src/cli/verify.ts`) judges
the ticket's tree against its base, executes the bound gates there under the same consent and
setup rules as the root sync, records the acceptance and requeues the ticket with the reason on
the record. The drift-requeue sweep skips a ticket whose note names the `--ticket` verb.

**V-6, in order.** Observed on the tree as it was: a worktree run whose ticket rewrote the bound
test recipe exited 2 with the ticket BLOCKED; `verifySync` on the root found no drift; a rerun
requeued the ticket and halted on the same tree. Then the change; then the halt names the verb,
accepting requeues, the rerun reaches DONE, the merge carries the change, the root's baseline
follows and agrees with its tree, the acceptance is consumed; the root-only sync leaves the
ticket blocked and the run human-gated instead of looping; and the base is proved frozen at
branch creation against a later root re-baseline. Full suite green, six gates green.
