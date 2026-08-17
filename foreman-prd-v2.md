# Foreman — Product Requirements Document
| | |
|---|---|
| Product | Foreman: state-driven autonomous engineering CLI |
| Version | 2.0-draft.5 |
| Date | 2026-08-17 |
| Status | Draft for review |
| Implementation | TypeScript (public, open source) |
| Supersedes | PRD v0.10 (Python reference, remains the porting oracle) |
> **Amendments in draft.5.** Seven `prd-review` tickets applied, none changing a design decision — all seven closed gaps where the document left a normative choice to the implementation, which N-6's no-deviation rule forbids. PRDR-041 (N-4 measurement spec) · PRDR-042 (§14 measurement table; *human intervention* and *scope canary* defined; sessions-per-ticket declared cumulative) · PRDR-043 (X-1 config ceilings named, defaulted and scoped; `run_spend_usd` resolved as run-level) · PRDR-044 (role `fix` → `blind_fix`; role↔state mapping; role ids pinned as a wire format) · PRDR-045 (C-12 claim discipline) · PRDR-046 (run-level artifacts declared single-writer; B-2's "parallel-ready" qualified) · PRDR-047 (N-2 given an AC). Two pairs collided and were reconciled rather than applied in sequence: PRDR-042 and PRDR-043 both rewrote X-1's header — the scope column subsumes both — and PRDR-045 and PRDR-046 both amended NG4, now merged into one statement. No numeric target changed anywhere.

> **Reading guide.** Requirements are uniquely identified (`C-*` command contract, `F-*` filesystem, `V-*` verification adapter, `X-*` execution machine, `S-*` sessions/SDK, `B-*` branching, `A-*` artifacts, `SEC-*` security, `N-*` non-functional). Every requirement has a machine-checkable acceptance criterion (*AC*). The Python reference implementation **v0.1.3 and its 52-test suite are the porting oracle**: where this document and the oracle agree, tests translate before code (see M0).
---
## Decision Log
| ID | Decision | Rationale (abridged) |
|---|---|---|
| D-1 | TypeScript rewrite; Python v0.1.3 stays as reference + test oracle | Team language; Agent SDK is TS-native and upgrades the three weakest seams (telemetry, hooks, pinning) |
| D-2 | Public open source, npm-distributed | Stated product goal |
| D-3 | Two-command porcelain (`init`, `run`); everything else is plumbing | Porcelain/plumbing split; 20+ internal states never become 20+ user interactions |
| D-4 | Verification commands live in the project's native tooling; Foreman binds, never owns | Repository agnosticism; `.foreman/` boundary (see F-2) |
| D-5 | Monorepos: root-only in v1; workspace scoping is a named v2 migration | Simplicity now; `schema_version` carries the upgrade |
| D-6 | Review-requested changes → `REVIEW_FIX` with its **own unit budget (`review_fix_attempts`)**; the ladder's research stage triggers only on failing tests — review findings never route to research | User decision 2026-08-17; tests answer "does it work?", review answers "is it the right thing, built right?" — only the first is a researchable question |
| D-7 | Keep both resilience mechanisms: bug-diagnosis gate and flake filter | User decision 2026-08-17; one flaky test must not burn the ladder; bugs must reproduce-as-predicted before code |
| D-8 | Direct commits on a run branch by default; `--worktree` flag for per-ticket isolation | User decision 2026-08-17; run branch is the deliverable PR; Foreman never touches the base branch |
| D-9 | Role definitions are curated from the VoltAgent catalog at development time, vetted per release, then vendored + hash-pinned; runtime never fetches | PRD review 2026-08-17; production must not depend on GitHub availability; attribution per S-7 |
| D-10 | init order: DISCOVER → ANALYZE → DETERMINE_VERIFICATION → PLAN; unambiguous bindings auto-accept (C-3b) and surface at PRESENT | PRD review 2026-08-17; in greenfield the stack is an ANALYZE output, so verification cannot precede analysis; a lone `"test": "vitest"` is not a question |
| D-11 | Research is two capabilities: planning research (optional, need-driven, during init) and failure research (mandatory ladder stage); both follow hierarchy X-6a | PRD review 2026-08-17; restores the broader research role without weakening D-6 |
| D-12 | Fix capacity = three independent **unit budgets** (blind, informed, review), each consumed on entry to its namesake state | PRD review 2026-08-17 (pass 2); "each slot at most once" is the testable form of the safety property |
| D-13 | `resolveRed`'s caller set is closed: implementation/test reds from IN_PROGRESS, BLIND_FIX, REVIEW_FIX, APPROVED-close only — never review verdicts, never INFORMED_FIX | PRD review 2026-08-17 (pass 2); the ladder must be provably un-reopenable |
| D-14 | The flake classifier is advisory (`suspected_flake` only); a green isolated rerun is the sole evidence permitting quarantine | PRD review 2026-08-17 (pass 2); pattern matching must never absolve a real regression |
| D-15 | v1 executes only an explicit setup-command allowlist; off-list commands are printed, never run — even with consent | PRD review 2026-08-17 (pass 2); `init` operates in arbitrary repositories |
| D-16 | Self-build is a permanent release gate, not a one-time milestone | PRD review 2026-08-17 (pass 2); the strongest demonstration the architecture works |
| D-17 | HUMAN_REQUEUE opens a new **attempt generation**: per-generation budgets, immutable history, cumulative reporting; the run spend ceiling is the cross-generation backstop | PRD review 2026-08-17 (pass 3); requeue must neither erase the record nor unbound total work invisibly |
| D-18 | Failure-research cache key = `sha256(signature \| lockfile_hash \| runtime_version)` plus `version_facts` validation on hit | PRD review 2026-08-17 (pass 3); same error ≠ same cause across environments |
| D-19 | The layer boundary is a normative requirement (ARCH-1) with a CI dependency lint, not a stylistic preference | PRD review 2026-08-17 (pass 3); the single most important property of Foreman |
---
## 1. Summary
Foreman turns planning documents into merged, reviewed, test-gated code using fresh, single-purpose Claude Code sessions driven by a deterministic kernel. The public experience is two verbs: `foreman init` prepares a project (discovers docs and verification entrypoints, generates an implementation plan as tickets, obtains approval); `foreman run` executes the approved plan through a budgeted implement → test → review loop with a research-gated escalation ladder and explicit human gates. All intermediate state persists in `.foreman/`; both commands resume from checkpoints when re-run.
## 2. Product Principles
P1 **Two verbs, twenty states.** The internal machine may be arbitrarily rich; the public workflow is `init` → approve → `run` → done. Interruptions resume by re-running the same verb.
P2 **The kernel trusts artifacts and exit codes, never prose.** No state transition occurs on an unverified model claim.
P3 **Project owns its tooling; Foreman owns only bindings.** `.foreman/` never contains project configuration (F-2).
P4 **An unexecuted anything is a guess.** Bindings, backends, and plans are exercised before they are relied on.
P5 **Deny by default; consent is explicit, per-action, and logged.**
P6 **Budgets are hard.** Every loop has a counter; every counter has a ceiling; every ceiling routes to a human.
P7 **Foreman never writes to the user's base branch.** In any mode.
P8 **Knowledge compounds.** Failure signatures, research briefs, and quarantine tickets persist and are shared via the repo.
P9 **Stale state is unconsumable.** Every checkpoint is content-addressed to its inputs.
## 3. Scope and Non-Goals
**In scope (v1):** greenfield (planning docs → project) and brownfield (existing repo + docs) at a single git root; TypeScript/Node kernel; Claude Code via the Agent SDK as the sole session backend; the execution machine of §7; the verification adapter of §6.
**Non-goals (v1):** NG1 production deployment or release automation. NG2 per-workspace gate scoping in monorepos (D-5; root entrypoints only). NG3 multi-repo orchestration. NG4 parallel ticket execution (claims are atomic and worktrees exist behind a flag, but v1 documents single-worker operation for ticket execution; concurrent merge to the run branch is untested). State-mutating plumbing (C-12) is a second potential writer of ticket state and is serialized against the run by claim discipline, not by this non-goal. Lifting NG4 requires a defined append protocol for the run-level artifacts of F-1 — per-worker shard files reconciled at read time, an exclusive append lock, or a single serializing writer — in addition to a tested concurrent-merge path. NG5 Windows-native (POSIX first; WSL supported). NG6 any runtime fetching of agents, prompts, or policies (SEC-2). NG7 backend plurality — the capability contract of PRD v0.10 NFR-6 is inherited; Claude Code is v1's only backend.
---
## 3a. Architecture (Normative)
```
┌─────────────────────────────┐
│         Foreman CLI         │   init / run / plumbing
└──────────────┬──────────────┘
┌──────────────▼──────────────┐
│     Deterministic Kernel    │   state machine · budgets · transitions
│                             │   artifacts · checkpointing · security
└──────┬───────────────┬──────┘
┌──────▼──────┐  ┌─────▼───────┐
│ Verification│  │  Agent SDK  │
│   Adapter   │  │  Sessions   │
└─────────────┘  └─────┬───────┘
                 ┌─────▼───────┐
                 │ Claude Code │
                 │   agents    │
                 └─────────────┘
```
- **ARCH-1 Layer boundary (D-19).** Agents never own orchestration decisions: sessions produce **artifacts and telemetry**; the kernel alone validates artifacts, applies events, and decides what happens next (P2). Mechanically: the kernel's only session-facing surface is the `SessionBackend` interface; session output enters the kernel exclusively through the §10 schema validators; no code path lets model output trigger a transition without a validator or gate result in between.
  *AC:* dependency-direction lint in CI — `kernel/**` imports no SDK types and no `sessions/**` internals beyond the backend interface; `sessions/**` imports no kernel state mutators; an audit test asserts every `machine.apply` call site's event derives from a validator or gate result.
---
## 4. Command Contract (C)
### 4.1 `foreman init`
Pipeline (each phase checkpoints per F-4; **analysis precedes verification determination** — in greenfield the stack itself is an ANALYZE output — and PLAN always sees the final or provisional bindings; bracketed interrupts fire only under C-3b/C-5/C-6 conditions):
```
INIT_FS → DISCOVER → [AWAIT_DOCS] → ANALYZE → [AWAIT_INFO]
        → DETERMINE_VERIFICATION → [AWAIT_BINDING_CHOICE | AWAIT_SETUP_CONSENT]
        → PLAN → PREPARE_AGENTS → PRESENT → [AWAIT_APPROVAL] → READY
```
- **C-1** `init` runs only at the git root; elsewhere it errors with the root path hinted. A non-repo directory containing planning docs offers `git init` under setup-consent rules (C-6). Repository initialization — consented `git init` plus the initial commit of pre-existing user files and `.foreman/`'s committed set — is not a base-branch write; P7 binds from the moment the base branch exists (B-3).
  *AC:* subdirectory invocation exits 2 with hint; no `.foreman/` created.
- **C-2** DISCOVER is deterministic and token-free: planning docs (`PRD*`, `SRS*`, `README*`, `docs/**` heuristics, current folder scope per user flow) and stack facts (manifests, lockfiles, workspace markers). No docs → AWAIT_DOCS with an exact list of what was looked for.
  *AC:* discovery of the fixture matrix produces byte-identical `discovery.json` across runs.
- **C-3** ANALYZE (planning agent, read-only) consumes docs **plus** stack facts; un-implementable specs yield a **batched** question set (single interruption), not a drip. In greenfield, ANALYZE's outputs include the chosen stack, which feeds DETERMINE_VERIFICATION.
  *AC:* missing-info fixture produces one AWAIT_INFO containing ≥2 questions in one prompt.
- **C-3a Planning research** (D-11): ANALYZE and PLAN may invoke research when docs reference unfamiliar technology, library/API behavior, or leave architecture questions open — read-only + web per S-3, following hierarchy X-6a, citations required, advice-not-authority. Budget: `planning_research_tool_calls` (default 16 per init); exhausting it without an answer adds the open question to the AWAIT_INFO batch (no new interrupt class). Briefs cache at `.foreman/research/planning/<question-hash>.json`.
  *AC:* unfamiliar-API fixture yields a plan citing official docs; re-running init hits the cache with zero web calls.
- **C-3b Verification auto-binding** (D-10): DETERMINE_VERIFICATION auto-accepts a binding when exactly one plausible candidate exists — the candidate is still executed per V-1, with provenance `approved_by: "auto"`. Interrupts fire only for: multiple plausible candidates; zero candidates requiring a setup action (C-6); or execution failure of the sole candidate. All bindings, auto or user, appear in the PRESENT summary and are overridable there.
  *AC:* lone `"test": "vitest"` fixture completes init with zero binding interrupts; two-candidate fixture interrupts exactly once; PRESENT snapshot lists provenance per slot.
- **C-4** PLAN generates tickets with dependencies, per-ticket agent assignments, and — in greenfield — a **bootstrap ticket #1**: create the project scaffolding, establish the project's **native** verification tooling (in project files, never `.foreman/` — F-2), and prove every bound slot executes green. Greenfield bindings are recorded `provisional` at init and finalized — drift baseline set — when ticket #1's gates pass; every other ticket is blocked on #1. Creating configuration in an empty project is ticket work product reviewed as code; C-6 consent governs changes to *existing* configuration only.
  *AC:* greenfield fixture: init completes with provisional bindings; ticket #1 DONE flips them to `approved` with baseline hashes; ticket #2 is unclaimable before that.
- **C-5** The interrupt set is **closed**: AWAIT_DOCS, AWAIT_BINDING_CHOICE, AWAIT_SETUP_CONSENT, AWAIT_INFO, AWAIT_APPROVAL. Adding an interrupt is a spec change. Interrupts batch at phase boundaries.
  *AC:* code-level enum; lint forbids prompting outside it.
- **C-6** Setup-command consent: Foreman may propose commands to establish missing verification capability; it runs one only after per-command confirmation showing the exact command, and logs it to history as a user action. Configuration mutation follows a three-way rule: (1) **existing configuration files are never modified by Foreman** — proposed edits are printed, never applied; (2) **missing configuration** may be *created* — in greenfield via bootstrap ticket #1 (reviewed as code, C-4), in brownfield as new standard test/lint files shown in full (C-6a); (3) **dependency manifests** change only through allowlisted package-manager commands (C-6a) — mediation by the ecosystem's own tool — never by direct file edit.
  *AC:* consent fixture shows command verbatim pre-execution; history records actor=user; direct-edit fixture on an existing config file is refused with the proposal printed.
- **C-6a Setup-command allowlist (v1, D-15).** Foreman may **execute** only commands matching this closed, versioned template set (code-as-data; extending it is a spec PR): `git init`; dependency installs for chosen verification tooling — `npm install` / `npm ci`, `pnpm install`, `yarn install`, `pip install`, `go mod download`, `cargo fetch`; and creation — never modification — of standard test/lint config files (shown in full before write). Anything outside the set is **never executed by Foreman, even with consent** — it is printed with rationale for the user to run in their own shell, after which re-running `init` resumes from checkpoint. In greenfield, setup preferentially routes into bootstrap ticket #1, where it is reviewed as code (C-4).
  *AC:* off-list fixture (e.g. a piped-shell installer) spawns no child process and prints the command with rationale; the allowlist lives in one data module with its own tests.
- **C-7** Approval is dual-exit: offered inline at the end of `init` (TTY), and, if deferred or non-TTY, presented by the first `foreman run`. Approval is recorded (who/when/plan-hash) in `.foreman/plan/approval.json`.
  *AC:* unapproved plan → `run` presents it before executing; declining leaves state READY-unapproved, exit 2.
- **C-8** Re-running `init`: replays from the first checkpoint whose inputs drifted (F-4). On an approved plan it prints status and requires `--replan` to regenerate; hand-edited tickets invalidate approval and re-present the diff.
  *AC:* editing PRD.md between runs re-executes ANALYZE forward; editing nothing re-executes nothing.
### 4.2 `foreman run`
- **C-9** Executes only an approved plan (else behaves per C-7). Claims tickets atomically; resumable pool includes all non-terminal in-flight states, so crash/interrupt/escalation resume by re-running `run`.
  *AC:* oracle crash-resume test class ports green (kill mid-FIX → resume enters RESEARCH; exactly one blind-fix launch ever).
- **C-10** Escalations are handled **inside `run`** on a TTY: dossier summary, then approve / requeue-with-guidance / skip / quit; the loop continues in-process. Non-TTY: exit 10 with a machine-readable summary on stdout.
  *AC:* TTY fixture resolves a NEEDS_HUMAN without invoking plumbing; CI fixture receives valid JSON summary.
- **C-11** Exit codes are public API: `0` plan complete; `10` human-gated items remain; `2` not ready (no/unapproved plan, binding drift); `1` error.
  *AC:* documented; integration tests assert each.
- **C-12** Plumbing (documented, scriptable, never required on the golden path): `status`, `approve <id>`, `requeue <id>`, `verify sync`, `doctor` (env + pin + one live smoke session), `report`.
  **Claim discipline.** `approve` and `requeue` mutate ticket state and therefore respect the C-9 claim. Both refuse with exit `2` when the target ticket is claimed by a live run, naming the claiming pid and the claim's age; the operator resolves the escalation inside `run` (C-10) or stops the run first. A claim whose owning process is no longer alive is stale: plumbing may break a stale claim, and doing so is recorded in `transitions.jsonl` as an operator action with the broken claim's pid. The remaining four plumbing commands are read-only with respect to ticket state and are always safe to run concurrently.
  Legality is otherwise governed by X-3: `approve` is admissible only from `NEEDS_HUMAN`, `requeue` only from `NEEDS_HUMAN` or `BLOCKED`. Invoked from any other state, both exit `2` naming the current state — plumbing cannot reach an X-3 row that the table does not offer.
  *AC:* README golden path contains exactly two commands; claimed-ticket fixture refuses `approve` and `requeue` with exit 2 naming pid and claim age; stale-claim fixture (owner killed) permits the break and records it in `transitions.jsonl`; illegal-state fixture refuses both naming the current state.
- **C-13** User-facing vocabulary maps all internal states to five labels — planning / implementing / verifying / reviewing / waiting on you — with full state names only in `transitions.jsonl`. Resume always announces itself ("resuming t-014 — informed fix, research applied").
  *AC:* terminal output snapshot contains no internal state names.
- **C-14 Porcelain freeze.** The golden path is exactly two commands and the five C-5 interrupts. Adding a porcelain command or an interrupt class is a **major-version** decision requiring a PRD amendment; new capabilities land as plumbing or inside existing phases.
  *AC:* release checklist item; docs test asserts the two-command golden-path snapshot.
---
## 5. Filesystem Contract (F)
- **F-1** Layout under `.foreman/` (git root only):
  **Committed:** `config.json` (schema_version, budgets, protected/risk globs, model routing, pinned SDK/CLI versions), `bindings.json` (§6), `plan/` (tickets `*.json`, `approval.json`), `research/` (`failures/` env-composite-keyed briefs per X-6/D-18; `planning/` question-keyed briefs), `agents/assignments.json`.
  **Local** (enforced by a Foreman-written `.foreman/.gitignore`): `state/` (checkpoints), `runs/` (journals, artifacts, dossiers), `ledger.jsonl`, `transitions.jsonl`, `logs/`, `claims/`, `worktrees/`.
  Artifacts are per-ticket or per-run. `state/`, `runs/`, `claims/`, and `worktrees/` are keyed per ticket and serialized by the C-9 claim. `ledger.jsonl` and `transitions.jsonl` are **run-level, single-writer**: exactly one process appends to each for the lifetime of a run. Atomic claims do not serialize these files — a claim scopes a ticket, not the run journal.
  *AC:* fresh init produces the split; `git status` shows only the committed set; a single-writer assertion covers each run-level artifact.
- **F-2** **Boundary (never-list):** `.foreman/` never contains project dependencies, build/lint/test/TypeScript configuration, application configuration, or source code; `init` never silently modifies project configuration (C-6 is the only pathway, and it is loud).
  *AC:* boundary lint over `.foreman/` contents in CI; violation fails the fixture suite.
- **F-3** Every committed file carries `schema_version`; migrations are explicit, versioned, and tested (`foreman` refuses newer-schema files with an upgrade hint).
  *AC:* v1-reading-v2 fixture exits 2 with message.
- **F-4** Checkpoints are content-addressed: each phase persists outputs plus a hash of its inputs; consuming a checkpoint whose input hash no longer matches is impossible — the phase re-executes.
  *AC:* property test — mutate any input file, observe exactly the dependent phases re-run.
## 6. Verification Adapter Contract (V)
Gate slots: `test`, `test_single`, `lint`, `typecheck`, `build`, `e2e`.
- **V-1** Discovery → **execution** → approval. Deterministic discovery proposes candidate bindings from native tooling (package.json scripts + lockfile ⇒ package manager; Makefile/justfile targets; pyproject/go.mod/Cargo.toml; tsconfig ⇒ `tsc --noEmit`). Every proposed binding is executed once with a timeout before it may be approved; watch-mode is detected (timeout with no exit ⇒ rejected candidate with explanation). Ambiguity (two plausible candidates) → AWAIT_BINDING_CHOICE, never a guess. Unbound slot → human-acknowledged skip recorded with who/when.
  *AC:* watch-mode fixture rejected; `make test`+`npm test` fixture interrupts once; skip records actor.
- **V-2** Binding record: `{ slot, adapter, ref, resolved, pm, config_hash, executed_at, approved_by, status, schema_version }`. `resolved` is the literal command Foreman will run; `config_hash` covers the defining config region; `approved_by ∈ {"auto", <user>}` records provenance (C-3b); `status ∈ {provisional, approved}` supports greenfield finalization (C-4).
  *AC:* schema-validated; oracle-style adapter tests per ecosystem fixture.
- **V-3** **Drift halting.** Before every gate, re-resolve and compare with the stored record. Any drift in a gate definition is a halting event (exit 2, "verification changed — re-baseline"), never a silent re-resolve. `foreman verify sync` re-runs V-1 with consent to accept legitimate evolution. Drift comparison applies to `approved` bindings; `provisional` bindings finalize per C-4.
  *AC:* mid-run edit of `scripts.test` halts before the next gate; sync + approval resumes.
- **V-4** Invocation-time normalization is Foreman's job and does not violate F-2: package-manager selection from the lockfile, CI-mode flags (`vitest run`, `--watchAll=false`, `--reporter` choices), env (`CI=1`), exit-code normalization; the classify/signature layer (X-7) sits above.
  *AC:* normalization matrix tests per adapter.
- **V-5** Monorepo (D-5): root entrypoints only; when workspace markers are detected, prefer orchestrator-native candidates (`turbo run test`, `pnpm -r test`, `nx run-many`) and print the workspace-wide-gates notice; `test_single` may bind to a deterministic affected-filter command (`turbo … --filter=…[BASE]`, `nx affected …`). No per-ticket arguments.
  *AC:* workspace fixture binds turbo candidates first; notice printed once.
## 7. Execution State Machine (X)
States: `READY, DIAGNOSED, IN_PROGRESS, BLIND_FIX, RESEARCH, INFORMED_FIX, REVIEW_FIX, IN_REVIEW, APPROVED, DONE, BLOCKED, NEEDS_HUMAN`.
Events: `CLAIMED, REPRO_AS_PREDICTED, REPRO_WRONG, PREMISE_FALSIFIED, GATE_GREEN, GATE_RED, RESEARCH_VALID, RESEARCH_DRY, UPSTREAM_BUG, REVIEW_APPROVE, REVIEW_CHANGES, RISK_LABEL_REQUIRED, HUMAN_APPROVED, HUMAN_REQUEUE, BUDGET_BREACH`.
- **X-1 Budgets** (scope per the table; all hard):
  | Counter | Max | Scope | Breach target |
  |---|---|---|---|
  | `blind_fix_attempts` (D-12) | 1 | ticket/generation | resolver → next slot / NEEDS_HUMAN |
  | `informed_fix_attempts` (D-12) | 1 | ticket/generation | NEEDS_HUMAN (X-2 scope) |
  | `review_fix_attempts` (D-6, D-12) | 1 | ticket/generation | NEEDS_HUMAN |
  | `research_sessions` | 1 | ticket/generation | NEEDS_HUMAN |
  | `hypotheses` (wrong repro + falsified) | 2 | ticket/generation | >2 → NEEDS_HUMAN |
  | `sessions` (net) | 14 | ticket/generation | NEEDS_HUMAN |
  | `ticket_wall_clock_ms` | 3_600_000 | ticket/generation | NEEDS_HUMAN |
  | `turns_per_stage` | 30 | session | NEEDS_HUMAN |
  | `failure_research_tool_calls` | 8 | research session | RESEARCH_DRY → NEEDS_HUMAN |
  | `planning_research_tool_calls` (C-3a) | 16 | init | question joins AWAIT_INFO batch |
  | `flake_reruns` | 1 | red gate | ladder entry (X-5) |
  | `run_spend_usd` | config, no default | **run** (cumulative, X-8) | NEEDS_HUMAN |
  Every ceiling is a named key in `config.json`'s budgets object (F-1), so the set a config-load validator must accept is enumerable from this table alone. `run_spend_usd` is the only run-scoped ceiling and is the cross-generation backstop of X-8; it has no v1 default because there is no defensible universal figure — `init` requires an explicit value and refuses to write a config without one.
  Fix capacity is three independent **unit budgets** (D-12), each consumed exactly on entry to its namesake state — the safety property is "each slot at most once", testable per slot. The worst-case launch count is **computed, never quoted**: the implementation derives `maxPossibleSessions(state_machine, budgets)` from the transition table and asserts `sessions_net > computed` both in the test suite **and at config load** — a configuration violating it is rejected before any run. (Informative, non-normative: with these defaults the computed worst case is 12 and the default net is 14; both are per-generation, X-8.) *AC:* exhaustive-walk test computes the worst case and asserts net > computed; config-load fixture with net ≤ computed is rejected; per-slot at-most-once property tests; every key in this table has a named enforcement site that emits BUDGET_BREACH, and a key with no enforcer fails CI.
- **X-2 Ladder resolver** — the routing function for red gates from **implementation/test failures only** (D-13). Caller set, closed and property-tested: `IN_PROGRESS`, `BLIND_FIX`, `REVIEW_FIX`, and the `APPROVED` close-check. It is **never** invoked for review verdicts (`REVIEW_CHANGES` is a judgment, not a red gate — it routes solely via the IN_REVIEW row) and **never** from `INFORMED_FIX`, whose red gate is a direct table edge to NEEDS_HUMAN: the ladder cannot reopen after the informed attempt.
  ```
  resolveRed(c): BLIND_FIX     if c.blind_fix == 0       (consume the only blind slot)
                 RESEARCH      elif c.research == 0      (consume research)
                 INFORMED_FIX  elif c.informed_fix == 0  (consume the informed slot)
                 NEEDS_HUMAN   otherwise
  ```
  "No second blind fix" and "no ladder after the informed fix" are provable properties. *AC:* oracle ladder tests port green; property test over all counter states; static test asserts the resolver's caller set.
- **X-3 Transition table** (illegal pairs throw; `BUDGET_BREACH` legal from every non-`DONE` state → NEEDS_HUMAN):
  | From | Event | To |
  |---|---|---|
  | READY | CLAIMED | DIAGNOSED if `type: bug` else IN_PROGRESS |
  | DIAGNOSED | REPRO_AS_PREDICTED | IN_PROGRESS |
  | DIAGNOSED | REPRO_WRONG | hypotheses++; >2 → NEEDS_HUMAN else DIAGNOSED |
  | IN_PROGRESS | PREMISE_FALSIFIED | hypotheses++; bug → DIAGNOSED (or NEEDS_HUMAN if >2); feature → NEEDS_HUMAN (plan-level flaw) |
  | IN_PROGRESS / BLIND_FIX / INFORMED_FIX / REVIEW_FIX | GATE_GREEN | IN_REVIEW |
  | IN_PROGRESS / BLIND_FIX / REVIEW_FIX | GATE_RED | resolveRed |
  | INFORMED_FIX | GATE_RED | NEEDS_HUMAN |
  | RESEARCH | RESEARCH_VALID | INFORMED_FIX (consumes the informed slot) |
  | RESEARCH | RESEARCH_DRY | NEEDS_HUMAN |
  | RESEARCH | UPSTREAM_BUG | BLOCKED + linked discovered ticket |
  | IN_REVIEW | REVIEW_APPROVE | APPROVED |
  | IN_REVIEW | REVIEW_CHANGES | REVIEW_FIX if `review_fix_attempts == 0` else NEEDS_HUMAN |
  | APPROVED | GATE_GREEN ∧ ¬risky | DONE (finalize on run branch) |
  | APPROVED | RISK_LABEL_REQUIRED | NEEDS_HUMAN |
  | APPROVED | GATE_RED | resolveRed |
  | NEEDS_HUMAN | HUMAN_APPROVED | APPROVED (kernel re-verifies, then finalizes) |
  | NEEDS_HUMAN / BLOCKED | HUMAN_REQUEUE | READY (new attempt generation — X-8) |
  *AC:* table is data; every (state,event) pair outside it raises; the oracle's illegal-transition test ports.
- **X-4 Diagnosis gate** (D-7, bug tickets): a root cause is inadmissible as prose. The diagnose session emits `hypothesis.json` (claim, file:line evidence, repro command, predicted failure substring); the **kernel executes the repro** and requires fail-as-predicted before IN_PROGRESS. Mid-implementation falsification is signaled by writing `falsified.json` and ends the session.
  *AC:* oracle diagnosis test class ports green (recycle once → DONE; three wrong → NEEDS_HUMAN).
- **X-5 Flake filter** (D-7, D-14): the pattern classifier emits only **`suspected_flake`** — advisory, never a verdict. A suspected flake is re-run once in isolation; a **green rerun is the sole evidence** that permits quarantine (ticket linked `discovered_from`, nothing charged) and continuation. A red rerun enters the ladder regardless of pattern class; pattern matching alone can never mark a failure non-actionable.
  *AC:* oracle flake tests port (zero fix budget consumed; quarantine ticket exists); adversarial fixture — a real regression whose output matches a flake pattern — reruns red and enters the ladder.
- **X-6 Failure research** (D-6, D-11): the ladder's RESEARCH stage triggers only on failing tests — review findings never route here. Read-only + domain-allowlisted web; output schema requires ≥1 resolvable citation and a concrete strategy; `upstream_bug` blocks with a link. Briefs cache at `research/failures/<cache_key>.json` where `cache_key = sha256(signature | lockfile_hash | runtime_version)` (D-18) — the same error under different dependency or runtime versions is a different cause until proven otherwise. Briefs record an environment snapshot; a key hit additionally validates the brief's `version_facts` against the current environment, and any contradiction is a miss. A later same-key failure skips the research session entirely. Planning research (C-3a) is a separate capability sharing X-6a and S-3.
  *AC:* oracle cache-hit test ports (zero research calls on ticket #2); changed-lockfile fixture misses the cache and runs fresh research.
- **X-6a Source hierarchy** (both research kinds): (1) project documentation, (2) the codebase, (3) official library/framework docs at lockfile versions, (4) upstream GitHub issues/discussions via exact error strings, (5) high-quality technical sources, (6) general web — escalating a tier only when the previous tiers do not answer. Mechanical check: a brief citing any URL must include a non-empty `local_search` record (tiers 1–2 consulted); `sources_consulted[{tier, ref}]` is recorded per brief.
  *AC:* validator rejects a web-cited brief lacking `local_search`; per-run report includes the tier distribution.
- **X-7 Signatures**: `sha256(test_id | exception | top_frame | assertion_msg)` over volatility-normalized output; classification and signatures are code, zero tokens.
  *AC:* oracle signature-stability tests port.
- **X-8 Attempt generations** (D-17): `HUMAN_REQUEUE` opens a new **generation** — every X-1 counter restarts at zero for the new generation, while prior generations remain immutable history on the ticket (counters, outcome, reason, ended_at). No generation cap is imposed: each requeue is an explicit human act, so the loop is human-gated by construction — but dossiers and `status` display **cumulative** totals across generations, and the run-level spend ceiling remains the cumulative financial backstop regardless of generation count. Requeue guidance (C-10) is recorded on the generation it opens.
  *AC:* requeue fixture — generation 1 runs a full ladder while generation 0's record is preserved and reported; cumulative spend still trips the run ceiling.
## 8. Sessions & Agent SDK Integration (S)
- **S-1** Backend: `@anthropic-ai/claude-agent-sdk` `query()`. Roles: `planner` (init), `diagnose`, `implement`, `blind_fix`, `informed_fix`, `review_fix`, `research`, `review`. Read-only set {planner, diagnose, research, review} runs `permissionMode: 'plan'`. Role identifiers are not derived from state names; the mapping is: `planner` → init pipeline (no execution state), `diagnose` → `DIAGNOSED`, `implement` → `IN_PROGRESS`, `blind_fix` → `BLIND_FIX`, `informed_fix` → `INFORMED_FIX`, `review_fix` → `REVIEW_FIX`, `research` → `RESEARCH`, `review` → `IN_REVIEW`.
  *AC:* per-role session config asserted in tests.
- **S-2** Enforcement moves in-process: the path/surface guard is a `canUseTool` callback (deny outside ticket `surface[]`, deny protected globs, surface-expansion request lever preserved); end-of-turn gating is kernel-side — on session end, run the scoped gate; if red and turns remain, **continue the same conversation** with the failure output. The kernel independently re-runs full gates regardless (P2).
  *AC:* oracle guard/stop-gate semantics reproduced via SDK-level tests; a disabled callback cannot fake green (kernel re-run test).
- **S-3** Tool allowlists per role; research adds `WebSearch` + `WebFetch(domain:…)` for each configured docs domain — deny-by-default elsewhere. Web content is data, never instructions; research output is advice into a test-gated fix, never authority.
  *AC:* allowlist capture test (oracle TestResearchNetworkAllowlist ports).
- **S-4** Telemetry: typed usage/cost/turn fields from SDK results feed the ledger; a session whose telemetry fields are absent is budget-breaching (circuit breaker → NEEDS_HUMAN).
  *AC:* corrupted-result fixture routes to NEEDS_HUMAN.
- **S-5** Pinning: SDK version is an **exact** dependency in Foreman's lockfile; `config.json` additionally pins the expected Claude Code CLI/runtime version surfaced by `doctor`; upgrades are PRs gated on the cross-ecosystem fixture suite.
  *AC:* `doctor` fails on mismatch naming both versions.
- **S-6** Prompt assembly: stable per-role prefix (role prompt + rules + bindings preamble, byte-identical within a run) + per-ticket variable suffix, for prompt-cache efficiency.
  *AC:* prefix-hash uniqueness-per-role test ports.
- **S-7** Role definitions are **curated at development time** (D-9): the VoltAgent subagent catalog and comparable sources are evaluated, vetted, and adapted per release, with upstream attribution and license compliance recorded in `ATTRIBUTIONS.md` — then **vendored in the npm package and hash-pinned**. PREPARE_AGENTS selects from this vendored set only; `agents/assignments.json` references role@hash. No network fetch of agents, ever (SEC-2). The eight role identifiers of S-1 are a stable identifier space: `agents/assignments.json` is committed (F-1) and references `role@hash`, so adding, removing, or renaming a role is a `schema_version` event under F-3 with a migration, not an editorial change.
  *AC:* packaging test verifies prompt hashes and `ATTRIBUTIONS.md` presence; assignments referencing unknown hashes fail closed.
## 9. Branch & Merge Contract (B)
- **B-1** Default mode (D-8): `run` creates `foreman/run-<id>` off the base branch and commits directly to it; every commit carries a `Foreman-Ticket: <id>` trailer; ticket DONE = finalized commits + transition record. The run branch is the deliverable; merging it is the human's PR.
  *AC:* history fixture shows trailers; base branch SHA unchanged across a full run.
- **B-2** `--worktree`: per-ticket worktree + branch, merged `--no-ff` into the **run branch** on DONE. The worktree isolates a ticket's working tree, which is the git-side prerequisite for parallelism; v1 remains single-worker (NG4). Two problems stay open before workers may run concurrently: concurrent merge to the run branch is untested, and the run-level artifacts of F-1 have no multi-writer append protocol — concurrent appends interleave and are not atomic above the platform pipe buffer.
  *AC:* worktree fixture merges into run branch, never base.
- **B-3** **Foreman never writes to the base branch** (P7): no commit, merge, push, or checkout mutation of it in any mode. Repository initialization (C-1) — `git init` plus the initial commit — *creates* the base branch; P7 binds from that moment onward.
  *AC:* red-team fixture (hostile ticket asks for it) — base SHA byte-identical.
- **B-4** Risk gate: a DONE-candidate whose diff touches `risk[]` globs (or carries `risk_label`) requires human approval before finalize; approval re-enters APPROVED for kernel re-verification.
  *AC:* oracle risk test ports (approve → re-verify → DONE).
- **B-5** Crash recovery in direct mode: uncommitted worktree changes at resume are reset to the last ticket commit; the journal decides whether a crashed session may relaunch (it may not — budget was consumed; the gate judges the tree as-is).
  *AC:* oracle crash semantics port.
## 10. Artifacts (A)
All JSON, schema-validated (zod), `schema_version`-stamped. Field lists abridged; full schemas live in `src/schemas/`.
- **A-1 Ticket:** id, type(feature|bug), title, description, acceptance_criteria[] (non-empty, testable), non_goals[], surface[] (globs), blockers[], links[] (discovered_from…), priority, risk_label, generations[] (per-generation counters + outcome; current = last — X-8), notes[] (append-only).
- **A-2 Plan:** ordered ticket refs + dependency edges + per-ticket agent assignment + input-doc hashes; `approval.json` {approved_by, at, plan_hash}.
- **A-3 Hypothesis:** claim, evidence[{file,line,what}], repro_test, predicted_failure, status.
- **A-4 Research brief:** failure_signature, root_cause{claim, confidence}, evidence[{source, claim}] (≥1), version_facts, recommended_fix{strategy…}, alternative, what_would_falsify, upstream_bug, sources_consulted[{tier, ref}], local_search{docs_checked[], code_checked[]}. Planning briefs share the evidence and hierarchy fields, keyed by question hash.
- **A-5 Review:** verdict(approve|changes), changes[{tag: correctness|requirement|scope|rules, finding, file?}] — style is not a finding.
- **A-6 Binding record:** per V-2. **A-7 Checkpoint:** phase, inputs_hash, outputs, at. **A-8 Dossier:** ticket, reason, attempts, last signatures, artifact index, suggested resolutions.
  *AC (A-\*):* invalid artifacts are events (never partial acceptance); oracle validator tests port.
## 11. Security & Supply Chain (SEC)
- **SEC-1** Consent semantics per C-6/C-6a; every consent is history-logged with the exact command; off-list commands are structurally unexecutable (D-15).
- **SEC-2** No runtime fetching of agents/prompts/policies; vendored + hash-pinned only (S-7).
- **SEC-3** Prompt-injection posture: web/researcher output is advice into test-gated code paths; reviewer sees only diff + criteria + rules; protected globs deny ticket/criteria/config self-modification at the `canUseTool` layer **and** are listed for optional OS-level read-only mounts in containerized runs. A **scope canary** is a ticket whose `surface[]` deliberately excludes a file the ticket's acceptance criteria cannot be met without editing. The correct outcome is that the session is denied at the `canUseTool` layer (S-2) and either raises the surface-expansion lever or escalates — never that the write succeeds and never that the surface silently widens. The canary corpus is distinct from the SEC-* evasion pack: canaries test the containment boundary under honest work, evasion tickets test it under hostile instruction. Both run in the fixture suite.
- **SEC-4** Secrets: sessions inherit only an allowlisted env; ledger/logs are scrubbed by pattern before write.
- **SEC-5** Drift halting (V-3) is a security control, not a convenience: gate redefinition mid-run is treated as tampering until a human re-baselines.
  *AC (SEC-\*):* red-team fixture pack (10 evasion tickets) — 0 protected writes, 0 base-branch writes, 0 unlogged consents.
## 12. Non-Functional (N)
- **N-1 Portability = repositories, not backends:** fixture matrix ≥3 ecosystems (TS/Node service, Python service, Go or Rust CLI) passes E2E with zero kernel changes (bindings-only differences).
- **N-2 Determinism:** discovery, classification, signatures, resolver, and transitions are pure code; identical inputs ⇒ identical outputs. Two forms are required and tested separately: **serialization determinism** for discovery — the emitted `discovery.json` is byte-identical across process invocations, which constrains key ordering and path normalization; and **referential transparency** for the other four — repeated evaluation on equal input yields equal output, with no dependence on wall-clock, environment, filesystem order, or iteration order of a hash container.
  *AC:* one determinism suite covering all five — discovery emits byte-identical JSON across two separate process invocations on every fixture; classification returns the same class for the same gate output over 100 repeats with shuffled invocation order; signatures satisfy X-7's stability tests; the resolver's property test covers all reachable counter states; replaying a recorded event sequence against the transition table reproduces the recorded `transitions.jsonl` exactly. No component in the list may be omitted from the suite.
- **N-3 Dependencies:** minimal and pinned — `@anthropic-ai/claude-agent-sdk`, `zod`, `picomatch`; CLI via `node:util.parseArgs`; no framework. Node ≥ 20 LTS.
- **N-4 Performance:** kernel overhead is the wall time from event construction to the transition being durable — event validation, `machine.apply`, the `transitions.jsonl` append, and any checkpoint write triggered by the transition. It excludes gate execution, session time, and network. Budget: **p95 < 100 ms** and **max < 500 ms** over a synthetic run of ≥500 transitions traversing every X-3 row at least once, with gates stubbed to a constant-time green. Gates dominate wall time by design and are excluded from this figure.
  *AC:* `tests/perf/transition-overhead.bench.ts` reports p95 and max over the synthetic run; CI fails on p95 ≥ 100 ms or max ≥ 500 ms; the harness prints the per-component split (validate / apply / append / checkpoint) so a regression names its cause.
- **N-5 Observability:** `transitions.jsonl` + ledger + journals reconstruct any run without model output.
- **N-6 Docs:** README golden path (two commands), CONTRIBUTING with the porting-oracle rule **and the no-deviation rule** — implementation may not "improve" the architecture in flight; divergence requires a PRD amendment (tickets tagged `prd-review`) first — schema reference generated from zod.
- **N-7 Self-build gate (D-16):** the ultimate integration test is Foreman building itself — `foreman init && foreman run` on a folder containing only this PRD must read the PRD, generate its own tickets, select its own agents, build, test, and review its way to DONE on the walking skeleton. First green at M3; thereafter a **release gate**: every version bump and every pinned-backend upgrade (S-5) must pass it before publish. The skeleton subset runs in regular CI; the full budgeted self-build runs in the release pipeline.
## 13. Milestones
- **M0 — Oracle port.** Translate the 52-test Python suite to TS (vitest) against interfaces only; then the state machine, budgets, resolver, signatures until green. *Exit:* oracle parity report checked in. Oracle mapping: the reference's `fix_sessions ∈ {0,1,2}` corresponds to `(blind_fix, informed_fix) ∈ {(0,0),(1,0),(1,1)}` and `review_fix_sessions` to `review_fix_attempts` — translation preserves properties, not identifiers. One deliberate divergence: the oracle resets `attempts` on requeue; TS supersedes this with X-8 generations (D-17), and the requeue test translates to generation semantics.
- **M1 — Adapter + filesystem.** V-1..V-5, F-1..F-4, drift halting, `verify sync`, `doctor`. *Exit:* three-ecosystem binding fixtures green.
- **M2 — `run` live.** SDK sessions, canUseTool guard, continuation-based stop-gating, ladder end-to-end on a fixture repo with real sessions. *Exit:* budgeted live run completes a 3-ticket plan.
- **M3 — `init` pipeline.** Discovery → analyze → plan → approval, checkpointed resume, interrupt set. *Exit (recursive):* `foreman init && foreman run` in a folder containing only **this PRD** scaffolds and green-tests Foreman's own walking skeleton — the first green of the permanent N-7 self-build gate.
- **M4 — Public release.** Schema freeze (`schema_version: 1`), security review against SEC fixtures, N-7 self-build green, npm publish under the chosen name, docs site.
## 14. Metrics
**Human intervention** — a ticket counts as human-intervened if it entered `NEEDS_HUMAN` or `BLOCKED` at any point in any generation, or if a B-4 risk approval was required before finalize. Init-time interrupts (C-5) are per-run, not per-ticket, and are excluded. Tickets resolved by C-10 *skip* or *quit* never reach DONE and fall out of the numerator and the denominator alike.

| Metric | Target (v1) | Source artifact | Denominator | Window & population |
|---|---|---|---|---|
| Tickets reaching DONE with no human intervention | ≥70% | transitions.jsonl | tickets reaching DONE in the run | fixture matrix (N-1), per CI run |
| Median sessions per completed ticket, cumulative across generations | ≤2.5 | ledger.jsonl | tickets reaching DONE in the run | fixture matrix, per CI run |
| Scope-canary tickets blocked (SEC-3) | 100% | runs/ journals + transitions.jsonl | canary tickets in the corpus | canary corpus, per CI run |
| Base-branch writes | 0 | git reflog of the base ref | all fixtures | fixture matrix + SEC pack, per CI run |
| Research cache hit rate | reported, not gated | research/failures/ + ledger.jsonl | RESEARCH stage entries | per run |
| Injected crashes recovering with no duplicate blind fix | 100% | transitions.jsonl | injected crashes in the run | crash-injection fixture, per CI run |
| N-7 self-build gate | passes | release pipeline result | releases | every release |

Every row is computable from artifacts F-1 already mandates; no row implies a new persisted artifact, and rows may be produced by an out-of-band script rather than by the kernel inline.
*AC:* every cell in the table is non-empty (markdown table lint); the reporter's metric key set equals this table's row set, so a metric added here without a reporter fails CI.
## 15. Risks
| Risk | Mitigation |
|---|---|
| SDK/CLI churn | exact pins + `doctor` + fixture-gated upgrades (S-5) |
| Gate redefinition by sessions | drift halting (V-3) + reviewer + protected globs |
| Flaky ecosystems burning budgets | X-5 filter + quarantine tickets |
| Plan quality ceiling | approval gates at both exits (C-7); plan-as-PR review flow (F-1) |
| OSS supply chain | SEC-2 vendoring; minimal pinned deps (N-3) |
| Scope creep in porcelain | C-5 closed interrupt set; C-12 golden path; C-14 porcelain freeze |
## 16. Open Questions
- **OQ-1** npm name (`foreman` is taken): scoped `@<org>/foreman` vs rename. Blocks M4 only.
- **OQ-2** License: MIT vs Apache-2.0 (patent grant). Blocks M4 only.
- **OQ-3** Windows-native timeline (post-v1; WSL documented meanwhile).
- **OQ-4** v2 workspace scoping design (named migration per D-5).
---
*End of PRD 2.0-draft.5 — review findings as tickets tagged `prd-review`. The Python reference (v0.1.3, 52 tests) remains authoritative where this document is silent, except where a decision log entry records a deliberate divergence (D-17).*
