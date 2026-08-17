---
id: PRDR-046
title: "State single-writer ownership of run-level artifacts and qualify B-2's parallel-ready claim"
state: DONE
severity: minor
category: gap
labels: ["prd-review"]
surface: ["detent-prd-v2.md"]
prd_refs: ["B-2", "NG4", "F-1", "N-5", "C-9", "S-4"]
acceptance_criteria: ["F-1 states which artifacts are per-ticket and which are per-run, and names the writer of each run-level artifact.", "B-2's \"parallel-ready\" claim either names what remains unsolved for parallelism or is removed; a reader cannot conclude from B-2 alone that enabling `--worktree` with two workers is safe.", "The PRD states that atomic claims (C-9) do not serialize writes to run-level artifacts, so the protection boundary of the claim mechanism is explicit.", "Lifting NG4 is stated to require a defined append protocol for run-level artifacts, so the v2 work item exists in the document rather than being discovered later.", "N-5's reconstruction guarantee is qualified by, or made consistent with, the single-writer statement."]
non_goals: ["Does not lift NG4, remove the `--worktree` flag, or change B-2's merge semantics.", "Does not choose an append protocol for v2 — per-worker shards, an exclusive lock, or a serializing writer process all remain open.", "Does not add a requirement that v1 detect or prevent a second concurrent run; documenting the constraint is sufficient."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-046 — State single-writer ownership of run-level artifacts and qualify B-2's parallel-ready claim

**Severity:** minor · **Category:** gap · **Amends:** B-2, F-1, NG4

**Applied in 2.0-draft.5.** See the PRD's draft.5 amendment note for where this ticket was reconciled against another.

## Problem

The PRD gives two different impressions of how close v1 is to parallel execution, and the gap between them is a class of artifact the claim mechanism does not cover.

C-9's atomic claims are per ticket. F-1's local set contains two artifacts that are per **run**: `ledger.jsonl` and `transitions.jsonl`. A claim on `t-014` says nothing about who may append to either file, so the claim mechanism — the thing NG4 cites as evidence that the ground is prepared — provides no protection for exactly the two files N-5 depends on to reconstruct a run.

B-2 describes `--worktree` as the "parallel-ready path". NG4 hedges with "concurrent merge to the run branch is untested", which names git as the open problem. Neither mentions that two workers appending to a shared JSONL file will interleave rows, and that appends are not atomic above the platform pipe buffer — telemetry-bearing ledger rows (S-4 records usage, cost, and turn fields per session) can exceed it. The consequence is not a merge conflict but silent corruption of the observability substrate, which fails quietly and is discovered only when someone tries to reconstruct a run.

So "parallel-ready" currently overstates the position: git merge is named as untested, while the run-level artifact protocol is not named at all. An implementer reading B-2 could reasonably enable two workers behind the flag and conclude the remaining work was in git.

## Evidence (verbatim from foreman-prd-v2.md)

- B-2: "`--worktree`: per-ticket worktree + branch, merged `--no-ff` into the **run branch** on DONE. Parallel-ready path; v1 still documents single-worker (NG4)."
- NG4: "parallel ticket execution (claims are atomic and worktrees exist behind a flag, but v1 documents single-worker operation; concurrent merge to the run branch is untested)"
- C-9: "Claims tickets atomically"
- F-1 local set: "`state/` (checkpoints), `runs/` (journals, artifacts, dossiers), `ledger.jsonl`, `transitions.jsonl`, `logs/`, `claims/`, `worktrees/`"
- N-5: "`transitions.jsonl` + ledger + journals reconstruct any run without model output."
- S-4: "typed usage/cost/turn fields from SDK results feed the ledger"

## Proposed change

**1. Name the ownership split in F-1.** Add after the local set: "Artifacts are per-ticket or per-run. `state/`, `runs/`, `claims/`, and `worktrees/` are keyed per ticket and serialized by the C-9 claim. `ledger.jsonl` and `transitions.jsonl` are **run-level, single-writer**: exactly one process appends to each for the lifetime of a run. Atomic claims do not serialize these files — a claim scopes a ticket, not the run journal."

**2. Qualify B-2.** Replace "Parallel-ready path; v1 still documents single-worker (NG4)." with: "The worktree isolates a ticket's working tree, which is the git-side prerequisite for parallelism; v1 remains single-worker (NG4). Two problems stay open before workers may run concurrently: concurrent merge to the run branch is untested, and the run-level artifacts of F-1 have no multi-writer append protocol — concurrent appends interleave and are not atomic above the platform pipe buffer."

**3. Record the v2 work item in NG4.** Append: "Lifting this non-goal requires a defined append protocol for run-level artifacts — per-worker shard files reconciled at read time, an exclusive append lock, or a single serializing writer — in addition to a tested concurrent-merge path."

## Acceptance criteria

1. F-1 states which artifacts are per-ticket and which are per-run, and names the writer of each run-level artifact.
2. B-2's "parallel-ready" claim either names what remains unsolved for parallelism or is removed; a reader cannot conclude from B-2 alone that enabling `--worktree` with two workers is safe.
3. The PRD states that atomic claims (C-9) do not serialize writes to run-level artifacts, so the protection boundary of the claim mechanism is explicit.
4. Lifting NG4 is stated to require a defined append protocol for run-level artifacts, so the v2 work item exists in the document rather than being discovered later.
5. N-5's reconstruction guarantee is qualified by, or made consistent with, the single-writer statement.

## Non-goals

- Does not lift NG4, remove the `--worktree` flag, or change B-2's merge semantics.
- Does not choose an append protocol for v2 — per-worker shards, an exclusive lock, or a serializing writer process all remain open.
- Does not add a requirement that v1 detect or prevent a second concurrent run; documenting the constraint is sufficient.
