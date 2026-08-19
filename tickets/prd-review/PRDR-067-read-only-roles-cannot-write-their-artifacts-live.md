---
id: PRDR-067
title: "Read-only roles cannot write their artifacts on the live path — S-1's plan mode and S-3's read-only allowlists contradict P2's artifact interface"
state: DONE
severity: major
category: consistency
labels: ["prd-review", "found-by-execution"]
surface: ["detent-prd-v2.md", "detent-prd-v3.md"]
prd_refs: ["S-1", "S-3", "P2", "A-3", "A-4", "A-5", "C-3", "D-21"]
acceptance_criteria:
  - "A read-only role that must produce an artifact can write exactly that artifact on the live path: default permission mode plus a single scoped write rule for its `artifact_out`, composed in the backend's documented specifier syntax (S-3's own mechanism)."
  - "Plan mode remains for artifact-less read-only sessions (doctor's smoke) — the mode was never wrong, only its pairing with an artifact contract."
  - "Read-only-ness is preserved semantically: the allowlist grants no general write tool, and the D-21 hook policy admits only the artifact area beyond the ticket surface."
  - "The init backend's hook policy no longer protects the artifact's own home: init sessions may write `.detent/state/**` and `.detent/research/**` and nothing else; config, plan, and tickets stay kernel-written."
non_goals:
  - "Does not weaken P2: artifacts and exit codes remain the interface; the kernel still validates every artifact through its schema."
  - "Does not grant read-only roles any general write capability — one path, one rule."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-066"]
depends_on: []
---

# PRDR-067 — read-only roles cannot write their artifacts live

**Severity:** major · **Category:** consistency · **Found by:** T-140's second live firing —
the first time a real (non-mock) read-only session ever ran.

## Problem

Three normative claims cannot all hold on the live path:

- **S-1**: "Read-only set {planner, diagnose, research, review} runs `permissionMode: 'plan'`."
  Plan mode blocks file modification — that is its purpose.
- **S-3 / the implementation's `toolsForRole`**: read-only roles get `Read, Grep, Glob` — no
  write tool of any kind.
- **P2 / A-3…A-5 / C-3**: artifacts are the interface, and every one of these roles is
  REQUIRED to produce one — `analyze.ts` says plainly "it writes `analysisPath(root)`", the
  review contract demands a verdict JSON at `artifact_out`, research a brief.

A fourth, init-specific contradiction compounds it: the init backend's D-21 policy listed
`.detent/**` as PROTECTED while `analysisPath` lives at `.detent/state/analysis.json` — the
pipeline commands the model to write to a path its own hook forbids.

Every mock-path test passes because mock stage functions write artifacts as fixtures,
bypassing tools entirely. The live firing failed in seconds:

```
init failed: ANALYZE produced no analysis artifact
[n7:init] init exited 1 before PRESENT
```

## Resolution

**S-1′.** Artifact-producing read-only sessions run `permissionMode: "default"` with their
read-only tool surface plus exactly one scoped write rule, `Write(//<artifact_out>)` —
composed in the backend's documented gitignore-style specifier syntax, the same S-3
mechanism already pinned for `WebFetch(domain:…)`, with `doctor` as the arbiter of an
unrecognized form. Plan mode remains for artifact-less sessions (doctor's smoke ping).
Read-only-ness is enforced where it always belonged: the allowlist (no general write tool)
and the D-21 hook (surface admits the artifact area only).

The init backend's policy inverts from "protect `.detent/**`" to "surface =
`.detent/state/**` + `.detent/research/**`, nothing else": init sessions write analysis,
plan drafts, and research briefs; the kernel alone writes config, tickets, and approval.

Applied to the v3 PRD as **S-1′** (3.0-draft.3). The v2 document stays frozen; v3 carries
the delta.
