---
id: PRDR-068
title: "D-21's surface must contain MUTATION — read containment starves sessions of their own specification"
state: DONE
severity: major
category: consistency
labels: ["prd-review", "found-by-execution"]
surface: ["detent-prd-v2.md", "detent-prd-v3.md"]
prd_refs: ["S-2", "D-21", "SEC-3", "P7", "P2", "D-6"]
acceptance_criteria:
  - "A session can READ anything inside its worktree — including the planning documents that specify its ticket — while its WRITES stay contained to the declared surface plus the artifact area."
  - "The outside-worktree boundary (P7) holds for every path'd tool, reads included."
  - "Protected globs stay immutable to sessions (SEC-3) — protection governs mutation; reading a ticket or config is not a violation."
  - "The oracle's seven guard semantics keep their meaning: every ported deny case concerned an edit."
non_goals:
  - "Does not open the DRIVER session's policy (D-27: the driver neither reads nor writes files; state flows through referee tools)."
  - "Does not widen any write path: the mutating set is exactly Write/Edit/MultiEdit/NotebookEdit."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-067"]
depends_on: []
---

# PRDR-068 — surface contains mutation; reads are worktree-bounded

**Severity:** major · **Category:** consistency · **Found by:** T-140's tenth firing — the
third occurrence of the same latent flaw, and the one that proved it structural.

## Problem

S-2/D-21 says the hook "denies outside ticket `surface[]`" — and the implementation
(faithful to the oracle) applies that check to EVERY tool call carrying a path, reads
included. Three live firings hit the same wall:

1. The init analyst could not read the planning documents (PRDR-067's amendment opened
   init's policy).
2. The N-7 worker implementing t-100 ("artifact schema vocabulary") was DENIED reading the
   PRD's §10 — its own specification. It filed a surface request nothing granted, produced
   an empty diff, gates stayed green (nothing changed), and only the D-6 review layer
   caught it: "The diff implements none of the four acceptance criteria… the authoritative
   §10 artifact enumeration was never obtained."

A session that cannot read its spec cannot implement it. Reviewers must read the code they
judge; implementers must read the documents and the neighboring modules they integrate
with. Write containment is D-21's load-bearing guarantee; read containment starves the
work while adding no protection the worktree boundary does not already give.

## Resolution

**S-2″.** The D-21 surface check governs MUTATION: path'd calls by the mutating tools
(Write, Edit, MultiEdit, NotebookEdit) are denied outside `surface[]` and denied on
protected globs (SEC-3 — protection is immutability, and reading a protected file is not a
mutation). Non-mutating path'd calls (Read, Grep, Glob, …) are allowed anywhere INSIDE the
worktree; the outside-worktree boundary (P7) holds for every tool, reads included. The
driver-mode policy is unchanged: the model driver neither reads nor writes files (D-27).

Applied to the v3 PRD as **S-2″** (3.0-draft.5). The oracle's seven guard semantics are
preserved — every ported deny case concerned an edit.
