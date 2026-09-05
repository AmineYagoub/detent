---
id: PRDR-124
title: "An init session's single write rule was decorative: the guard's fallback surface was `**`, and a cleared mutation returns a terminal allow, so a planner asked for one artifact wrote its draft as part files somewhere else"
state: DONE
severity: major
category: correctness
labels: ["prd-review", "found-by-execution"]
surface: ["src/init/session.ts", "tests/init/stages.test.ts", "tests/sessions/guard.test.ts", "detent-prd-v3.md"]
prd_refs: ["S-1′", "S-2′", "S-2‴", "SEC-3", "D-21", "P2"]
acceptance_criteria: ["An init session carries its own containment policy whose surface is exactly its artifact, so the one write rule the allowlist grants is the one the hook enforces.", "A write to any other path in the repository is denied, including beside the artifact in the same directory.", "Reads are unchanged: non-mutating calls abstain and the worktree bound still holds, because a planner that cannot read the documents cannot analyse them."]
non_goals: ["Does not support a session writing its artifact in parts. The contract is one artifact at the named path; a draft large enough to tempt chunking is still one Write.", "Does not narrow what init sessions may READ. S-1′ was always reads-open, writes-guarded."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-067", "PRDR-122"]
depends_on: []
---

# PRDR-124 — the one write rule was decorative

**Severity:** major · **Category:** correctness · **Found by:** the first self-build gate init
on the 3.1.1 line, 5 September 2026

## What happened

`initSessionSpec` grants exactly one write rule — `Write(<artifact>)` — under a comment
stating the property directly: *"the read-only surface plus exactly one write rule — the
session's own artifact."*

It carried no policy of its own, so the hook fell back to the one the backend was constructed
with: `surface: ["**"]`, protecting only `.detent/plan/**`, `config.json` and `bindings.json`.
A `Write` is a mutating call; inside the worktree, unprotected and matching `**`, the guard
returns `allow` — which is TERMINAL in the SDK's permission order (S-2‴), so the allowlist was
never consulted.

The planner used the freedom. Asked for `.detent/state/plan-draft.json`, it wrote its draft as
`.detent/state/plan/s01-part1.json` and `-part2.json` — 90KB across two files the pipeline
does not read. `plan-draft.json` never appeared. The same files, under their ksar names, had
been sitting unexplained in that repository's state directory since the previous run.

This is the mutating half of PRDR-122. That ticket fixed tools the guard does not govern, by
abstaining. For a mutating call the guard legitimately answers `allow` — and for init, the
question it was answering was "is this anywhere in the repo?".

## Resolution

The policy moves onto the spec, as worker sessions have always done, with `surface` set to the
artifact's own path. Reads are untouched: non-mutating calls abstain and the worktree bound
still holds, so a planner reads the documents exactly as before and writes only what it was
asked for.
