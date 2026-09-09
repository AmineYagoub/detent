---
id: PRDR-139
title: "`run` schema-parsed approval.json and never compared `plan_hash`, so tickets edited after approval executed unreviewed"
state: DONE
severity: critical
category: bug
labels: ["prd-review", "found-by-audit", "approval", "recovered"]
surface: ["src/cli/run.ts", "src/init/machine.ts", "src/init/plan-write.ts", "src/kernel/run.ts"]
prd_refs: ["C-9′"]
acceptance_criteria: ["`run` compares the approval's `plan_hash` against the plan it is about to execute.", "The hash covers each ticket's PLAN-DEFINING fields — what a human approved — not whole ticket files.", "An unreadable ticket is SKIPPED, not reported as an edit: damage is not an edit.", "`writePlan` breaks a claim only through `claimBreakable`."]
non_goals: ["Does not change what approval means, only that it is checked."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-192"]
depends_on: []
---

# PRDR-139 — the approval nobody compared

**Severity:** critical · **Category:** bug · **Found by:** the phase-3 audit (`7b652d1`)

> **Recovered 2026-09-09 (PRDR-192).** Filed as an empty file — the filename carried the
> title and nothing else was ever written. Its reasoning survived in the commit that created
> it, and this body is that account. Fields the original never recorded are derived from
> evidence, not invented.

## Problem

`run` schema-parsed `approval.json` and never compared `plan_hash`, so **tickets edited after
approval executed unreviewed.**

`writePlan` also deleted a claim without asking whether its holder was alive — the only claim
breaker in the tree that skipped `claimBreakable`, while its check-then-act guard sat an
entire planning run away from the act.

## The trap, and why reading the writer first mattered

Reading the writer before validating the format — the lesson phase 2 cost — is what stopped
this from bricking every resume. `planHash` hashed **whole ticket files**, and `writeTicket`
rewrites those on every transition, counter bump and note, so the hash changes within seconds
of a run starting. Calling the existing `approvalState` at run start would have refused every
resume. It was already a latent defect on the init side, where a re-init after a partial run
called an untouched plan stale.

The hash now covers each ticket's plan-defining fields. An unreadable ticket is skipped,
because reporting "the tickets have changed since you approved" for a corrupt file
misdiagnoses — `readTicket` refuses it by name a moment later, and that is the error worth
surfacing.

## Fixture correction

Every test's approval carried `plan_hash: sha256("fixture-plan")`, a fabricated value that
could never equal `planHash(root)`. It was viable only because `run` never compared it. The
fixture now approves the plan it actually has.
