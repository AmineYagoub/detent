---
id: PRDR-091
title: "The base guard strands HEAD when it deletes a checked-out branch"
state: DONE
severity: major
category: correctness
labels: ["prd-review", "found-by-execution"]
surface: ["src/kernel/git.ts"]
prd_refs: ["P7", "B-3", "B-5", "C-11"]
acceptance_criteria:
  - "When the guard deletes a session-created branch that HEAD points at, HEAD is re-pointed at the run branch first."
  - "The breach still escalates the ticket exactly as before — the rescue changes the repository's usability, not the verdict."
  - "After the guard runs, `git rev-parse HEAD` resolves and the working tree is usable."
non_goals:
  - "Does not weaken P7: the stray ref is still deleted and the write is still a breach."
  - "Does not restore a detached HEAD or one pointing outside refs/heads — only the ref being deleted is rescued."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-089"]
depends_on: []
---

# PRDR-091 — the base guard strands HEAD when it deletes a checked-out branch

**Severity:** major · **Category:** correctness · **Found by:** a routed A/B arm whose
session ran `checkout -b t-102` and bricked its repository.

## Problem

P7's guard treats a brand-new non-run branch as a base write: it records the violation
and deletes the ref. That is right. What it did not consider is that the session may
have **checked the branch out** — which is exactly what happens when a model interprets
"commit with the ticket id" as "work on a branch named for the ticket."

Deleting the ref then leaves `.git/HEAD` pointing at `refs/heads/t-102`, a branch that
no longer exists. The repository is not corrupt but it is unusable: HEAD is unborn, so
`git rev-parse --abbrev-ref HEAD` fails, `git status` reports the entire tree as newly
added, and the next run dies on

    Command failed: git rev-parse --abbrev-ref HEAD
    fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree

which names nothing a reader can act on. The breach was caught correctly and then buried
under an unrelated failure, and recovery needed a hand-run `git symbolic-ref`.

The irony is precise: the guard exists so a misbehaving session cannot damage the
repository, and its own remedy did the damage the session could not.

## Resolution

Before deleting a stray ref, the guard checks whether HEAD points at it and, if so,
re-points HEAD at the run branch. The ref is still deleted, the violation still
recorded, the ticket still escalated — P7 is unchanged in what it forbids. What changes
is that the repository the operator inherits after a breach is a working one, so the
escalation they read is the breach itself rather than a git error two layers downstream.
