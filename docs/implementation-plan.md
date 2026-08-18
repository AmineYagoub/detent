# Detent — Implementation Plan

| | |
|---|---|
| Source of truth | `detent-prd-v2.md` (2.0-draft.6) — no redesign, no simplification, no additions |
| Plan version | 1.6 — T-030 landed; **M1 exited** (§6, §7) |
| Date | 2026-08-17 |
| Shape | 56 tickets, dependency-ordered, A-1-compatible — usable as the N-7 self-build seed |

---

## 0. Working Agreements (bind every ticket)

1. **Tests before code** (M0 rule): each ticket that ports oracle behavior lands its translated tests first, red, then implements to green. Oracle = Python reference v0.1.3, 52 tests.
2. **No-deviation rule** (N-6): an implementer who wants a "better" design files a `prd-review` ticket and stops. The PRD amends first; code follows.
3. **ARCH-1 is law from day one**: the dependency lint (T-003) merges before any kernel code exists, so violations are impossible rather than cleaned up.
4. **Every AC below is machine-checkable.** "Done" = its tests exist and pass in CI, plus the global DoD: typecheck clean, lint clean, no new runtime dependency beyond N-3's set, schema_version on any new committed artifact type.
5. **Ticket IDs are stable**; commits carry `Detent-Ticket: T-###` trailers from T-001 onward — we adopt B-1's convention for building Detent itself.

## 1. Resolved Implementation Details

The PRD deliberately leaves mechanics open; these are the resolutions (flagged here so review can veto them in one place). None alters PRD semantics.

| # | Question | Resolution |
|---|---|---|
| R-1 | N-3 "minimal pinned deps" scope | Governs **direct runtime** deps (`@anthropic-ai/claude-agent-sdk`, `zod`, `picomatch`). Dev tooling (vitest, eslint, tsx, typescript) is unrestricted-but-lean and never ships. Two corrections from the upstream check: **zod 4** is the target (~7× faster array parsing, and TS type instantiations drop from >25k to ~175 — a compile-time win for a project whose backbone is `src/schemas/**` under a strict tsconfig; migration cost is `z.string().email()` → `z.email()`, `.merge()` → `.extend()`, the unified error param, and changed optional + `.catch()`/`.default()` semantics). And the agent SDK ships **platform-specific optional dependencies** (`-darwin-arm64`, `-linux-x64`, `-linux-x64-musl`, `-win32-x64`), so "three deps" means three *direct* deps — a transitive count will not be three. |
| R-2 | Test runner | vitest (named in M0). All 52 oracle tests are translated against interfaces at M0 (PRD M0: "against interfaces only"); those needing a later layer land as `test.todo`. The parity report (T-018) records per test `status ∈ {green, pending-M1, pending-M2, pending-later}` **plus the ticket that closes it**, so each milestone exit asserts its own threshold instead of one global one. Status is *derived* from the closing ticket's milestone rather than asserted separately, so the two cannot drift. Measured distribution at M0 exit: **22 green, 5 pending-M1, 24 pending-M2, 1 pending-later**; after T-020 and T-022, **27 / 0 / 24 / 1**. The fourth value is not decoration — `test_mode1_stub_detected` maps to greenfield/brownfield detection, which is C-1's job at T-060 (M3), so a three-value vocabulary could not express it. Status derives from whether the port exists (`ts` names a test file that cites the closing ticket), not from the closing ticket's milestone: the milestone-only form was correct only while M0 was the last landed milestone, and kept reporting `pending-M1` after T-020 and T-022 landed. `LANDED_THROUGH` is the single ratchet, asserted in both directions. |
| R-3 | Atomic claim | `fs.openSync(path, "wx")` — POSIX O_CREAT\|O_EXCL, same semantics as the oracle. Claim-race test forks real processes via `node:child_process`. |
| R-4 | Resolver caller-set test (X-2 AC) | Source-scan unit test (fs + regex over `src/`): `resolveRed(` may appear only in the four allowed call sites + its own module + tests. No AST dependency. |
| R-5 | ARCH-1 dependency lint | eslint `no-restricted-imports` zones: `src/kernel/**` bans `@anthropic-ai/*` and `src/sessions/**` (except `src/sessions/backend.ts` interface); `src/sessions/**` bans `src/kernel/machine` and `src/kernel/tickets/mutations`. ARCH-1's "no kernel state mutators" is only expressible to `no-restricted-imports` if mutators are their own module, so T-017 lands `src/kernel/tickets/` as a directory splitting `mutations.ts` from `readers.ts`. dependency-cruiser avoided (R-1 leanness). |
| R-6 | Hashing / globs / prompts | `node:crypto` sha256 everywhere; `picomatch` for all glob matching (one matcher, one semantics); TTY prompts via `node:readline/promises`; TTY detection `process.stdout.isTTY`. |
| R-7 | Lockfile hash inputs (D-18) | node: `package-lock.json`\|`pnpm-lock.yaml`\|`yarn.lock`\|`bun.lockb`; python: `uv.lock`\|`poetry.lock`\|`requirements*.txt`; go: `go.sum`; rust: `Cargo.lock`. Missing lockfile ⇒ hash of manifest + recorded `lockfile: none`. |
| R-8 | JSONL writers | `fs.appendFileSync`. Per-ticket files are single-writer by claim. `ledger.jsonl` and `transitions.jsonl` are **run-level**: they are single-writer because v1 is single-worker (NG4), *not* because of claims, and `appendFileSync` is only atomic below `PIPE_BUF` (4096B) — ledger rows carrying telemetry can exceed it. Lifting NG4 requires a real append protocol, not more claims. T-041 asserts exactly one writer per run-level file. |
| R-9 | Where `maxPossibleSessions` runs | In the config module's load path — config parse → compute → assert → return; the CLI never sees an invalid config object. |
| R-10 | Live-session CI | Jobs needing real SDK sessions (T-051, T-070, doctor smoke) are gated on `ANTHROPIC_API_KEY` presence + a spend cap env; contributors without keys still get a fully green mock suite. |
| R-11 | Package identity pre-M4 | `package.json` name `detent-cli-placeholder`, `"private": true` until OQ-1/OQ-2 resolve at T-083. |
| R-12 | Repo layout | `src/{cli,kernel,adapter,sessions,schemas,fs,init}` (with `src/kernel/tickets/{readers,mutations}.ts` per R-5) + `prompts/` + `scripts/` + `tests/{oracle,arch,adapter,fs,kernel,cli,fixtures,sec,live,docs,perf}` — directory names are what R-5's lint zones bind to, so every ticket surface must name one of them. `tests/perf/` is fixed by draft.5's N-4, which names `tests/perf/transition-overhead.bench.ts` normatively. `tests/{adapter,fs,kernel,cli}` mirror the `src/` layer they cover and were added at 1.5: M1's tickets are not oracle ports, and `tests/oracle/` had been the only home for module tests. Oracle ports are located by the parity map's `ts` field, not by directory. |

## 2. Execution Topology

**Critical path** — the longest chain in the dependency graph below, 17 tickets; every arrow is a real `deps:` edge:

```
T-001 → T-010 → T-011 → T-012 → T-015 → T-017 → T-022 → T-041 → T-045
      → T-063 → T-066 → T-067 → T-070 → T-071 → T-080 → T-083 → T-084
```

Two notes on the tail. `T-067` and `T-068` tie at depth 12; ties break by ascending ticket id, so T-067 is canonical here and the choice carries no scheduling meaning. And **T-083 is human-blocked on OQ-1/OQ-2** — it sits two hops from the terminal T-084, so the schedule-critical path runs through a decision no engineer can unblock. Resolve OQ-1/OQ-2 before M4 opens, not at it.

The critical path is derived, not authored: T-018 regenerates it from the `deps:` fields and CI diffs the result, so an edited dependency that reshapes the graph fails the build rather than silently rotting this diagram.

**Parallel lanes** (team-of-3 mapping; solo dev runs the critical path and pulls lane work between blocks). Lanes fork at their own entry deps, not at a single point:
- **Lane K (kernel):** enters at T-011 (deps T-010). T-016 forks separately off T-010. Runs T-011 → T-012 → {T-013, T-014, T-015} → T-017 → T-018.
- **Lane A (adapter/fs):** T-021, T-023, T-025 enter off T-010, but **T-020 is gated on Lane K's T-016** and T-022 additionally on T-017 — Lane A is not independent of Lane K, it joins it.
- **Lane S (sessions/prompts):** T-047 has zero deps (start anytime); T-040 enters off T-010; T-046 needs both.

Milestone exit reviews are hard gates (§6): nothing in M(n+1) **merges** before M(n)'s exit ticket is green. Lanes may develop across a milestone boundary — several M1 tickets are genuine deps of T-041 — but they land in milestone order.

---

## 3. Tickets

Format: `T-### · Title [Milestone · Size S/M/L/XL] — Deps` · Surface · Implements → PRD IDs. All ACs are test assertions.

### Phase P0 — Foundation

**T-001 · Repository scaffold + CI skeleton [P0 · M] — deps: none**
Surface: `/`, `.github/workflows/ci.yml`, `package.json`, `tsconfig.json`
Implements → N-3, N-6 (partial), R-1, R-11, R-12.
**Node ≥22 LTS, developed against Active LTS (24)** — Node 20 reached EOL 2026-04-30 and is not a supported target (PRDR-055). ESM, strict tsconfig, vitest wired, direct runtime deps exactly {agent-sdk, zod@4, picomatch} pinned exact. CI runs lint+typecheck+test on PR.
AC: fresh clone `npm ci && npm test` green; CI blocks on any of the three; **`package.json#dependencies` has exactly three keys** *and* `npm ls --prod` is clean — the manifest assertion is the primary one because it is hermetic (independent of install state and of npm's default `ls` depth, which has changed across npm majors); `engines.node` excludes every EOL release line; CI's runtime matrix contains no EOL line.
Verified at implementation: the SDK declares 8 platform-specific `optionalDependencies`, but they nest under it rather than hoisting, so `npm ls --prod` does report exactly three. The transitive install is 251 packages — R-1's "three deps" has always meant three *direct* deps.

**T-002 · Detent's own verification gates [P0 · S] — deps: T-001**
Surface: `eslint.config.js`, `vitest.config.ts`, `package.json#scripts`
Implements → dogfooding prerequisite for N-7 (Detent must later bind these very scripts).
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
Implements → X-1 (**both** rows: the three unit slots *and* the config-driven ceilings), D-12.
Oracle: ladder-budget tests via counter mapping (fix_sessions{0,1,2} ⇔ (blind,informed){(0,0),(1,0),(1,1)}).
This module owns all twelve X-1 keys as data, with the scope draft.5 assigns each: `blind_fix_attempts`, `informed_fix_attempts`, `review_fix_attempts`, `research_sessions`, `hypotheses`, `sessions`, `ticket_wall_clock_ms` (ticket/generation); `turns_per_stage` (session); `failure_research_tool_calls` (research session); `planning_research_tool_calls` (init); `flake_reruns` (red gate); `run_spend_usd` (**run**, cumulative — the only run-scoped ceiling, and the one with no default, so config load refuses a config that omits it). Enforcement sites: ticket wall-clock + sessions → T-041, run spend → T-048, turns-per-stage → T-046, failure-research tool calls → T-045, planning-research tool calls → T-063, flake reruns → T-022.
AC: per-slot at-most-once property test over all reachable counter states; review_fix_attempts independent of ladder slots (D-6 review-loop test ports); **every key in X-1's table has a named enforcement site emitting the breach target its row declares** — most are BUDGET_BREACH, but `failure_research_tool_calls` emits RESEARCH_DRY, `planning_research_tool_calls` defers to the AWAIT_INFO batch, and `flake_reruns` enters the ladder — asserted by a coverage test that enumerates the exported ceiling keys and fails CI on any key with no enforcer; config load rejects a budgets object missing `run_spend_usd`.

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

**T-018 · Oracle parity report + derived critical path [M0 · S — exit ticket] — deps: T-011…T-017**
Surface: `tests/oracle/PARITY.md`, `docs/critical-path.md`, generator script
Implements → M0 exit, §2 (derived topology).
AC: checked-in table mapping all 52 oracle tests → TS test id + `status ∈ {green, pending-M1, pending-M2}` + **closing ticket id** (R-2); zero `unmapped` — every oracle test names a destination ticket, which is what forced T-055 into existence; per-milestone thresholds asserted at each exit rather than one global count (M0: ≥22 green; M1: pending-M1 == 0; M2: pending-M2 == 0); the same generator emits the §2 critical path from the ticket `deps:` graph; CI regenerates both and diffs.

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
AC: oracle flake tests port (zero fix budget consumed; quarantine ticket linked discovered_from); **adversarial fixture**: real regression whose output matches a flake pattern → rerun red → enters ladder; green-rerun is the only path to quarantine (code path assertion); `flake_reruns` ceiling of 1 enforced — a second rerun of the same signature is unreachable (property test), never a retry loop.

**T-023 · `.detent/` layout + commit split [M1 · M] — deps: T-010**
Surface: `src/fs/layout.ts`
Implements → F-1, F-2 boundary lint, F-3 stamping.
AC: fresh init produces exact split; Detent-written `.detent/.gitignore` enforces local set; boundary lint fixture (a project-config file appearing under `.detent/`) fails CI; git status shows only committed set; draft.5's per-ticket vs per-run ownership split is encoded — F-1's single-writer AC for `ledger.jsonl` and `transitions.jsonl` is discharged at T-041, since no writer exists until the run loop does.

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
Surface: `src/kernel/run.ts`, `src/cli/run.ts`, `tests/perf/transition-overhead.bench.ts`
Implements → C-9 (claim + resumable pool), C-11 exit codes, B-5 journal (crashed session never relaunches — budget consumed, gate judges tree as-is), budget-at-launch, **N-4**, X-1 `ticket_wall_clock_ms` + `sessions` enforcement, F-1 run-level single-writer, ledger hooks.
Oracle: the 11 `test_kernel_e2e` tests flip from `todo` to green here (R-2) — hook, review, research and risk tests close later at T-046/T-044/T-045/T-049, not here.
AC: oracle happy path / full ladder / crash-resume / falsified-premise / hypothesis-thrash / review-loop all green; exit codes 0/10/2/1 integration-tested; resumable pool picks up every non-terminal in-flight state; **N-4 benchmark in `tests/perf/transition-overhead.bench.ts` — p95 < 100 ms and max < 500 ms over ≥500 synthetic transitions traversing every X-3 row, gates stubbed to constant-time green**, with the per-component split (validate / apply / append / checkpoint) printed so a regression names its cause; CI fails on either bound; `ticket_wall_clock_ms` and net `sessions` ceilings each trip BUDGET_BREACH → NEEDS_HUMAN in their own fixture; exactly one writer per run-level JSONL file asserted, discharging F-1's single-writer AC on behalf of T-023 (R-8).

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
AC: oracle cache-hit ports (zero research calls, same env); changed-lockfile fixture misses; contradiction between brief version_facts and current env = miss; tier distribution lands in run report (T-053); `failure_research_tool_calls` ceiling of 8 enforced — the 9th call is refused and the session ends RESEARCH_DRY rather than running unbounded (X-1 config row).

**T-046 · Agent SDK backend [M2 · XL] — deps: T-040, T-047**
Surface: `src/sessions/sdk.ts`, `src/sessions/guard.ts`
Implements → S-1 (plan mode for read-only roles), S-2 (**`PreToolUse` hook** path/surface guard + surface-expansion request lever + continuation-based end-of-turn gating), S-3 (per-role allowlists + deny-on-unmatched mode), S-4 (telemetry → ledger), S-6 (stable prefix; per-role hash equality; reachable cache).
**The guard is a hook, not `canUseTool`** (PRDR-050). The SDK evaluates hooks → deny → ask → permission mode → allow → `canUseTool`, and a tool auto-approved by an allow rule **never reaches `canUseTool`** — which is every writing tool S-3's allowlists grant. The SDK emits `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` for exactly this shape. The Python oracle already guarded at the hook layer; this keeps it there rather than relocating it.
Non-goal: retry/backoff logic beyond gate-red continuation.
AC: guard denies protected + out-of-surface with reason (all 7 `test_hooks` tests close here, not at T-041) **and is asserted to run on a tool that `allowedTools` auto-approves** — the regression test for the shadowing failure; **`settingSources: []`** asserted, and a fixture repo committing a permissive backend settings file changes the session's effective permission set by zero (PRDR-051); no `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warning is emitted during the suite; disabled-guard fixture still cannot fake green (kernel re-runs gates — P2 test); prefix hash identical per role per run **and a second same-role session after a >5-min gate run reports non-zero cache-read tokens** (PRDR-054 — requires the extended-cache-TTL env var on SEC-4's allowlist); `turns_per_stage` ceiling enforced — continuation stops at the ceiling and emits BUDGET_BREACH rather than looping (X-1 config row); per-role session config asserted for all eight S-1 roles; the `WebFetch` domain-scoping rule form is verified against the pinned backend rather than assumed (PRDR-050).

**T-047 · Vendored role prompts + curation + attribution [M2 · M] — deps: none (content work)**
Surface: `prompts/*.md`, `ATTRIBUTIONS.md`, `scripts/hash-prompts.ts`
Implements → S-7, D-9.
AC: packaging test verifies prompt hashes + ATTRIBUTIONS.md presence (upstream sources + licenses); assignments referencing unknown role@hash fail closed; prompts encode X-4/X-6a/A-5 protocols (prompt-lint checklist test); **the vendored set covers exactly S-1's eight roles** (`planner`, `diagnose`, `implement`, `blind_fix`, `informed_fix`, `review_fix`, `research`, `review` — note `blind_fix`, renamed from `fix` in draft.5) — a missing role fails at packaging, not at runtime; role ids are a committed wire format, so renaming one is an F-3 schema event, asserted by a test that pins the eight strings.

**T-048 · Ledger + cross-generation spend backstop [M2 · M] — deps: T-041, T-015**
Surface: `src/kernel/ledger.ts`
Implements → S-4 ledger, X-8 cumulative ceiling, F-1 ledger.jsonl.
Field discipline (PRDR-052/053), since the SDK's result fields are not interchangeable: read cost and tokens from the **per-model breakdown**, never the cumulative `usage` field, which excludes nested-agent tokens; read output tokens from the **result message**, never summed from per-step assistant messages where the count is a placeholder; deduplicate per-step input/cache counts by message id, since parallel tool calls repeat one id. Record cost as `cost_estimate_usd` — the SDK computes it client-side from a bundled price table and its docs say not to drive financial decisions from it.
AC: spend accumulates across generations and trips the run ceiling regardless of generation count; ledger rows schema-valid; per-session cost/turn/token recorded from the named fields; **crash fixture** — a session whose result carries *zeroed* (not absent) telemetry is recorded as a flagged lower bound, never as zero, and does **not** trip S-4's absent-fields breaker (PRDR-053); budget-exceeded fixture reads the per-model breakdown, which includes the response that crossed the ceiling; a nested-agent fixture pins the `usage`-vs-breakdown divergence so a future roster cannot silently undercount.

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
Implements → SEC-1…SEC-5 ACs, SEC-4 (allowlisted env, pattern scrub before write), §14 scope-canary corpus.
AC: 10 evasion tickets — 0 protected writes, 0 base-branch writes, 0 unlogged consents; secret-shaped strings never reach ledger/logs (fixture); **scope canaries are a named, separately-counted subset** — tickets whose `surface[]` excludes a file the work plainly needs, so a correct run is blocked rather than expanded — feeding T-053's 100%-blocked metric.

**T-053 · status/report + metrics counters [M2 · M] — deps: T-041, T-048**
Surface: `src/cli/status.ts`, `src/cli/report.ts`
Implements → C-12 (`status`, `report`), C-13 five-label vocabulary + resume announcements, and **all seven §14 metrics** — autonomous-completion rate (≥70%), median sessions/completed ticket (≤2.5), scope-canary block rate (100%, corpus from T-052), base-branch writes (0), research cache hit rate, resume correctness (100% of injected crashes recover with no duplicate blind fix), N-7 gate status — plus the X-6a tier distribution.
AC: terminal snapshot contains no internal state names; resume announces ticket + stage; report emits every §14 metric from artifacts alone; **enumeration test — the metric key set equals §14's, so a metric added to the PRD without a reporter fails CI** (the check that would have caught scope-canary going unreported).

**T-054 · ARCH-1 apply-site audit [M2 · S] — deps: T-041**
Surface: `tests/arch/apply-audit.test.ts`
Implements → ARCH-1 (audit half).
AC: every `machine.apply` call site's event provably derives from a validator result or gate result (source-scan + type-level: event constructors only exported from validator/gate modules).

**T-055 · `approve` / `requeue` plumbing commands [M2 · S] — deps: T-015, T-041, T-049**
Surface: `src/cli/approve.ts`, `src/cli/requeue.ts`
Implements → C-12 (the two plumbing verbs T-027/T-050/T-053 do not cover), X-3 `HUMAN_APPROVED` / `HUMAN_REQUEUE` rows reached out-of-band, X-8 (requeue opens a generation).
Rationale: C-12 names six plumbing commands; `status`/`report` land in T-053, `verify sync` in T-027, `doctor` in T-050. `approve <id>` and `requeue <id>` had no ticket, and the oracle's `test_validate_report_approve_requeue` — which drives both as CLI verbs and asserts the resulting states — had no destination, breaching T-018's zero-unmapped exit.
Also implements → C-12 claim discipline (draft.5), the rule this ticket's absence exposed.
Non-goal: any new interrupt or porcelain surface (C-14) — these are scriptable plumbing only, never on the golden path.
AC: `approve <id>` on a NEEDS_HUMAN ticket re-enters APPROVED and the kernel re-verifies before finalize (never a direct DONE); `requeue <id>` opens generation N+1 with zeroed counters and generation N frozen (T-015 semantics, *not* the oracle's `attempts = {}` reset — the M0 divergence); both are refused with exit 2 from any state where the X-3 row is illegal, naming the current state; **claim discipline** — against a live claim both refuse exit 2 naming the claiming pid and the claim's age, and against a stale claim (owner not alive) both may break it, recording the break in `transitions.jsonl` as an operator action with the broken pid; oracle `test_validate_report_approve_requeue` ports green with requeue asserting generation semantics; README golden path still contains exactly two commands (T-069 unaffected).

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
Implements → C-3a, D-11 (question-hash cache, `planning_research_tool_calls` budget, exhaustion → joins AWAIT_INFO batch), shared X-6a validator.
AC: unfamiliar-API fixture yields plan citing official docs; re-init cache hit = zero web calls; `planning_research_tool_calls` ceiling of 16 per init enforced (distinct from T-045's failure-research 8 — two counters, two budgets); budget exhaustion adds the question to the single AWAIT_INFO batch (no new interrupt, C-5 unchanged).

**T-064 · DETERMINE_VERIFICATION + auto-binding [M3 · M] — deps: T-026, T-062**
Surface: `src/init/bind.ts`
Implements → C-3b, D-10 (auto-accept sole candidate, `approved_by:"auto"`, interrupt only on ambiguity/zero/failed-sole), PRESENT binding table surfacing.
AC: lone-vitest fixture: zero binding interrupts; two-candidate fixture: exactly one; PRESENT snapshot lists provenance per slot; auto bindings overridable at PRESENT.

**T-065 · Setup-consent engine + allowlist [M3 · M] — deps: T-060, T-064**
Surface: `src/init/consent.ts`, `src/init/allowlist.ts`
Implements → C-6 three-way rule, C-6a/D-15 (closed template data module; off-list never executed even with consent — printed with rationale, resume-after), C-1/B-3 `git init` + initial-commit template.
Depends on T-064 because the PRD places AWAIT_SETUP_CONSENT *after* DETERMINE_VERIFICATION: C-3b's zero-candidate branch is what raises it, so the consent engine consumes T-064's candidate result.
AC: off-list fixture (piped-shell installer) spawns no child process; direct-edit of existing config refused with proposal printed; allowlist module has its own tests; git-init template creates base branch, P7 red-team from that commit onward; zero-candidate slot from T-064 raises AWAIT_SETUP_CONSENT and no other interrupt class (C-5).

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
AC: README golden path contains exactly `detent init` and `detent run`; interrupt enum length == 5 asserted; release checklist includes the freeze item.

**T-070 · Self-build first green [M3 · XL — exit ticket] — deps: T-060…T-068, T-051**
Surface: `tests/live/self-build.test.ts`
Implements → M3 exit, N-7/D-16 first green.
AC: folder containing only `detent-prd-v2.md` → `detent init && detent run` (R-10-gated, budgeted) reads the PRD, generates tickets, selects agents, builds, tests, reviews to DONE on the walking skeleton; base branch untouched; run reconstructable from artifacts.

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

One row per requirement — parseable, so T-018's generator can diff it against the `Implements →` lines and fail CI on an orphaned requirement or a stale ticket reference.

| PRD | Tickets |
|---|---|
| ARCH-1 | T-003, T-040, T-054 |
| C-1 | T-060, T-065 |
| C-2 | T-025, T-061 |
| C-3 | T-062 |
| C-3a | T-063 |
| C-3b | T-064 |
| C-4 | T-066 |
| C-5 | T-060, T-069 |
| C-6 | T-065 |
| C-6a | T-065 |
| C-7 | T-068 |
| C-8 | T-024, T-060 |
| C-9 | T-041 |
| C-10 | T-049 |
| C-11 | T-041 |
| C-12 | T-027, T-050, T-053, T-055 |
| C-13 | T-053 |
| C-14 | T-069 |
| F-1 | T-023 |
| F-2 | T-023, T-028, T-065 |
| F-3 | T-010, T-023, T-080 |
| F-4 | T-024 |
| V-1 | T-025, T-026 |
| V-2 | T-010, T-026 |
| V-3 | T-027 |
| V-4 | T-020, T-028 |
| V-5 | T-029 |
| X-1 | T-012, T-014, T-022, T-041, T-045, T-046, T-048, T-063 |
| X-2 | T-013 |
| X-3 | T-011, T-043, T-044, T-055 |
| X-4 | T-043 |
| X-5 | T-016, T-022 |
| X-6 | T-021, T-045 |
| X-6a | T-045, T-063 |
| X-7 | T-016 |
| X-8 | T-015, T-048, T-049, T-055 |
| S-1 | T-046, T-047, T-062 |
| S-2 | T-046 |
| S-3 | T-046 |
| S-4 | T-046, T-048 |
| S-5 | T-050, T-084 |
| S-6 | T-046 |
| S-7 | T-047, T-067, T-083 |
| B-1 | T-042 |
| B-2 | T-042 |
| B-3 | T-042, T-065 |
| B-4 | T-049 |
| B-5 | T-041, T-042 |
| A-1 | T-010, T-015, T-017 |
| A-2 | T-010, T-066, T-068 |
| A-3 | T-010, T-043 |
| A-4 | T-010, T-045, T-063 |
| A-5 | T-010, T-044 |
| A-6 | T-010, T-026 |
| A-7 | T-010, T-024 |
| A-8 | T-010, T-049 |
| SEC-1 | T-052, T-065 |
| SEC-2 | T-047, T-067 |
| SEC-3 | T-046, T-052 |
| SEC-4 | T-052 |
| SEC-5 | T-027, T-052 |
| N-1 | T-030 |
| N-2 | T-013, T-016, T-025 |
| N-3 | T-001 |
| N-4 | T-041 |
| N-5 | T-051, T-053 |
| N-6 | T-069, T-082 |
| N-7 | T-002, T-070, T-071, T-084 |
| D-5 | T-029 |
| D-6 | T-012, T-044 |
| D-7 | T-022, T-043 |
| D-9 | T-047 |
| D-10 | T-062, T-064 |
| D-11 | T-045, T-063 |
| D-12 | T-012, T-013 |
| D-13 | T-013 |
| D-14 | T-016, T-022 |
| D-15 | T-065 |
| D-16 | T-070, T-084 |
| D-17 | T-015, T-048 |
| D-18 | T-021, T-045 |
| D-19 | T-003, T-054 |
| §14 metrics | T-052, T-053 |
| M0–M4 exits | T-018, T-030, T-051, T-070, T-080, T-081, T-082, T-083, T-084 |

Every C/F/V/X/S/B/A/SEC/N/ARCH/D identifier in draft.5 appears above. OQ-1/OQ-2 surface only in T-083, the sole human-blocked ticket — and it is on the critical path (§2), so it gates publish rather than merely accompanying it. D-1…D-4 and D-8 are framing decisions with no discrete ticket; they are realized across T-001 (D-1 language), T-083 (D-2 distribution), T-026 (D-4 binding), T-042 (D-8 branch mode).

## 5. Risk Register (delta to PRD §15 — execution risks only)

| Risk | Ticket-level mitigation |
|---|---|
| Oracle e2e tests stall as `todo` and rot | T-018 parity report diffs in CI, each test carrying its closing ticket (R-2); thresholds are per-milestone — `pending-M1` reaches 0 at the M1 exit (T-030), `pending-M2` at the M2 exit (T-051), **not** at T-041, which closes only the 11 `test_kernel_e2e` tests |
| SDK integration surprises (T-046) | T-050 doctor smoke lands with it; continuation-gating has a mock-level twin so only transport is live-risk |
| Self-build (T-070) too flaky as a gate | budgets + R-10 caps; skeleton/full split (T-071) keeps PR CI deterministic |
| Solo-dev context loss across 56 tickets | trailers (Agreement 5) + this plan as `.detent/plan/` seed — Detent's own resume model, applied manually until M3 |
| OQ-1/OQ-2 stall the critical path at T-083 | they are the only human-blocked node and sit two hops from the terminal ticket (§2); resolve before M4 opens, not at it |

## 6. Milestone Exit Reviews

M0 (T-018): parity report zero-unmapped, every test carrying its closing ticket, ≥22 green → M1 (T-030): three ecosystems, kernel-diff empty, `pending-M1` == 0 → M2 (T-051): live 3-ticket run reconstructable from artifacts, `pending-M2` == 0 → M3 (T-070): self-build green once → M4 (T-080…T-084): schema frozen, security review signed, N-7 wired as permanent gate, identity resolved, publish.

Each exit asserts its own parity threshold rather than deferring to a single global count — the correction that made T-018's zero-unmapped criterion satisfiable (§7.2, §7.3).

---

## 7. Changelog

**1.6** — T-030 landed; **M1 is exited**. §6's criteria, measured: three ecosystems e2e green (`tests/fixtures/{ts-service,py-service,go-cli}` through one driver with zero per-ecosystem branches), kernel-diff empty (mechanized below), `pending-M1` == 0 (reached at 1.5). No PRD semantics changed; no ticket rescoped.

What each leg exercises is deliberately different, so the matrix covers V-1's whole decision surface rather than the same happy path three times:

| Fixture | Discovery shape | Approve path | Drift → re-baseline |
|---|---|---|---|
| ts-service | package.json scripts + npm from the lockfile | C-3b auto (`approved_by: "auto"`) | edit `scripts.test` → halt → `verify sync` consent → clean |
| py-service | Makefile at rank 0 **outranks** the pyproject pytest fallback at rank 1 — a preference, not an ambiguity | auto | edit the recipe → halt → sync → clean |
| go-cli | `make test` and `go test ./...` both at rank 0 — a real two-candidate ambiguity | choice interrupt, resolved by "dev"; vet and build auto | edit the recipe → halt → **sync refuses** (the ambiguity persists, and V-1 forbids guessing — asserted as correct behaviour, not tolerated as a limitation) → human re-resolves → clean |

Toolchain policy, recorded honestly: the e2e executes real gates (node, python3+make, go). A host without go skips the go leg **loudly**; on CI (`CI` set) a missing toolchain is a hard failure at collection, never a skip — an exit gate that can silently skip is not a gate. The dev machine this landed from has no go toolchain, so the go leg was arbitrated by CI on a PR branch before reaching main; ubuntu runners provide go. Two consequences worth keeping visible: `go-cli` carries no `go.sum` (a zero-dependency module), so R-7's manifest-hash fallback with `lockfile: none` is exercised by a real fixture; and T-001's "fresh clone `npm ci && npm test` green" now assumes go on the host — true of CI images and most dev machines, and loudly skipped elsewhere.

Two scans landed with the e2e:

- The oracle's `test_kernel_contains_no_stack_strings` is reinstated **literally** (banned toolchain strings over `src/kernel/**`, assembled from pieces exactly as the reference did). The parity map had recorded it as "generalized into ARCH-1's dependency lint" at T-003; the literal form is stronger and now also holds.
- The no-kernel-import rule for the layers below the kernel (adapter, fs, cli, schemas) — held by hand-run grep since 1.5 — is mechanized as a source scan in the e2e, as interim enforcement until PRDR-059 amends ARCH-1 and it becomes a lint zone.

One 1.5 statement is corrected by this release rather than by editing it: `LANDED_THROUGH = "M1"` was set at 1.5, whose doc comment reads "the last milestone whose tickets are all written" — with T-030 unwritten, that was one ticket ahead of itself (harmless to the assertions, which only consult oracle-closing tickets, but the comment overstated). With T-030 in, the statement is literally true.

**1.5** — M1's ten tickets implemented (T-020…T-029); no PRD semantics changed and no ticket rescoped. T-030, M1's exit ticket, is **not** included, so M1 is not exited — but its parity half is met: T-020 and T-022 close all five `pending-M1` oracle tests, so the count reaches 0 ahead of the exit review.

| Plan | 1.4 | 1.5 |
|---|---|---|
| R-2 | status derived from the closing ticket's milestone | derived from whether the port **exists**. The milestone-only form was correct only while M0 was the last landed milestone: T-020 and T-022 landed and their five oracle tests still reported `pending-M1`. `LANDED_THROUGH` is now the one ratchet, asserted in both directions — a green entry whose milestone has not landed fails, and so does a landed milestone with an unported test |
| R-2 | 22 / 5 / 24 / 1 | **27 / 0 / 24 / 1** measured after T-022 |
| R-12 | `tests/{oracle,arch,fixtures,sec,live,docs,perf}` | + `tests/{adapter,fs,kernel,cli}` — M1's tickets are not oracle ports and had no home; oracle ports are located by the parity map's `ts` field, not by directory |
| T-017 | `linkDiscovered` stamped `discovered_from` on both ends | the parent carries `quarantines` (X-5) or `related`. Both ends reading `discovered_from` made the direction unreadable — a reader of the parent saw "discovered from its own quarantine ticket" |
| T-020 / T-025 | gate slots declared twice | `src/schemas/gates.ts` owns the vocabulary; A-6's enum and the adapter both derive from it, as `STATES` already did |

Four defects found by the implementation and fixed inside these tickets rather than filed:

| Where | Defect | Fix |
|---|---|---|
| T-023 | `writeArtifact("plan/../../../x.json")` matched the `plan/` entry by prefix and then joined straight out of `.detent/` | containment check on the relative path; regression test asserts nothing lands outside the state directory |
| T-026 | `resolveChoice` tested candidate membership by object identity | membership by value. C-5 interrupts batch at phase boundaries and resume from a checkpoint (F-4), so the answer arrives in a later process and the offer's object identity is gone; the test now round-trips through JSON |
| T-022 | `RerunLedger.used_for` | `usedFor` — the codebase is camelCase |
| T-025 | discovery could have exposed `writeDiscovery(root, …)` that wrote nothing | removed; `discoveryPath` names where the checkpoint goes and `serializeDiscovery` produces the bytes |
| T-022 | `filterFlake`'s rerun ledger was optional | required, and it carries the ceiling. An optional ledger hands every red gate a fresh allowance — an X-1 ceiling disabled by forgetting to thread a parameter, which is what P6 forbids. `ledgerFor(budgets)` builds one per generation |

Two implementation notes worth carrying, neither a plan change:

- **T-020 does not classify.** The plan says it *feeds* X-5/X-7, and it is written that way: the runner reports `outcome ∈ {exited, timed-out, not-found}` and leaves classification to `src/kernel/classify.ts`. That keeps the adapter free of any upward dependency on the kernel — a direction ARCH-1's lint does not currently enforce, since R-5 zones only `kernel/**` and `sessions/**`. Verified by grep, not by CI (see PRDR-059).
- **T-022's third oracle port lands at the filter's level, not end to end.** `test_flake_charges_nothing_and_quarantines` drove the whole reference kernel; the run loop is T-041. It is ported against a real ticket store as T-022's AC words it — quarantine linked `discovered_from`, zero fix budget charged — and the parity map records that in its note.

**1.4** — product renamed **Foreman → Detent** per PRDR-056 / D-20, applied to PRD 2.0-draft.6 first. Identifier rename only; no ticket added, removed, or rescoped, and no AC's meaning changed. Case-preserving throughout: product name, `.detent/`, `Detent-Ticket:` trailer, `detent/run-<id>` branch prefix, the `detent init` / `detent run` porcelain, `detent-prd-v2.md`, and R-11's placeholder package name. Three consequences are carried, not invented here: T-023 gains the `.foreman/` → `.detent/` relocation as part of F-3's v0→v1 migration; T-042 must parse both trailer forms while writing only the current one, since history is immutable; and T-070's self-build seed is the renamed PRD file. The Python oracle keeps its own name — it is a historical artifact, and `prd-review` evidence filed before the rename is preserved verbatim per N-6.

**1.3** — verified against the live Agent SDK documentation and current release data; six findings filed as PRDR-050…055. The three plan-level ones are applied here; the PRD-level three (guard layer, setting sources, telemetry fields) are pre-applied to the tickets they implement so T-046/T-048 do not encode a design the PRD is about to amend.

| Plan | 1.2 | 1.3 |
|---|---|---|
| T-046 | guard in `canUseTool` | guard in a **`PreToolUse` hook** — `canUseTool` is skipped for any tool an allow rule approves, i.e. every writing tool S-3 grants; regression test asserts the guard fires on an auto-approved tool, and that no `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warning is emitted |
| T-046 | — | **`settingSources: []`** asserted — the SDK's default enables project scope, which resolves against the repo under work, so a committed settings file could add allow rules |
| T-046 | prefix-hash equality only | + cache-read tokens observed across a >5-min gate gap; the extended-TTL env var goes on SEC-4's allowlist |
| T-048 | "per-session cost/turn/token" | reads the per-model breakdown (the cumulative `usage` field excludes nested-agent tokens); output tokens from the result message (per-step is a placeholder); cost recorded as `cost_estimate_usd`; crash fixture asserts zeroed ≠ absent |
| T-001 | `Node ≥20` | **Node ≥22 LTS**, developed against Active LTS 24 — Node 20 hit EOL 2026-04-30; `engines.node` and the CI matrix exclude EOL lines |
| T-001 | `npm ls --prod` shows exactly three | asserts three keys in `package.json#dependencies` — `npm ls --prod` surfaces the SDK's platform-specific optional packages and **would have failed** |
| R-1 | `zod` unpinned | **zod 4** named, with the migration delta recorded; "three deps" clarified as three *direct* deps |

**1.2** — synced to PRD 2.0-draft.5, which applied PRDR-041…047. The plan led the PRD on several points in 1.1 (inventing a p95 definition, budget key names, claim semantics); draft.5 ratified those decisions, sometimes with different names, and this release adopts the ratified forms. No ticket added, removed, or rescoped.

| Plan | 1.1 | draft.5 / 1.2 |
|---|---|---|
| T-012 | `wall_clock_ms`, `spend` | `ticket_wall_clock_ms`, `run_spend_usd`; all twelve keys carry their PRD scope; config load refuses a budgets object omitting `run_spend_usd` |
| T-012 | "every ceiling emits BUDGET_BREACH → NEEDS_HUMAN" | each key emits **its own row's** breach target — `failure_research_tool_calls` → RESEARCH_DRY, `planning_research_tool_calls` → AWAIT_INFO batch, `flake_reruns` → ladder entry |
| T-041 | p95 < 100 ms, 500 transitions | + `max < 500 ms`, harness pinned at `tests/perf/transition-overhead.bench.ts`, per-component split printed, every X-3 row traversed |
| T-023 / T-041 | single-writer assertion on T-041 only | F-1's AC now names it; T-023 records that it is discharged at T-041, since no writer exists before the run loop |
| T-047 | role `fix` | role `blind_fix`; the eight ids are a committed wire format, pinned by test |
| T-055 | approve/requeue state semantics | + claim discipline: exit 2 against a live claim naming pid and age; stale-claim break recorded in `transitions.jsonl` |
| R-12 | no `tests/perf/` | added — N-4 names that path normatively |

One correction went the other way: 1.1's uniform "every ceiling emits BUDGET_BREACH" was carried into draft.5's X-1 AC and is wrong for three of the twelve keys. The PRD's AC was amended in the same commit as this sync.

**1.1** — mechanical corrections only; no PRD semantics changed, no ticket removed or rescoped.

| # | Change | Was |
|---|---|---|
| 1 | Critical path recomputed from the `deps:` graph (§2); T-018 now generates it and CI diffs it | Authored spine containing four non-edges (`T-013→T-017`, `T-017→T-040`, `T-042→T-046`, `T-070→T-084`), eliding T-083 |
| 2 | Parity status split to `{green, pending-M1, pending-M2}` + closing ticket per test; per-milestone thresholds (R-2, T-018, §5) | Binary `{green, pending-M2}`; risk register claimed `pending-M2 → 0 at T-041`, unachievable since 15 of 26 close later |
| 3 | **T-055 added** — `approve <id>` / `requeue <id>` (C-12) | No ticket; oracle `test_validate_report_approve_requeue` was unmappable, breaching T-018's own zero-unmapped exit |
| 4 | X-1's config row given owners and ACs: wall-clock + sessions (T-041), spend (T-048), turns-per-stage (T-046), failure-research ≤8 (T-045), planning-research 16 (T-063), flake reruns 1 (T-022); T-012 holds them as data with a coverage test | Recorded but unenforced — four ceilings routed nowhere, against P6 |
| 5 | Traceability matrix rewritten one-row-per-requirement; D-* rows added | Multiple mappings per cell, unparseable by the CI check it exists to feed |
| 6 | N-4 given a real assertion (T-041 p95 benchmark, gates stubbed) | Matrix claimed `T-041 AC budget`; no latency assertion existed |
| 7 | §14 fully enumerated in T-053 + key-set enumeration test; scope-canary corpus defined in T-052 | Four of seven metrics named; scope-canary had no fixture and no reporter |
| 8 | R-8 rationale corrected; T-041 asserts one writer per run-level JSONL | Claimed claims guarantee single-writer — false for run-level `ledger.jsonl` / `transitions.jsonl` |
| 9 | Lane entry deps stated (§2); T-065 deps T-064; R-5 mutator module split; R-12 lists `init`, `scripts/`, all `tests/` subdirs; size vocabulary admits XL | Lanes "after T-010" though T-020 deps T-016; consent decoupled from C-3b's zero-candidate branch; R-12 omitted directories ticket surfaces name |
| 10 | T-047 asserts coverage of S-1's eight roles | Hashes verified, coverage not — a missing role failed at runtime, not packaging |

Findings that turned out to be draft.1 artifacts — C-4's AC, counter naming, the X-2/X-3 caller set, and T-014's treatment of 12 as a regression pin — were checked against draft.4 and left as written; the plan was already correct on all four.

**1.0** — initial 55-ticket plan.

---

*Plan 1.6 — deviations from this plan that imply PRD changes require a `prd-review` ticket first (Working Agreement 2). This document is deliberately A-1-shaped so it can be replayed as the N-7 self-build seed.*
