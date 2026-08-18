---
id: PRDR-062
title: "Give research docs domains a config home — S-3 and X-6 consume a value F-1 nowhere stores"
state: READY
severity: minor
category: gap
labels: ["prd-review"]
surface: ["detent-prd-v2.md"]
prd_refs: ["S-3", "X-6", "C-3a", "F-1", "SEC-2"]
acceptance_criteria: ["A reader can determine, from the PRD alone, where the configured docs domains live and which artifact schema carries them.", "F-1's description of config.json either includes the research configuration or names the artifact that does.", "The domain list is committed state (P8: research configuration is shared via the repo), not per-machine local state.", "S-3, X-6 and C-3a all resolve their 'configured docs domain' references to the same home."]
non_goals: ["Does not change the domain-scoping mechanism itself (WebFetch rule per domain) or the X-6a hierarchy.", "Does not add per-role domain lists; one list serves both research kinds (D-11).", "Does not decide the WebFetch specifier syntax — that stays pinned at implementation and checked by doctor (PRDR-050)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-062 — Give research docs domains a config home

**Severity:** minor · **Category:** gap · **Amends:** F-1

## Problem

Three requirements consume a configured list of documentation domains. S-3 grants research sessions "`WebSearch` + domain-scoped `WebFetch` for each configured docs domain". X-6 scopes the ladder's research stage to "domain-allowlisted web". C-3a gives planning research the same posture via S-3. All three say *configured*; none says where.

F-1 enumerates `config.json`'s contents — "schema_version, budgets, protected/risk globs, model routing, pinned SDK/CLI versions" — and docs domains are not among them, nor in any other committed artifact. The Python reference kept `research.docs_domains` in its contract file, so the oracle's allowlist test had a value to read; Detent's config schema, built faithfully from F-1's list, has no field to hold one.

This surfaced at implementation: T-046's tool composition takes the domain list as a **parameter**, and the kernel passes an empty list because there is nothing to read. The network containment mechanism works; the value it scopes to has no home, so every research session currently gets `WebSearch` and no `WebFetch` at all — safe, but not what X-6 describes.

## Evidence (verbatim from detent-prd-v2.md)

- S-3: "Tool allowlists per role; research adds `WebSearch` + domain-scoped `WebFetch` for each configured docs domain, expressed in the backend's documented scoped-rule syntax"
- X-6: "Read-only + domain-allowlisted web; output schema requires ≥1 resolvable citation and a concrete strategy; `upstream_bug` blocks with a link."
- C-3a: "ANALYZE and PLAN may invoke research when docs reference unfamiliar technology, library/API behavior, or leave architecture questions open — read-only + web per S-3, following hierarchy X-6a, citations required, advice-not-authority."
- F-1: "**Committed:** `config.json` (schema_version, budgets, protected/risk globs, model routing, pinned SDK/CLI versions), `bindings.json` (§6), `plan/` (tickets `*.json`, `approval.json`), `research/` (`failures/` env-composite-keyed briefs per X-6/D-18; `planning/` question-keyed briefs), `agents/assignments.json`."

## Proposed change

**1. Add the field to F-1.** Amend config.json's parenthetical to: "(schema_version, budgets, protected/risk globs, **research docs domains**, model routing, pinned SDK/CLI versions)".

**2. Cross-reference from S-3.** Append: "The domain list lives in `config.json` (F-1) — committed, because research configuration is knowledge the repository shares (P8), and `init` writes it from DISCOVER's stack facts plus user input at PRESENT."

## Acceptance criteria

1. A reader can determine, from the PRD alone, where the configured docs domains live and which artifact schema carries them.
2. F-1's description of config.json either includes the research configuration or names the artifact that does.
3. The domain list is committed state (P8: research configuration is shared via the repo), not per-machine local state.
4. S-3, X-6 and C-3a all resolve their "configured docs domain" references to the same home.

## Non-goals

- Does not change the domain-scoping mechanism itself (WebFetch rule per domain) or the X-6a hierarchy.
- Does not add per-role domain lists; one list serves both research kinds (D-11).
- Does not decide the WebFetch specifier syntax — that stays pinned at implementation and checked by doctor (PRDR-050).
