---
id: PRDR-122
title: "The D-21 containment hook answered `allow` for every tool it does not govern, and a hook `allow` is terminal in the SDK's permission order — so it silently overrode `allowedTools` for Bash and for every MCP tool"
state: DONE
severity: major
category: security
labels: ["prd-review", "found-by-audit"]
surface: ["src/sessions/guard.ts", "src/sessions/sdk.ts", "src/plugin/hook.ts", "tests/sessions/guard.test.ts", "tests/sec/pack.test.ts", "detent-prd-v3.md"]
prd_refs: ["S-2′", "S-2″", "SEC-3", "D-21", "D-29", "P2", "P7"]
acceptance_criteria: ["The guard returns `abstain` for a call it does not govern — no path named, or a non-mutating tool inside the worktree — and the SDK hook omits `permissionDecision` entirely for it, so the SDK's own deny/ask/allow evaluation proceeds.", "Deny is unchanged and still terminal: outside the worktree, protected, or outside the declared surface for a mutating tool.", "The plugin hook treats `abstain` as silence, never as a refusal — it may narrow what the permission rules grant and never widen it (D-29).", "A `Bash` call outside the role's granted patterns is no longer permitted by the hook, and an MCP tool the guard does not govern is the allowlist's decision rather than a grant."]
non_goals: ["Does not add MCP tool names to the guard's path extraction. The guard governs WHERE a mutation lands; which tools exist at all is the allowlist's job, and that is the separation this restores.", "Does not change what any role is allowlisted. `implement` keeps Read, Grep, Glob, Edit, Write and the two git Bash patterns.", "Does not claim empirical verification of SDK precedence. The fix removes the dependence on it: abstaining is correct under either reading."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-050", "PRDR-068", "PRDR-121"]
depends_on: []
---

# PRDR-122 — the containment hook granted what it was only meant to bound

**Severity:** major · **Category:** security · **Found by:** an adversarial audit of PRDR-121,
5 September 2026

## What happened

`guardToolUse` governs WHERE a mutation may land. For anything else it returned
`{decision: "allow"}` — a pathless call, or a non-mutating tool inside the worktree — on the
reasoning that "bricking the session gains nothing, and the kernel re-runs full gates
regardless (P2)".

That reasoning holds for a hook that merely declines to object. It does not hold for this one.
PRDR-050 recorded the SDK's contract in this repository's own words:

> The SDK evaluates permissions in a fixed order — hooks → deny rules → ask rules → permission
> mode → allow rules → canUseTool. Hooks run before every other step.

So a hook that answers `allow` **ends the evaluation before the allow rules are reached**. The
guard was not declining to object; it was granting.

`implement` is allowlisted exactly `["Read", "Grep", "Glob", "Edit", "Write", "Bash(git add:*)",
"Bash(git commit:*)"]`. A bash call names no path, so `pathOf` returned null, so the guard
answered `allow` — for every command, not just the two granted patterns. The scoping was
decorative.

PRDR-121 made it worse by adding an MCP server. Serena's editing tools take `relative_path`,
not `file_path`, so they too produced a null path and a terminal `allow` — meaning the very
containment claim that ticket was built around ("its editing tools would never pass through the
D-21 hook") was false in the opposite direction. They pass through it; the hook waves them by.

## Evidence

The security pack's own test asserted the behaviour while its comment described the opposite:

> The guard allows path-less calls (bricking gains nothing); containment of what Bash *does* is
> the allowlist plus the kernel's own gate re-run.

The allowlist was named as the real control, by a line that was overriding it.

## Resolution

A third decision: `abstain`. The guard says `deny` when it means it, `allow` only for a
mutating call it has positively cleared, and `abstain` for everything else — where the SDK hook
omits `permissionDecision` entirely and the allowlist decides, as it was always supposed to.
The plugin hook maps `abstain` to silence, matching its own documented rule that it may narrow
and never widen (D-29).

This removes the dependence on the precedence question rather than betting on it: abstaining is
correct whether a hook `allow` is terminal or not.
