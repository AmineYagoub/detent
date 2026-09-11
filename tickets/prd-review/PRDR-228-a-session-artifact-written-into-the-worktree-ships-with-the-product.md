---
id: PRDR-228
title: "A session's artifact written to the worktree-relative runs path is admitted by the surface, committed by finalize and merged into the product: `.detent/runs/t-s01-007/blind_fix.json` is tracked on gate-313's run branch"
state: DONE
severity: major
category: defect
labels: ["prd-review", "B-2″", "F-1", "finalize", "containment", "gate-313"]
surface: ["src/kernel/referee-session.ts", "src/kernel/git.ts", "src/kernel/referee.ts", "tests/kernel/session-policy.test.ts", "tests/kernel/git.test.ts", "tests/kernel/worktree-run.test.ts", "detent-prd-v3.md"]
prd_refs: ["B-2″", "F-1", "S-1′", "S-2″", "V-1⁵", "P7", "V-6", "N-6", "PRDR-180", "PRDR-216"]
acceptance_criteria: ["Under worktrees, the session policy's surface no longer carries the worktree-relative `.detent/runs/**`: the artifact area is the ROOT's runs directory, admitted by `artifactRoot` (B-2″, PRDR-180), and a write to `<worktree>/.detent/runs/...` is outside the surface and denied. Observed FIRST (V-6): the policy for a worktree session admits `.detent/runs/**` relative to the work root, and on gate-313 t-s01-007's blind-fix session wrote its artifact there.", "Finalize never stages F-1's LOCAL set: `stageAll` excludes every local layout entry under `.detent/` (`runs`, `state`, `claims`, `worktrees`, `logs`, the ledger, the transitions and hook files) the way it excludes an install directory, asking git first (V-1⁵). Observed FIRST: `t-s01-007: finalize` (6aa2edd) committed `.detent/runs/t-s01-007/blind_fix.json`, which every later worktree and the product itself now carry.", "Non-worktree mode is unchanged: the runs area is the root's, the same directory both ways."]
non_goals: ["Does not stop a session writing its artifact: the told path under the root's runs directory stays writable (S-1′).", "Does not clean gate-313's run branch — that is an operator commit, recorded in the run's notes."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-180", "PRDR-216"]
depends_on: []
---

# PRDR-228 — run state that shipped

**Severity:** major · **Category:** defect · **Found by:** gate-313, while reading t-s01-018's
worktree for PRDR-226

## Problem

A session is told an absolute artifact path under the root's `.detent/runs/<ticket>/`, and
B-2″ (PRDR-180) admits that directory through `artifactRoot`. The policy ALSO lists
`.detent/runs/**` in the surface — right in non-worktree mode, where the work root is the root,
and wrong under worktrees, where it resolves to `<worktree>/.detent/runs/**`: a path inside the
product's tree. t-s01-007's blind-fix session wrote `.detent/runs/t-s01-007/blind_fix.json`
relative to its working directory, the guard allowed it, finalize's `git add -A` staged it,
and `6aa2edd t-s01-007: finalize` merged it into the run branch. It is tracked there now, in
every later worktree, and in the product a reader would clone.

F-1 says the local set "must never travel". Finalize had one exclusion, the install directory
(V-1⁵), and no notion of the layout's own local entries.

## The shape

Two seams. The surface under worktrees admits the root's artifact area only, which
`artifactRoot` already does; the relative runs entry goes. And finalize excludes the F-1 local
set by name, the way it excludes an install directory, so run state cannot join a change set
whichever path wrote it.

## What implementation changed

**The surface admits the artifact root and nothing else of `.detent/`.** The session policy no
longer lists `.detent/runs/**`; an artifact-only role's surface is empty and a write role's is
the ticket's, while `artifactRoot` — the root's runs directory for this ticket — admits the
told path as B-2″ always did. A write to the worktree's own relative runs path is now outside
the surface and denied.

**Finalize excludes F-1's local set.** `stageAll` names every local layout entry under
`.detent/` beside the install directories, asked of git first (V-1⁵), so run state cannot join
a change set whichever path wrote into it.

**V-6, in order.** Observed on the tree as it was: the policy allowed a write to
`<worktree>/.detent/runs/t-1/review.json`; `stageAll` staged an untracked
`.detent/runs/t1/blind_fix.json`; and a worktree run on a root whose run branch tracks no
`.detent/` — gate-313's shape — merged a session's relative runs write into the run branch.
Then the change; then all three green, the existing artifact-root cases untouched.

