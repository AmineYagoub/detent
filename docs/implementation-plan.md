# Foreman — Implementation Plan

| | |
|---|---|
| Source of truth | `foreman-prd-v2.md` (2.0-draft.4) — no redesign, no simplification, no additions |
| Plan version | 1.0 |
| Date | 2026-08-17 |
| Shape | 55 tickets, dependency-ordered, A-1-compatible — usable as the N-7 self-build seed |

---

## 0. Working Agreements (bind every ticket)

1. **Tests before code** (M0 rule): each ticket that ports oracle behavior lands its translated tests first, red, then implements to green. Oracle = Python reference v0.1.3, 52 tests.
2. **No-deviation rule** (N-6): an implementer who wants a "better" design files a `prd-review` ticket and stops. The PRD amends first; code follows.
3. **ARCH-1 is law from day one**: the dependency lint (T-003) merges before any kernel code exists, so violations are impossible rather than cleaned up.
4. **Every AC below is machine-checkable.** "Done" = its tests exist and pass in CI, plus the global DoD: typecheck clean, lint clean, no new runtime dependency beyond N-3's set, schema_version on any new committed artifact type.
5. **Ticket IDs are stable**; commits carry `Foreman-Ticket: T-###` trailers from T-001 onward — we adopt B-1's convention for building Foreman itself.

## 1. Resolved Implementation Details

The PRD deliberately leaves mechanics open; these are the resolutions (flagged here so review can veto them in one place). None alters PRD semantics.

| # | Question | Resolution |
|---|---|---|
| R-1 | N-3 "minimal pinned deps" scope | Governs **runtime** deps (`@anthropic-ai/claude-agent-sdk`, `zod`, `picomatch`). Dev tooling (vitest, eslint, tsx, typescript) is unrestricted-but-lean and never ships. |
| R-2 | Test runner | vitest (named in M0). Oracle e2e tests that need the run loop are ported as `test.todo` until T-041; the parity report (T-018) tracks `green` vs `pending-M2` per test. |
| R-3 | Atomic claim | `fs.openSync(path, "wx")` — POSIX O_CREAT\|O_EXCL, same semantics as the oracle. Claim-race test forks real processes via `node:child_process`. |
| R-4 | Resolver caller-set test (X-2 AC) | Source-scan unit test (fs + regex over `src/`): `resolveRed(` may appear only in the four allowed call sites + its own module + tests. No AST dependency. |
| R-5 | ARCH-1 dependency lint | eslint `no-restricted-imports` zones: `src/kernel/**` bans `@anthropic-ai/*` and `src/sessions/**` (except `src/sessions/backend.ts` interface); `src/sessions/**` bans `src/kernel/machine`, `src/kernel/tickets` mutators. dependency-cruiser avoided (R-1 leanness). |
| R-6 | Hashing / globs / prompts | `node:crypto` sha256 everywhere; `picomatch` for all glob matching (one matcher, one semantics); TTY prompts via `node:readline/promises`; TTY detection `process.stdout.isTTY`. |
| R-7 | Lockfile hash inputs (D-18) | node: `package-lock.json`\|`pnpm-lock.yaml`\|`yarn.lock`\|`bun.lockb`; python: `uv.lock`\|`poetry.lock`\|`requirements*.txt`; go: `go.sum`; rust: `Cargo.lock`. Missing lockfile ⇒ hash of manifest + recorded `lockfile: none`. |
| R-8 | JSONL writers | `fs.appendFileSync`; single-writer-per-ticket is guaranteed by the claim, so no file locking beyond claims. |
| R-9 | Where `maxPossibleSessions` runs | In the config module's load path — config parse → compute → assert → return; the CLI never sees an invalid config object. |
| R-10 | Live-session CI | Jobs needing real SDK sessions (T-051, T-070, doctor smoke) are gated on `ANTHROPIC_API_KEY` presence + a spend cap env; contributors without keys still get a fully green mock suite. |
| R-11 | Package identity pre-M4 | `package.json` name `foreman-cli-placeholder`, `"private": true` until OQ-1/OQ-2 resolve at T-083. |
| R-12 | Repo layout | `src/{cli,kernel,adapter,sessions,schemas,fs}` + `prompts/` + `tests/{oracle,fixtures}` — directory names are what R-5's lint zones bind to. |

## 2. Execution Topology

**Critical path:** T-001 → T-010 → T-011 → T-013 → T-017 → T-040 → T-041 → T-042 → T-046 → T-051 → T-060 → T-066 → T-068 → T-070 → T-084.

**Parallel lanes after T-010** (team-of-3 mapping; solo dev runs the critical path and pulls lane work between blocks):
- **Lane K (kernel):** T-011…T-018
- **Lane A (adapter/fs):** T-020…T-030
- **Lane S (sessions/prompts):** T-040, T-046, T-047 (T-047 has zero code deps — start anytime)

Milestone exit reviews are hard gates (§6). Nothing in M(n+1) merges before M(n)'s exit ticket is green.

---

## 3. Tickets

Format: `T-### · Title [Milestone · Size S/M/L] — Deps` · Surface · Implements → PRD IDs. All ACs are test assertions.

### Phase P0 — Foundation

**T-001 · Repository scaffold + CI skeleton [P0 · M] — deps: none**
Surface: `/`, `.github/workflows/ci.yml`, `package.json`, `tsconfig.json`
Implements → N-3, N-6 (partial), R-1, R-11, R-12.
Node ≥20, ESM, strict tsconfig, vitest wired, runtime deps exactly {agent-sdk, zod, picomatch} pinned exact. CI runs lint+typecheck+test on PR.
AC: fresh clone `npm ci && npm test` green; CI blocks on any of the three; `npm ls --prod` shows exactly three deps.

**T-002 · Foreman's own verification gates [P0 · S] — deps: T-001**
Surface: `eslint.config.js`, `vitest.config.ts`, `package.json#scripts`
Implements → dogfooding prerequisite for N-7 (Foreman must later bind these very scripts).
AC: `npm run test|lint|typecheck` each exit 0 on empty skeleton; scripts are the future binding targets (no watch-mode defaults — `vitest run`).

**T-003 · ARCH-1 dependency-direction lint [P0 · S] — deps: T-001**
Surface: `eslint.config.js`, `tests/arch/deps.test.ts`
Implements → ARCH-1 (lint half), D-19, R-5.
AC: fixture import of SDK from `src/kernel/**` fails CI; interface-only import from `src/sessions/backend.ts` passes.

### M0 — Oracle Port (state core)

**T-010 · Schemas + inferred types (zod) [M0 · L] — deps: T-001**
Surface: `src/schemas/**`, `tests/oracle/artifacts.test.ts`
Implements → A-1…A-8, F-3 (schema_version + newer-schema refusal), V-2 record shape, X-6 brief fields (sources_consulted, local_search), A-1 generations[].
Oracle: artifact validator tests.
AC: each schema rejects its invalid fixtures with field-level errors; every committed type carries schema_version; newer-version fixture exits 2 with upgrade hint; A-5 rejects `changes` without tag ∈ {correctness, requirement, scope, rules}.

**T-011 · State machine: table as data + apply [M0 · L] — deps: T-010**
Surface: `src/kernel/machine.ts`, `tests/oracle/state.test.ts`
Implements → X-3 (BLIND_FIX naming per D-12), transitions.jsonl (F-1 local set), illegal-pair throw.
Oracle: test_state (illegal transitions, happy paths, BUDGET_BREACH-from-anywhere).
AC: every (state,event) outside TABLE throws; table exported as data (no logic in rows beyond guard refs); transition log line schema-validated.

**T-012 · Unit budgets + counters [M0 · M] — deps: T-011**
Surface: `src/kernel/budgets.ts`
Implements → X-1, D-12.
Oracle: ladder-budget tests via counter mapping (fix_sessions{0,1,2} ⇔ (blind,informed){(0,0),(1,0),(1,1)}).
AC: per-slot at-most-once property test over all reachable counter states; review_fix_attempts independent of ladder slots (D-6 review-loop test ports).

**T-013 · Ladder resolver + closed caller set [M0 · M] — deps: T-012**
Surface: `src/kernel/resolver.ts`, `tests/arch/resolver-callers.test.ts`
Implements → X-2, D-13, R-4.
AC: oracle ladder paths port green ("no second blind fix"); property test: ∀ counters, resolver output ∈ {BLIND_FIX, RESEARCH, INFORMED_FIX, NEEDS_HUMAN} with monotone slot consumption; source-scan asserts callers = {IN_PROGRESS handler, BLIND_FIX handler, REVIEW_FIX handler, APPROVED close-check}; INFORMED_FIX red is a table edge, not a resolver call.

**T-014 · maxPossibleSessions + config-load rejection [M0 · M] — deps: T-011, T-012**
Surface: `src/kernel/worstcase.ts`, `src/schemas/config.ts`
Implements → X-1 (computed-never-quoted), R-9.
AC: graph walk computes worst case from TABLE + budgets (asserts 12 for defaults as a *regression pin*, not a spec constant); config with net ≤ computed rejected at load with both numbers named; adding a synthetic recovery edge in a test copy of TABLE raises the computed value (proves sensitivity).

**T-015 · Attempt generations [M0 · M] — deps: T-012**
Surface: `src/kernel/generations.ts`
Implements → X-8, D-17, A-1 generations[], M0 divergence note.
AC: HUMAN_REQUEUE opens gen N+1 with zeroed counters; gen N frozen (mutation throws); cumulative totals helper feeds dossier/status; oracle requeue test translated to generation semantics.

**T-016 · Classifier + signatures [M0 · M] — deps: T-010**
Surface: `src/kernel/classify.ts`
Implements → X-5 (advisory `suspected_flake` only), X-7.
Oracle: classification + signature-stability tests.
AC: signatures stable across volatile tokens (line numbers, addresses, PIDs), distinct across distinct failures; classifier output type has no "non-actionable" variant — API makes D-14 violations unrepresentable.

**T-017 · Ticket store [M0 · L] — deps: T-010, T-015**
Surface: `src/kernel/tickets.ts`
Implements → A-1 persistence, atomic claims (R-3), ready() w/ blockers, discovered_from, append-only notes.
Oracle: full tickets suite incl. 8-process claim race (exactly one winner).
AC: oracle parity; generations persist round-trip; bootstrap blocking (deps on ticket #1) honored by ready().

**T-018 · Oracle parity report [M0 · S — exit ticket] — deps: T-011…T-017**
Surface: `tests/oracle/PARITY.md`, generator script
Implements → M0 exit.
AC: checked-in table mapping all 52 oracle tests → TS test id + status ∈ {green, pending-M2 (R-2)}; zero `unmapped`; CI regenerates and diffs.

### M1 — Verification Adapter + Filesystem

**T-020 · Gate runner [M1 · M] — deps: T-016**
Surface: `src/adapter/run.ts`
Implements → gate execution under V-4 semantics (timeout, captured output, normalized exit), feeds X-5/X-7.
AC: timeout produces classifiable result; output tail captured bounded; exit normalization matrix tests.

**T-021 · Environment fingerprint [M1 · S] — deps: T-010**
Surface: `src/adapter/env.ts`
Implements → D-18 inputs (lockfile hash per R-7, runtime version), brief env snapshot.
AC: per-ecosystem lockfile detection tests; missing-lockfile fallback recorded as `lockfile: none`.

**T-022 · Flake filter [M1 · M] — deps: T-016, T-017, T-020**
Surface: `src/kernel/flake.ts`
Implements → X-5, D-14, D-7.
AC: oracle flake tests port (zero fix budget consumed; quarantine ticket linked discovered_from); **adversarial fixture**: real regression whose output matches a flake pattern → rerun red → enters ladder; green-rerun is the only path to quarantine (code path assertion).

**T-023 · `.foreman/` layout + commit split [M1 · M] — deps: T-010**
Surface: `src/fs/layout.ts`
Implements → F-1, F-2 boundary lint, F-3 stamping.
AC: fresh init produces exact split; Foreman-written `.foreman/.gitignore` enforces local set; boundary lint fixture (a project-config file appearing under `.foreman/`) fails CI; git status shows only committed set.

**T-024 · Content-addressed checkpoints [M1 · L] — deps: T-023**
Surface: `src/fs/checkpoints.ts`
Implements → F-4, P9, C-8 substrate.
AC: property test — mutate any input file, exactly the dependent phases re-execute; consuming a stale checkpoint is impossible (API returns `stale`, never data); checkpoint records validate (A-7).

**T-025 · Discovery engines (stack facts) [M1 · L] — deps: T-010**
Surface: `src/adapter/discover/*.ts`
Implements → V-1 (candidate proposal), C-2 stack-facts half, N-2 determinism.
AC: byte-identical `discovery.json` across repeated runs on every fixture; candidates for node (scripts+lockfile→pm), make/just, pyproject, go, cargo, tsc(`--noEmit`) each covered by a fixture.

**T-026 · Binding execution + watch-mode + status [M1 · M] — deps: T-020, T-025**
Surface: `src/adapter/bind.ts`
Implements → V-1 (execute-before-approve, watch rejection, ambiguity signal, acknowledged skip), V-2 (`status`, `approved_by`).
AC: watch-mode fixture rejected with explanation; ambiguity yields a structured choice event (consumed by C-3b later); skip records who/when; provisional status representable (C-4 consumer).

**T-027 · config_hash + drift halting + verify sync [M1 · L] — deps: T-026**
Surface: `src/adapter/drift.ts`, `src/cli/verify.ts`
Implements → V-3, SEC-5, plumbing `verify sync` (C-12).
AC: mid-run edit of the defining config region halts before next gate, exit 2, both hashes named; sync re-runs V-1 with consent and re-baselines; provisional bindings exempt until finalization (C-4); drift on non-gate config regions does not halt (region hashing precision test).

**T-028 · Invocation normalization matrix [M1 · M] — deps: T-020**
Surface: `src/adapter/normalize.ts`
Implements → V-4 (CI-mode flags, env, pm selection at call time).
AC: matrix tests per adapter (`vitest run`, `--watchAll=false`, `CI=1`, pm chosen from lockfile); normalization never edits project files (F-2 assertion in test).

**T-029 · Monorepo detection + root candidates [M1 · M] — deps: T-025**
Surface: `src/adapter/workspace.ts`
Implements → V-5, D-5.
Non-goal: any per-workspace schema field.
AC: workspace fixtures (pnpm-workspace, npm workspaces, turbo, nx, go.work, cargo ws) prefer orchestrator-native root commands; notice printed once; `test_single` binds affected-filter where available, root fallback otherwise.

**T-030 · Three-ecosystem fixtures [M1 · L — exit ticket] — deps: T-025…T-029**
Surface: `tests/fixtures/{ts-service,py-service,go-cli}/`
Implements → N-1, M1 exit.
AC: full adapter e2e (discover→execute→approve→drift) green on all three with zero kernel changes — bindings-only diffs between fixtures (asserted by comparing fixture configs).

### M2 — `run` Live

**T-040 · SessionBackend interface + MockBackend [M2 · M] — deps: T-010**
Surface: `src/sessions/backend.ts`, `src/sessions/mock.ts`
Implements → ARCH-1 seam, oracle mock semantics (per `ticket:role:n` scripting, call recording).
AC: interface is the only symbol `src/kernel` may import from sessions (R-5 zone test); mock replays oracle e2e scripts; un-scripted role defaults to success (oracle parity).

**T-041 · Kernel run loop [M2 · XL] — deps: T-013, T-014, T-017, T-022, T-024, T-040**
Surface: `src/kernel/run.ts`, `src/cli/run.ts`
Implements → C-9 (claim + resumable pool), C-11 exit codes, B-5 journal (crashed session never relaunches — budget consumed, gate judges tree as-is), budget-at-launch, ledger hooks.
Oracle: kernel e2e suite flips from `todo` to green here (R-2).
AC: oracle happy path / full ladder / crash-resume / falsified-premise / hypothesis-thrash / review-loop all green; exit codes 0/10/2/1 integration-tested; resumable pool picks up every non-terminal in-flight state.

**T-042 · Run branch + worktree mode + base guard [M2 · L] — deps: T-041**
Surface: `src/kernel/git.ts`
Implements → B-1 (trailers), B-2 (`--worktree` merging into run branch), B-3 + repository-initialization boundary, B-5 reset.
AC: base SHA byte-identical across a full run (both modes); trailers on every commit; hostile-ticket red-team fixture cannot induce base write; crash with dirty tree resets to last ticket commit.

**T-043 · Diagnosis gate [M2 · M] — deps: T-041**
Surface: `src/kernel/stages/diagnose.ts`
Implements → X-4, D-7.
AC: kernel executes repro and requires fail-as-predicted (substring) before IN_PROGRESS; falsified.json → hypotheses++ and re-diagnosis; >2 → NEEDS_HUMAN; feature-ticket falsification → NEEDS_HUMAN (plan-level flaw row).

**T-044 · Review + REVIEW_FIX routing [M2 · M] — deps: T-041**
Surface: `src/kernel/stages/review.ts`
Implements → X-3 review rows, D-6, A-5 consumption.
AC: reviewer sees only diff+criteria+rules+hypothesis (input-set assertion); REVIEW_CHANGES with review_fix_attempts==0 → REVIEW_FIX else NEEDS_HUMAN; REVIEW_FIX red routes via resolver (caller-set test extends); invalid review artifact = breaker event, never partial acceptance.

**T-045 · Failure research + env-keyed cache [M2 · L] — deps: T-021, T-041**
Surface: `src/kernel/stages/research.ts`
Implements → X-6, X-6a validator (URL ⇒ non-empty local_search), D-18 composite key + version_facts validation-on-hit, upstream_bug → BLOCKED + linked ticket.
AC: oracle cache-hit ports (zero research calls, same env); changed-lockfile fixture misses; contradiction between brief version_facts and current env = miss; tier distribution lands in run report (T-053).

**T-046 · Agent SDK backend [M2 · XL] — deps: T-040, T-047**
Surface: `src/sessions/sdk.ts`, `src/sessions/guard.ts`
Implements → S-1 (plan mode for read-only roles), S-2 (canUseTool path/surface guard + surface-expansion request lever + continuation-based end-of-turn gating), S-3 (per-role allowlists, `WebFetch(domain:…)` from config), S-4 (typed telemetry → ledger; absent fields = breaker), S-6 (stable prefix; per-role hash equality).
Non-goal: retry/backoff logic beyond gate-red continuation.
AC: guard denies protected + out-of-surface with reason (oracle hook-test semantics reproduced in-process); disabled-guard fixture still cannot fake green (kernel re-runs gates — P2 test); telemetry-absent fixture → NEEDS_HUMAN breaker; prefix hash identical per role per run.

**T-047 · Vendored role prompts + curation + attribution [M2 · M] — deps: none (content work)**
Surface: `prompts/*.md`, `ATTRIBUTIONS.md`, `scripts/hash-prompts.ts`
Implements → S-7, D-9.
AC: packaging test verifies prompt hashes + ATTRIBUTIONS.md presence (upstream sources + licenses); assignments referencing unknown role@hash fail closed; prompts encode X-4/X-6a/A-5 protocols (prompt-lint checklist test).

**T-048 · Ledger + cross-generation spend backstop [M2 · M] — deps: T-041, T-015**
Surface: `src/kernel/ledger.ts`
Implements → S-4 ledger, X-8 cumulative ceiling, F-1 ledger.jsonl.
AC: spend accumulates across generations and trips the run ceiling regardless of generation count; ledger rows schema-valid; per-session cost/turn/token recorded.

**T-049 · Escalation UX + dossier + risk gate [M2 · L] — deps: T-041, T-042**
Surface: `src/kernel/dossier.ts`, `src/cli/escalate.ts`
Implements → C-10 (TTY conversational approve/requeue-with-guidance/skip/quit; non-TTY JSON summary), A-8, B-4 (risk approval → re-enter APPROVED, kernel re-verifies), X-8 cumulative display, requeue guidance recorded on new generation.
AC: TTY fixture resolves NEEDS_HUMAN without plumbing; CI fixture emits schema-valid JSON; risk fixture: approve → re-verify → DONE with merge; dossier lists per-generation history.

**T-050 · doctor + pinning [M2 · M] — deps: T-046**
Surface: `src/cli/doctor.ts`
Implements → S-5, C-12.
AC: exact SDK dep asserted from lockfile; CLI/runtime pin mismatch fails naming both versions; doctor runs one live smoke session (R-10-gated) verifying telemetry parse end-to-end.

**T-051 · M2 live exit fixture [M2 · M — exit ticket] — deps: T-041…T-050**
Surface: `tests/live/three-ticket-plan.test.ts`
Implements → M2 exit.
AC: budgeted live run (R-10) completes a 3-ticket plan on the ts-service fixture: ≥1 clean DONE, ≥1 ladder traversal, ≥1 review-changes cycle; ledger + transitions reconstruct the run (N-5 assertion).

**T-052 · SEC red-team pack + env allowlist + scrubbing [M2 · L] — deps: T-042, T-046**
Surface: `tests/sec/**`, `src/sessions/env.ts`, `src/kernel/scrub.ts`
Implements → SEC-1…SEC-5 ACs, SEC-4 (allowlisted env, pattern scrub before write).
AC: 10 evasion tickets — 0 protected writes, 0 base-branch writes, 0 unlogged consents; secret-shaped strings never reach ledger/logs (fixture).

**T-053 · status/report + metrics counters [M2 · M] — deps: T-041, T-048**
Surface: `src/cli/status.ts`, `src/cli/report.ts`
Implements → C-12 plumbing, §14 counters (autonomous-completion rate, sessions/ticket, cache hit rate, tier distribution), C-13 five-label vocabulary + resume announcements.
AC: terminal snapshot contains no internal state names; resume announces ticket + stage; report emits every §14 metric from artifacts alone.

**T-054 · ARCH-1 apply-site audit [M2 · S] — deps: T-041**
Surface: `tests/arch/apply-audit.test.ts`
Implements → ARCH-1 (audit half).
AC: every `machine.apply` call site's event provably derives from a validator result or gate result (source-scan + type-level: event constructors only exported from validator/gate modules).

### M3 — `init` Pipeline

**T-060 · init phase machine + resume [M3 · L] — deps: T-024**
Surface: `src/init/machine.ts`, `src/cli/init.ts`
Implements → C-5 closed interrupt enum (lint forbids prompting outside it), C-8 (checkpoint replay, `--replan`, approval invalidation on ticket edits), C-1 root-only.
AC: subdirectory exits 2 with hint; editing PRD.md re-runs ANALYZE-forward only; approved-plan re-init prints status; hand-edited ticket invalidates approval and re-presents diff.

**T-061 · Doc discovery [M3 · M] — deps: T-060**
Surface: `src/init/discover-docs.ts`
Implements → C-2 (docs half), AWAIT_DOCS with exact looked-for list.
AC: deterministic discovery.json; none-found fixture interrupts once listing patterns searched.

**T-062 · ANALYZE stage [M3 · L] — deps: T-060, T-046**
Surface: `src/init/analyze.ts`
Implements → C-3 (batched AWAIT_INFO), greenfield stack decision output (D-10 consumer), read-only planner session.
AC: missing-info fixture yields one interruption with ≥2 questions; greenfield fixture emits stack decision consumed by T-064; planner session runs in plan mode with no write tools (S-1 assertion).

**T-063 · Planning research [M3 · M] — deps: T-062, T-045**
Surface: `src/init/plan-research.ts`
Implements → C-3a, D-11 (question-hash cache, budget, exhaustion → joins AWAIT_INFO batch), shared X-6a validator.
AC: unfamiliar-API fixture yields plan citing official docs; re-init cache hit = zero web calls; budget exhaustion adds question to the single AWAIT_INFO batch (no new interrupt).

**T-064 · DETERMINE_VERIFICATION + auto-binding [M3 · M] — deps: T-026, T-062**
Surface: `src/init/bind.ts`
Implements → C-3b, D-10 (auto-accept sole candidate, `approved_by:"auto"`, interrupt only on ambiguity/zero/failed-sole), PRESENT binding table surfacing.
AC: lone-vitest fixture: zero binding interrupts; two-candidate fixture: exactly one; PRESENT snapshot lists provenance per slot; auto bindings overridable at PRESENT.

**T-065 · Setup-consent engine + allowlist [M3 · M] — deps: T-060**
Surface: `src/init/consent.ts`, `src/init/allowlist.ts`
Implements → C-6 three-way rule, C-6a/D-15 (closed template data module; off-list never executed even with consent — printed with rationale, resume-after), C-1/B-3 `git init` + initial-commit template.
AC: off-list fixture (piped-shell installer) spawns no child process; direct-edit of existing config refused with proposal printed; allowlist module has its own tests; git-init template creates base branch, P7 red-team from that commit onward.

**T-066 · PLAN generation + bootstrap lifecycle [M3 · XL] — deps: T-062, T-063, T-064, T-047**
Surface: `src/init/plan.ts`
Implements → C-4 (deps, agent assignment, greenfield bootstrap ticket #1; provisional→approved binding finalization on #1's green gates; all tickets blocked on #1), A-2 emission.
AC: greenfield fixture: init completes with provisional bindings; #1 DONE flips them approved + baseline hashes; #2 unclaimable before that; brownfield fixture: no bootstrap ticket, bindings approved at init.

**T-067 · PREPARE_AGENTS [M3 · S] — deps: T-066, T-047**
Surface: `src/init/agents.ts`
Implements → S-7 consumer (select from vendored set only; assignments role@hash).
AC: assignment referencing unknown hash fails closed; no network syscalls in phase (test spy).

**T-068 · PRESENT + dual-exit approval [M3 · M] — deps: T-064, T-066**
Surface: `src/init/present.ts`
Implements → C-7 (inline TTY approval; deferred → first `run` presents; approval.json who/when/plan-hash).
AC: declined approval → READY-unapproved, exit 2; `run` on unapproved presents then executes on yes; approval.json validates (A-2).

**T-069 · Porcelain freeze + golden-path docs test [M3 · S] — deps: T-053**
Surface: `tests/docs/golden-path.test.ts`, `README.md`
Implements → C-14, N-6 (README two-command snapshot).
AC: README golden path contains exactly `foreman init` and `foreman run`; interrupt enum length == 5 asserted; release checklist includes the freeze item.

**T-070 · Self-build first green [M3 · XL — exit ticket] — deps: T-060…T-068, T-051**
Surface: `tests/live/self-build.test.ts`
Implements → M3 exit, N-7/D-16 first green.
AC: folder containing only `foreman-prd-v2.md` → `foreman init && foreman run` (R-10-gated, budgeted) reads the PRD, generates tickets, selects agents, builds, tests, reviews to DONE on the walking skeleton; base branch untouched; run reconstructable from artifacts.

**T-071 · CI split: skeleton vs full self-build [M3 · S] — deps: T-070**
Surface: `.github/workflows/{ci,release}.yml`
Implements → N-7 split (skeleton subset in regular CI; full budgeted self-build in release pipeline).
AC: PR CI runs skeleton subset mock-first; release workflow requires full self-build green.

### M4 — Public Release

**T-080 · Schema freeze v1 + migration policy [M4 · M] — deps: all M3**
Implements → F-3, M4. AC: `schema_version: 1` across committed types; migration doc; v0→v1 fixture migrates; freeze test forbids field changes without version bump.

**T-081 · Security review sign-off [M4 · M] — deps: T-052**
Implements → M4 (SEC fixtures re-run + human review recorded). AC: signed review doc referencing SEC pack run id.

**T-082 · Docs site + CONTRIBUTING [M4 · M] — deps: T-069**
Implements → N-6 complete (porting-oracle rule, no-deviation rule, zod-generated schema reference). AC: schema reference generated in CI; CONTRIBUTING contains both rules verbatim.

**T-083 · Packaging + identity [M4 · S] — deps: T-080; **blocked on OQ-1, OQ-2 (human)**
Implements → M4, S-7 packaging AC, R-11 removal. AC: name + license set; `npm pack` contains prompts + ATTRIBUTIONS.md + hashes; private flag removed.

**T-084 · Release pipeline + upgrade gates [M4 · M] — deps: T-071, T-083**
Implements → N-7 as release gate, S-5 (backend-upgrade PR template requiring fixture-suite + self-build link).
AC: publish job hard-requires N-7 green; upgrade PR without fixture link blocked by CI.

---

## 4. Traceability Matrix (requirement → tickets)

| PRD | Tickets |
|---|---|
| ARCH-1 / D-19 | T-003, T-040, T-054 |
| C-1 | T-060, T-065 · C-2 | T-025, T-061 · C-3 | T-062 · C-3a | T-063 · C-3b/D-10 | T-064 |
| C-4 | T-066 · C-5 | T-060 · C-6/C-6a/D-15 | T-065 · C-7 | T-068 · C-8 | T-060, T-024 |
| C-9 | T-041 · C-10 | T-049 · C-11 | T-041 · C-12 | T-027, T-050, T-053 · C-13 | T-053 · C-14 | T-069 |
| F-1 | T-023 · F-2 | T-023, T-028, T-065 · F-3 | T-010, T-023, T-080 · F-4/P9 | T-024 |
| V-1 | T-025, T-026 · V-2 | T-010, T-026 · V-3/SEC-5 | T-027 · V-4 | T-020, T-028 · V-5/D-5 | T-029 |
| X-1/D-12 | T-012, T-014 · X-2/D-13 | T-013, T-044 · X-3 | T-011, T-043, T-044 · X-4/D-7 | T-043 |
| X-5/D-14 | T-016, T-022 · X-6/D-18 | T-045, T-021 · X-6a | T-045, T-063 · X-7 | T-016 · X-8/D-17 | T-015, T-048, T-049 |
| S-1…S-4, S-6 | T-046 · S-5 | T-050, T-084 · S-7/D-9 | T-047, T-067, T-083 |
| B-1…B-3 | T-042, T-065 · B-4 | T-049 · B-5 | T-041, T-042 |
| A-1…A-8 | T-010 (+ consumers T-043/T-044/T-045/T-049/T-066) |
| SEC-1…SEC-4 | T-052, T-065 · N-1 | T-030 · N-2 | T-025 · N-3 | T-001 · N-4 | T-041 AC budget · N-5 | T-051, T-053 · N-6 | T-069, T-082 · N-7/D-16 | T-070, T-071, T-084 |
| M0–M4 exits | T-018, T-030, T-051, T-070, T-083/T-084 |

Every C/F/V/X/S/B/A/SEC/N/ARCH identifier in draft.4 appears above; OQ-1/OQ-2 surface only in T-083 as the sole human-blocked ticket before publish.

## 5. Risk Register (delta to PRD §15 — execution risks only)

| Risk | Ticket-level mitigation |
|---|---|
| Oracle e2e tests stall as `todo` and rot | T-018 parity report diffs in CI; `pending-M2` count must reach 0 at T-041 merge |
| SDK integration surprises (T-046) | T-050 doctor smoke lands with it; continuation-gating has a mock-level twin so only transport is live-risk |
| Self-build (T-070) too flaky as a gate | budgets + R-10 caps; skeleton/full split (T-071) keeps PR CI deterministic |
| Solo-dev context loss across 55 tickets | trailers (Agreement 5) + this plan as `.foreman/plan/` seed — Foreman's own resume model, applied manually until M3 |

## 6. Milestone Exit Reviews

M0: parity report zero-unmapped → M1: three ecosystems, kernel-diff empty → M2: live 3-ticket run reconstructable from artifacts → M3: self-build green once → M4: N-7 wired as permanent gate, identity resolved, publish.

---

*Plan 1.0 — deviations from this plan that imply PRD changes require a `prd-review` ticket first (Working Agreement 2). This document is deliberately A-1-shaped so it can be replayed as the N-7 self-build seed.*
