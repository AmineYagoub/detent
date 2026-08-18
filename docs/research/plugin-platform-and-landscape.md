# Plugin platform & landscape research — 2026-08

Inputs for the v3 plugin re-target (PRDR-065, `detent-prd-v3.md` 3.0-draft.1, `docs/implementation-plan-v3.md`). Two web-research streams against the state of the platform as of 2026-08-18: **Part A** — what the plugin platform actually supports, from official documentation, checked claim-by-claim against the v3 plan's assumptions; **Part B** — the marketplace landscape and every tool adjacent to Detent's territory; **Part C** — the ticket-by-ticket verdict. Under N-6, anything here that *contradicts* a v3 decision (D-26…D-30) files a PRDR rather than silently editing the PRD; refinements below the decision level land directly in the plan.

Primary sources: `code.claude.com/docs` (plugins, plugins-reference, plugin-marketplaces, hooks, skills, sub-agents, mcp, headless, agent-sdk/plugins). Load-bearing claims were required to be quoted verbatim from the docs by the research brief.

---

## Part A — Platform capabilities vs v3 assumptions

### A.1 The surfaces v3 needs, checked

| v3 assumption (ticket) | Platform reality | Verdict |
|---|---|---|
| Manifest at `.claude-plugin/plugin.json`, marketplace at `marketplace.json` (T-110) | Confirmed. **Only `plugin.json` lives inside `.claude-plugin/`; component dirs (`skills/`, `agents/`, `hooks/`, `commands/`) must sit at plugin root.** Manifest needs only `name`; components auto-discovered. | ✅ confirmed (layout caution) |
| Two commands `/detent:init`, `/detent:run` (T-111, C-1′) | Confirmed. Plugin `name` becomes the namespace: `/detent:<skill>`. Commands are now *invoked skills*; the directory form `skills/<name>/SKILL.md` is preferred (`commands/` flat files are legacy). `$ARGUMENTS` carries trailing text; `disable-model-invocation: true` restricts a skill to explicit user invocation. | ✅ confirmed (format refinement) |
| Vendored role subagents `agents/*.md` (T-112) | Confirmed, richer than assumed: frontmatter supports `tools` allowlist, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, **per-agent `hooks`**, `memory` scope, `isolation: worktree`. Role surfaces (S-3′) are expressible natively per agent. Hash-pinning stays ours (S-7). | ✅ confirmed |
| D-21 guard as a plugin `PreToolUse` hook that can DENY (T-113) | **Confirmed — the make-or-break claim.** Plugin hooks can block since v2.1.195: exit code 2 with `hookSpecificOutput.permissionDecision: "deny"` + `permissionDecisionReason`. Stop hooks block the same way (our stop-gate ports). `${CLAUDE_PLUGIN_ROOT}` available in hook commands. Hook input delivers `tool_name`, `tool_input`, `cwd`, `permission_mode` on stdin. | ✅ confirmed |
| D-29/SEC-6: the plugin's deny is authoritative over anything a repo introduces (T-122) | **Confirmed by the documented combination rule.** All matching hooks run to completion, then results merge: "For `PreToolUse` permission decisions, the most restrictive answer applies, in the order `deny`, `defer`, `ask`, `allow`." — no short-circuiting, so source ordering (project → user → plugin) cannot let a repo-authored hook's `allow` preempt the plugin's `deny`. Separately: "a hook returning `allow` … can tighten restrictions but not loosen them past what permission rules allow" — hook-allow only skips the prompt, never bypasses denies. | ✅ confirmed — D-29 holds as drafted |
| Referee as a bundled MCP server (R-1, T-100) | Confirmed. Declared in `.mcp.json` at plugin root or inline `mcpServers` in the manifest; **started automatically when the plugin enables**; stdio `command`/`args`/`env` with `${CLAUDE_PLUGIN_ROOT}` substitution. Tools surface as `mcp__plugin_detent_<server>__<tool>`. | ✅ confirmed |
| Headless driver / CI without an interactive session (D-26, T-106, MP4) | **Confirmed and strengthened.** Plugins load by default under `claude -p` ("loads the same context an interactive session would, including hooks, skills, plugins, MCP servers" unless `--bare`), and the **Agent SDK loads plugins** via `options.plugins: [{type: "local", path}]` — hooks, agents, skills, and bundled MCP servers all active. Local directories only (marketplace plugins must be on disk first); `~` not expanded. | ✅ confirmed — see A.2.1 |
| Marketplace distribution (T-110, T-141/MP4) | Confirmed. `marketplace.json` schema stable (`name`, `owner`, `plugins[]`, `metadata.pluginRoot`); source types: relative path, github, git URL, git-subdir, npm, zip archive (≤256 MiB, sha256), command. Hosted from any git repo — `/plugin marketplace add owner/repo`. Official community submission portal exists (`platform.claude.com/plugins/submit`); org distribution via managed settings (`strictKnownMarketplaces`). Reserved names exclude anything Anthropic-official-sounding. | ✅ confirmed |
| Local dev/test loop (all MP1 tickets) | `claude --plugin-dir ./detent-plugin` (repeatable), `--plugin-url` for archives, `/reload-plugins [--force]`, `claude plugin validate --strict`, `claude --debug`, `/mcp` to inspect server status. | ✅ confirmed |

### A.2 Refinements to the v3 plan (below the decision level — applied to the plan, no PRDR needed)

1. **One artifact, two drivers — literally (D-26 lands better than drafted).** The Agent SDK's `options.plugins` means the headless driver can load *the same plugin directory* the interactive session uses: same hooks.json, same bundled referee server, same agents. MP0's "extract the referee" and MP1's "plugin skeleton" converge on a single deliverable; T-106 (headless driver) becomes "SDK program loading the plugin," not a parallel wiring. Additionally the platform's `bin/` dir ("executables added to PATH") lets the marketplace artifact *ship* the headless CLI itself.
2. **The guard hook should call the referee, not re-implement policy (T-113, T-121).** Hook types include `mcp_tool` — a hook can invoke a tool on a connected MCP server. The PreToolUse guard can therefore delegate its decision to a referee tool (`guard.check`), keeping **one implementation of legality** (ARCH-2) instead of a shell script duplicating glob/budget logic. Deterministic hook types only for the guard (`command` or `mcp_tool`); the platform's `prompt`/`agent` hook types are P2-incompatible for containment and must not be used there.
3. **Commands land as skills.** T-111 should use `skills/init/SKILL.md` + `skills/run/SKILL.md` (directory form), with the C-14′ freeze asserted against the manifest (exactly two user-invocable skills). Natural-intent invocation ("keep going" → run) is the default; `disable-model-invocation` is available where we want explicit-only.
4. **Pin an explicit `version`.** Omitting `version` derives it from the git SHA; SEC-2/S-5's pinning posture wants the deliberate string.
5. **`.detent/` remains the only state home.** The platform offers `${CLAUDE_PLUGIN_DATA}` (per-plugin storage surviving updates) — fine for nothing of ours. Run state, checkpoints, research briefs are repo artifacts by design (F-1, P8: knowledge compounds *via the repo*).
6. **`userConfig` is a candidate config home for PRDR-062.** The manifest can declare user-prompted config (typed, `sensitive` flag). Research docs-domains — currently homeless (PRDR-062) — and the spend cap could surface here for the plugin driver. Feed this option into PRDR-062's resolution rather than deciding here.
7. **MP1's live exit (T-114) needs no marketplace** — `--plugin-dir` suffices; marketplace mechanics defer entirely to MP4 (T-141).

### A.3 Platform surfaces we did not plan for (noted, not adopted)

`monitors/monitors.json` (background watchers), `settings.json` (defaults applied on enable), LSP server bundling, plugin `dependencies` (semver), `defaultEnabled: false` shipping, relevance signals for contextual install suggestions, owner-wildcard marketplace entries, `CLAUDE_CODE_SYNC_PLUGIN_INSTALL` team auto-install. None are needed for MP0…MP4; monitors are worth revisiting if the watchdog role (X-7) ever surfaces in the plugin driver.

### A.4 Verification items — two resolved by follow-up, one residual

1. **RESOLVED — cross-source hook precedence (the D-29/SEC-6 crux).** The docs state the combination rule explicitly: *"When multiple hooks match the same event, every hook's command runs to completion before Claude Code merges the results… For `PreToolUse` permission decisions, the most restrictive answer applies, in the order `deny`, `defer`, `ask`, `allow`."* No short-circuiting exists, so the project→user→plugin *execution* order is irrelevant to the *decision*: the plugin guard's `deny` wins over any repo-authored hook's `allow`. And hook-allow is bounded: *"Hooks can tighten restrictions but not loosen them past what permission rules allow."* **D-29 is confirmed as drafted.** T-122's hostile-repo fixture stays in the plan regardless — P4.
2. **RESOLVED — project-hook trust model, with one platform caveat worth recording.** Repo-authored hooks in `.claude/settings.json` run **without a trust prompt** (docs: hooks in settings files are "Used" even before folder trust). They cannot defeat the guard (see 1), but they *are* arbitrary code the platform executes on the user's machine — a hostile repo can do damage entirely outside Detent's tool-call containment. That is Claude Code's documented trust posture, not a Detent surface; SEC-6's scope ("a settings file can only narrow what Detent may do, never widen it") is exactly right and confirmed. Users opening untrusted repos are exposed via the platform with or without Detent installed.
3. **RESIDUAL — SDK parity for bundled servers.** T-106's byte-parity fixture doubles as the proof that plugin-bundled MCP servers + hooks behave identically under `options.plugins` (headless) and interactive load. Proven by execution at MP0, per P4.

---

## Part B — Marketplace landscape (surveyed 2026-08-18)

### B.1 Where plugins are distributed

| Channel | What it is | Scale signals |
|---|---|---|
| [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | The Anthropic-managed directory, auto-registered in Claude Code. First-party plugins (`/plugins`) + vetted partners (`/external_plugins`: GitHub, Supabase, Figma, Vercel, Linear, Sentry, Stripe, Playwright, Semgrep). | 33.7k★ repo; 200+ plugins reported by 2026-07 |
| [claude.com/plugins](https://claude.com/plugins) | Web catalog of the official directory with per-plugin install counts. | Anthropic's "Feature Dev" at 256K installs — the visible ceiling for a workflow plugin |
| [anthropics/claude-plugins-community](https://github.com/anthropics/claude-plugins-community) | Anthropic-run *reviewed* community marketplace — submission portal, automated security scanning, PRs auto-closed. | 355★ |
| [anthropics/claude-code in-repo marketplace](https://github.com/anthropics/claude-code/blob/main/.claude-plugin/marketplace.json) | Includes the official **ralph-wiggum** autonomous-loop plugin — a Stop hook that re-feeds the prompt. Precedent: in-session self-looping is an *officially shipped* pattern. | — |
| Self-hosted marketplaces + directories | Any git repo can be a marketplace (`/plugin marketplace add owner/repo`); discovery via [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) (52.5k★) and peers. | 9,000+ third-party entries claimed ecosystem-wide |

Monetization: effectively everything is free/OSS; the marketplace has **no paid-listing mechanism**. Commercial motion happens off-marketplace (hosted services, desktop apps, restrictive licenses). No marketplace category exists for this genre — discovery runs through awesome-lists, GitHub topics, and press.

### B.2 The adjacent field

**Methodology giants (huge, model-driven, no enforcement).** [Superpowers](https://github.com/obra/superpowers) (273.6k★ — brainstorm→plan→TDD→two-stage review, official marketplace), [spec-kit](https://github.com/github/spec-kit) (130.1k★, GitHub's constitution→specify→plan→tasks→implement), [GSD](https://github.com/gsd-build/get-shit-done) (64.7k★, archived → community fork), [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) (52k★, agile personas), [SuperClaude](https://github.com/SuperClaude-Org/SuperClaude_Framework) (23.8k★). All: the model drives in-session, quality comes from document discipline and prompts; **none has budgets, a state machine, verification binding, or containment**.

**Spec→tasks pipelines (closer in workflow).** [Taskmaster](https://github.com/eyaltoledano/claude-task-master) (28k★, PRD→tasks.json w/ dependencies; human prompts each step), [CCPM](https://github.com/automazeio/ccpm) (8.3k★, PRD→epics→parallel agents over GitHub Issues), [Agent OS](https://github.com/buildermethods/agent-os) (5.3k★), [spec-workflow-mcp](https://github.com/Pimzino/spec-workflow-mcp) (4.3k★, strongest approval-gate UX — dashboard approvals w/ revisions; now in maintenance mode).

**Loop runners.** The "Ralph" family — official [ralph-wiggum](https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum) plugin (Stop-hook re-feed), [ralph-claude-code](https://github.com/frankbria/ralph-claude-code) (9.6k★ — the richest budget story found: calls/hour + token caps + circuit breakers + dual-gate exit).

**External orchestrators (the other side of the referee/driver divide).** [Gas Town](https://github.com/gastownhall/gastown) (15.9k★, Steve Yegge; 20–30 parallel agents, 7 roles; famously **no spend ceilings** — ~$100/hr burn reported), [ruflo](https://github.com/ruvnet/ruflo) (ex-claude-flow, 68.2k★, MCP daemon + swarm topologies), [Conductor](https://conductor.build) ($22M-funded free Mac app), [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) (~27k★, **sunset**), [claude-squad](https://github.com/smtg-ai/claude-squad) (8.3k★), [Auto-Claude](https://github.com/AndyMik90/Auto-Claude) (14.3k★, **dormant post-pivot**).

**The three closest full-shape analogues — all tiny.** [Quantum-Loop](https://github.com/andyzengmath/quantum-loop) (**24★**: spec→DAG plan→autonomous TDD loop, 5-state story tracking, "Iron Law" fresh-verification-evidence rule, worktree parallelism — but commands hand-written at plan time, no budgets, no write containment); [prd-taskmaster](https://github.com/anombyte93/prd-taskmaster) (**588★**: graded PRD validation, evidence-gated `SHIP_CHECK_OK` completion token, logged `[OVERRIDE]`s — the only audit-log gesture found; cost-based not research-based escalation); [coco-workflow](https://github.com/skullninja/coco-workflow) (**7★**: circuit breaker, max-iteration caps).

### B.3 Gap analysis — Detent's guarantees vs the field

| Detent capability | Ecosystem status |
|---|---|
| Deterministic ~20-state machine + auditable `transitions.jsonl` | **Absent as a product surface.** Nearest gestures: Quantum-Loop's 5 states, prd-taskmaster's logged overrides |
| Hard per-ticket spend/attempt budgets routing to a human | **Rare.** Hourly caps + circuit breakers exist (ralph-claude-code, coco); nobody does per-ticket spend AND attempt ceilings that escalate to a human decision |
| Verification **auto-binding** to the repo's own commands + drift halting | **Absent.** Commands are hand-written into plans (Quantum-Loop) or judgment-based; buildomator's "drift detection" is schema drift, not verification-command drift |
| Research-gated escalation ladder | **Not found anywhere.** Closest is cost-based model escalation (prd-taskmaster) |
| Flake filtering / quarantine | **Absent across every tool surveyed** |
| Explicit human approval gates | **Common and expected** — table stakes; ours fits ecosystem norms |
| Per-ticket write-surface containment (deny-enforced) | **Absent as enforcement.** The universal isolation granularity is the git worktree; nobody binds platform deny rules to a per-ticket surface |

**Platform absorption is live and shapes the moat:** Anthropic shipped ralph-wiggum, `/loop`, background agents, and native subagent budget caps in 2026 — bare "loop + budget" is being commoditized at the harness level. What remains unclaimed is exactly Detent's core: the ticket-scoped state machine, the audit log, verification binding, and containment.

### B.4 Positioning conclusion

The competitive axis of the field is **parallelism/swarm scale and spec-document quality**; the systematically under-served axes are **determinism, auditability, budget enforcement, and write containment**. The methodology layer above Detent is crowded (spec-kit, Superpowers, BMAD — and largely *complementary*: their outputs are planning docs Detent can consume); the enforcement layer Detent occupies is validated in concept but unclaimed at scale (closest analogues: 24★, 588★, 7★). Detent's honest one-line position: **the referee under the methodology layer — the plugin that makes an autonomous run auditable, budgeted, and contained, whichever way the plan was written.** Niche-specific caution: this genre has a visible maintenance-death pattern (spec-workflow-mcp, Vibe Kanban, Auto-Claude, GSD); N-7's permanent self-build gate is a credibility asset here, worth stating in the README.

---

## Part C — Verdict against the v3 plan

**Headline: zero contradictions with D-26…D-30 → zero PRDRs forced.** Every load-bearing v3 assumption is confirmed by the platform docs (Part A), and the landscape validates the positioning (Part B). All deltas below are refinements at plan level.

### C.1 Ticket-by-ticket deltas to `implementation-plan-v3.md`

| Ticket | Delta from research |
|---|---|
| T-100 | Bundle referee via `.mcp.json` at plugin root; tools will surface as `mcp__plugin_detent_<server>__<tool>`; `${CLAUDE_PLUGIN_ROOT}` for the server binary path |
| T-101…T-105 | Unaffected (referee-internal) |
| T-106 | Headless driver = an Agent SDK program loading **the same plugin directory** via `options.plugins: [{type:"local", path}]` — one artifact, two drivers; absolute/relative paths only (no `~`) |
| T-110 | Components at plugin **root**, only `plugin.json` inside `.claude-plugin/`; pin explicit `version` (SEC-2); consider `userConfig` for spend cap + docs-domains (feeds PRDR-062) |
| T-111 | Implement commands as `skills/init/SKILL.md` + `skills/run/SKILL.md` (directory form; `commands/` is legacy); C-14′ docs test asserts exactly two; `$ARGUMENTS` for flags like `--replan` |
| T-112 | Use the richer agent frontmatter per role: `tools`/`disallowedTools`/`permissionMode`/`maxTurns`; hash-pinning stays ours (S-7) |
| T-113 | Guard as `type: command` or `type: mcp_tool` calling a referee `guard.check` tool (one legality implementation, ARCH-2); **never** `prompt`/`agent` hook types for containment (P2); AC keeps the live hostile-repo-hook fixture despite the documented deny-wins rule (P4) |
| T-114 | `--plugin-dir` suffices for the live exit; `/reload-plugins`, `claude plugin validate --strict` in the dev loop; marketplace defers to MP4 |
| T-120 | Design option with official precedent (ralph-wiggum): sustain the loop via a **Stop-hook re-feed** rather than trusting the model to continue; coexists with the S-2 stop-gate (multiple Stop hooks combine) |
| T-121 | Layer the platform's **native subagent budget caps** (2026-w20) under D-28 as defense in depth — Detent's ledger remains the source of record |
| T-122 | The hostile-repo fixture is now *confirmation* of a documented rule ("most restrictive answer applies: `deny`, `defer`, `ask`, `allow`"), not exploration |
| T-141 | Three-channel distribution: own marketplace repo (immediate) → `anthropics/claude-plugins-community` (security-scan review queue) → claude.com/plugins listing. No paid mechanism exists; OSS is the norm |

### C.2 Positioning inputs for MP4

README/listing should lead with the four unclaimed axes (auditable state machine, hard per-ticket budgets, verification auto-binding + drift halt, per-ticket containment), explicitly frame the methodology giants as **complementary upstream** (their spec docs are Detent's input), and state the N-7 self-build gate as the maintenance-credibility answer this niche visibly lacks.

### C.3 Net effect

The v3 PRD stands as drafted. `implementation-plan-v3.md` absorbs the C.1 refinements at its next revision (no ticket added or removed; MP0's shape unchanged). PRDR-062 gains a candidate resolution (`userConfig`) to be weighed when that ticket is applied.
