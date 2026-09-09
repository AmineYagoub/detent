---
id: PRDR-145a
title: "`mergeWorktree` merged unguarded then removed the worktree and deleted the branch unconditionally, losing the work on any conflict"
state: DONE
severity: major
category: bug
labels: ["prd-review", "found-by-audit", "data-loss", "recovered"]
surface: ["src/kernel/git.ts", "tests/kernel/git.test.ts"]
prd_refs: ["B-2′"]
acceptance_criteria: ["A merge conflict is an OUTCOME: the branch and worktree survive for a human, the run branch does not move, and it routes as a breach."]
non_goals: ["Does not make worktrees the default; that is PRDR-145b, and this is its precondition."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-145b", "PRDR-146", "PRDR-192"]
depends_on: []
---

# PRDR-145a — the unguarded merge

**Severity:** major · **Category:** bug · **Found by:** the phase-2 audit (`e02cf44`)

> **Recovered 2026-09-09 (PRDR-192).** Filed as an empty file — the filename carried the
> title and nothing else was ever written. Its reasoning survived in the commit that created
> it, and this body is that account. Fields the original never recorded are derived from
> evidence, not invented.

## Problem

`mergeWorktree` ran `git merge --no-ff` unguarded and then removed the worktree and deleted
the branch **unconditionally**. Two tickets touching one file therefore left a ticket DONE
with its work unmerged, an orphaned worktree and a stale branch, surfacing only as exit 1.

## Resolution

A conflict is an outcome now: the branch and worktree survive for a human, the run branch does
not move, and it routes as a breach. **This is the precondition for making worktrees the
default** (PRDR-145b).
