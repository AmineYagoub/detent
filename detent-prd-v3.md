# Detent — Product Requirements Document
| | |
|---|---|
| Product | Detent: state-driven autonomous engineering, delivered as a Claude Code plugin |
| Version | 3.1.0 |
| Date | 2026-09-02 |
| Status | Released (T-142) — 3.1.0 certified by the N-7 gate on `detent-n7-310`, 67/67 DONE; draft line 3.0-draft.1…draft.6 closed by the N-7 green (T-140) |
| Implementation | TypeScript (public, open source) |
| Supersedes | PRD v2.0-draft.7 (the CLI line; remains the reference for every section v3 inherits unchanged) |

> **Detent v3 — the plugin re-target.** Applies **PRDR-065**: Detent is re-targeted from a standalone npm CLI into a **native Claude Code plugin whose interactive loop is driven by the model**, over a deterministic **referee** that keeps every safety guarantee the v2 kernel enforced. The change rests on one structural idea — the **referee/driver split** — and records five decisions, **D-26…D-30**. It amends the delivery model (D-2), the architecture (ARCH-1/D-19), the command contract (P1/D-3/C-14), budget enforcement (P6), and the containment posture (D-22). It does **not** touch the twenty-state machine (§7), the verification adapter (§6), the filesystem contract (§5), branching (§9), or artifacts (§10): those are driver-agnostic and are **inherited unchanged from v2.0-draft.7** (see *Inheritance*, end of document). This is a major-version event under C-14, taken deliberately.

> **Reading guide.** Requirement ids carry over from v2 (`C-*` command, `F-*` filesystem, `V-*` verification, `X-*` execution machine, `S-*` sessions/SDK, `B-*` branch, `A-*` artifacts, `SEC-*` security, `N-*` non-functional), plus v3's `R-*` referee surface. **One global reconciliation applies to every inherited section: "the kernel" now reads "the referee."** The Python reference v0.1.3 remains the porting oracle for the inherited machine; v3's new surfaces (the referee MCP boundary, the plugin, the model-driven loop) have no oracle and are specified here directly.

---

## 1. Summary
Detent turns planning documents into merged, reviewed, test-gated code using fresh, single-purpose Claude sessions whose every consequential move is admitted by a **deterministic referee**. It ships two ways over **one shared referee**: a **Claude Code plugin** — the interactive default, where the model drives the loop through referee tools — and a **headless driver** — the retained deterministic loop, for CI and unattended runs. The public experience is unchanged: `init` prepares a project (discovers docs and verification entrypoints, generates a plan as tickets, obtains approval); `run` executes the approved plan through a budgeted implement → test → review loop with a research-gated escalation ladder and explicit human gates. All intermediate state persists in `.detent/`; both workflows resume from checkpoints when re-invoked, under either driver.

## 2. Product Principles
P1 **Two workflows, twenty states.** The internal machine may be arbitrarily rich; the public workflow is `init` → approve → `run` → done, surfaced as the plugin's commands and the five closed decisions. Interruptions resume by re-invoking the same workflow.
P2 **The referee trusts artifacts and exit codes, never prose.** No state transition occurs on an unverified model claim — under either driver, and whether the move was chosen by the deterministic loop or proposed by the model.
P3 **Project owns its tooling; Detent owns only bindings.** `.detent/` never contains project configuration (F-2).
P4 **An unexecuted anything is a guess.** Bindings, backends, and plans are exercised before they are relied on.
P5 **Deny by default; consent is explicit, per-action, and logged.**
P6 **Budgets are hard.** Every loop has a counter; every counter has a ceiling; every ceiling routes to a human. Under the model-driven driver, *hard* is enforced at the referee boundary, not by owning the loop: a billable session exists only through the metered referee tool, and ambient tool use that would bypass the ledger is denied by the containment hook (D-28).
P7 **Detent never writes to the user's base branch.** In any mode, under any driver — enforced by the containment hook, which runs on every tool call.
P8 **Knowledge compounds.** Failure signatures, research briefs, and quarantine tickets persist and are shared via the repo.
P9 **Stale state is unconsumable.** Every checkpoint is content-addressed to its inputs; resume is a referee property, identical under either driver (D-30).

## Decision Log (v3 additions)
D-1…D-25 carry forward from v2.0-draft.7. D-2, D-19, and D-22 are amended as below; P6 gains D-28.

| ID | Decision | Rationale (abridged) |
|---|---|---|
| D-26 | **Delivery is a Claude Code plugin (interactive) plus a retained headless driver (CI/unattended), over one shared referee.** Amends D-2's "npm-distributed": the plugin distributes via a marketplace; the headless driver remains an npm package. | PRDR-065; a plugin is the native home for the interactive planning/approval/monitoring experience, but N-7's self-build gate and the CI split need a headless entry point a model-driven loop does not provide — so both drivers are first-class. |
| D-27 | **The referee owns legality; drivers own sequencing.** Restates ARCH-1/D-19. "Decides what happens next" splits: *legality* (validate artifact, apply event, classify gate, admit transition, permit spend) is the referee's alone; *sequencing* (which legal move runs next) may be the model's. Model output still enters the referee only through §10 validators and gate results — an illegal request is **rejected, not applied**. | PRDR-065; preserves the property D-19 calls the single most important — no transition on an unverified claim — while allowing the model to choose among moves the referee has already deemed legal. |
| D-28 | **Budgets are enforced at the referee-tool + `PreToolUse`-hook boundary.** A billable session spawns only through the metered `R-4` `attempt` tool, which checks the ledger before and records after; the hook denies ambient billable tool use (a direct `Task` spawn, a direct gate-running `Bash`) that would bypass the ledger; overshoot is bounded at one in-flight session (inherits D-25). | PRDR-065 (OQ-A); with the model driving, "hard" cannot mean "the kernel is the only actor" — it means every spend path passes through a counter the hook makes unavoidable. |
| D-29 | **D-22 splits by driver.** `settingSources: []` is retained unchanged on the headless driver (it still constructs sessions directly). On the interactive plugin driver — which runs inside the user's configured Claude Code and cannot suppress loaded settings the same way — the D-21 `PreToolUse` hook is **authoritative over any allow rule a settings file introduces**, and referee legality never consults repo settings. | PRDR-065 (OQ-C); the isolation `settingSources: []` bought is preserved where available and backstopped by the hook where it is not. |
| D-30 | **Resume is a referee property, not a driver property.** Checkpoints in `.detent/` are written by the referee on every admitted transition and reload identically under either driver (C-8/C-9). Interactive redirection mid-loop reuses C-8 content-addressed invalidation; an abandoned interactive attempt resumes as a C-9 crash (stale claim, resumable pool). No new state. | PRDR-065 (OQ-D); the model-driven loop changes who picks the next move, not where state lives or how it is keyed. |

---

## 3a. Architecture (Normative, v3)
```
┌───────────────────────────────────────────────────────┐
│  DRIVER — chooses which LEGAL move runs next            │
│                                                         │
│  interactive:  Claude Code + Detent plugin              │
│                (skills · commands · subagents)          │
│                the model sequences the loop             │
│  headless:     the deterministic loop (CI/unattended)   │
└───────────────┬───────────────────────────────────────┘
   D-21 PreToolUse / Stop hooks — containment, every call │  (both drivers)
┌───────────────▼───────────────────────────────────────┐
│  REFEREE — owns LEGALITY (the v2 kernel, behind MCP)    │
│  state machine · budgets · transitions · gate classify  │
│  flake filter · checkpoints · ticket store              │
│  every state-mutating tool re-validates its pre (P2)    │
└───────────────┬─────────────────────────┬──────────────┘
┌───────────────▼─────────┐   ┌────────────▼─────────────┐
│  Verification Adapter    │   │  schemas/**  (vocabulary) │
└──────────────────────────┘   └───────────────────────────┘
```

- **ARCH-1 Layer boundary (D-19, restated by D-27).** Agents and the driving model never own **legality**: sessions and the model produce **artifacts, telemetry, and move requests**; the referee alone validates artifacts, applies events, classifies gates, and admits transitions (P2). The model may own **sequencing** — which legal move runs next — but every request enters the referee exclusively through the §10 schema validators and gate results; **no model-issued request applies a transition, consumes a budget, or writes outside surface without a validator or gate result in between.** Mechanically: the referee's only driver-facing surface is the `R-*` tool set (§3b); session output enters through the §10 validators; `schemas/**` remains below every layer.
  *AC:* dependency-direction lint in CI — the referee imports no driver code and no SDK types beyond the backend interface; an audit test asserts **every `machine.apply` call site's event derives from a validator or gate result** (unchanged from v2, and true regardless of which driver called the tool); a second audit asserts every referee tool that mutates ticket or run state re-validates its precondition and is reachable by the model only as an MCP tool, never as an ambient capability.
- **ARCH-2 Referee is driver-agnostic (D-26/D-27).** The referee has no knowledge of which driver invoked it. Both drivers reach identical legality through the same `R-*` tools; a move legal under one is legal under the other. This is what lets the headless driver serve CI while the model-driven driver serves the interactive session, with one implementation of every guarantee.

## 3b. Referee surface (R)
- **R-1** The referee is a bundled MCP server. Every capability that reads or mutates run state is an MCP tool; there is no ambient path to legality. Tools: `next` (ready set), `claim` (atomic, X-3), `attempt` (spawn a metered billable session for a role), `record` (ingest a validated artifact/gate result → event), `gate` (run + classify a bound gate), `transition` (admit an X-3 event), `status`/`report` (read-only). Each mutating tool re-validates against the machine before acting.
  *AC:* a fixture that calls `transition` with an event the current state does not admit is refused with the current state named, no checkpoint written; the model cannot reach `machine.apply` except through a tool that gate- or validator-derives the event.
- **R-2** Sequencing requests are advisory; legality is dispositive. The model calls `next`, picks one ready ticket, calls `claim`; a claim the machine does not admit is refused. The model never observes an illegal move as available.
  *AC:* two-ready-ticket fixture — the model may claim either; a claim on a blocked ticket is refused naming the blocker.
- **R-3** The referee persists every admitted transition to `.detent/` (F-1) before returning success, so resume (D-30) is independent of the driver's liveness.
  *AC:* kill the interactive session mid-`attempt`; re-invoking `run` resumes from the last admitted transition, the stale claim reclaimable per C-9.
- **R-4** `attempt` is the sole billable path (D-28): it checks the run and per-slot ledgers before spawning, refuses over-ceiling with the human-routing outcome P6 requires, and records tokens/cost on return. The containment hook denies any ambient tool the model could use to spawn or run gate-work outside `attempt`.
  *AC:* over-budget fixture — `attempt` refuses and routes to a human; a direct ambient `Task` spawn for Detent work is hook-denied; the ledger sums every session that ran.

---

## 4. Command Contract (C, v3)
- **C-2′ (draft.2, PRDR-066).** C-2's discovery families gain an infix prd family —
  `*prd*.md` / `*prd*.txt`, case-insensitive on the token — so a `<product>-prd*.md`
  planning document is discoverable. Found by T-140's first live firing: N-7 names
  `detent-prd-v3.md`, which the prefix-only families could not see; the heuristics move
  toward the contract, the document keeps the name D-20 fixed.

- **P6′ (3.0.3, PRDR-088).** Init sessions are metered. ANALYZE, PLAN, REVIEW_PLAN and
  planning research are billable model sessions, and `src/init/` recorded none of them:
  `run_spend_usd` did not bound init spend, so repeated re-derivations could pass the
  declared ceiling with no ledger row, and a failed phase left nothing to diagnose —
  turn-ceiling exhaustion, a refused session and an invalid artifact were
  indistinguishable. Every init launch now passes the D-25 gate, writes an S-4 row
  against ticket `init`, and journals its start and end with turns, cost, the crash
  flag and the backend's tail. X-1's per-ticket counters remain out of scope here:
  init has no ticket and no generations.

- **C-7′ (3.0.3, PRDR-087).** A stale approval forces **PRESENT** to re-execute and
  nothing earlier. C-7's gate rests on approving the plan you were shown; the stale
  flag started the pipeline at phase one, so ANALYZE and PLAN re-ran and — planning
  being a model act — a DIFFERENT plan reached approval. Observed: eleven reviewed
  tickets, fourteen approved. Forced re-execution now names its entry phase, shared
  with `--replan`'s (PRDR-085), so re-presenting costs nothing and derives nothing.

- **C-2″ (3.0.3, PRDR-086).** `config.plan_docs` narrows C-2 discovery to the documents
  the current increment plans from; empty (the default) keeps the full family discovery.
  Without it, planning a large product slice by slice — the workflow the README
  documents — was impossible: every replan rediscovered the whole `docs/` tree and
  re-planned the entire product. Scope is configuration beside `protected` and `risk`,
  not a new decision or command, and because DISCOVER's digest is a listing of what it
  found, changing the scope re-derives planning through the existing C-8 rule.

- **C-8′ (3.0.3, PRDR-085).** `--replan` re-derives every planning phase from ANALYZE
  regardless of checkpoint digests — the flag previously only lifted the approved-plan
  guard, so it frequently planned nothing. PLAN then reconciles against the new plan: a
  drafted id already DONE is preserved untouched (its code is committed; a redraft would
  send a session to rebuild it), and tickets the new plan does not name are removed
  rather than left READY and claimable. A replan while any ticket is claimed or
  mid-ladder is refused by name before any session launches. `.detent/` is NOT reset:
  the ledger is what makes the spend cap un-restartable-around, `transitions.jsonl` is
  the audit log, `config.json` is the user's own settings, and `runs/` plus DONE tickets
  are the record of work that exists in the code — and planning increment by increment
  makes replanning a project with finished work the normal case.

- **C-4″ (3.0.3, PRDR-084).** The plan is reviewed before it is written. After PLAN
  validates its draft, a fresh session judges it at a **REVIEW_PLAN** stage over a
  closed tag set — `sizing`, `testability`, `coverage`, `shape`, `traceability` — and a
  `changes` verdict buys exactly one revision carrying the findings; what survives is
  presented to the human at approval rather than ground on (D-24's argument). D-6 held
  that work must be judged by something that did not do it, and every implementation
  had such a judge while the plan that determines them all had only a human reading a
  presentation — a real check at five tickets, none at three hundred. The review
  advises and never blocks: an absent verdict leaves the draft standing, announced.
  No new role (the planner prompt multiplexes by stage; a new `RoleId` is an F-3
  schema event) and no new X-1 key.

- **X-1′ (3.0.3, PRDR-083).** `run_spend_usd` carries a default (100) like every
  other ceiling in the table, and a first `init` without `--spend-cap-usd` writes it
  and announces it rather than refusing. v2's "no defensible universal figure" rule
  made the first init of every project a required spend decision the user cannot
  calibrate before a ticket has ever run — and on subscription auth the figure is a
  client-side ESTIMATE against quota (PRDR-052), not a bill. The ceiling is unchanged:
  a launch gate with D-25's one-session overshoot bound, cumulative across restarts,
  routing to a human on breach (P6). The demand is deleted; the ceiling is not.

- **X-1″ (3.1.0, PRDR-106).** `turns_per_stage` no longer terminates a session. Four
  breaches on the certification gate — 103, 145, 307 and 222 turns — caught zero runaways:
  every breached ticket finished on resume in 46–63 turns, and every firing halted the
  run, recorded $0, and stranded uncommitted work (PRDR-105). The kill is deleted: no
  session is launched with a turn ceiling, the referee has no breach path, and the plugin
  agents carry no `maxTurns`. The key stays as the planner's sizing target —
  `session_budget.implement_turns` (C-4′) — advisory and never enforced, and keeps its
  name because a rename is a migration for every committed config. What bounds a session
  is what bounded the run all along: `run_spend_usd` at launch (D-25), `sessions` per
  generation, `ticket_wall_clock_ms` per ticket. The ledger keeps recording turns per
  session; that measurement is PRDR-102's input and needs no ceiling to exist.

- **B-4′ (3.1.0, PRDR-107).** The plan's `risk_label` is advisory: recorded once as a
  kernel note and shown in the report, never a stop. Eleven label stops across every gate
  and field test were approved eleven times and declined never. The glob trigger is
  unchanged — a DONE-candidate whose diff touches the operator's `risk` globs still waits
  for a human, and approval still re-enters APPROVED for kernel re-verification.

- **X-1‴ (3.1.0, PRDR-108).** `review_fix_attempts` is read by the machine: review findings
  buy that many review-fix rounds before a human, default 3. It was configurable and never
  consulted — the guard was hard-wired to one round. Six second-round stops on the
  certification gate were each cleared by a requeue relaying the same findings. The key
  leaves D-12's at-most-once slot set; the three ladder slots stay structural (D-24). The
  computed worst case and the default net `sessions` move with it, deliberately.

- **A-5′ (3.1.0, PRDR-109).** A review that produces no usable verdict — absent or
  invalid — is relaunched once, noted, before it counts as a breach. Six such stops on the
  gate, all cleared by a requeue that changed nothing. The relaunch passes D-25's spend gate
  and the net session ceiling, lands on the ledger, and is charged in the worst-case figure
  for every `IN_REVIEW` entry.

- **X-2′ (3.1.0, PRDR-110).** Dry research enters `INFORMED_FIX` through the same guard as
  valid research, carrying its finding — no external cause, so the fault is in the ticket's
  own change. Eight of nine research sessions on the gate were dry and each became a stop.
  D-13 holds: the informed attempt's red gate is still a direct edge to a human.

- **X-4′ (3.1.0, PRDR-111).** A falsification that names the code it is missing is a
  dependency, not a stop. `falsified.json` may carry `missing` — concrete paths that do not
  exist yet. The referee resolves them against every other ticket's surface; when an owner
  exists that is not DONE and does not itself depend on this ticket, the ticket records it
  in `waits_on`, closes its generation as blocked, opens the next with the reason, and
  returns to READY through `DEPENDENCY_DISCOVERED`. The pool waits on `waits_on` exactly as
  it waits on `blockers`, and the ticket runs when its owners finish. No owner — nobody
  builds the path, or the only owner would deadlock — is a human stop as X-4 always was,
  and the note says which. Three releases per ticket, then a human. The worst case does not
  traverse the re-queue: it opens a new generation, like a human requeue (X-8).

- **D-27′ (3.1.1, PRDR-104).** The plugin hook files — `active_surface.json` and
  `stage.json` — are published only on the plugin path, where the model session that owns
  the claim is their reader. The headless driver publishes neither: its loop is a Node
  process no hook can nudge, and the files landed on whatever Claude session had the run
  root as its cwd, denying the operator's edits everywhere (D-27) and telling them to drive
  a loop already running. The hook itself is unchanged; it is simply no longer fed on a
  path that has no session to govern.

- **X-8′ (3.1.1, PRDR-112).** An outage halt keeps its detection and loses its aftermath.
  The referee's streak halt is a structured `REFUSED` route; the headless driver backs off
  1, 5 and 15 minutes and retries — the retry is the probe, and a crashed retry costs $0 —
  before it exits as before. The outage names its victims: every ticket whose session
  crashed inside the streak is noted, the run journal records the window and the sessions,
  and a ticket the outage pushed into NEEDS_HUMAN returns to the pool by itself through
  `OUTAGE_REQUEUE` when the run resumes, the reason recorded on the generation it opens. A
  ticket a person has since touched is left to that person.

- **C-4‴ (3.1.1, PRDR-103).** REVIEW_PLAN's closed tag set gains `dependency`: a criterion
  that requires behaviour another ticket builds, where neither `depends_on` nor the surface
  says so — the criterion cannot be met when the ticket runs. Distinct from `shape` and
  `sizing`; a finding names both tickets, because the remedy is an edge or a surface and
  either needs the pair. The planner is told the same at PLAN. X-4′ recovers a missing
  edge at run time; this is the plan saying it first.

- **X-4″ (3.1.1, PRDR-102).** A session that judges its ticket larger than one session
  commits what is finished, writes `oversized.json` — a note and the split it proposes, one
  line per ticket — and ends. The referee records the proposal on the ticket and takes it
  to a human through `TICKET_OVERSIZED`: a plan-level finding like a false premise, and no
  rung can make a ticket smaller. The file stays as evidence, and the next PLAN and
  REVIEW_PLAN of the same documents receive `sizing_evidence` — turns per implement session
  from the ledger, and every oversized proposal — the only measured input either stage has
  ever had. Nothing auto-splits; the decision stays the planner's and the operator's.

- **S-5′ (3.1.1, PRDR-114).** `init` writes an opinionated `model_routing`: the planner on
  `claude-fable-5-1`; review, diagnose and the informed attempt on `claude-opus-5`; implement,
  blind fix, review fix and research on `claude-sonnet-5` — judgement roles on the stronger
  models, volume roles on Sonnet, typed over the role set so a new role cannot default
  silently. A routed model the runtime cannot serve is not a crashed session: the backend
  falls back to the runtime default for that session and every later one that run, and the
  referee notes and journals the fallback per session; the ledger's `models` field says what
  actually ran (PRDR-095). The agent-sdk pin moves to 0.3.258, whose bundled runtime serves
  the models the default names. An existing config keeps its own routing untouched.

- **V-1′ (3.1.1, PRDR-115).** Greenfield's provisional bindings come from the documents
  first: when the planning documents name the verification commands, ANALYZE copies them
  into `stack.verification` exactly as written and those are the bindings bootstrap ticket
  #1 proves. The per-language table is only the fallback for documents that name none, and
  its key is the first known language named as a word in `stack.language` — the planner
  writes that field as prose as readily as a name, and an exact-match lookup refused a Go
  project whose documents named all three canonical gates.

- **C-4⁗ (3.1.1, PRDR-116).** REVIEW_PLAN's verdict vocabulary stays closed, but a reviewer
  that writes a plain synonym — `revise` for `changes`, `approved` for `approve` — has still
  reviewed, and is read as the word it means, noted. An absent or unusable review artifact
  buys one relaunch carrying the validator's own words, exactly as a code review does
  (A-5′); only after that does the draft stand unreviewed, and the note names the reason.
  Found on ksar-cloud: six real findings — three tickets oversized, two missing edges, one
  untestable criterion — discarded over one word, and the draft written unreviewed.

- **C-2‴ (3.1.1, PRDR-117).** A product larger than one planning pass is planned by Detent
  itself, to the end, without stopping. A **SLICE** phase between DETERMINE_VERIFICATION and
  PLAN reads the whole document set and cuts it into ordered increments — the walking skeleton
  first, each later slice thickening the ones it names in `depends_on`, every requirement id
  placed in exactly one slice — and PLAN then plans each slice in turn: drafted with the
  earlier slices' ticket index in view (ids `t-<slice>-NNN`, cross-slice edges by id),
  reviewed as its own plan (C-4″), revised once, and cached under `.detent/state/plan/<slice>`
  keyed by its own documents, its spec, the stack, the bindings, the budgets and the prompt —
  so an edited document re-plans its slice and reuses the rest (C-8‴) while `--replan` wipes
  the cache (C-8′). When every slice is planned, a fresh session
  reviews the WHOLE plan: the closed tag set gains `coherence` — two tickets that contradict,
  duplicate, or disagree about the interface between them, usually across slices — and
  coverage is judged across every slice's requirement ids and baseline items. A `changes`
  verdict redrafts only the slices its findings name, with the rest of the plan in view and
  the ids later slices depend on kept; a second whole review says what remains, and that is
  presented to the human rather than ground on (D-24). Order is enforced in the written plan:
  a ticket with no edge of its own into the slice it thickens is blocked on that slice's
  capstones — the tickets nothing else in it depends on — so a slice cannot start before the
  ones it builds on are DONE, and nothing inside a slice is serialised that need not be. The
  draft's ids and edges are normalised rather than trusted: a colliding id is renamed and its
  slice's references follow; an edge to nothing planned is dropped and kept as a `dependency`
  finding for the human. `plan_docs` (C-2″) remains the manual scope for a deliberate
  narrowing; it is no longer how a large product is planned. Found on ksar-cloud: a product
  the user sized at five hundred tickets planned as twenty-seven, because one pass over one
  slice was all the pipeline could hold, and the sequencing and the stopping were the
  operator's.

- **C-2⁗ (3.1.1, PRDR-117).** The plan is production grade whether or not the documents
  ask for it. Detent carries a **production baseline** — fifteen items across six areas
  (security, reliability, data, observability, operations, quality), each with an
  `applies_when` and a `verifiable_by`. SLICE receives it and places every applicable item in
  the slice where the thing it hardens first exists; PLAN receives the items its slice
  carries and drafts tickets whose acceptance criteria are the item's `verifiable_by`, sourced
  `baseline:PB-###`, which REVIEW_PLAN accepts as provenance and judges under `coverage`. A
  document's explicit decision wins over the baseline, and the ticket records it.
  `config.plan_baseline` is `production` by default; `none` opts out, in writing. Detent is
  used by people who will not write "and back it up" — the plan says it for them.

- **A-1‴ (3.1.1, PRDR-120).** A ticket declares the interface it OWNS and the interfaces it
  LEANS ON. `provides` names what it brings into existence — a `symbol`, a `config` key, a
  shared `file`, a `route`, a `table`, an `event` — each with the meaning a consumer needs;
  `consumes` names what another ticket owns. The kinds are a closed set, like the interrupts
  and the finding tags. The contract is the union of the tickets' own declarations, so unlike
  a separate artifact it cannot drift from them.
  Detent then checks the union with CODE, no session and no judgement: a name two tickets
  provide is a `coherence` finding naming both, a name nobody provides is a `dependency`
  finding, a shared file two tickets create is a conflict reported before it happens, and a
  provider the plan does not already order before its consumer becomes a **derived dependency
  edge** — the plan carrying an edge the planner never thought to write. An edge that would
  close a cycle is refused and reported instead, because two tickets needing each other is a
  contradiction rather than an omission. X-4′ recovers the same fact at run time, one
  generation later; this is the plan knowing it first. The declarations travel onto the written
  ticket, so an implement or review session receives its own `provides` and, for each
  `consumes`, the OWNING ticket's note — the interface reaches the work instead of being
  inferred and contradicted. What this does not do is judge semantics: whether two rules over
  one value agree stays the reviewer's, now with the right pair in front of it. Found on
  ksar-cloud, where eight findings survived a revision round and five were one defect wearing
  different costumes — two tickets disagreeing about a name neither of them owned.

- **S-3′ (3.1.1, PRDR-121).** Symbol intelligence is an OPTIONAL adapter, discovered and never
  installed. `symbols: { enabled, command, pinned }` in config; absent or disabled, every stage
  runs unchanged. Enabled with a command Detent cannot run raises `AWAIT_SETUP_CONSENT` naming
  the pinned install command — Detent binds to what the machine has and does not put software
  on it (D-4/F-2), and a third-party server with read access to a private repository is a
  decision its owner makes. Two constraints are structural rather than configurable: only the
  server's READ tools are ever granted, because its editing tools write from inside the MCP
  server process and would never pass the `Write`/`Edit` calls the D-21 hook inspects (S-2′,
  SEC-3); and the server's own cross-session memory is disabled, because a hidden per-project
  memory would make two identical runs diverge (C-8, S-6). There is no flag that permits
  either.

- **S-3″ (3.1.1, PRDR-121).** The reminder to install it is EARNED, never periodic. Detent
  mentions symbol intelligence only when the run just completed contains evidence it would have
  helped — a `coherence` or `dependency` finding whose subject was a symbol — and the message
  names those tickets, gives the pinned install command, and states how to silence it forever
  in the same breath. No evidence, no message. `enabled: false` is honoured absolutely: a user
  who declines once is never asked again. PRDR-119 removed noise that buried signal; a standing
  banner would be the same mistake in a different costume.

- **A-1⁗ (3.1.1, PRDR-121).** A ticket that declares it provides a symbol is checked against the
  diff it produced: the identifier appears in what the ticket changed, or it does not. The precise
  answer is a symbol-table lookup and needs a client Detent does not have; this needs nothing, and
  catches the case that occurs — a ticket claiming a name it never wrote, which another ticket's
  work is waiting on. It is deliberately weak in one direction only: an identifier in a comment
  satisfies it, so it never fails a ticket and never touches the gate. It is EVIDENCE handed to
  the review, which was already judging whether the diff does what the ticket says, so a false
  positive is a sentence a reviewer dismisses rather than a red build.

- **C-3″ (3.1.1, PRDR-119).** A question is for a fact outside the documents AND outside
  engineering judgement — a price, a domain or account the founder owns, a vendor or payment
  rail with commercial consequences, a legal or retention rule, a credential; a decision whose
  cost is counted in money or contracts rather than in code. Everything a competent engineer
  could settle by reading the documents is SETTLED, and the decision with its reason is
  recorded where the work is: the ticket's `description`, the slice's `rationale`, or the
  analysis's `assumptions`. Asking to have a defensible decision confirmed is not caution, it
  is noise that buries the two or three decisions a human must actually make. Found on
  ksar-cloud: the first slice raised ten questions of which seven were the planner seeking
  permission for choices it had already justified from the documents — one asked whether
  running every component on a single host was acceptable, which the slice document itself
  requires — and at nineteen slices that projected to roughly two hundred questions at
  approval, against perhaps twenty-five real ones. C-3′'s batching is unchanged; what changed
  is what earns a place in the batch. A question also carries an id unique across everything
  one session writes, and the batch keeps it unique across every stage: two questions sharing
  an id are indistinguishable to the human answering them, and a slice's first and revised
  drafts each numbered from one.

- **F-1′ (3.1.1, PRDR-118).** A ticket id is a FILE NAME under `.detent/plan/`, and a model
  writes it. It is therefore constrained like one: lowercase, alphanumeric with `-` and `_`,
  at most 64 characters, and never `plan` or `approval`, which are artifact names in the same
  directory. The schema rejects one on the way in and the path builder refuses one that
  reached it another way. Found by audit: `nonEmptyString` accepted `../../package`, which the
  writer joined onto the plan directory and wrote through — outside the repository, over any
  file the process could reach — and accepted two ids differing only in case, which are one
  file on macOS: the plan claimed three tickets, the disk held two, and the pool deadlocked
  on a ticket the plan said existed.

- **A-1″ (3.1.1, PRDR-118).** The drafted graph is repaired before it is written, not trusted
  and not merely refused. An id that is unusable or already planned is renamed and this
  slice's own references follow — but a reference that also names a real earlier ticket is
  left alone, because that is what it meant. An edge to nothing planned is dropped, and a
  dependency CYCLE is broken at the edge that closes it. Each repair is a `dependency`
  finding the human sees at approval. Nothing downstream ever looked for a cycle — not the
  draft validator, not the plan schema — and two tickets naming each other is an ordinary
  thing for a model to write; the result was a permanent, silent deadlock in which `ready()`
  simply never offered those tickets and nothing reported why.

- **C-2⁵ (3.1.1, PRDR-118).** A ticket's own edge into an earlier slice does not stand in for
  that slice's order. The planner is told to name the specific ticket it needs, so this is the
  commonest shape a plan takes — and treating it as sufficient let a later slice start against
  a slice that was one ticket in. Only a capstone the ticket already names is skipped; the
  rest still gate it.

- **C-8″ (3.1.1, PRDR-118).** The in-flight refusal belongs to re-planning, not to the
  `--replan` flag. Re-planning rewrites every drafted ticket to READY with fresh counters and
  deletes the ones the new plan does not name, and the guard against doing that under a
  claimed or mid-ladder ticket ran only for the flag. Every other route was unguarded —
  including the one PRESENT itself recommends: answer a question in a planning document while
  a run is executing, re-run `detent init`, and the content digest replays ANALYZE-forward
  into PLAN, which resets the ticket a session is working in.

- **C-8‴ (3.1.1, PRDR-118).** Three repairs to what a checkpoint means. A phase may declare
  whether what it WROTE is still there, and PLAN does: deleting `.detent/plan/` used to reuse
  every checkpoint and report READY over an empty directory. A digest covers a phase's inputs
  and must never move when the phase succeeds, so this is a separate question from the digest.
  And a slice's cache key holds what actually determines that slice — its own documents, its
  spec, the stack, the bindings, the budgets, the prompt — rather than the whole ANALYZE
  artifact and every earlier ticket id: ANALYZE is a model act whose prose drifts on every
  re-run, so a typo in one slice's document re-planned all twenty, and the ids cascaded the
  same way. What the slice actually reached into is recorded as its external dependencies and
  checked precisely on reuse. The cache is validated on read like every other artifact.

- **C-4⁗′ (3.1.1, PRDR-118).** Every strict planning artifact gets the one relaunch PRDR-116
  gave the review — the validator's own words in the inputs, and only then a failure. The
  lesson had been applied one level too low: the review's artifact is the simplest planning
  produces, while the SLICE and PLAN artifacts are the strictest and by far the most
  expensive, and they had no second attempt at all. A twenty-slice product asks for thirty to
  sixty independent strict artifacts, so at a one-percent chance of a stray key in any of
  them, better than a third of runs would abort hours in. A failure now names the slice it
  died on and says that the finished slices are cached.

- **S-4′ (3.1.1, PRDR-118).** `init` applies the same telemetry circuit breaker the run loop
  has had since T-046. A stream that ends with no result message parses as success with no
  telemetry, so a session killed in transport returned ok, recorded $0 against the ceiling,
  and its phase then reported "produced no artifact" — blaming the model for a death on the
  wire.

- **R-9′ (3.1.1, PRDR-118).** `init` refuses a `.detent/config.json` it cannot read, as `run`
  already does. Each reader used to catch its own parse failure and return a default, so a
  merge conflict in the config silently widened planning scope to the whole repository, reset
  the spend ceiling, and dropped the model routing — at full model cost, against a scope
  nobody asked for, with nothing printed.

- **C-3′ (3.1.1, PRDR-117).** Planning does not stop for a question. Every question a stage
  cannot answer — ANALYZE's, SLICE's, each slice's PLAN — carries the assumption the plan
  proceeds on, and the batch is asked ONCE, with the whole plan, at PRESENT: the human answers
  and approves in the same sitting, and an answer that changes an assumption re-plans only the
  slices whose inputs it touched (C-8). `AWAIT_INFO` moves from ANALYZE to PRESENT and is
  raised only for a question marked blocking — one no assumption could carry — after the plan
  is written and shown. C-3's rule stands and is stronger: one batch, never a drip, and never
  a stop in the middle of a product that takes a night to plan. Planning research (C-3a)
  still runs first over every question; its unanswered residue joins the batch as before,
  now with the analyst's assumption beside it. The interrupt set is unchanged at five (C-5).

- **C-4′ (3.0.3, PRDR-081).** The plan's unit is an executable step, not a document
  heading: a ticket is ONE implement session's work inside X-1's budget, and a
  requirement larger than that decomposes into dependent tickets. PLAN receives
  `session_budget` (implement turns, ticket wall clock, per-generation sessions) so the
  planner sizes against the budget that will execute it. The plan is ordered as vertical
  slices — walking skeleton first, through the riskiest integration — not as
  infrastructure layers completed ahead of the first end-to-end path. Found by the first
  live init against a large specification: 27 documents produced 32 epic-grained tickets,
  each far past one session, with the first end-to-end path at ticket twenty-two. Size
  remains planning judgment, deliberately unvalidated (A-1 is unchanged): a numeric
  ceiling would refuse honest atomic work.

The `init` pipeline (§4.1 of v2) is **inherited** in its phases and interrupts — since C-2‴/C-3′ (3.1.1): `INIT_FS → DISCOVER → [AWAIT_DOCS] → ANALYZE → DETERMINE_VERIFICATION → [AWAIT_BINDING_CHOICE | AWAIT_SETUP_CONSENT] → SLICE → PLAN → PREPARE_AGENTS → PRESENT → [AWAIT_INFO | AWAIT_APPROVAL] → READY`; the interrupt set is the same five — and re-surfaced as plugin commands and skills. C-1…C-8 hold verbatim (with "kernel" → "referee"). v3 restates only the surface and the loop ownership:

- **C-1′** `init` and `run` are the plugin's two commands (`/detent:init`, `/detent:run`), and Detent registers skills so the model invokes the right phase from natural intent ("plan this repo", "keep going"). The headless driver exposes the same two as the retained CLI verbs. C-1's git-root rule and the five C-5 interrupts are unchanged; interrupts are surfaced as the plugin's **presented decisions**, still a closed set of five.
  *AC:* the plugin manifest registers exactly two commands; a docs test asserts the five-decision closed set; subdirectory invocation still exits/《presents》 the root hint with no `.detent/` created.
- **C-9′…C-13′** `run` semantics (execute only an approved plan; atomic claims; resumable pool; escalation handling; exit codes; user-facing vocabulary) are inherited. Under the **model-driven driver**, the loop is: `next` → `claim` → `attempt` → `record`/`gate` → `transition`, chosen by the model, admitted by the referee. Under the **headless driver**, the same sequence is chosen deterministically. C-11 exit codes remain public API for the headless driver; the plugin surfaces the same four outcomes as presented states.
  *AC:* the oracle crash-resume class ports green under the headless driver; an interactive-abandon fixture resumes identically (D-30); both drivers produce byte-identical `transitions.jsonl` for the same admitted sequence.
- **C-14′ Porcelain freeze (major-version).** The golden path is exactly the two workflows and the five closed decisions, now surfaced as the two plugin commands and their presented interrupts. Adding a command or a decision class is a major-version decision requiring a PRD amendment. The v2→v3 re-target is itself such a decision, recorded here (D-26).
  *AC:* release-checklist item; a docs test asserts the two-command, five-decision plugin surface.

*(C-6/C-6a setup-consent, C-7 approval, C-8 replay, C-10 escalation, C-12 plumbing, C-13 vocabulary: inherited from v2 §4, reconciled "kernel"→"referee". C-12 plumbing commands become read-only referee tools / plugin subcommands; claim discipline is unchanged.)*

## 8. Sessions & Agent SDK Integration (S, v3)
S-1…S-7 are inherited from v2 §8, reconciled to the two drivers:
- **S-1′ (draft.3, PRDR-067).** An artifact-producing read-only session runs
  `permissionMode: "default"` with its read-only tool surface plus exactly one scoped
  write rule, `Write(//<artifact_out>)` (S-3's specifier mechanism; `doctor` arbitrates an
  unrecognized form). Plan mode remains for artifact-less sessions (doctor's smoke).
  Read-only-ness is the allowlist plus the D-21 hook, not a mode that contradicts P2's
  artifact interface. Found by T-140's first live read-only session.
- **S-2′/D-21** Containment is the `PreToolUse` hook under **both** drivers — the headless driver wires it when constructing sessions; the plugin ships it as a plugin hook. It denies outside `surface[]`, denies protected globs, preserves the surface-expansion lever, and (D-28) denies ledger-bypassing ambient billable tools. A hook deny binds over every allow rule and permission mode.
- **S-2″ (draft.5, PRDR-068).** The D-21 surface check governs MUTATION: the mutating
  tools (Write/Edit/MultiEdit/NotebookEdit) are denied outside `surface[]` and denied on
  protected globs (SEC-3 is immutability, not unreadability); non-mutating path'd calls
  are allowed anywhere INSIDE the worktree, and the outside-worktree boundary (P7) holds
  for every tool. Found by T-140: a worker denied READING the PRD's §10 — its own
  specification — shipped an empty diff that only the D-6 review layer caught. Driver-mode
  policy unchanged (D-27: the driver neither reads nor writes files).
- **OQ-2 resolved (draft.6, PRDR-074).** The license is **MIT** — chosen by the user
  2026-08-20 during T-141 publish preparation. v2 posed MIT vs Apache-2.0 as the sole
  M4 blocker; MIT matches the header's "public, open source" delivery and the plugin
  ecosystem's norm. `LICENSE` at the repo root is the operative text; the v2 document
  stays frozen with the question as it stood.
- **C-12′ (3.0.1, PRDR-078).** The plumbing set gains `unclaim <id>` / `unclaim
  --stale`: an explicit, state-independent release for claims whose owner is
  verifiably dead — the crash-resume case approve/requeue cannot legally reach.
  Live owners refuse with pid and age; unreadable claims stay held (R-3); the
  break is an attributed ticket note, never a transition. Porcelain unchanged
  (plumbing sits outside C-14's freeze).
- **C-9′ (3.0.2, PRDR-079).** The resumable pool self-heals stale claims: a
  claim that is readable, recorded on this host, and held by a dead pid is
  released (kernel-noted) and its ticket rejoins the pool — D-30's crash-resume
  sentence now holds without operator surgery. Live, foreign-host, and
  unreadable claims stand. Claims record their host; one breakability
  predicate serves the pool and every plumbing verb.
- **S-3′** Per-role tool allowlists define the role surface; containment is the hook, never the allowlist (unchanged from PRDR-050).
- **D-22/D-29** Setting-source isolation splits by driver: `settingSources: []` retained headless; on the plugin the hook is authoritative over loaded settings, and referee legality never consults repo settings.

## 11. Security & Supply Chain (SEC, v3)
SEC-1…SEC-5 inherited. v3 adds the in-session threat answer:
- **SEC-6 In-session policy (D-29).** Running inside the user's Claude Code, the plugin cannot rely on empty setting sources to neutralize an attacker-authored project settings file. The containment hook is therefore normative and authoritative: it evaluates before, and overrides, any allow rule a loaded settings file introduces, and referee legality is independent of settings entirely. A settings file can only *narrow* what Detent may do, never widen it.
  *AC:* a fixture project ships a settings file allow-listing an out-of-surface write; the hook denies it; `transitions.jsonl` records no transition.

## 13. Milestones (v3)
The v2 milestones (M0…M4) delivered the CLI line and its 52-test oracle parity; they are complete through M3 and are the referee's provenance. v3 adds the plugin series **MP0…MP4**, each with its own exit:

- **MP0 — the referee.** Extract the v2 kernel behind the R-* MCP server; the headless driver drives it to full parity with today's `run` (same `transitions.jsonl`, same oracle tests green). *Exit:* the headless driver over the referee passes the entire v2 suite unchanged.
- **MP1 — the plugin skeleton.** Manifest, the two commands, vendored subagents, the D-21 hook wired as a plugin hook. *Exit:* `/detent:init` and `/detent:run` load; the hook denies an out-of-surface write in a live session.
- **MP2 — the model-driven loop.** `run` driven by the model over R-* tools; the D-28 budget hook; D-29 hook authority. *Exit:* a multi-ticket run completes under the model driver with byte-identical transitions to the headless driver, budgets provably hard (over-budget fixture routes to a human; ambient bypass denied).
- **MP3 — init as a plugin.** The seven phases and five decisions surfaced as commands/skills/presented interrupts. *Exit:* the golden-path docs test passes against the plugin surface.
- **MP4 — self-build + distribution (N-7).** The headless driver self-builds v3 in CI (the permanent gate, D-16); the plugin publishes to a marketplace. *Exit:* N-7 green on the v3 document; marketplace install smoke-tested.

**N-7 scoping note (draft.4, raised by the self-build's own analyst — T-140).** The walking skeleton N-7 builds is the referee core and the headless driver (the MP0-equivalent of this document): a deterministic machine whose gates run green. The plugin shell and marketplace distribution are post-skeleton milestones; their platform-authoring and publish mechanics are plan-time research topics (C-3a) or later tickets' concerns, and are **never blocking questions for the skeleton plan** — an analyst reading this document should plan the skeleton first and defer those surfaces to their milestones.

---

## Inheritance (unchanged from v2.0-draft.7)
The following sections are **driver-agnostic** and are inherited verbatim from `detent-prd-v2.md`, with the single reconciliation "kernel" → "referee":
- **§3 Scope & Non-Goals** — including NG7 (Claude Code remains the only backend; a plugin *is* Claude Code, so NG7 is reinforced, not weakened).
- **§5 Filesystem Contract (F)** — `.detent/` layout, the committed set, content-addressed checkpoints (F-4). **F-1′ (draft.4, PRDR-066/PRDR-064 applied):** the local set gains the two D-21 hook-policy files (`active_surface.json`, `stage.json` — run-level, never committed); and the plan directory is `plan/` (tickets `<ticket-id>.json`, plus the plan artifact `plan.json` and the approval record `approval.json`) — a file in `plan/` is a ticket **iff** its name is not one of the reserved names `plan.json` and `approval.json`; the reserved set is closed, and a reader that enumerates the directory asserts against it rather than carrying its own list. This is A-2's stated home, raised unprompted by the N-7 analyst reading this document (T-140).
- **§6 Verification Adapter Contract (V)** — discovery, binding, execution, drift.
- **§7 Execution State Machine (X)** — the twenty states, the X-3 transition table, the escalation ladder, the budgets of X-1, `GATE_DRIFT` (D-23), attempt generations (D-17). The referee *is* this machine; nothing in it changes.
- **§9 Branch & Merge Contract (B)**, **§10 Artifacts (A)**, **§12 Non-Functional (N)** — including N-7 self-build, now naming `detent-prd-v3.md` as its target — **§14 Metrics**, **§15 Risks**.

Where an inherited section says the CLI is the entry point, read "the headless driver or the plugin"; where it says "the kernel decides", read "the referee admits, the driver sequences" (D-27). No inherited requirement's *semantics* change; only the delivery surface and the loop's driver do.
