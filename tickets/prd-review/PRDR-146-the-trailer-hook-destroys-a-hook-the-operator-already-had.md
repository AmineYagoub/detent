---
id: PRDR-146
title: "Installing the trailer hook overwrote a `commit-msg` hook the operator already had"
state: DONE
severity: major
category: gap
labels: ["prd-review", "found-by-audit", "data-loss", "recovered"]
surface: ["src/kernel/git.ts", "tests/kernel/git.test.ts"]
prd_refs: ["B-2″"]
acceptance_criteria: ["An existing hook is not destroyed by installation.", "Re-installing stays idempotent.", "The write reaches the main repository in worktree mode, via `--git-common-dir`."]
non_goals: ["Does not change what the trailer contains."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-145b", "PRDR-192"]
depends_on: []
---

# PRDR-146 — the hook that ate the operator's hook

**Severity:** major · **Category:** gap · **Found by:** the phase-1 audit (`e192c25`)

> **Recovered 2026-09-09 (PRDR-192).** This ticket was filed as an empty file: the
> filename carried the title and nothing else was ever written. Its reasoning survived in
> the commit that created it, and this body is that account. Fields the original never
> recorded are derived from evidence — `surface` from the files the commit changed,
> `state` from the id being cited in shipped code — not invented.

## Problem

Installing Detent's commit-message trailer hook overwrote whatever `commit-msg` hook the
operator already had, without reading it first — a data-loss surface in a tool that runs
unattended.

## Resolution

Re-installing stays idempotent. It writes to `--git-common-dir`, so it reaches the main
repository even in worktree mode — **the one data-loss surface that making worktrees the
default (PRDR-145b) will not cover.**
