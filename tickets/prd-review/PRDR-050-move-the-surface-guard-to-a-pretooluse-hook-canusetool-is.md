---
id: PRDR-050
title: "Move the surface/protected-glob guard to a PreToolUse hook — canUseTool is bypassed by S-3's allowlists"
state: DONE
severity: major
category: security
labels: ["prd-review"]
surface: ["detent-prd-v2.md"]
prd_refs: ["S-2", "S-3", "SEC-3", "P5", "ARCH-1", "M0"]
acceptance_criteria: ["S-2 names an enforcement mechanism that the SDK guarantees runs on every tool call, and the PRD states why that mechanism was chosen over `canUseTool`.", "S-2 and S-3 are consistent: a reader can determine that per-role tool allowlists do not disable the surface/protected-glob guard.", "SEC-3's protected-glob denial names the same layer as S-2, so there is one enforcement point rather than two named layers that disagree.", "The PRD records that the oracle's hook-layer semantics are preserved rather than relocated, so the M0 hook tests remain a valid conformance target against the real backend.", "S-3's `WebFetch(domain:…)` allowlist form is either confirmed against the backend's documented rule syntax or replaced with a form that is."]
non_goals: ["Does not change what the guard denies — ticket `surface[]`, protected globs, and the surface-expansion request lever are unchanged.", "Does not remove per-role tool allowlists; S-3's deny-by-default posture stands, only the layer that enforces containment moves.", "Does not adopt `bypassPermissions` or weaken any existing denial."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-050 — Move the surface/protected-glob guard to a PreToolUse hook — canUseTool is bypassed by S-3's allowlists

**Severity:** major · **Category:** security · **Amends:** S-2, S-3, SEC-3

## Problem

S-2 places the path/surface guard in a `canUseTool` callback and SEC-3 relies on that same layer to deny ticket/criteria/config self-modification. S-3 independently mandates per-role tool allowlists. Against the actual Agent SDK, those two requirements cancel each other out.

The SDK evaluates permissions in a fixed order — **hooks → deny rules → ask rules → permission mode → allow rules → `canUseTool`** — and its permissions documentation states the consequence directly: *"Auto-approved tools never reach `canUseTool`. A tool call approved at any earlier step … or by an allow rule, skips your `canUseTool` callback, so permission checks you put there are silently bypassed for that tool."* A bare allowlist entry auto-approves **every** call to that tool. So for exactly the writing tools an implement or fix role must be granted, the surface and protected-glob checks never execute. The SDK treats this as a known misconfiguration and emits a process warning, `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`, once per bare allowlist entry.

The failure is silent in the worst way: nothing errors, the session proceeds, and the guard simply never runs. P5's deny-by-default and SEC-3's protected globs both read as satisfied while being unenforced.

The same documentation names the mechanism that does hold: *"For checks that must run on every tool call, use a `PreToolUse` hook: hooks run before every other step, and a hook deny applies even in `bypassPermissions` mode."*

**The Python reference already had this right.** Its guard tests — `test_denies_protected`, `test_denies_out_of_surface_with_escape_hatch_hint`, `test_denies_outside_worktree` — exercise the **hook** layer. S-2's "enforcement moves in-process" reads as an upgrade from the oracle's hooks to a callback, but it is a downgrade in guarantee. It also puts M0 conformance at risk: the oracle's hook tests can pass against a mock backend that calls the callback unconditionally while failing against the real SDK, so a green suite would not mean the containment boundary holds.

Separately, S-3 specifies `WebFetch(domain:…)` as an allowlist form. The SDK's permissions documentation enumerates scoped rules of the shape `Bash(rm *)`, `Read(path)`, `Edit(path)`, and `mcp__<server>__*`, and does not show a `domain:` specifier. It may be valid syntax the SDK page simply does not enumerate, but the PRD should not depend on an unconfirmed rule form for its network containment.

## Evidence (verbatim from foreman-prd-v2.md)

- S-2: "Enforcement moves in-process: the path/surface guard is a `canUseTool` callback (deny outside ticket `surface[]`, deny protected globs, surface-expansion request lever preserved)"
- S-3: "Tool allowlists per role; research adds `WebSearch` + `WebFetch(domain:…)` for each configured docs domain — deny-by-default elsewhere."
- SEC-3: "protected globs deny ticket/criteria/config self-modification at the `canUseTool` layer **and** are listed for optional OS-level read-only mounts in containerized runs."
- P5: "**Deny by default; consent is explicit, per-action, and logged.**"
- M0: "Translate the 52-test Python suite to TS (vitest) against interfaces only"

## Proposed change

**1. Re-base S-2 on a hook.** Replace the first clause with: "Enforcement moves in-process: the path/surface guard is a **`PreToolUse` hook** (deny outside ticket `surface[]`, deny protected globs, surface-expansion request lever preserved). The hook layer is normative, not incidental — the backend evaluates hooks before deny rules, ask rules, permission mode, and allow rules, so it is the only layer that runs on **every** tool call. A `canUseTool` callback is not sufficient: it is skipped for any call auto-approved by an allow rule, which is exactly the writing tools S-3's per-role allowlists grant. This preserves the reference implementation's hook semantics rather than relocating them."

**2. Align S-3 with it.** Append: "Allowlists set the role's tool *surface*; they never constitute containment. Containment is the S-2 hook, which runs regardless of allowlist contents. The recommended posture for a headless role is an explicit allowlist paired with a deny-on-unmatched permission mode, so an unlisted tool is refused outright rather than falling through to a prompt that no operator is watching."

**3. Align SEC-3.** Replace "at the `canUseTool` layer" with "at the S-2 `PreToolUse` hook layer".

**4. Settle the WebFetch rule form.** Amend S-3's parenthetical to: "…for each configured docs domain, expressed in the backend's documented scoped-rule syntax; the exact specifier form is pinned at implementation against the backend version named in S-5, and a form the backend does not recognize is a `doctor` failure rather than a silent no-op."

## Acceptance criteria

1. S-2 names an enforcement mechanism that the SDK guarantees runs on every tool call, and the PRD states why that mechanism was chosen over `canUseTool`.
2. S-2 and S-3 are consistent: a reader can determine that per-role tool allowlists do not disable the surface/protected-glob guard.
3. SEC-3's protected-glob denial names the same layer as S-2, so there is one enforcement point rather than two named layers that disagree.
4. The PRD records that the oracle's hook-layer semantics are preserved rather than relocated, so the M0 hook tests remain a valid conformance target against the real backend.
5. S-3's `WebFetch(domain:…)` allowlist form is either confirmed against the backend's documented rule syntax or replaced with a form that is.

## Non-goals

- Does not change what the guard denies — ticket `surface[]`, protected globs, and the surface-expansion request lever are unchanged.
- Does not remove per-role tool allowlists; S-3's deny-by-default posture stands, only the layer that enforces containment moves.
- Does not adopt `bypassPermissions` or weaken any existing denial.
