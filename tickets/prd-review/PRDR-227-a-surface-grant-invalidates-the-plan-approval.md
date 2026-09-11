---
id: PRDR-227
title: "A kernel-granted surface expansion changes the ticket the approval was computed over, so the next run start refuses the plan as 'changed since it was approved' — the kernel's own recorded act reads as a human edit"
state: DONE
severity: major
category: defect
labels: ["prd-review", "C-9", "SEC-3", "approval", "surface", "gate-313"]
surface: ["src/schemas/ticket.ts", "src/init/machine.ts", "src/kernel/referee-session.ts", "src/kernel/tickets/mutations.ts", "tests/kernel/grant-approval.test.ts", "detent-prd-v3.md"]
prd_refs: ["C-9", "C-9′", "SEC-3", "X-8", "V-6", "N-6", "PRDR-073", "PRDR-139", "PRDR-153"]
acceptance_criteria: ["A surface grant is recorded as its own field: the ticket schema gains `granted: string[]` (default empty), the grant appends the path to `surface` (the effective surface every reader uses) AND to `granted`, and the approved projection hashes the surface AS PLANNED — `surface` minus `granted` — so a grant leaves the approval valid. Observed FIRST (V-6): a run in which a session's surface request is granted, then a second run on the same root — today the second exits 2 with `the approval in .detent/plan/approval.json is for a different plan`; on gate-313 the first restart after t-s01-018's grant of `package.json` refused with exactly that.", "The projection is otherwise unchanged: an edit to any approved field by anyone still stales the approval (C-9), and a ticket the run filed is still not an edit (PRDR-153).", "A root granted BEFORE this landed is not migrated: its grant is a note, its approval is stale once, and `detent init --approve` re-stamps it — said in the ticket so the operator knows."]
non_goals: ["Does not make grants unrecorded or unlimited: the cap of three per ticket and the SEC-3 floor stand, and the note stays.", "Does not let a session widen the approved surface: the grant is the kernel's, after the session, on a request with a justification."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-073", "PRDR-139", "PRDR-153"]
depends_on: []
---

# PRDR-227 — the kernel's own act, read as a stranger's edit

**Severity:** major · **Category:** defect · **Found by:** gate-313, take 10 — exit 2 one second
after launch

## Problem

C-9: a run executes only what a human approved, and `approval.json` carries the hash of the
plan as it was shown. PRDR-153 anchored that hash to the tickets the plan named, so the run's
own bookkeeping — quarantined and discovered tickets — does not stale it. One kernel act was
left out: a surface grant (PRDR-073, SEC-3's lever) appends the granted path to the ticket's
`surface`, and `surface` is an approved field.

t-s01-018 asked for `package.json`, the kernel granted it with the justification on the record,
the ticket went on. The next restart of the run:

> the approval in .detent/plan/approval.json is for a different plan — the tickets have
> changed since it was given. Re-approve with `detent init` (C-9)

Nobody edited the plan. The human's approval is for the plan; the grant is the kernel widening
one ticket's write surface by one path, after a session, with a cap and a floor and a note —
the very mechanism the approved plan relies on for a surface the planner got wrong.

## The shape

Record the grant as a field and hash the surface as planned. `granted` carries what the kernel
added; `surface` stays the effective surface every reader uses; the approved projection hashes
`surface` minus `granted`. A grant made before the field existed is a note, and that root's
approval is re-stamped once with `detent init --approve`.

## What implementation changed

**A field for the grant.** `granted: string[]` (default empty) joins the ticket schema; new
tickets start with none; `handleSurfaceRequest` appends the granted path to `surface` and to
`granted` in the same write. **The projection subtracts it.** `approvedProjection` hashes
`surface` with every granted path removed and every other approved field as before, so a grant
moves nothing the approval covers, while an edit to the planned surface still does.

**V-6, in order.** Observed on the tree as it was: after a run whose session's request was
granted, the ticket had no `granted` field, the plan hash had moved, and a second run on the
same root exited 2 with `the approval … is for a different plan`. Then the change; then the
grant is a field, the hash is unchanged, the second run starts and finishes the next ticket,
and a hand edit to a surface still stales the approval.


## Audit

Cold re-read. The field defaults to empty through the schema, so every ticket on every root
parses without migration and the projection of an ungranted ticket is byte-for-byte what it
was — the approval hashes of every existing root stand. The grant cap still counts notes, which
is the record that existed before the field and is still written beside it. The census test
that asserts every ticket field is either approved content or declared run state now declares
`granted` as run state with its reason, so the next field added cannot slip past C-9 the way
this one did. No code change.
