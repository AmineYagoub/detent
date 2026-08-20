---
id: PRDR-070
title: "The review basis is blind to untracked work the gate judges"
state: DONE
severity: major
category: consistency
labels: ["prd-review", "found-by-execution"]
surface: ["src/kernel/referee-context.ts"]
prd_refs: ["SEC-3", "D-6", "B-5", "P2"]
acceptance_criteria:
  - "An untracked file inside the ticket's surface appears in the reviewer's diff input as a new-file pseudo-diff."
  - "An untracked file outside the surface stays out of the review basis (PRDR-069's scoping applies to untracked work too)."
  - "Ignored files (.detent/runs, claims) stay excluded — the listing respects the exclude-standard rules."
non_goals:
  - "Does not change B-5: untracked files still survive resume and the gate still judges the tree as-is."
  - "Does not stage, add, or otherwise mutate the index or worktree — the basis is a pure read."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-069"]
depends_on: []
---

# PRDR-070 — the review basis is blind to untracked work the gate judges

**Severity:** major · **Category:** consistency · **Found by:** T-140's live run,
the firing after PRDR-069.

## Problem

B-5 says untracked files stay at resume and "the gate judges the tree as-is" — and it
does: t-107's implement session wrote `src/sessions/`, `src/agents/`, and five test
files without `git add`, and the green gate executed all of them. But the review basis
is `git diff`, which never shows untracked files. The reviewer honestly reported "only
pinning tests, no production code" — factually right about the diff, wrong about the
tree — and the ticket escalated to NEEDS_HUMAN carrying substantial invisible work.
P2 says only artifacts and exit codes count; here the gate's exit code and the
reviewer's input disagreed about which tree they were judging.

## Resolution

The review basis must equal the gate's basis. Untracked files inside the scope
(`git ls-files --others --exclude-standard -- <surface…>`) are appended to the diff as
new-file pseudo-diffs — a pure read, no staging, no index mutation. Outside-surface and
ignored files stay invisible, exactly as PRDR-069 scopes tracked work. No PRD text
change: B-5 and SEC-3 already state the contract this restores.
