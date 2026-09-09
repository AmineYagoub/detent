---
id: PRDR-145b
title: "Per-ticket worktrees become the default, `--no-worktree` the escape"
state: DONE
severity: minor
category: design
labels: ["prd-review", "found-by-audit", "recovered"]
surface: ["src/cli/run.ts", "README.md"]
prd_refs: ["B-2″"]
acceptance_criteria: ["Per-ticket worktrees are the default and `--no-worktree` is the escape.", "The README states the posture rather than leaving it to be discovered."]
non_goals: ["Does not change merge behaviour; PRDR-145a is the precondition that made this safe."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-145a", "PRDR-146", "PRDR-192"]
depends_on: ["PRDR-145a"]
---

# PRDR-145b — worktrees by default

**Severity:** minor · **Category:** design · **Found by:** the phase-3 audit (`7b652d1`)

> **Recovered 2026-09-09 (PRDR-192).** Filed as an empty file — the filename carried the
> title and nothing else was ever written. Its reasoning survived in the commit that created
> it, and this body is that account. Fields the original never recorded are derived from
> evidence, not invented.

## Change

Per-ticket worktrees are the default, `--no-worktree` the escape, and the README states the
posture rather than leaving it to be discovered.

This depends on PRDR-145a: an unguarded merge that deleted the branch on conflict made
worktrees unsafe to default to, so that fix is the precondition for this one.
