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

- **A-1⁵ (3.1.1, PRDR-201).** A ticket declares the **requirement ids and production-baseline
  items it delivers**, in typed fields, so coverage is a set operation rather than a reading.
  C-2⁗ has commanded that coverage since PRDR-117 — every id in a slice's `requirement_ids` and
  every item in its `baseline_items` reaches a ticket — and nothing has ever checked it:
  `requirement_ids` occurs in the source only in the prompt that commands it, the skeleton that
  shapes it and the schema that types it. Baseline sourcing was asked for as PROSE,
  `baseline:PB-###` inside an acceptance criterion, and prose is not checkable — one finished
  plan cited the ids bare where another bracketed them, so a strict check accused a complete
  fifteen-slice plan of dropping CI, the runbook, traceability and the golden path, while a
  loose one reads a non-goal naming an item as EXCLUDED as coverage of it. A-1‴ already
  established the shape that works for the other half of this problem; this is that shape,
  applied here. The findings are PROOFS and join the contract set (PRDR-193), reaching PRESENT
  under the proved heading rather than merged with the review's, because one kind is decided and
  the other is judgement. A slice planned before the fields existed is reported as **undeclared**
  rather than as uncovered: a cache reused under C-8 cannot be read as a plan that dropped
  something. This matters now because the only thing watching coverage today is the review's own
  `coverage` tag, which PRDR-200 measured at Jaccard 0.45 across two independent sweeps and 0.56
  after majority filtering; a set operation decides the same question exactly, for no session.

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

- **S-3‴ (3.1.1, PRDR-123).** `symbols.command` is an executable NAME resolved on PATH, refused
  at config load if it contains a separator or a traversal. `.detent/config.json` is repository
  content, and an unrestricted string let a repo point the orchestrator at an executable it
  shipped and have it run at the operator's privilege, in the orchestrator process, before
  anything was presented or approved. This restores parity with the boundary Detent already
  has — it executes repo-defined verification commands by design, but those are discovered from
  known structured locations and re-validated against drift before every gate (V-3) — and it
  claims nothing beyond that parity: Detent is not safe to run against a repository you do not
  trust, and never was.
  Separately, a session reports the MCP servers it did NOT get. The status comes from the SDK's
  own init message, is carried on the result, and is noted and journalled exactly as a model
  fallback is (PRDR-114). Probing the binary per ticket answers the wrong question — it can
  exist while this session's server never attached — and a session that quietly lost its symbol
  tools was indistinguishable from one that never had them. An absent or unrecognised init
  message is treated as no information, never as success.

- **C-2⁵′ (3.1.1, PRDR-125).** How many tickets a slice holds is CONFIGURATION, not a number in
  a prompt: `slice_size` is a `{min, max}` band, 12–18 by default, folded into SLICE's digest so
  a changed band re-cuts the product. A slice is drafted by one session into one artifact
  (S-1″), so its size is the size of the largest thing the pipeline must produce without
  failing — a real operational parameter. Measured on the first self-build gate: a 36-ticket
  slice, the top of the old 15–40 band, emitted 176,391 output tokens, about 4,900 per ticket
  now that a ticket carries its contracts and their notes, and that draft is where a session
  limit killed the run. Smaller slices are not cheaper — drafting is the same work and the
  review, revision and re-review are paid per slice — they buy a failure you can afford. The
  band stays guidance rather than enforcement: `expected_tickets` is planning judgement (A-1),
  and a slice that ignores it is the reviewer's `sizing` finding.

- **S-5″ (3.1.1, PRDR-125).** The planner runs on `claude-opus-5`. S-5′ seated it on Fable 5.1
  on the strength of a probe; the first self-build gate measured it on real work, and the
  operator's call is that it is not the right seat for the role that determines every other
  session. Review, diagnose and the informed attempt were already on Opus; implement, the three
  fixes and research stay on Sonnet.

- **S-1″ (3.1.1, PRDR-124).** An init session carries its OWN containment policy, whose surface
  is exactly the artifact it was asked to write. S-1′ has always said such a session gets the
  read-only surface plus one write rule; the rule was granted on the allowlist while the hook
  fell back to the backend's construction policy of `**`, and a cleared mutation returns a
  terminal allow, so the allowlist was never consulted and the rule was decorative. A planner
  asked for one artifact wrote its draft as two part files beside it and the phase found
  nothing where it was told to look. Reads are unchanged — non-mutating calls abstain (S-2‴)
  and the worktree bound holds — because a planner that cannot read the documents cannot
  analyse them.

- **S-2‴ (3.1.1, PRDR-122).** The containment hook ABSTAINS on a call it does not govern; it
  does not allow it. A hook decision runs before every other permission step, so `allow` is
  terminal — it ends the evaluation before the allow rules are reached. The guard governs where
  a mutation lands and answered `allow` for everything else, which meant it was silently
  granting rather than declining to object: `implement` is allowlisted only `Bash(git add:*)`
  and `Bash(git commit:*)`, yet every bash command passed, because a bash call names no path.
  The same hole waved through any MCP tool, whose parameters the guard cannot read — including
  the editing tools S-3′ was written to keep out. Now `deny` is terminal and unchanged, `allow`
  is reserved for a mutating call the guard positively cleared, and `abstain` omits the
  decision so the allowlist decides. The plugin hook renders an abstention as silence, matching
  D-29's rule that a hook may narrow what the permission rules grant and never widen it.

- **V-3′ / S-5′ / R-10′ (3.1.1, PRDR-141).** Five features were implemented, tested, documented
  and unreachable, and each is now wired at its ENTRY POINT or its claim withdrawn.
  `detent verify sync` — the only sanctioned V-3 recovery, which the drift halt message itself
  names — was absent from the dispatcher, so every drift-blocked ticket sat behind an instruction
  that answered `unknown command`. `doctor`'s `main` passed no deps, so the S-5 pin check and the
  R-10 smoke session pushed `ok: true` unconditionally while the CLI advertised a live smoke
  session it structurally could not run. `preferOrchestrator` had no caller, so a monorepo bound a
  per-package command instead of the orchestrator's root one and the notice explaining that never
  printed. Two latent defects in the unwired consent engine are fixed regardless of when it is
  wired: `proposeConfigWrite` had no traversal guard where both its siblings do, and the
  allowlist admitted `npm install ../../evil`, which runs a local package's lifecycle scripts.
  **The rule this ran under is PRDR-148's:** wiring a dead control exposes every latent defect in
  it at once, so each was checked against what the system now does before being connected — and
  that immediately found `doctor` keyed on `ANTHROPIC_API_KEY`, stale since the transports
  broadened to three, and then that `hasLiveBackendAuth` probes the live CLI so an injected
  environment cannot make it answer no. The entry point decides liveness; the backend's presence
  is the signal.

- **P6′ (3.1.1, PRDR-142).** A bound that cannot be read is refused rather than dropped, the
  routing's keys are validated against the real role set, and the enforcement map names where each
  ceiling is actually enforced. `--max-tickets tenn` yielded `NaN` and the option was silently
  omitted, so the full pool ran against the full ceiling having been asked for a limit.
  `model_routing` accepted any key, so a typo routed that role to the runtime default forever —
  `roles.ts` claims the typing makes that a compile error, which is true of the default table and
  false of the config a human is invited to edit. And `ENFORCEMENT_SITES` was tested for
  TOTALITY, which `satisfies Record<CeilingKey, string>` already guarantees at compile time, so it
  could not notice an entry becoming untrue — two had: `ticket_wall_clock_ms` after X-1⁗ moved it,
  and `failure_research_tool_calls`, which the new test found. The test now reads the named module
  and requires it to mention the ceiling.

- **C-9′ (3.1.1, PRDR-139).** "Executes only an approved plan" is CHECKED, and the approval is
  a statement about the plan rather than about the files that carry it. `run` schema-parsed
  `approval.json` and never compared `plan_hash`, so tickets edited after approval executed
  unreviewed. The obvious repair — call the existing `approvalState` at run start — would have
  refused every RESUME, and reading the writer is what shows it: `planHash` hashed every ticket
  file, and `writeTicket` rewrites those on every transition, counter bump and note, so the hash
  changes within seconds of a run starting. It was already a latent defect on the init side, where
  a re-init after a partial run called an untouched plan stale. The hash now covers each ticket's
  plan-defining fields — what a human approved — and not the run state stored beside them.
  Separately, `writePlan` deleted a claim without asking whether its holder was alive: the only
  claim breaker in the tree that skipped `claimBreakable`, while a check-then-act guard sat an
  entire planning run away from the act.

- **X-1⁗ (3.1.1, PRDR-140).** `ticket_wall_clock_ms` is enforced where the work is LAUNCHED, so
  both drivers inherit it. It had exactly one enforcement site — the headless loop — while
  `skills/run/SKILL.md`, the published program the model-driven driver executes, contains no time
  check at all. `sessions` and `run_spend_usd` already live at the launch seam and are free to
  both drivers for that reason; the wall clock now joins them, and ARCH-2's parity becomes true by
  construction rather than by duplication. The outage BACKOFF is deliberately not moved: waiting
  is something a loop does and the referee has none, so the plugin path needs its own instruction
  — named here rather than half-solved.

- **B-2″ (3.1.1, PRDR-145b).** Per-ticket worktrees are the DEFAULT, with `--no-worktree` as the
  documented escape. `workDir` was the operator's own checkout unless a flag said otherwise, which
  turned three behaviours that are correct for a tree Detent owns into destructive ones:
  `resetDirtyTracked` ran `git checkout HEAD --` on uncommitted work, `parkForeignUntracked`
  relocated untracked files on every claim, and `finalizeDone`'s `git add -A` staged whatever else
  was in the tree under the ticket's name. Not three bugs — one posture, *Detent owns the working
  tree during a run*, applied where it was false. The posture is defensible; what was not is that
  it went unstated while the dangerous mode was the default. B-2′ hardened the merge path first,
  so this promotes a mode that has been tested rather than trading a known hazard for an untested
  one. `--no-worktree` still carries those surfaces, now as an explicit choice.

- **V-1‴ (3.1.1, PRDR-155).** A bound gate that VERIFIES NOTHING is named to the operator.
  `bindSlot` refuses a command that will not terminate and one that cannot execute; a command
  that exits 0 having done nothing is neither, so `"test": "echo no tests here"` bound as an
  approved gate and passed for the life of the project — making P2's "only exit codes count"
  vacuous. V-1″ closed the adjacent case of NO bound gate; this is the same hole one step in, and
  it was found by generalising a monorepo-specific critical rather than accepting its framing.
  Deliberately EVIDENCE, on the A-1⁗ and V-6 precedent: a fast zero-exit command is genuinely
  ambiguous — a small build and a clean lint are both — so refusing it would make `init` unusable
  on the projects it should serve, and the decisive check (break the tree, require red) is what
  V-6 does at review time where a diff exists to revert. The signal is the COMMAND TEXT, not its
  duration (PRDR-156): a command whose every statement is a no-op — `echo …`, `true`, `:`,
  `exit 0`, empty — is vacuous by inspection, and `Candidate.config_region` already carries the
  script body or recipe block the engine read. Duration was tried first and does not discriminate.
  A vacuous `echo` probes in 96 ms of which ~94 ms is npm's own startup, while a no-op `make` takes
  12 ms and is legitimate: the populations overlap, and a 500 ms cut flagged all four gates of an
  ordinary small project — including the 344 ms script this rule's own evidence calls real work.
  Narrow and true beats broad and wrong, and the miss direction is the safe one, because an
  undetected vacuous gate is the status quo whereas a notice on every gate is a new harm. What
  this cannot see — `jest --passWithNoTests`, a suite with no assertions — is undecidable here and
  belongs to V-6. The notice carries the command's own output, SCRUBBED (SEC-4), plus its duration
  as context, and it reaches the operator through `PipelineDeps.note`, the seam `init` already
  uses to speak to them: a notice the pipeline does not forward is not a notice.

- **V-1″ (3.1.1, PRDR-135).** No bound gate is UNVERIFIABLE, not green. `runScopedGates`
  returned `null` when no binding matched any requested slot and the caller read it as a pass,
  minting a real `GATE_GREEN` carrying the evidence string "no bound gates" — so a
  `bindings.json` that was deleted, gitignored or never committed sent every ticket to DONE with
  zero verification commands executed, merged each into the run branch, and exited 0. A corrupt
  bindings file correctly threw; it was specifically ABSENCE that failed open, because
  `readBindings` answers an empty set for a missing file and `run` checked config and approval
  at startup but never bindings. P2's "only exit codes count" is vacuous when nothing runs.

- **X-1‴ (3.1.1, PRDR-136/PRDR-147).** The run ceiling is enforced against the FILE, and a root
  has one writer. `SpendLedger` seeded its total once at construction and thereafter counted in
  memory, so two runs on one root each enforced the full `run_spend_usd` and jointly spent past
  it — silently, because per-ticket claims correctly kept them off the same ticket, so nothing
  else looked wrong. The launch gate is not hot; it re-reads. The ledger it reads is now
  validated with the schema that wrote it, rather than cast: a string cost concatenated
  (`5, "5", 3` → `"553"`), a negative subtracted, and `1e999` refused every launch. And a run
  now takes an exclusive root lock on the `O_EXCL` primitive the claim mechanism already proves,
  breakable on the same dead-pid-and-matching-host terms, so a second run REFUSES and names its
  holder. NG4 stands — concurrent runs are not made safe, they are made to decline.

- **X-1⁵ (3.1.1, PRDR-191).** `run_spend_usd` counts and no longer blocks; what halts a run is
  spend WITHOUT PROGRESS. A total is the wrong quantity and fails in two opposite directions. It
  fires on success: the gate-312 planning run reached $230 having completed eleven of fifteen
  slices with nothing wrong, and was on course to halt at s15 for no reason but arithmetic. And
  it fires late on failure: PRDR-186's key-formula bug re-planned every completed slice and
  burned $70 before anyone noticed, and had that been a cycle rather than a one-shot, the
  ceiling would have been the only thing to stop it — after hours. Raising the constant trades
  one failure for the other, and no value is both low enough to leave real work alone and high
  enough to catch a defect quickly. The constant is unchooseable in any case, because the phases
  differ by an order of magnitude: $230 buys 230 tickets WRITTEN DOWN, and building them is an
  implement session and a review per ticket plus gates plus the fix ladder, so planning is the
  cheap quarter of a self-build and one number is wrong for at least one phase of the same run.
  Nor was it ever the backstop X-8 named: D-25 evaluates at session launch, so a run overshoots
  by a whole session's cost, and before X-1‴ two runs on one root reached $16 against a $10
  ceiling with neither ever seeing `SpendExhaustedError`. **The replacement bounds the quantity
  the fear actually describes.** Legitimate work COMPLETES things — a slice for `init`, a ticket
  reaching DONE for the loop — and a runaway does not, so the ceiling is dollars accrued since
  the last completed unit. It cannot fire on a run that is working, however long or expensive.
  **What it does not catch is worth stating, because the first draft of this clause claimed
  otherwise:** PRDR-186's runaway RE-PLANNED finished slices, and re-planning writes the slice
  file, so that failure completes units and this breaker stays silent through it. The shape it
  catches is a run that finishes nothing — a retry storm, a wedged phase, a ladder that never
  lands — which is the larger class and the one no other control covers. Redoing completed work
  needs a different test and does not have one yet. The threshold is DERIVED rather than chosen,
  and derived from the SESSION rather than the unit: the mean cost of the sessions this root has
  recorded, times a session count, because a session is observable after the first one lands
  whereas the first unit may be an hour away. A multiple of the last completed unit's cost takes
  over once there is one, and a small absolute minimum covers the moment before any session has
  finished. A fixed dollar floor was the first implementation and this amendment's own audit
  rejected it for the reason the rest of this clause gives: it read about three times one
  project's slice cost and would read a fraction of that on a project whose sessions cost ten
  times as much. `run_spend_usd` stays in
  the table as an advisory figure that is counted and reported — and where an operator sets one
  deliberately, reaching it presents rather than dies, because everything is checkpointed and
  the answer is a human's. The financial exposure of an unbounded total is accepted here
  deliberately: it is the cost of a tool that finishes its job, and the no-progress breaker is
  what makes accepting it reasonable, so the two land together. A release carrying the removal
  without the breaker is a regression, not a step.

- **F-3′ (3.1.1, PRDR-137).** An artifact is read with the schema that wrote it. Four were
  validated on write and cast on read, and each failed in its own way: the slice cache
  advertised itself as a validated trust boundary while checking 3 of 11 fields, so a cache from
  an older build was a HIT that crashed `init` mid-PLAN; ticket writes truncated in place and
  `readTicket` parsed OUTSIDE the guard that names the file, so one torn ticket took `ready`,
  `pool`, `status`, `report` and `doctor` down together with no filename; and the two journal
  readers parsed unguarded, one of which — `unfinished` — exists to be read after a crash, which
  is exactly what tears the last line of an append-only file. The pattern to copy was already
  present: `readCheckpoint` returns `invalid` and the caller re-executes. Crash-safe by
  validation rather than by durability.

- **S-4″ (3.1.1, PRDR-138).** A stream that ends with no result message is a CRASH on the kernel
  path, as it already is on the init path (S-4′). It parsed as `ok: true` with
  `telemetryParsed: false` and no `crashed` flag, so the ledger took a $0 row with no
  `partial: "crash"`, the journal recorded a successful end for a session that died on the wire,
  and — the part that matters — the success branch RESET the outage streak. A repeated backend
  outage therefore could never reach `CRASH_STREAK_HALT`, and `requeueOutageVictims` never
  recognised its victims; the operator was told "budget breach", at $0, about an outage. PRDR-090
  and PRDR-112 exist to make an outage legible, and this was the path they did not cover.

- **B-2′ (3.1.1, PRDR-145a).** A worktree merge that CONFLICTS is an outcome, not a defect.
  `mergeWorktree` ran `git merge --no-ff` unguarded and then removed the worktree and deleted the
  branch unconditionally, so two tickets touching one file left a ticket DONE with its work
  unmerged, an orphaned worktree and a stale branch, surfacing as exit 1. Nothing enforces
  surface disjointness, so this is reachable by ordinary planning. Hardened here as the
  precondition for making per-ticket worktrees the default (PRDR-145b), because promoting a mode
  with one happy-path test would trade a known hazard for an untested one.

- **V-6 (3.1.1, PRDR-150).** A test that would pass WITHOUT the change it ships with is not
  evidence that the change works, and Detent checks it mechanically. After a green gate, when a
  ticket's diff touches both source and test files, the SOURCE half is reverted, the bound test
  gate is re-run, and the tree is restored; tests that stay green are named to the review. The
  measurement that motivates it: three of the 7 September audit's critical blockers had a
  passing test asserting the property they violated, and the remediation's own SEC-5′ test
  passed because its fixture was already CI-safe, making the mismatch it should have caught a
  no-op. Every one of those is the same mechanical property. It is EVIDENCE, never a gate — the
  A-1⁗ precedent, for the same reason: a check whose false-positive rate has not been measured
  must not be able to fail a ticket, and there are honest reasons a test stays green (it guards
  against over-correction rather than reproducing a defect; it covers a path the revert did not
  reach). A reviewer weighs that in a sentence; a red build cannot. The probe reverts with
  `git apply -R`, which refuses cleanly rather than half-applying, and restores in a `finally`;
  a missed restore is bounded by B-5's existing dirty-tracked reset on the next claim.

- **SEC-3′ (3.1.1, PRDR-132).** `.git/**` is in the STRUCTURAL protected floor, and the
  surface-expansion lever cannot grant a wildcard. `.git` appeared in no protected set at all,
  and a session could widen its own surface to `**` by writing a `surface_request.json` — the
  target was checked against `config.protected` only, never against the structural floor, and
  never checked to be a path. `ticketSchema.surface` accepted any non-empty string, so `**` was
  granted and PERSISTED onto the ticket for every later generation. `.git` matters not because
  it is sensitive but because writing into it is executing: `.gitattributes` plus a
  `filter.<name>.clean` entry in `.git/config` runs a shell command on `git add`, which the
  implement role holds and which `finalizeDone` performs itself — arbitrary execution outside
  the guard, without needing an executable bit the `Write` tool cannot set. The grant path and
  the enforcement path also disagreed: a request for `.detent/config.json` matched no default
  protected glob, so it was GRANTED and recorded as granted while the write was separately
  denied, leaving an audit trail that stated the opposite of what happened. Two checks on one
  question must not disagree — PRDR-120's `resolveOwner` lesson, in a different place.

- **SEC-4′ (3.1.1, PRDR-133).** The session-environment allowlist is APPLIED. `buildSessionEnv`
  had no production caller: `buildOptions` never set `env`, and the pinned SDK inherits
  `process.env` when it is omitted, so every session — holding `Edit`, `Write` and
  `Bash(git commit:*)` — inherited the operator's cloud credentials, deploy keys and tokens,
  and `git commit -m "$AWS_SECRET_ACCESS_KEY"` matches the prefix rule. SEC-4's own words were
  *"cloud credentials, tokens, deploy keys never cross into a session"*; the filter existed,
  was tested, was green, and was not wired. Its test asserted the helper rather than
  `buildOptions`, which is the third instance of that shape in this line and the reason the
  remediation rule is now explicit: assert on the entry point, never on the helper the entry
  point forgot to call. The same missing call also dropped `EXTENDED_CACHE_HEADER`, so S-6's
  extended prompt-cache TTL had never once been requested.

- **SEC-5′ (3.1.1, PRDR-134).** The drift check compares the COMMAND, not only the
  configuration it came from. `checkBinding` compared `config_hash` alone, and `resolved` — the
  only field that executes — was never compared to what discovery currently produces, while
  the schema constrained it to any non-empty string. `config_hash` is computable from the
  repository's own config region, so a committed `bindings.json` could pair a validating hash
  with an arbitrary command; `assertNoDrift` reported clean and the first gate of `detent run`
  executed it through a shell with the operator's full environment. The binding still names
  the command discovery found, or it has drifted — which is what SEC-5 was always described as
  checking.

- **B-1′ (3.1.1, PRDR-146).** The trailer hook preserves what it finds. `installTrailerHook`
  wrote `prepare-commit-msg` unconditionally at the start of every run, destroying an
  operator's commit linting, signing or issue-tracker hook with nothing said and nothing kept.
  Detent's posture is that it discovers tooling and refuses to install it (D-4, F-2); silently
  replacing a user's git hook is that posture broken in the place a user is least likely to
  look. A foreign hook is moved aside under a name that says what happened and the move is
  announced; Detent's own is recognised by its marker so re-installation stays idempotent.
  Note this writes to `--git-common-dir`, so it reaches the MAIN repository even in worktree
  mode — per-ticket worktrees do not cover it.

- **D-27″ (3.1.1, PRDR-128).** The plugin hook no longer executes a command from repository
  content, because it never had one to execute. The Stop path read `gate_cmd` out of
  `<cwd>/.detent/stage.json` and ran it through a shell, and `expired()` treated an ABSENT
  `expires_at_ms` as eternal rather than as expired — and since the hook is registered with no
  matcher, it runs in every session of every user who installed the plugin. Cloning a hostile
  repository and opening a session in it was therefore sufficient to execute arbitrary code,
  with no run in flight, no config, no plan and no approval. The remedy is removal rather than
  authentication: NOTHING in the product has ever written a non-null `gate_cmd`
  — `refreshRunRefeed` hard-codes `null`, and a test asserts it — so the execution path had no
  producer and served only an attacker. The run re-feed, which is what this file legitimately
  carries, is unchanged, and the hook's own contract is unaffected: the stop gate was always
  *"an accelerant, never the authority — the referee re-runs the full gate after session end"*
  (P2), and on this path it had never once run. An absent expiry is now expired, so a planted
  file cannot linger. The prior defence — that a repository could achieve the same through its
  own settings hooks — does not hold: those sit behind Claude Code's trust prompt, and this
  fired without one. SEC-6 says a settings file may only narrow what Detent does; a repository
  file causing execution that would not otherwise happen is that property inverted.

- **B-5′ (3.1.1, PRDR-131).** The crash skip is scoped to the GENERATION, not to the ticket's
  lifetime. B-5's premise — the budget was consumed, so a crashed session may not relaunch — is
  sound for the generation being resumed and false across one, because X-8 defines a new
  generation by zeroed counters. `unfinished` counted `start` against `end` over the ticket's
  whole journal and the skip event rebalanced neither, so one killed session suppressed that role
  on that ticket permanently: the ladder still spent real money fixing an implementation that was
  never written, and requeue — the documented remedy — could not clear it. Session events now
  carry the generation they belong to, which was not previously recorded at all; events without
  one count toward generation 0, the conservative reading that preserves B-5 for the resume it
  was written for.

- **C-14″ (3.1.1, PRDR-129).** The porcelain runs LIVE. `detent run` defaulted to the fixture
  backend while `detent referee` defaulted to the live one and `detent init` refused the fixture
  outright — and the README's two-command golden path, test-locked to exactly `detent init` and
  `detent run`, carries no flag. So the documented public workflow executed a fake whose result
  shape is indistinguishable from a real session: fabricated telemetry into the real ledger,
  `start`/`end` into the real journal, session and generation counters consumed against real
  tickets, ending in NEEDS_HUMAN for a reason that was not the reason. The default is now live,
  a non-live backend announces itself before the run, and the per-run config audit event records
  which backend ran — `SessionBackend.name` existed with no reader, so a journal could not answer
  "was this real?" even afterwards.

- **P7′ (3.1.1, PRDR-130).** A git call that COULD NOT COMPLETE is not a git call that found
  nothing. `git()` ran without an explicit `maxBuffer`, so Node's 1 MB default threw ENOBUFS on
  any larger output, and every wrapper turned the throw into an empty value — one `null` standing
  for two different facts. Three consequences, none announced: the reviewer received `""` for a
  diff, which is under the truncation cap so the "never truncate silently" banner never fired;
  `changedFiles` returned empty, so B-4 minted no risk label and a risk-touching diff finalized
  without the human approval it requires; and `snapshotRefs` returned an empty map, after which
  the base-branch guard's own "a new branch is also a write" loop matched EVERY local branch,
  `main` included, and deleted them. The buffer is now explicit, failure is distinguishable from
  absence at every wrapper, and a guard with no baseline refuses to act rather than treating
  every branch as new.

- **S-2⁗ (3.1.1, PRDR-127).** Containment is judged against the RESOLVED destination of a path,
  not the path a session typed. `path.resolve` normalises `..` lexically and does not follow
  symbolic links, so a link inside the worktree walked past the boundary, past the declared
  surface, and past the SEC-3 protected globs — three escapes, of which the protected one is a
  straight bypass of the immutability floor. The worktree bound, the protected match and the
  surface match now all run on the destination. The destination is what is judged, never the
  mechanism: a link whose target is still inside the worktree and inside the surface is allowed,
  because denying links as a class would refuse `node_modules/.bin` and every monorepo workspace
  link. Resolution walks up to the nearest ancestor that exists — a `Write` creating a new file
  is the ordinary case and `realpath` throws on it — and both sides are resolved, since `/tmp` is
  itself a link on macOS and comparing a resolved target against an unresolved root would call
  every temp worktree an escape. The resolver is injected with a filesystem-backed default so the
  decision stays testable without a session, and a resolver that throws denies. The TOCTOU window
  between the decision and the write is not closed by this and is bounded by the kernel re-running
  verification (P2).

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

- **C-8⁗ (3.1.1, PRDR-199).** A checkpoint covers the expensive LOOP inside a phase, not only
  the phase. C-8 is stated per phase, and the whole-plan redraft is a loop inside PLAN: it
  redrafts each slice the coherence review named, accumulating into memory and writing nothing
  until it returns. A death at redraft `k` of `n` discards all `k` — and discards the review that
  produced the findings too, because that review is recomputed from a slice cache the redrafts
  never reached, so no restart can get further than the one before it except by surviving the
  whole set in a single life. Observed on `detent-gate-311`: twelve planner sessions totalling
  **$59.96** ran after the last file in `state/plan/` was written and left no durable artifact,
  and the run reached **$296.69 across 81 sessions and 11 supervisor attempts** without ever
  producing a `plan.json`. Each completed redraft is now checkpointed **before the next begins**,
  keyed on what the whole-plan review READ, and the review's findings and their slice assignment
  travel with them — a resumed run CONTINUES the set rather than re-paying for the session that
  named it. The rule generalises past this loop: a phase that spends per ITEM checkpoints per
  item. And the exit record stops promising otherwise — PRDR-190's "every finished slice is
  checkpointed" was true of slices and false of redrafts, which cost the operator the ability to
  notice.

- **C-4⁗′ (3.1.1, PRDR-118).** Every strict planning artifact gets the one relaunch PRDR-116
  gave the review — the validator's own words in the inputs, and only then a failure. The
  lesson had been applied one level too low: the review's artifact is the simplest planning
  produces, while the SLICE and PLAN artifacts are the strictest and by far the most
  expensive, and they had no second attempt at all. A twenty-slice product asks for thirty to
  sixty independent strict artifacts, so at a one-percent chance of a stray key in any of
  them, better than a third of runs would abort hours in. A failure now names the slice it
  died on and says that the finished slices are cached.

- **C-4⁗″ (3.1.1, PRDR-200).** REVIEW_PLAN is **sampled**, not drawn once. C-4″ said a
  `changes` verdict buys exactly one revision carrying the findings; it did not say where those
  findings come from, and they came from a single session whose findings do not reproduce.
  Measured by running the production review three times over byte-identical tickets with no
  redraft between the passes: **ten of sixteen distinct findings appeared in exactly one read**,
  four of eighteen ordered pairs shared nothing at all, and one ticket drew three different tags
  in three reads. The revision was being paid an index-carrying session to chase findings that
  were not reliably there. A slice's review now runs `k` times — 3, a named constant beside
  PRDR-084's revision count, and **announced at PLAN with the threshold that produced the
  findings**, because a knob an operator cannot see is one they do not have (PRDR-197). A new
  X-1 key is an F-3 schema event and is declined here exactly as C-4″ declined one. Only
  findings recurring in at least ⌈k/2⌉ reads are handed to the reviser; the rest travel to
  PRESENT as the review's own advice, which is where D-24 always meant a judgement call to go. The samples are not extra cost for the measurement:
  their pairwise disagreement IS the null, so every slice now records what the same arithmetic
  returns when nothing was revised. This does not add revision ROUNDS — PRDR-196's non-goal
  stands, more passes of intrinsic critique is the shape the evidence rejects — and it does not
  touch D-24: the review still advises and never blocks. It also retires the reading that
  `revisionOutcome` measured the revision. Against a null in which nothing was redrafted the
  same arithmetic returns c 0.583 and γ 0.333 versus production's 0.714 and 0.533, and the
  two-rate break-even test fails an operation that provably did nothing. The recorded numbers
  were never wrong; what they isolate is smaller than it was read to be, and from here each one
  is reported beside its own null.

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
