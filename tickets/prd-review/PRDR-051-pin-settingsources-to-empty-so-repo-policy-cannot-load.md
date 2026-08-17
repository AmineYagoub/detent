---
id: PRDR-051
title: "Pin the backend's setting sources to empty — the default loads policy from the target repository"
state: READY
severity: major
category: security
labels: ["prd-review"]
surface: ["foreman-prd-v2.md"]
prd_refs: ["SEC-2", "SEC-3", "S-1", "S-3", "NG6", "P5", "F-2"]
acceptance_criteria: ["The PRD states that the session backend loads no settings from the working tree, the user's home directory, or any other on-disk source outside `.foreman/`, and names that as a required session-construction parameter rather than a default to rely on.", "NG6's \"no runtime fetching of policies\" is shown to hold against a backend whose default behavior is to read policy from the repository under work.", "A test asserts the setting-source configuration, so a backend upgrade that changes the default cannot silently re-enable repository policy.", "The PRD states what happens when the working tree contains backend settings files — ignored, and whether their presence is reported."]
non_goals: ["Does not change `.foreman/config.json` as the source of Foreman's own configuration.", "Does not forbid the operator from configuring the backend outside Foreman; it forbids the session inheriting policy from the repository being worked on.", "Does not add a scanner for settings files in the target repo — ignoring them is sufficient."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-051 — Pin the backend's setting sources to empty — the default loads policy from the target repository

**Severity:** major · **Category:** security · **Amends:** SEC-2, S-1, NG6

## Problem

NG6 makes "any runtime fetching of agents, prompts, or **policies**" a non-goal, and SEC-2 restates it as "No runtime fetching of agents/prompts/policies; vendored + hash-pinned only." The PRD treats that as settled by vendoring prompts (S-7).

It is not settled, because the session backend loads policy on its own. The Agent SDK reads permission rules from settings files under a `settingSources` option covering user, project, and local scopes, and its permissions documentation states that project settings "are read when the `project` setting source is enabled, **which it is for default `query()` options**." The project scope resolves against the session's working directory — which, for Foreman, is **the repository being worked on**.

So by default every session inherits allow, deny, and ask rules from a `.claude/settings.json` committed to the target repo. That file is attacker-reachable under the PRD's own threat model: SEC-3 assumes hostile content can arrive through the repository, and a merged external contribution can add or edit it with no review step Foreman performs. An allow rule placed there auto-approves a tool before the S-2 guard runs (see PRDR-050), which means a repository can disable Foreman's containment by committing a file.

This is a policy load from untrusted ground at runtime — precisely what NG6 names — and it happens by default, with nothing in the PRD instructing the implementation to turn it off. P5's deny-by-default does not survive a config layer that can add allows, and F-2's boundary logic ("`.foreman/` never contains project configuration") has no mirror requiring that project configuration never governs Foreman.

## Evidence (verbatim from foreman-prd-v2.md)

- NG6: "any runtime fetching of agents, prompts, or policies (SEC-2)"
- SEC-2: "No runtime fetching of agents/prompts/policies; vendored + hash-pinned only (S-7)."
- S-1: "Backend: `@anthropic-ai/claude-agent-sdk` `query()`."
- P5: "**Deny by default; consent is explicit, per-action, and logged.**"
- SEC-3: "Prompt-injection posture: web/researcher output is advice into test-gated code paths"
- F-2: "**Boundary (never-list):** `.foreman/` never contains project dependencies, build/lint/test/TypeScript configuration, application configuration, or source code"

## Proposed change

**1. Make the isolation explicit in S-1.** Append: "Sessions are constructed with **no external setting sources**: the backend's setting-source option is set to the empty set, so no user-scope, project-scope, or local-scope settings file contributes tool permissions, hooks, or server definitions to a Foreman session. This is a required construction parameter, not a default — the backend's own default enables project scope, which resolves against the repository under work."

**2. State the rule in SEC-2.** Append: "This extends to backend configuration: a settings file in the target repository is project data, never Foreman policy. Foreman's session policy comes from `.foreman/config.json` and the vendored role definitions only. A repository cannot alter what a Foreman session is permitted to do by committing a file."

**3. Give SEC-\* an AC covering it.** Add to the red-team pack: "a fixture repository committing a backend settings file with a permissive allow rule — 0 tools auto-approved from it, and the session's effective permission set is byte-identical to the same run in a repository without one."

**4. Note the boundary symmetry in F-2.** Append: "The converse also holds: project configuration never governs Foreman. F-2 keeps Foreman's state out of the project; S-1's empty setting sources keep the project's configuration out of Foreman."

## Acceptance criteria

1. The PRD states that the session backend loads no settings from the working tree, the user's home directory, or any other on-disk source outside `.foreman/`, and names that as a required session-construction parameter rather than a default to rely on.
2. NG6's "no runtime fetching of policies" is shown to hold against a backend whose default behavior is to read policy from the repository under work.
3. A test asserts the setting-source configuration, so a backend upgrade that changes the default cannot silently re-enable repository policy.
4. The PRD states what happens when the working tree contains backend settings files — ignored, and whether their presence is reported.

## Non-goals

- Does not change `.foreman/config.json` as the source of Foreman's own configuration.
- Does not forbid the operator from configuring the backend outside Foreman; it forbids the session inheriting policy from the repository being worked on.
- Does not add a scanner for settings files in the target repo — ignoring them is sufficient.
