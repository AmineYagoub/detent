---
id: PRDR-100
title: "A terminated session's untracked debris fails every later ticket's gate, and no fix rung can clear it"
state: DONE
severity: major
category: correctness
labels: ["prd-review", "found-by-execution"]
surface: ["src/kernel/git.ts", "src/kernel/referee-gate.ts", "src/kernel/referee.ts"]
prd_refs: ["B-5", "V-1", "X-2", "P3", "D-21"]
acceptance_criteria: ["A ticket's gate cannot be failed by uncommitted files that another ticket's terminated session left behind and that this ticket's surface forbids it from touching.", "B-5's deliberate behaviour is preserved where it is right: a ticket resuming its OWN crashed session still finds its own partial work and is still judged on the tree as-is.", "When a gate failure is caused by files outside the claiming ticket's surface, the dossier says so by name — an operator must not have to diff the worktree to discover the ticket was never at fault.", "A regression test reproduces it: terminate ticket A mid-work leaving untracked files in A's surface, claim ticket B whose surface excludes them, and assert B's gate is not failed by A's residue."]
non_goals: ["Does not scope the gate to a surface. P3 means the gate is the project's own whole-tree command, and narrowing it would weaken verification rather than fix this.", "Does not change PRDR-097's turns-breach halt, which behaved correctly — it merely produced the first terminated session this defect could feed on.", "Does not delete a ticket's own partial work; B-5 keeps it for the resume it was written for."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-094", "PRDR-097"]
depends_on: []
---

# PRDR-100 — a terminated session's debris fails every later ticket's gate

**Severity:** major · **Category:** correctness · **Found by:** execution, on the N-7 gate

## Problem

`resetDirtyTracked` restores tracked files at resume and **deliberately leaves untracked
files in place** — "the gate judges the tree as-is" — which is right for a ticket resuming
its own crashed session. It is wrong for every OTHER ticket, because the gate is
whole-tree by design (P3: the project's own commands), so one ticket's abandoned output
becomes another ticket's gate failure.

Observed end to end:

1. **t-116** (`V-1 deterministic binding discovery`, surface `src/verification/discovery/**`,
   `tests/verification/**`) breached the turns ceiling at 103 turns and was terminated
   mid-work, leaving 21 untracked files across both directories.
2. **t-102** (surface `src/kernel/fs/**`, `tests/fs/**`, `.detent/.gitignore`) then claimed
   and ran its gate. The lint gate lints the whole tree:

   > `tests/verification/discovery/determinism.test.ts` was not found by the project
   > service. Consider either including it in the tsconfig.json…

3. t-102 cannot fix that. The files are outside its declared surface, D-21 denies the
   write, and they belong to a ticket that is still IN_PROGRESS.
4. It burned its whole ladder trying anyway — implement, `blind_fix`, `research`,
   `informed_fix`, roughly **$5.80** — and landed in NEEDS_HUMAN.

Removing t-116's 21 untracked files made the lint gate pass immediately, with no change to
t-102 whatsoever. The ticket was never at fault.

## It is not the planner's fault, nor the reviewer's

Worth stating because both are the natural suspects, and the evidence clears both.

**The surfaces were perfectly disjoint.** `t-102` declares `src/kernel/fs/**`,
`tests/fs/**`, `.detent/.gitignore`; `t-116` declares `src/verification/discovery/**`,
`tests/verification/**`. The debris paths are claimed by t-116 and never by t-102. This is
precisely the condition PRDR-094's old comment ASSUMED made things safe — "disjoint across
tickets by the plan's own contract" — and the failure occurs regardless, because surfaces
are scoped while the gate is whole-tree. No plan can close that gap.

**The reviewer never ran.** A green gate is the precondition for review, and t-102 never
got one. Had it, the diff it judges now contains only the ticket's own commits (PRDR-094),
so another ticket's uncommitted files would not appear in it.

**No instruction to "clean up" could work.** The only role that meets the debris is the
claiming ticket's implement session, and D-21 denies it every write outside its surface.
SEC-3's expansion lever is not an answer either: a request to delete another IN_PROGRESS
ticket's work is one the referee should refuse. The containment that makes Detent safe is
exactly what makes this unfixable from inside a session — which is why it belongs to the
kernel.

## Why it is major

**No rung can resolve it.** Every fix session is handed a red gate whose cause is
unreachable from its surface, so it either flails or reports success against a tree that
is still red. The ladder is guaranteed to exhaust, exactly as in PRDR-094 — the same
defect shape (a ticket judged on another ticket's work) relocated from the review side to
the gate side.

**It compounds.** The debris outlives the session that made it, so every subsequent ticket
inherits the same unfixable failure until an operator notices and clears it by hand. One
terminated session can consume the ladder budget of every ticket after it.

**It is silent about its cause.** The dossier records a lint failure and a signature.
Nothing says the failing paths lie outside the claiming ticket's surface, so the
operator's natural reading is that the implementer wrote bad code.

## Direction (not a decision)

The claiming ticket's surface is already known, and so is every other ticket's. A gate
failure whose paths fall outside the claimant's surface is attributable before the ladder
is entered, which is the cheapest place either to quarantine the residue or to name it in
the dossier. Deleting a terminated session's untracked output at termination is the
blunter alternative and forfeits B-5's same-ticket resume, so it should not be reached for
first.

## Resolution

`settleWorktree`, called at claim before the ticket is judged: restore the parked files
this ticket owns, park the untracked files it does not. Nothing is deleted, so B-5's
same-ticket resume keeps working — a ticket that crashed mid-work still finds its own
partial output; it is only ever moved aside while somebody else holds the claim.

Two placement decisions carry the fix. The park lives under `.git/detent-parked/` because
anywhere in the worktree would be linted or tested, and `.detent/` especially so — the F-2
boundary lint fails when project sources appear under it, which would have traded one gate
failure for another. And `.detent/` itself is never parked: it is the kernel's own state,
not any ticket's work.

The claim path is where this belongs because a READY claim returns before
`resetDirtyTracked` ever runs — which is exactly why a fresh ticket inherited the residue
with no cleanup step to intercept it.

Covered by `tests/kernel/parked-debris.test.ts`: foreign residue parked, the claimant's own
untracked work untouched, the park kept out of the worktree, the owner getting its files
back, and `.detent/` left alone.

## Aside — found while filing this

Committing this ticket was itself denied by the D-28 hook, because the commit message text
contained the bound gate command as a substring and `deny_bash_containing` matches the raw
command line rather than an actual gate invocation. Any command that merely mentions the
gate command — a commit message, a grep, an echo — is refused. Minor, and separable from
this ticket, but it belongs on the record next to PRDR-099 as another case of a policy
written for a session being applied to a bystander.
