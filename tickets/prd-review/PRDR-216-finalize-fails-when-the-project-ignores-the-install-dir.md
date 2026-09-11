---
id: PRDR-216
title: "Finalize's exclude pathspec fails the moment the project ignores the install directory — V-1⁗'s `:!node_modules` is refused by git exactly where node_modules exists and is gitignored"
state: DONE
severity: critical
category: defect
labels: ["prd-review", "finalize", "V-1⁗", "git", "regression", "gate-313"]
surface: ["src/kernel/git.ts", "src/kernel/referee.ts", "tests/kernel/install-run.test.ts", "tests/kernel/git.test.ts", "detent-prd-v3.md"]
prd_refs: ["V-1⁗", "B-2", "B-2′", "P2", "V-6", "N-6", "PRDR-211", "PRDR-151"]
acceptance_criteria: ["`finalizeDone` stages the ticket's tree without naming an ignored path: an ecosystem directory that git already ignores is left to `-A`'s own skip, and only one git does NOT ignore is excluded by pathspec. Observed FIRST (V-6) on gate-313's bootstrap, generation 2: `git add -A -- . :!node_modules` exited 1 with `The following paths are ignored by one of your .gitignore files: node_modules` — the session's `.gitignore` lists `node_modules/`, and the referee's own install had created it. Reproduced in a scratch repository: ignored and present → exit 1; present and not ignored → exit 0.", "End to end (`tests/kernel/install-run.test.ts`): a ticket whose manifest the referee installs, in a project whose `.gitignore` lists the install directory, reaches DONE with exit 0 and its run-branch tree carries the feature and never the install directory. Today the run exits 1 with the ticket already DONE.", "The same in worktree mode, the default — the gate's mode."]
non_goals: ["Does not add `-f` or un-ignore anything: what the referee installed is never part of the change set (V-1⁗).", "Does not touch how a stranded DONE ticket is recovered — that is PRDR-217."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-211", "PRDR-217", "PRDR-213"]
depends_on: []
---

# PRDR-216 — an exclusion git refuses to hear

**Severity:** critical · **Category:** defect · **Found by:** gate-313's walking skeleton, take 3
— the bootstrap's generation 2, DONE at 07:51:06 and the run dead one second later

## Problem

PRDR-211 made `finalizeDone` stage with `git add -A -- . :!node_modules`, so the directory the
referee's install creates never joins the change set. The E2E fixture that proved it has no
`.gitignore`. gate-313's bootstrap does — its own scaffold wrote `node_modules/` into it — and
git's `add` refuses a pathspec that names an ignored path even when the pathspec is an
EXCLUSION:

```
Command failed: git add -A -- . :!node_modules
The following paths are ignored by one of your .gitignore files:
node_modules
hint: Use -f if you really want to add them.
```

Exit 1. The ticket was already DONE (07:51:06, APPROVED → DONE); the merge into the run
branch never happened; the driver's DONE handler catches only a `DriverBreach`, so the throw
escaped `loop()` as exit 1 "while: ticket t-001-bootstrap", with the generation left
`in_flight`. Every project that ignores its install directory — which is every project — hits
this on its first DONE after an install.

Reproduced in a scratch repository: the exclusion fails exactly when the directory exists AND
is ignored; it passes when the directory is untracked and not ignored, and when it is absent.

## The shape

Ask git before naming: an ecosystem directory `git check-ignore` already ignores needs no
pathspec — `-A` skips it — and one git does not ignore is excluded as today. One helper in
`git.ts`, called by `finalizeDone`; the two E2E fixtures grow a `.gitignore`.

## What implementation changed

**Ask git before naming.** `stageAll(cwd, excludeDirs)` in `git.ts` runs `git check-ignore -q`
per ecosystem directory: exit 0 (ignored) means `-A` skips it on its own and no pathspec is
named; exit 1 (not ignored) — or a git that could not answer — keeps the explicit `:!<dir>`
exclusion exactly as V-1⁗ had it. `finalizeDone` calls it in place of the bare `git add`.

**V-6, in order.** Observed on the tree as it was: both new E2E cases — a manifest the referee
installs in a project whose `.gitignore` lists the install directory, non-worktree and
worktree — exited 1 with the ticket already DONE, the gate's exact shape; the unit test's
import of `stageAll` did not exist. Then the change; then the six install/finalize E2E cases and
the two staging unit cases green, and the full suite green.

