---
id: PRDR-094
title: "A stale claim base shows the reviewer other tickets' work, and the fix ladder cannot resolve it"
state: DONE
severity: major
category: correctness
labels: ["prd-review", "found-by-execution"]
surface: ["src/kernel/referee-context.ts", "src/kernel/referee-stage.ts", "src/kernel/git.ts", "detent-prd-v3.md"]
prd_refs: ["A-1", "X-8", "D-6", "D-21", "B-5", "C-9"]
acceptance_criteria: ["A ticket's review diff contains only that ticket's own work, however many other tickets committed to the run branch between its first claim and its review.", "The property survives requeue (X-8): a ticket requeued after other tickets advanced the branch reviews exactly as it would have reviewed immediately, with no foreign hunks.", "The 'judge the whole ticket, not the last patch' intent that pins the base at first acquire is preserved — a ticket that took three fix generations is still reviewed as one body of work.", "A regression test reproduces the failure: claim ticket A, commit tickets B and C touching files inside A's declared surface, then review A and assert its diff names no file changed only by B or C.", "When a review verdict is driven by hunks the ticket did not author, the dossier says so by name rather than recording an unexplained `scope` finding."]
non_goals: ["Does not make surfaces disjoint or change how the planner assigns them — overlap is legal and D-21 already governs writes; this ticket is about what the reviewer is SHOWN, not what the implementer may touch.", "Does not weaken D-6: a genuine out-of-scope write by the implementer must still be caught and still tagged `scope`.", "Does not change the `scope` tag or the reviewer prompt — the reviewer's judgement was correct on every instance observed; it was reasoning about the wrong input.", "Does not revisit PRDR-090's outage halt, which behaved correctly and merely exposes this bug via the requeue that follows it."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-093", "PRDR-090"]
depends_on: []
---

# PRDR-094 — a stale claim base shows the reviewer other tickets' work

**Severity:** major · **Category:** correctness · **Found by:** execution, in the PRDR-093
A/B

## Problem

`recordClaimBase` writes once and never updates:

```ts
recordClaimBase(id: string, workDir: string): void {
  const file = path.join(runsDir(this.root, id), "claim_base.json");
  if (existsSync(file)) return;
  ...
```

The intent is stated in its own comment and is sound: pinning HEAD at the FIRST acquire
means later generations and resumes "judge the whole ticket" rather than only the last
patch. The bug is not that intent — it is that the review basis is a *range*,
`ctx.diff(workDir, ctx.claimBase(id), ticket.surface)`, and a range from a fixed point to
current HEAD sweeps in every commit any other ticket made in between.

Observed directly. In `ab2-c2`, `t-101` ("reject running outside a git work tree", R-5)
pinned its base at `fde1b54` and committed at `c4c3360`. Four tickets then committed
after it:

```
c78fab4 t-102 …
3146137 t-105: finalize
eb5442b t-105: --json output for tally authors (R-4)
ff27ec2 t-104: finalize
61f3b40 t-104: tally files --top <n> busiest paths (R-3)
c4c3360 t-101: reject running outside a git work tree (R-5)   ← the ticket under review
fde1b54 t-100: finalize                                        ← t-101's pinned claim base
```

Its reviewer was shown t-104's and t-105's work and returned, accurately:

> "The entire `files` subcommand wiring … is unrelated to R-5. Only the pre-switch
> RequireWorkTree guard is needed to satisfy the ticket."

The surface filter does not save it. `t-101` declares `internal/cli/**` and
`**/*_test.go`; t-104 and t-105 both wrote `internal/cli/cli.go` and test files, so their
hunks are inside t-101's own surface and pass straight through. Surface overlap is
therefore what lets the foreign commits through the filter, but the stale base is what
puts them in range at all — with disjoint surfaces this bug is invisible, not absent.

## Why it is major rather than cosmetic

**The ladder cannot resolve it.** The finding asks the implementer to remove work that is
outside its surface, belongs to another ticket, and is legitimately DONE. Every generation
re-reads the same foreign hunks and produces the same verdict, so the ticket burns its
whole ladder and lands in NEEDS_HUMAN by construction.

**The documented recovery path creates it.** PRDR-090 halts a run on an outage — correctly
— and the operator's remedy is `detent requeue` (X-8). The run then advances other tickets
while the requeued one waits, and by the time it is reviewed its basis is stale. The
supported way to recover from an outage manufactures unreviewable tickets.

**It is silent about its own cause.** The dossier records `review changes: scope,scope,
scope,scope`, which reads as an implementer that overreached. Nothing in the artifact
points at the diff basis, so the operator's natural response — requeue again, or approve
manually — is either useless or wrong.

Scale, in a controlled run: **45 of 56 blocked tickets across 8 arms**, evenly split
between two conditions that differed only in a prompt, which is how it was isolated as
structural rather than behavioural.

## Direction (not a decision)

Commits already carry their ticket id (`t-104: …`), so a diff assembled from the ticket's
OWN commits — rather than a range endpoint — would preserve the "whole ticket" intent
that the current pin exists to protect, while excluding work the ticket did not author.
Re-recording the base at requeue is the obvious alternative and is worse: it discards
exactly the property the original comment defends.
