---
id: PRDR-113
title: "The review basis scopes by git pathspec, git cannot read a brace glob, and the reviewer rejected the one commit that satisfied the ticket because it was never shown it"
state: READY
severity: major
category: correctness
labels: ["prd-review", "found-by-execution"]
surface: ["src/kernel/referee-context.ts", "src/kernel/review-scope.ts", "tests/kernel/review-basis.test.ts"]
prd_refs: ["A-5", "D-6", "SEC-3", "D-21"]
acceptance_criteria: ["A surface entry that is a legal Detent glob — braces included — scopes the review basis exactly as it scopes containment: every hunk in a file the glob matches is shown, every hunk it does not match is not.", "The basis's file list is computed by Detent's own matcher, never by handing the glob to git.", "A regression test commits a change under a brace-glob surface and asserts the hunk reaches the reviewer, and that an untracked file under the same glob renders as a pseudo-diff."]
non_goals: ["Does not change what a surface may contain. `src/cli{.ts,/init.ts}` was a legal, granted surface; the defect is downstream of the grant.", "Does not change PRDR-094's basis definition — the ticket's own commits plus the uncommitted tree — only how that basis is filtered."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-094", "PRDR-070", "PRDR-073"]
depends_on: []
---

# PRDR-113 — the review basis scopes by git pathspec, and git cannot read a brace glob

**Severity:** major · **Category:** correctness · **Found by:** t-164, the last ticket of
the certification gate, at review round three

## What happened

t-164's fix session raised a SEC-3 request for `src/cli{.ts,/init.ts}` — a legal glob,
the shape `implement.md` invites — and the referee granted it. The next round committed
`339b083: wire src/cli.ts argv dispatch to runInit/runRun for real`: 101 insertions in
`src/cli.ts`, the exact change every review had asked for.

The third review rejected it: *"this diff contains no hunk for src/cli.ts (or
src/cli/init.ts) anywhere."* It was right. It was never shown one.

`RefereeContext.diff` turns each surface entry into a git pathspec, `:(glob)<entry>`, and
hands it to `git diff` and `git ls-files`. Git's glob pathspec knows `*`, `**`, `?` and
character classes. It does not know braces:

```
$ git show --stat 339b083 -- ':(glob)src/cli{.ts,/init.ts}'
(nothing)
$ git show --stat 339b083 -- src/cli.ts
 src/cli.ts | 105 +++++++++++++...
```

Containment (D-21) and the risk gate (B-4) match surfaces with picomatch, which expands
braces. The review basis is the one consumer that outsourced the match to git, so a
surface could be granted, written to under the hook's approval, gated green — and be
invisible to the only judge. With `review_fix_attempts` exhausted the ticket would have
gone to a human carrying a verdict that was false about the tree.

## Resolution

The basis's file lists come from git unscoped — the commit's changed names, the working
tree's changed names, the untracked names — and Detent's own matcher filters them. The
filtered, concrete paths are what git is asked to diff. One matcher for every consumer
of a surface, which is what a surface is supposed to mean.
