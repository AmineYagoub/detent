---
id: PRDR-065
title: "Re-target Detent as a native Claude Code plugin with a model-driven loop — relocate enforcement from the kernel loop to the MCP-tool boundary and hooks"
state: DONE
severity: major
category: architecture
labels: ["prd-review", "major-version"]
surface: ["detent-prd-v2.md"]
prd_refs: ["P1", "P2", "P6", "P7", "ARCH-1", "D-2", "D-3", "D-19", "D-21", "D-22", "C-1", "C-14", "S-2", "S-3", "NG7", "N-7"]
acceptance_criteria:
  - "The PRD states a delivery model that includes a Claude Code plugin, and whether the standalone CLI survives, coexists, or is retired."
  - "ARCH-1/D-19 is restated to distinguish legality (validating artifacts, applying events — stays deterministic) from sequencing (which legal move runs next — may be model-driven), such that the AC's `machine.apply`-derives-from-a-validator invariant still holds verbatim when the driver is the model."
  - "The PRD names the new enforcement boundary: every state-mutating capability the model can reach is an MCP tool that re-validates its precondition (P2), and containment remains the D-21 PreToolUse hook — so no model-issued request applies a transition, spends budget, or writes outside surface without a validator or gate result in between."
  - "The PRD confronts, rather than assumes away, the two guarantees that genuinely weaken when the driver has ambient tools inside the user's own session: P6 budget-hardness and D-22 setting-source isolation. Each gets either a preserved mechanism or an explicit, logged downgrade."
  - "P1/D-3/C-14's two-verb porcelain is mapped to plugin surfaces (commands / skills / subagents) with the golden-path freeze restated for the plugin, and the change is recorded as the major-version event C-14 requires."
  - "The proposal states what is reused unchanged behind MCP (the machine, budgets, gate classifier, flake filter, checkpoints, ticket store, verification adapter, schemas) versus what is replaced (the kernel run loop and the CLI verbs), so the cost is scoped as re-fronting, not a from-scratch rewrite."
non_goals:
  - "Does not write the implementation plan or milestone breakdown — a PRDR proposes the amendment; planning follows once the PRD amends."
  - "Does not weaken P2: the model may choose the next move but never applies one; the referee still trusts only artifacts and exit codes."
  - "Does not adopt a second session backend — NG7 stands; the plugin runs on Claude Code, which is still the only backend."
  - "Does not change what the containment guard denies (surface, protected globs) or the gate/ladder semantics of §7 — only where the control loop lives."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-065 — Re-target Detent as a native Claude Code plugin with a model-driven loop

**Severity:** major (the largest to date — a major-version event under C-14) · **Category:** architecture · **Amends:** the delivery model (D-2), the architecture (ARCH-1/D-19), the command contract (P1/D-3/C-1/C-14), and the containment posture (D-21/D-22)

## Problem

The product owner has chosen to re-target Detent from a standalone npm CLI into a **native Claude Code plugin whose orchestration loop is driven by the model**, not by the kernel's `run` loop. A plugin bundles slash commands, subagents, skills, hooks, and an MCP server into the user's *interactive* Claude Code session. Today Detent is the inverse: it is itself the orchestrator — `detent run` owns a deterministic loop that spawns headless sessions and drives a twenty-state machine to completion unattended.

Most of Detent maps onto plugin surfaces cleanly. The role prompts become subagents; the D-21 containment guard is **already** a `PreToolUse` hook and ports as-is; the `init` pipeline is a natural fit for a command plus skills; and the deterministic kernel — the state machine, budgets, gate classifier, flake filter, checkpoints, ticket store, and verification adapter — can be exposed **behind an MCP server** without being rewritten.

One thing does not map cleanly, and it is the load-bearing one: **the loop**. Moving loop ownership to the model collides head-on with the property the PRD names "the single most important property of Detent" (D-19): *the kernel alone decides what happens next.* It also strains two safety guarantees that today are structural because the kernel is the only thing that can act — **P6 budget-hardness** and **D-22 setting-source isolation** — because a plugin runs inside a session where the model has its own ambient tools and the user's own settings are loaded.

The central question this PRDR must resolve is therefore **not** "can Detent be a plugin" (it can) but: **where does enforcement live once the model drives?** The answer this PRDR proposes is that enforcement *relocates* rather than *dissolves* — from the kernel loop to the MCP-tool boundary and the hook layer — and that "decides what happens next" splits into two things the current PRD conflates:

- **Legality** — validating an artifact, applying an event, classifying a gate, admitting a transition, permitting a spend. This stays deterministic and non-negotiable.
- **Sequencing** — which *legal* move runs next: which ready ticket to claim, when to launch an attempt. This is what moves to the model.

A model that can only *propose* moves, each of which the referee validates before it takes effect, does not violate P2 — it violates only the incidental fact that today the proposer and the validator are the same process.

## Evidence (verbatim from detent-prd-v2.md)

- **D-2:** "Public open source, npm-distributed | Stated product goal"
- **D-3:** "Two-command porcelain (`init`, `run`); everything else is plumbing | Porcelain/plumbing split; 20+ internal states never become 20+ user interactions"
- **P1:** "**Two verbs, twenty states.** The internal machine may be arbitrarily rich; the public workflow is `init` → approve → `run` → done. Interruptions resume by re-running the same verb."
- **P2:** "**The kernel trusts artifacts and exit codes, never prose.** No state transition occurs on an unverified model claim."
- **P6:** "**Budgets are hard.** Every loop has a counter; every counter has a ceiling; every ceiling routes to a human."
- **P7:** "**Detent never writes to the user's base branch.** In any mode."
- **ARCH-1 (D-19):** "Agents never own orchestration decisions: sessions produce **artifacts and telemetry**; the kernel alone validates artifacts, applies events, and decides what happens next (P2). Mechanically: the kernel's only session-facing surface is the `SessionBackend` interface; session output enters the kernel exclusively through the §10 schema validators; no code path lets model output trigger a transition without a validator or gate result in between."
- **ARCH-1 AC:** "…an audit test asserts every `machine.apply` call site's event derives from a validator or gate result."
- **D-19 rationale:** "PRD review 2026-08-17 (pass 3); the single most important property of Detent"
- **D-21:** "The containment guard is a **`PreToolUse` hook**; `canUseTool` is insufficient — it is skipped for any tool an allow rule approves"
- **D-22:** "Sessions are constructed with **empty setting sources**; a settings file in the target repository never governs Detent | …the backend's default loads project-scope policy from the repository under work — attacker-reachable ground under SEC-3's own threat model (PRDR-051)"
- **C-1:** "`init` runs only at the git root; elsewhere it errors with the root path hinted."
- **C-14 Porcelain freeze:** "The golden path is exactly two commands and the five C-5 interrupts. Adding a porcelain command or an interrupt class is a **major-version** decision requiring a PRD amendment; new capabilities land as plumbing or inside existing phases."
- **NG7:** "backend plurality — the capability contract of PRD v0.10 NFR-6 is inherited; Claude Code is v1's only backend."

## Proposed change

Amend the PRD to describe a **plugin delivery model with a referee architecture**. Concretely:

**1. Delivery model (amends D-2, §1).** State that Detent ships as a Claude Code plugin — commands, subagents, skills, hooks, and a bundled MCP server, distributed via a marketplace — and record the disposition of the CLI. *Recommendation:* the CLI and plugin **coexist**. The plugin is the interactive front door (planning, approval, single-ticket runs, monitoring); the CLI/headless path remains for unattended and CI use (it is what the N-7 self-build gate and the T-071 CI split already need). "Native model-driven" is a statement about the *loop*, not a demand that the headless entry point be deleted.

**2. Architecture (amends ARCH-1/§3a, D-19).** Replace the single "Detent CLI → Kernel" stack with the referee model:

```
┌───────────────────────────────────────────────────────┐
│   Claude Code — the user's session          (DRIVER)   │  sequencing:
│   + Detent plugin: skills · commands · subagents       │  picks the next
└───────────────┬───────────────────────────────────────┘  LEGAL move
   D-21 PreToolUse / Stop hooks — containment, every call  │
┌───────────────▼───────────────────────────────────────┐
│   Detent MCP server — the REFEREE          (AUTHORITY)  │  legality:
│   state machine · budgets · transitions · gate classify │  validates,
│   flake filter · checkpoints · ticket store             │  applies,
│   every state-mutating tool re-validates its pre (P2)   │  admits
└───────────────┬─────────────────────────┬──────────────┘
┌───────────────▼─────────┐   ┌────────────▼─────────────┐
│  Verification Adapter    │   │  schemas/**  (vocabulary) │
└──────────────────────────┘   └───────────────────────────┘
```

Restate D-19 so the invariant is exact: *Agents never own **legality**. Sessions and the driving model produce artifacts, telemetry, and **move requests**; the referee alone validates artifacts, applies events, and admits transitions (P2). The model may choose **which legal move runs next** (sequencing), but every move it requests enters the referee exclusively through the §10 schema validators and gate results — no model-issued request applies a transition, consumes a budget, or writes outside surface without a validator or gate result in between.* The AC survives **verbatim**: every `machine.apply` call site (now inside the MCP server) still derives its event from a validator or gate result. What changes is only that the *caller* of the referee's tools is the model, and an illegal request is **rejected, not applied**.

**3. Enforcement relocation (amends S-2/S-3, ties to P2/P7).** Name the two enforcement layers the plugin keeps:
  - **Containment** stays the D-21 `PreToolUse` hook — it already runs on every tool call regardless of who drives, so surface/protected-glob denial and the P7 base-branch guard port directly (a hook deny binds even in `bypassPermissions`).
  - **Legality** is the MCP boundary: the machine, budgets, gates, and ticket-claim discipline are reachable only as MCP tools, each of which re-validates. The model cannot fabricate a transition or a spend it did not earn, because the only path to one is a tool that checks first.

**4. The two honest weakenings (amends P6, D-22).** These do not fully relocate; the PRD must state the downgrade rather than imply structural parity:
  - **P6 budget-hardness.** Today "every loop has a counter" is structural because the kernel is the *only* actor — the sole way to spend is the kernel launching a session. In a plugin the driving model has ambient tools (Bash, Edit, subagent spawns) and could do gate-worthy work *outside* the MCP ledger. Mitigation: (a) route all billable work through MCP/subagent tools the ledger sees; (b) use the `PreToolUse` hook to count and deny ambient tool use that bypasses the ledger; (c) accept a stated overshoot bound, as D-25 already does for `run_spend_usd`. The PRD must pick one and admit budgets are hook-enforced, not loop-structural.
  - **D-22 setting-source isolation.** `settingSources: []` bought the guarantee that a settings file in the target repo cannot govern Detent. A plugin runs *inside* the user's Claude Code, which loads the user's and project's settings by construction — the isolation D-22 depends on is not available to a plugin the same way. The PRD must state what replaces it: the containment hook still denies out-of-surface and protected-glob writes regardless of loaded settings, but the "attacker-reachable project policy" threat (SEC-3) needs a fresh answer for the in-session posture — at minimum, that the D-21 hook is authoritative over any allow rule a loaded settings file introduces.

**5. Porcelain mapping (amends P1/D-3/C-14).** Map the two verbs to plugin surfaces — `init` as an interactive command + skills; `run` as a command that drives the model-loop (or launches the headless path) — and restate the C-14 golden-path freeze for the plugin (the frozen surface becomes "these commands + the five closed interrupts, now surfaced as the plugin's presented decisions"). Record this as the major-version event C-14 itself requires.

**6. Version.** Bump the PRD to a new major line (draft of **v3**), since D-2, ARCH-1, and the C-14 porcelain all move. The v2 kernel is not discarded: items 1–5 reuse the machine, budgets, gate classifier, flake filter, checkpoints, ticket store, verification adapter, and schemas **unchanged behind MCP**; what is replaced is the kernel run loop (`run.ts` orchestration) and the CLI verbs. The cost is re-fronting plus a genuinely new driver, not a from-scratch rewrite.

## Acceptance criteria

1. The PRD states a delivery model that includes a Claude Code plugin, and whether the standalone CLI survives, coexists, or is retired.
2. ARCH-1/D-19 is restated to split legality from sequencing such that the `machine.apply`-derives-from-a-validator AC holds verbatim with a model driver, and the restatement is explicit that illegal model requests are rejected, not applied.
3. The PRD names the MCP-tool boundary as the legality enforcement point and the D-21 hook as the containment point, and asserts no model-issued request applies a transition / spends budget / writes out-of-surface without a validator or gate result between.
4. The PRD confronts P6 budget-hardness and D-22 isolation under an ambient-tool driver, and for each states a preserved mechanism or an explicit, logged downgrade with its bound.
5. P1/D-3/C-14's porcelain is mapped to plugin surfaces with the golden-path freeze restated, recorded as a C-14 major-version event.
6. The proposal scopes reuse-behind-MCP vs replaced-loop, so the effort reads as re-fronting, not rewrite.

## Non-goals

- Does not write the implementation plan or milestones — a PRDR proposes the amendment; planning follows the amend.
- Does not weaken P2: the model chooses among legal moves but never applies one; the referee still trusts only artifacts and exit codes.
- Does not adopt a second backend — NG7 stands; the plugin runs on Claude Code.
- Does not change what the containment guard denies or the §7 gate/ladder semantics — only where the loop lives.

## Open questions

- **OQ-A — budget authority under ambient tools.** Can the `PreToolUse` hook make budgets genuinely hard by denying ledger-bypassing tool use, or is a stated overshoot bound (D-25-style) the honest ceiling? This is the make-or-break for P6 in a plugin.
- **OQ-B — unattended runs.** If the model drives, what runs Detent in CI where no interactive session exists? (Motivates the coexisting headless path in item 1; N-7/T-071 depend on the answer.)
- **OQ-C — D-22 replacement.** Is "the D-21 hook overrides any settings-file allow rule" a sufficient answer to SEC-3's project-policy threat when running inside the user's session, or does the plugin need its own settings-isolation mechanism?
- **OQ-D — resumability.** C-8/C-9 resume by re-running the verb against `.detent/` checkpoints. Does a model-driven loop preserve "re-running resumes from the first drifted checkpoint," or does interactive drift (the human redirecting mid-loop) need a new state?
