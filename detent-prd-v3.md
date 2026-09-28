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

> **One mark, one rule (3.1.1, PRDR-287/PRDR-288, 2026-09-26).** Nine marks were each defined more
> than once, for different rules, so every citation of one named more than one rule and a reader
> could not tell which was meant. The definition introduced first keeps its mark; each later one
> takes its family's next free mark and names the mark it had:
> C-3″ (PRDR-207) → C-3‴ · C-9′ (PRDR-139) → C-9‴ · C-9′ (PRDR-079) → C-9⁗ ·
> C-12′ (PRDR-078) → C-12⁗ · F-1′ (PRDR-118) → F-1‴ · P6′ (PRDR-142) → P6″ ·
> S-3′ (PRDR-121) → S-3⁸ · S-5′ (PRDR-141) → S-5⁗ · V-1⁵ (PRDR-232) → V-1⁶ ·
> X-1‴ (PRDR-136/PRDR-147) → X-1⁷.
> A restatement is a definition. §8's S-3′ restates v2's S-3, and §4's range `C-9′…C-13′` restates
> C-9…C-13, for v3; each was written before the amendments that reused its marks, so each kept them
> (for the range, PRDR-288 records the owner's decision). A mark is an identifier, not a chronology:
> C-9″ amends what is now C-9‴, S-3″ to S-3⁷‴ build on what is now S-3⁸, and C-9⁗ and C-12⁗ are
> older than C-9″, C-9‴, C-12″ and C-12‴. Every citation in the code, the docs and the tickets was
> re-pointed, one at a time, to the rule it means. Three records keep the mark they had and read
> through this note: a quotation inside a `prd-review` ticket, which N-6 preserves as the document
> stood; PRDR-287's account of the overlap it left open; and every commit message.
> `tests/docs/prd-requirement-ids.test.ts` fails on a mark defined twice, unless the second is a
> restatement of the same rule, named there one by one (D-29).

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
| D-31 | **`init` judges the documents before it plans from them.** A specification phase, AUDIT, DECIDE, WRITE and VALIDATE, turns the discovered documents into a validated pack with a fixed schema, a conformance record and a deterministic checker, inside `init` and with no switch (C-2⁶, C-2⁷). Only money, legal and policy questions are asked, once and early; every other gap is a vetoable default, and off a TTY every recommended answer is taken (C-3⁗). A session that proves the pack wrong files an amendment, and fix sessions may too (X-3′, X-4⁷). | PRDR-278 (3.1.1); the operator's sixteen decisions of 2026-09-26, in `docs/plan-specification-phase.md` §2. Trials on other projects kept hitting contradictions in the PRD, and a rule that is consistent but wrong passes every gate, because the code and its tests both follow it. The ksarjs specification turned a raw PRD into 2,024 requirements and 1,144 criteria through the same four steps, and its validation found what no build would have: a rounding defect a simulation caught, a race, a security hole left by omission, and a forfeiture rule that was consistent and wrong. |
| D-32 | **Planning is built on the pack.** SLICE is seeded by code and keyed by requirement ids (C-2⁸); PLAN drafts from pack records and asks nothing (C-4⁵); code checks what code can prove, drives one targeted redraft and blocks approval on what still fails (A-1⁷); one `plan_review` read per slice judges what code cannot (C-4⁶); ANALYZE is folded into DECIDE (D-10′); and gates bind per package (D-5′). | PRDR-278 (3.1.1); the operator's ten decisions of 2026-09-26, in `docs/plan-planning-redesign.md` §2, after `docs/planning-phase-audit-2026-09-26.md`. September's 79 planning tickets delivered about 19 results a live run could see, nearly all plumbing. ksar-cloud's approved plan was never reviewed whole (1.55M tokens against a 1M limit), kept 34 defects code had proved, and spent 78% of its planning on a review whose 151 verdicts were all `changes`. The pack alone would not fix that: ksar-cloud's documents were already half a pack. Planning decision 1 put this in the same amendment as D-31, and planning decision 4 pauses ksar-cloud's plan until the new planner re-plans it, as the baseline for later changes. |
| D-33 | **Run-time outcomes decide which planning mechanisms stay.** A mechanism that claims to improve plans names the outcome it should move, among escalations to NEEDS_HUMAN, falsifications by cause, budget breaches, first-generation DONE, review rounds, and cost or wall-clock per ticket (N-5′), and a measured run in which that outcome does not move is grounds to remove it. Reviewer finding counts are not an outcome. | PRDR-278 (3.1.1); planning decision 3. September judged its planning patches by reviewer finding counts, and its own experiments showed those counts track how much the reviewer writes. |
| D-34 | **AUDIT checks only what a decision rests on and a source could settle.** A triage sorts the survey's claims first. A claim a decision in the documents rests on, and that a primary source could settle, is checked, up to five of one topic to a session. A load-bearing claim no source could settle goes to DECIDE, and a claim nothing rests on is recorded and not checked. The checks keep the `audit` role's routing (C-2¹⁸). | PRDR-306 (3.1.1); the user's four decisions of 2026-09-28, taken during tabachir's test run. By 08:06 AUDIT had checked 138 claims, one session apiece on claude-opus-5-5 at max, for $426. DECIDE is given only the claims that are not confirmed, so the 77 confirmed changed nothing it was given. Many of the 48 unverified were claims no source could settle, and the 13 wrong ones, about $40 of checks, were the payoff. The user kept the model at max: the triage and the grouping do the saving. |

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
  *Amended by C-8⁵ (PRDR-278): `--replan` enters at DETERMINE_VERIFICATION and never re-runs the
  specification phase.*

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
  *Amended by C-4⁶ and S-1‴ (PRDR-278): each slice gets one review read, by its own `plan_review`
  role.*
  *Amended by C-4⁸ (PRDR-294): built.*

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
  *Amended by C-4⁶ (PRDR-278): `dependency` is one of the review's four tags.*
  *Amended by C-4⁸ (PRDR-294): built. A finding names the ticket whose change answers it, and the
  other in its words.*

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
  *Amended by D-10′ (PRDR-278): the documented commands come from the decision log's stack entry,
  in structured form.*
  *Amended by V-5″ (PRDR-295): each other package the decision log declares is bound as it
  declares, provisionally, beside the root's.*

- **C-4⁗ (3.1.1, PRDR-116).** REVIEW_PLAN's verdict vocabulary stays closed, but a reviewer
  that writes a plain synonym — `revise` for `changes`, `approved` for `approve` — has still
  reviewed, and is read as the word it means, noted. An absent or unusable review artifact
  buys one relaunch carrying the validator's own words, exactly as a code review does
  (A-5′); only after that does the draft stand unreviewed, and the note names the reason.
  Found on ksar-cloud: six real findings — three tickets oversized, two missing edges, one
  untestable criterion — discarded over one word, and the draft written unreviewed.
  *Amended by C-4⁸ (PRDR-294): code grades the verdict by the findings' severities, and a word that
  disagrees with them is noted.*

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
  *Amended by C-2⁸, A-1⁷ and C-4⁶ (PRDR-278): SLICE is seeded by the pack and keyed by requirement
  ids, mechanical checks replace the whole-plan review, and each slice gets one `plan_review`
  read.*
  *Amended by C-2¹⁵ (PRDR-291): on a pack SLICE is seeded by code and its cut kept on record.
  Without a parse it cuts the documents as this built it, and no slice carries an estimate.*
  *Amended by C-4⁷ (PRDR-292): on a pack a slice is drafted from its records, and the index a draft
  is shown names what each ticket provides.*
  *Amended by A-1⁸ (PRDR-293): the whole-plan review is deleted; code's checks run across the plan
  after every slice.*
  *Amended by C-4⁸ (PRDR-294): a slice's draft is read once, by `plan_review`, and revised once
  where the read finds a blocker or major.*

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
  *Amended by A-1⁷ (PRDR-278): baseline coverage is code's check, not the review's judgement.*
  *Amended by A-1⁸ (PRDR-293): built.*

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
  *Amended by A-1⁷ (PRDR-278): a proved contract failure buys one targeted redraft, and what still
  fails blocks approval.*
  *Amended by C-4⁷ (PRDR-292): the kinds gain `error_code`, `setting` and `job`, and a kind the
  pack catalogues is named by its catalogue ids.*
  *Amended by A-1⁸ (PRDR-293): built. What the checks prove is a failure, which a redraft is sent
  and approval waits on, not a finding for the review.*

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
  *Amended by A-1⁷ (PRDR-278): coverage adds criterion ids, and a failure buys one targeted
  redraft and then blocks approval.*
  *Amended by A-1⁸ (PRDR-293): built. A slice whose tickets name none of its items fails for each,
  and nothing is reported as undeclared.*

- **S-3⁸ (3.1.1, PRDR-121; renumbered from S-3′ by PRDR-287).** Symbol intelligence is an OPTIONAL adapter, discovered and never
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
  *Amended by C-2⁸ (PRDR-278): the slicer estimates no ticket count; the band stays its guidance.*
  *Amended by C-2¹⁵ (PRDR-291): built. The announcement states the session formula for the slice
  count.*

- **S-5″ (3.1.1, PRDR-125).** The planner runs on `claude-opus-5`. S-5′ seated it on Fable 5.1
  on the strength of a probe; the first self-build gate measured it on real work, and the
  operator's call is that it is not the right seat for the role that determines every other
  session. Review, diagnose and the informed attempt were already on Opus; implement, the three
  fixes and research stay on Sonnet.

- **S-5‴ (3.1.1, PRDR-275).** The agent-sdk pin moves to 0.3.280, whose bundled runtime,
  2.1.280, is the first to serve `claude-opus-5-5`. S-5′'s reasoning holds unchanged: the SDK's
  bundled runtime is what serves a session, so model support moves with this pin and not with
  the `claude` an operator installs. The default routing is untouched — both models it names are
  served by 2.1.280 — so the pin decides only what a project MAY route to, not what it does.

- **S-1″ (3.1.1, PRDR-124).** An init session carries its OWN containment policy, whose surface
  is exactly the artifact it was asked to write. S-1′ has always said such a session gets the
  read-only surface plus one write rule; the rule was granted on the allowlist while the hook
  fell back to the backend's construction policy of `**`, and a cleared mutation returns a
  terminal allow, so the allowlist was never consulted and the rule was decorative. A planner
  asked for one artifact wrote its draft as two part files beside it and the phase found
  nothing where it was told to look. Reads are unchanged — non-mutating calls abstain (S-2‴)
  and the worktree bound holds — because a planner that cannot read the documents cannot
  analyse them.
  *Amended by S-1‴ (PRDR-278): a `spec_write` session's surface is the decision log, the pack's
  paths and `archive/`, declared.*
  *Amended by C-2¹² (PRDR-282): DECIDE's `spec_write` session keeps this one artifact; code
  writes the log.*
  *Amended by C-2¹³ (PRDR-283): WRITE's `spec_write` session declares the pack's paths as its
  surface, beside its artifact; `archive/` is code's to write.*
  *Amended by C-2¹⁴ (PRDR-284): VALIDATE's reviewers keep their one artifact, and its writer
  declares the pack's paths as WRITE's session does.*

- **S-2‴ (3.1.1, PRDR-122).** The containment hook ABSTAINS on a call it does not govern; it
  does not allow it. A hook decision runs before every other permission step, so `allow` is
  terminal — it ends the evaluation before the allow rules are reached. The guard governs where
  a mutation lands and answered `allow` for everything else, which meant it was silently
  granting rather than declining to object: `implement` is allowlisted only `Bash(git add:*)`
  and `Bash(git commit:*)`, yet every bash command passed, because a bash call names no path.
  The same hole waved through any MCP tool, whose parameters the guard cannot read — including
  the editing tools S-3⁸ was written to keep out. Now `deny` is terminal and unchanged, `allow`
  is reserved for a mutating call the guard positively cleared, and `abstain` omits the
  decision so the allowlist decides. The plugin hook renders an abstention as silence, matching
  D-29's rule that a hook may narrow what the permission rules grant and never widen it.
  *Amended by S-1⁵ (PRDR-302): the permission mode decides before the allowlist, and approves a
  read-only command no allow rule names, so a session's base set of built-in tools is what binds.*

- **V-3′ / S-5⁗ / R-10′ (3.1.1, PRDR-141; S-5⁗ renumbered from S-5′ by PRDR-287).** Five features were implemented, tested, documented
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

- **P6″ (3.1.1, PRDR-142; renumbered from P6′ by PRDR-287).** A bound that cannot be read is refused rather than dropped, the
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

- **C-9‴ (3.1.1, PRDR-139; renumbered from C-9′ by PRDR-287).** "Executes only an approved plan" is CHECKED, and the approval is
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

- **X-1⁷ (3.1.1, PRDR-136/PRDR-147; renumbered from X-1‴ by PRDR-287).** The run ceiling is enforced against the FILE, and a root
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
  by a whole session's cost, and before X-1⁷ two runs on one root reached $16 against a $10
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

- **F-3″ (3.1.1, PRDR-300).** A persisted shape can be migrated. `SCHEMA_VERSION` had been 1
  since the first commit, the stamp was read only to refuse a newer file, and no code migrated
  anything: 22 schemas pinned the literal, and 31 places in `src/` and three prompts named it. The
  3.1.1 line is `schema_version` 2, one event. Each shape the line changes adds its step to the one
  v1→v2 migration before the release (S-1‴), and none gets a version of its own.
  - **Data.** Migrations are an ordered list in `src/kernel/migrate.ts`, each from one version to
    the next, with a name and the transforms it makes, by file. A file is carried from its own
    stamp to the build's, nested stamps included, and a second migration changes nothing.
  - **Who.** `init`, `run` and the referee migrate before they read the state, under the run lock
    (X-1⁷), and write `config.json` last, so a migration cut short is resumed by the next
    command. `run` migrates before it builds its backend, which reads the bindings. A state holding a file stamped newer than the build is refused with F-3's upgrade
    hint, and nothing is written. The other verbs do not migrate: on an older state each refuses
    and names `detent init` and `detent run`.
  - **What.** Every JSON file under `.detent/` that carries a stamp, except `worktrees/`, and the
    pack's conformance record. A file that is not JSON, or has no stamp, is left for its reader.
    The JSONL logs are history and keep their rows as written; none of their readers reads a
    stamp.
  - **Kept.** `agents/assignments.json` is re-pinned to the prompts the build ships (S-7). An
    approved plan stays approved and a conforming pack stays conforming. An unapproved plan
    re-derives once, from SLICE on, because SLICE's and PLAN's digests cover restamped values,
    and from DISCOVER on where the pack carries a record, whose bytes DISCOVER's digest covers.
  - **Nothing names a version but the constant.** Writers and skeletons take `SCHEMA_VERSION`,
    and the prompts say the stamp is the skeleton's, so the next event edits no prompt.

  A team whose members run different versions on one repository is not supported: an older file
  that arrives after the migration is refused by its reader, by name.
  *Amended by C-4⁷ (PRDR-292): the event gains PLAN's draft and caches and the ticket's
  `criterion_ids`.*
  *Amended by V-5″ (PRDR-295): the event carries `.detent/bindings.json` to packages.*
  *Amended by C-4⁸ (PRDR-294): the event routes `plan_review`.*

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

- **B-5‴ (3.1.1, PRDR-234).** The skip **discharges** the start it was written for. B-5′ above
  fixed the SCOPE of the crash skip and left its arithmetic alone, so the sentence B-5′ itself
  wrote — *"the skip event rebalanced neither"* — went on describing the code after the fix as
  accurately as before it. `unfinished` counted `start` against `end`; `skipped_after_crash` is
  neither, so the imbalance that FIRED the skip survived it and every later launch of that role,
  in that generation, was skipped in turn. Across a generation X-8's zeroed counters cleared it,
  which is what B-5′ measured and why it read as fixed. Within one, the original defect was
  untouched. It stayed invisible because the ladder normally moves ON after a skip — blind_fix to
  research to informed_fix, different roles, separate tallies, which is the shape the crash-resume
  test pins. The role the ladder RE-ENTERS is REVIEW_FIX, and nothing covered it. On gate-313 that
  spent two of `t-s01-012`'s three review-fix rounds on launches that never happened: each time
  the reviewer re-read a tree nobody had touched, re-raised the same finding, and the ticket
  reached NEEDS_HUMAN — halting the run — with that finding never once handed to a running fixer.
  Its ledger holds ONE review_fix session against a counter reading three. The discharge is
  counted in the predicate rather than written as a synthetic `end`, because `end` carries `ok`
  and `cost` that every ledger and report reader trusts: fabricating one would claim a session
  ran. The journal keeps saying, truthfully, that it did not. B-5's skip-once and B-5′'s
  generation scoping are both unchanged — this restores the property each was written to provide.

- **S-4‴ (3.1.1, PRDR-235).** A configured **effort** is recorded, not assumed to have been
  honoured. PRDR-197 mirrored the SDK's closed set of levels so a typo is refused at config load,
  and justified that in `src/schemas/roles.ts` with *"the SDK downgrades silently for a model that
  cannot serve one, which is why a configured effort is recorded per session rather than assumed
  to have been honoured."* No such recording existed. The models half of the same routing is fully
  observed — `models` on every ledger row, a `model_fallback` event, a note on the ticket — so a
  reader could always answer which MODEL ran and never which effort, and PRDR-092's config audit
  event listed `budgets`, `model_routing`, `protected` and `risk` while omitting `effort_routing`
  from the very record whose contract is *"the run records the configuration it actually loaded."*
  The consequence is not a wrong number but an unfalsifiable knob: a run at `max` and a run at the
  SDK default leave identical journals, so an experiment that raises effort cannot be
  distinguished afterwards from one that did not, and the 188 sessions already on gate-313 cannot
  be established as a baseline either. The run's config event now names `effort_routing`, and each
  session's `start` names the level it launched with — `"default"` where none was routed, because
  an absent field cannot tell *"the SDK's own default governed"* apart from *"this build did not
  record it."* What the SDK settles on AFTER a silent downgrade is a further fact, exposed to hooks
  as `effort.level`, and deliberately not this one. Noted while amending: effort routing appears in
  neither PRD, so PRDR-197 shipped an operator-facing knob with no PRD entry at all; this is the
  first, and it covers only the recording.
  *Amended by S-4⁵ (PRDR-299): built for `init`'s sessions too; until then only the kernel's
  `start` named a level.*

- **C-12″ (3.1.1, PRDR-236).** Requeue guidance reaches the SESSION, not only the judge of it.
  C-12's one lever over a stopped ticket is a requeue carrying guidance; `requeueTicket` records it
  as a ticket note and as the new generation's `reason`, and the confirmation says the generation
  was opened *with the guidance recorded*. Recorded, and never delivered: `attemptInputs` handed an
  attempt session `publicTicket`, which is id, type, title, description, criteria, non-goals,
  contracts and surface, and carries no notes under any name — `lastNote`'s only readers were the
  operator exit summary and the drift sweeps. The reviewer, since PRDR-080, received the whole trail.
  That ticket's own comment lists the operator acts a session must be able to see — surface grants,
  **requeue guidance**, claim breaks — and fixed only the reviewer, which is the right audience for
  two of the three: a grant and a claim break are facts a judge needs, and guidance is an
  INSTRUCTION, delivered to the one party not meant to act on it. Found when gate-313's t-s01-012
  was requeued with its reviewer's finding relayed verbatim, generation 1 rebuilt the ticket from
  its acceptance criteria alone, and the next review opened *"The requeue guidance's finding is
  still unaddressed"* — the reviewer quoting a record the implementer could not read. The key is
  added at the `attemptInputs` seam, so all four attempt roles inherit it rather than each
  remembering it, and shares the reviewer's window and its one definition so a long-lived ticket
  cannot push its own criteria out of context. The four attempt prompts describe it as binding; the
  reviewer's closed input set is untouched. Corrected in the same pass: `prompts/review_fix.md` still
  told its reader that *a second round of review findings escalates to a human*, which X-1‴ made
  false — findings buy a budgeted number of rounds — so a fixer with four rounds left believed it
  had one.

- **C-12‴ (3.1.1, PRDR-238).** A human may restart the attempt of a ticket that is **not finished**,
  not only one that has already halted. `HUMAN_REQUEUE` had exactly two rows in X-3's table —
  NEEDS_HUMAN and BLOCKED — which was right when PRDR-078 built these verbs for a halted ticket, and
  was never revisited once crash-resume existed. A crash does not leave a ticket halted; it leaves it
  mid-flight. So a session killed mid-implement left its ticket IN_PROGRESS, where B-5's skip then
  sent an implementation nobody had written down the entire ladder — a blind fix, a research session,
  an informed fix, each spending real sessions against a near-empty tree — before NEEDS_HUMAN finally
  made C-12's requeue admissible. The documented remedy was gated behind the failure path it exists
  to short-circuit. A machine restart during gate-313's take 15 stranded two tickets that way at
  once, at a measured cost of roughly $10-16 and an hour to reach a state a human could already see
  was correct from the outside. The admissible set is now one exported constant the table and the
  plumbing check both read, so the second copy that lived in `requeueTicket` cannot drift from the
  first. APPROVED is deliberately absent: its diff passed the authoritative gate and a review,
  finalize is mechanical from there, and a requeue would discard verified work on a keystroke —
  `approve` is the verb for re-examining it. DONE is merged and READY is what a requeue produces.
  What makes the widening safe is the guard that did NOT move with it: `guardClaim` still refuses a
  claim held by a live process, naming the pid and the claim's age, and breaks only a verifiably dead
  owner on this host — the predicate `unclaim` and the pool's crash-resume self-heal already share
  (PRDR-079). A requeue therefore cannot pull a ticket out from under a running session in any newly
  admitted state, which is why this is a widening of the table rather than a new verb.

- **S-4⁗ (3.1.1, PRDR-237).** The effort a session RAN at, beside the one it was asked for. S-4‴
  recorded the routed level, and the sentence that justified recording anything is about the other
  half: *"the SDK downgrades silently for a model that cannot serve one, which is why a configured
  effort is recorded per session rather than assumed to have been honoured."* Recording the request
  detects no downgrade. The model half of the same routing has had both ends since PRDR-114 — a
  fallback is detected, carried on the result, journaled and noted — so *which model ran* always had
  an answer while *which effort ran* had none. The SDK publishes it: every tool-context hook input
  carries `effort.level`, documented as the active level after any silent downgrade, and Detent's
  D-21 containment hook — the one layer that sees every tool call a session makes — read `tool_name`
  and `tool_input` off that input and dropped the rest. It now reports the first level it sees, once,
  as observation that cannot reach the decision; the result carries it, and the kernel journals
  routed against active, noting the ticket when they disagree. Neither refuses nor retries the
  session, following PRDR-114. A session that calls no tool reports nothing, and that is recorded as
  UNOBSERVED rather than as agreement — a missing signal read as a matching one is the failure this
  exists to prevent. Found when gate-313's first `max` session came in 10% above the baseline mean in
  output tokens and 2% in cost, with no way to say whether that was a small real effect or a level
  that never took.
  *Amended by S-4⁵ (PRDR-299): built for `init`'s sessions too, which say a disagreement through
  init's note seam.*

- **S-4⁵ (3.1.1, PRDR-299).** `init`'s sessions record the effort they were routed to and the one
  they ran at, as the kernel's have since S-4‴ and S-4⁗, and the model they fell back from, as
  PRDR-114's have. `init` routed every session a level and journaled a bare `start`; the level the
  containment hook observed reached the result and was dropped; and a routed model the runtime could
  not serve left the ledger row's `models` as the only trace. S-5⁵ puts the planner, `plan_review`
  and all three specification roles at `max`, and the SDK downgrades silently, so a planner that ran
  lower left a journal identical to one that ran at `max`, and an experiment on effort (D-33) could
  not be told from one that did not happen. Each init session's `start` now names its routed level,
  `"default"` where none is; `effort_settled` follows it with the routed and the active level,
  `unobserved` when no tool call reported one; a routed model the runtime could not serve is
  journaled as `model_fallback`. With no ticket to note, a downgrade and a fallback are said through
  init's note seam, in the kernel's words, which both drivers take from one module (ARCH-2). Neither
  refuses nor retries the session, as PRDR-114 set, and a failed session records its level before
  its phase fails. The prompt hash the kernel's `start` carries is still not on init's.

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
  *Amended by C-3⁗ (PRDR-278): DECIDE asks this class of question, and records every other
  decision as a vetoable default in the decision log.*

- **F-1‴ (3.1.1, PRDR-118; renumbered from F-1′ by PRDR-287).** A ticket id is a FILE NAME under `.detent/plan/`, and a model
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
  *Amended by C-8⁵ (PRDR-278): on an amendment's scoped re-plan, the refusal covers only the
  re-planned slices' tickets.*
  *Amended by C-2¹² (PRDR-282): the refusal is asked again as each phase on the chain up to PLAN
  is about to run, since a standalone phase can change what planning reads.*
  *Amended by C-2¹³ (PRDR-283): the scan goes past a miss to a phase that restarts the chain, and
  the second ask is not made before the phases ahead of that phase.*
  *Amended by C-2¹⁴ (PRDR-284): VALIDATE restarts the chain after WRITE, so the second ask is
  made before VALIDATE runs and not before WRITE.*
  *Amended by X-4⁸ (PRDR-286): under an applied amendment neither ask is made; PLAN asks it of each
  slice it plans again, and the filing ticket's NEEDS_HUMAN does not refuse.*

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
  *Amended by C-2⁸ (PRDR-278): a slice's key is its requirement ids and their content hashes,
  never the model's words.*
  *Amended by C-2¹¹ (PRDR-281): a phase may stand outside the chain, keyed by its own digest
  alone; AUDIT does.*
  *Amended by C-2¹² (PRDR-282): a phase that writes what its digest reads is keyed after it
  runs. DECIDE does, and stands outside the chain beside AUDIT.*
  *Amended by C-2¹³ (PRDR-283): a phase may restart the chain: keyed by its own digest, looked up
  while earlier phases replay, and the phases after it chain from its key. WRITE does.*
  *Amended by C-2¹⁴ (PRDR-284): VALIDATE restarts the chain too, directly after WRITE, whose key
  then reaches nothing.*
  *Amended by C-2¹⁵ (PRDR-291): built. On a pack a slice's key hashes its requirements' records,
  and without a parse the documents it plans from, as here; neither holds the slice's own words.*
  *Amended by C-4⁷ (PRDR-292): a slice's key covers PLAN's prompt and the review's, not SLICE's.*
  *Amended by C-4⁸ (PRDR-294): the review reads what the key reads, so a cached verdict goes stale
  when its draft does.*

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
  *Amended by A-1⁷ (PRDR-278): the cross-slice checks send the redrafts, where the whole-plan
  review did; the rule stands.*
  *Amended by A-1⁸ (PRDR-293): built. Each redraft the checks send is checkpointed before the next
  begins, in `state/plan-checks.json`.*

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
  *Amended by C-4⁶ (PRDR-278): the sampling is deleted; each slice gets one review read.*
  *Amended by C-4⁸ (PRDR-294): built.*

- **D-28′ (3.1.1, PRDR-203).** The overshoot bound is one in-flight **batch**, not one in-flight
  session. D-25 evaluates the gate at launch and never mid-flight, and D-28 states the
  consequence as "bounded at one in-flight session". C-4⁗″'s three review draws are independent
  by construction — the one place in the pipeline where concurrency buys wall-clock without
  touching plan quality — and launches that pass the gate together all pass it at the same
  figure. So a batch is gated ONCE, by the first of its launches the gate lets through, and the
  bound is `PLAN_REVIEW_SAMPLES` sessions: whether the draws run together or one after another,
  because a bound that depended on scheduling would not be one. A refused batch launches none
  of its sessions; a relaunch (C-4⁗) is gated on its own. The figure: two extra in-flight
  sessions are $4–10 on smoke-1's ledger (mean $2.08, peak $5.18 over 45 rows), against a
  no-progress threshold whose unit term there was about $40. Two things had to hold first, and
  neither was the ledger, which appends a row per session and re-reads the file at the gate
  (X-1⁷): `init` now holds one journal per PHASE and hands it to every launch, as the run loop
  has held one per run — F-1's single writer is the process, which the lock decides, not the
  launch — and each draw writes its own artifact under its own S-1″ surface. The draws still
  run in sequence; making them concurrent is C-4⁗″'s own amendment, and this is what had to
  hold before it could be.
  *Amended by C-4⁶ (PRDR-278): the draws this bounds are deleted; the rule stands for any later
  batch, bounded by that batch's own size.*
  *Amended by C-4⁸ (PRDR-294): built. No launch is batched: VALIDATE's reviewers run one after
  another (C-2¹⁴).*
  *Amended by C-2¹⁶ (PRDR-304): AUDIT's claim checks are a batch, four at a time, and this bounds
  them.*

- **C-4⁗‴ (3.1.1, PRDR-204).** The `k` draws of a slice's review launch **together**. They are
  independent by construction — that independence is what the threshold rests on — and they ran
  one after another: three sessions' wall-clock for three sessions' money. Now the first draw
  launches, and the rest launch when it has answered its first turn, or returned, or after a
  bounded wait, whichever comes first — one batch gated once (D-28′). A C-4⁗ relaunch inside a
  draw is gated on its own and may overlap the others, so at most `2k − 1` sessions are in
  flight. Reads come back in launch order whatever order the draws finish in, so the `churn`
  C-8 caches and what the reviser is handed are the same across runs. Measured on smoke-1's
  s04, three draws over unchanged tickets: **9.0 minutes in sequence, 2.9 launched together**,
  $2.41 against $2.56. The wait exists because the draws share one first turn (S-6), and the
  measurement found that turn is NOT shared as it stands: PRDR-203 gave each draw its own
  `artifact_out`, which sits inside the cached block, so the second and third draws write the
  block the first already wrote — about 25k tokens a draw, in sequence or together alike (21k
  and 17k created behind one shared path; 45k and 47k behind one path each). That is PRDR-203's
  cost, carried by PRDR-205, and the stagger's own value can be measured only once the first
  turns are byte-identical again. The whole-plan review is still drawn once; slice planning and
  the redrafts are still sequential; there is no knob.
  *Amended by C-4⁶ (PRDR-278): the draws are deleted with the sampling.*
  *Amended by A-1⁸ (PRDR-293): the whole-plan review is deleted.*
  *Amended by C-4⁸ (PRDR-294): built.*

- **S-6′ (3.1.1, PRDR-205).** The sessions of one batch are handed **byte-identical first
  turns**, and the file each writes is still its own. S-6's stable prefix was never the whole
  cache key: the SDK is handed one user message, prefix then variable, and the variable ended
  with the artifact path — so when PRDR-203 gave each draw its own file, the three first turns
  differed in their last few dozen bytes and the block missed for every draw but the first,
  about 25k tokens a draw (45k and 47k created behind one path each; 21k and 17k behind one
  shared path). The draws are now TOLD one path, and the containment hook carries a write to it
  out at the draw's own file — rewritten before the guard judges it, so containment is decided
  on the file that will actually be written; reads are untouched (S-2‴) and any other path is
  judged as before. Measured on never-cached slices: one at a time, the second and third draws
  fell from 45k/47k to **30.6k/29.6k** against a cold first draw's 54k; launched together, with
  C-4⁗‴'s wait on the first answer, the two warm draws created **10.6k and 24.1k** against the
  cold one's 46.4k — the stagger's test deferred from C-4⁗‴, passed. What a session is told and
  where its file goes are two facts now, and the prompt carries only the one the cache should.
  *Amended by C-4⁸ (PRDR-294): no session is told another's path, since no launch is batched. The
  backend's support has no caller, and PRDR-298 deletes it.*
  *Amended by C-3⁵ (PRDR-298): the backend's support is deleted.*
  *Amended by C-2¹⁶ (PRDR-304): AUDIT's claim checks are batched, and each is told its own path.*

- **C-4⁗⁵ (3.1.1, PRDR-210).** The wait ends when the first response **begins**, not when its
  first turn completes. C-4⁗‴ listened for the stream's first completed `assistant` message; the
  prompt cache is readable from the moment a response starts, and on the null harness the two
  coincided only because the reviewer's first turn was a three-second tool call. On gate-313's
  fourteen slices the first turn was often a long generation: **three slices waited the full 60 s
  and launched their other draws cold** (s01's draws created 76k, 77k and 41k), three more waited
  27–50 s. A session someone is waiting on now streams its events, and the signal is the first
  `message_start` — the API's first streaming event for a turn — with the completed `assistant`
  frame kept as the signal for a stream that carries no events. Telemetry reads exactly what it
  read: turns are completed turns, never events. Measured on a never-cached slice, launched
  together: the first began its answer after **2 s**, and the two warm draws created 9.4k and
  12.5k against the cold one's 54k. The wait no longer depends on how long the first turn is.
  *Amended by C-4⁸ (PRDR-294): no launch waits on another's first response, since no launch is
  batched. The backend's streaming signal has no caller, and PRDR-298 deletes it.*
  *Amended by C-3⁵ (PRDR-298): the streaming signal is deleted, and no session asks for the
  event stream.*
  *Amended by C-2¹⁶ (PRDR-304): AUDIT's claim checks are batched, and none waits on another's
  first response.*

- **V-1⁗ (3.1.1, PRDR-211).** Before a bound gate runs, the adapter **installs what the work
  directory's manifest declares** — `npm install` for a `package.json` whose install mark is
  absent or older than the manifest or its lockfile — through the gate runner, in the work
  directory, recorded in the ticket journal as its own `install` record. An install that fails
  is a red gate carrying the install's own tail; what the install creates is never part of the
  change set, and the lockfile it produces is. The session's surface does not change: its Bash
  stays `git add` and `git commit` (S-3), and S-2‴'s abstention stands. Found by the first gate
  to run without the hole PRDR-122 closed: at 3.1.0 the guard answered a path-less tool call
  with `allow`, terminal in the SDK's order, so a greenfield bootstrap could run `npm install`
  and did — `detent-n7-310`'s bootstrap commit carries an npm-written lockfile. With the hole
  closed, gate-313's bootstrap wrote a correct scaffold, could not install it, and went
  NEEDS_HUMAN at ticket one with every other ticket blocked behind it. Installing is a property
  of executing a gate, not of implementing a ticket; a session that can run a package manager can
  run whatever a dependency's install script asks, past the hook, and the referee running the
  same command is one process the operator chose, logged, once per work directory. The Stop
  hook's scoped gate now runs where the session works — its worktree since B-2″ — and only after
  the same install there; it used to run in the root, which on gate-313 was `npm test` against a
  tree with no `package.json`.

- **X-4‴ (3.1.1, PRDR-212).** A falsification its author takes back is no falsification, and the
  implementer is told what it can do. The implement prompt said *"run the scoped gate command
  you were given as you work"* to a session whose Bash is `git add` and `git commit` (S-3), and
  never said so; gate-313's bootstrap session tried `npm`, `mkdir`, `rm` and `env`, was refused
  each time, read the wall as the ticket being unimplementable — the prompt's own trigger for the
  signal — wrote the falsified signal, then understood, finished the scaffold, and wrote the
  retraction INTO the signal, since it cannot delete a file. The referee read a file and admitted
  PREMISE_FALSIFIED: prose is not a field. Now the prompt states the surface as it is — files
  inside the surface, the two git verbs, nothing else; gates are the referee's, run after the
  session ends with what the manifest declares installed first, and the Stop hook hands a red
  scoped gate back — and names a refusal as containment working, never evidence about the
  ticket. And the signal can be taken back: `{"retracted": true, "note"}` overwrites it, the
  referee reads that as no signal, records the withdrawal in the ticket's notes and journal, and
  proceeds. Only the boolean `true` retracts; a malformed file remains the standing signal it
  always was, and a standing signal is still X-4's — signal, not failure, the human's to judge.

- **S-3⁗ (3.1.1, PRDR-208).** Symbol intelligence is decided by a **flag**: `detent init
  --symbols` records `enabled: true`, `--no-symbols` records the decline S-3″ honours absolutely,
  and neither leaves the tri-state as it was. S-3″ was right that only a person enables a tool
  that reads a private codebase (D-4, F-2); it left the person one place to say so, a TTY prompt,
  and the runs that matter most have none — the self-build gate (D-16), CI, a background
  launch. Same machine, serena installed and ready: gate-312, interactive, ran with the four read
  tools; gate-313, in the background, planned and ran undecided and sent 80 symbol-level
  couplings to review that code could have checked, until a hand edit of the config before
  `run`. A flag is a person deciding, carried where the prompt cannot go. `--symbols` is honoured
  only when the probe finds the tool — `enabled: true` for a command that cannot run would be
  the silent failure S-3‴ exists to report — so it refuses, names the install command and writes
  nothing; both flags at once are refused before anything runs. The self-build harness passes
  whichever the runner's probe supports, and says which, so the permanent gate carries the
  tooling the host has and its record shows it. Nothing is installed, and the read-only surface
  of an enabled session is unchanged (SEC-3).

- **A-1⁶ (3.1.1, PRDR-206).** The bootstrap ticket **provides the scaffold it creates**. C-4
  has Detent construct the bootstrap in greenfield and block every ticket on it; it declared no
  `provides`, so a ticket consuming `file:package.json` — a file the bootstrap's own description
  promises — was reported as consuming a file no ticket creates, printed at PRESENT under the
  heading that says it was proved by code, and handed to the whole-plan review as
  `already_found` (PRDR-193): a false proof, twice over. gate-313's four contract findings held
  two of them. ANALYZE, which already chooses the stack (D-10), now names the files that stack's
  scaffold creates and later tickets lean on — `stack.scaffold_files`, additive and defaulted to
  none (F-3) — and the bootstrap provides each as a `file` contract. The check resolves a consume
  of one to the bootstrap without deriving an edge every ticket already carries, and reports
  every other file exactly as before: nothing is inferred from a file's name, and an analysis
  that names nothing yields today's findings unchanged. The symbol and test-file findings on
  gate-313 were the plan's, and were right.
  *Amended by D-10′ (PRDR-278): the scaffold files come from DECIDE's stack entry.*
  *Amended by A-1⁸ (PRDR-293): what the check proves is a failure, and no review is handed it.*

- **D-24′ (3.1.1, PRDR-209).** The advice D-24 hands the human is rendered so a human can act
  on it. gate-313's PRESENT printed 144 held findings as one flat list, twice — once at init and
  again at `--approve` — and buried in it were the twenty-six tickets some read called too big
  for a session, the most actionable thing the review found, and which findings had survived a
  paid revision against which were seen in one read and never again, the kind C-4⁗″'s null says
  is mostly noise. A list that long is not read, so the judgement D-24 reserved was not made.
  Every held finding now carries **why** it is held — `seen-once` or `after-revision`, marked
  where the reviews produce them — and PRESENT renders up to a named number inline, each with
  its kind, and above it the totals by tag and by kind, the tickets drawing the most (by distinct
  tags, then count), the plan-wide count, and the path of `.detent/state/advice.md`, where the
  whole list lives grouped the same way with every finding in full. Nothing is dropped, ranked
  away or resolved by the machine: all of it is still the human's, and the file is the proof.
  The number is a constant beside PRDR-119's noise rules, not a knob; `--approve` re-presents
  the same summary, since the wall is in the file.
  *Amended by C-7″ (PRDR-278): the held-finding labels and the advice file are deleted; PRESENT
  shows what survives a revision as risks.*
  *Amended by C-4⁸ (PRDR-294): built. PRESENT lists each blocker and major a slice's read found as
  a risk, since no review reads the revision.*

- **C-3‴ (3.1.1, PRDR-207; renumbered from C-3″ by PRDR-287).** A question is asked **once**. C-3′ batches every stage's
  questions at PRESENT and dedups them on exact text; nothing told a later stage what an
  earlier one had asked. gate-313 asked the founder which npm identity publishes Detent at
  ANALYZE and again, in s14's own words, at PLAN — two paid assumptions, two answers. Now the
  stages that draft are handed `open_questions` — what ANALYZE and the slices before them already
  asked, each with its assumption — and told not to ask any of them again in any words, recording
  a differing assumption where the stage decides instead; the list joins a stage's inputs only
  when non-empty, so a root with no questions gets byte-for-byte the prompt it always got (S-6)
  and reuses every cache (C-8). PRESENT keeps the backstop: two questions whose vocabularies
  overlap past a stated threshold render as one entry naming both ids, so one answer covers
  both — pinned on gate-313's pair, which merges, and on its two other founder questions, both
  beginning "Which …", which do not.
  *Amended by C-3⁗ (PRDR-278): no planning stage asks, so the decision log keeps a question to one
  asking, and `open_questions` goes.*
  *Amended by D-10″ (PRDR-290): ANALYZE is gone, so `open_questions` carries what the slices before
  a draft asked, and SLICE is handed none.*
  *Amended by C-7‴ (PRDR-296): PRESENT's backstop is gone with its question list. The threshold
  stays, DECIDE's, which refuses a question the log already answers.*
  *Amended by C-4⁷ (PRDR-292): no stage is handed `open_questions`, since none asks.*

- **S-3⁵ (3.1.1, PRDR-213).** A write session has **three** git verbs: `git add`, `git rm`
  and `git commit`. Nothing a session had removed a file — Write and Edit create and change,
  and PRDR-212 had already admitted it in passing — so a `scope` finding that named a file was
  one no fix session could act on, while the review-fix prompt says a scope finding "means
  removing work". gate-313's bootstrap spent all three review-fix attempts on a staged probe
  file (PRDR-214): 53 shell calls in the last session alone, every deletion refused, and a
  pathspec-less `git commit` run to test the verb committed the probe by accident. It went to a
  human with $7.56 of the run's $12.85 spent on a deletion nobody had. Now `git rm` is judged by
  the containment hook the way a Write is — per pathspec, resolved, inside the worktree, not
  protected (SEC-3), inside the surface, one refused path refusing the call — and a `git rm`
  the guard cannot read with confidence (no pathspec, `-r`, a glob, pathspec magic, an option
  it does not know, a quoted or compound command) is DENIED, never abstained: S-2‴ abstains on
  a call that names no path, and this one names paths. The options read are `-f`, `-q`,
  `--cached` and `--`. A file the session itself left untracked goes the same way — `git add`
  it, `git rm -f` it — and the four write-role prompts say so. The reading is one module under
  both drivers, since the plugin hook is the same decision in a third skin. No `rm`, no
  `git clean`, no `git reset` or `git restore`: the branch stays append-only under a session;
  the referee owns it.

- **B-5″ (3.1.1, PRDR-214).** The claim settles the **index** before it settles the tree, and
  parking works where the product runs. PRDR-100's settle reads `git ls-files --others`; a path
  a previous generation STAGED and never committed is not "others", so it stayed in the index
  across a requeue — on the change surface of every review, with no verb any session had to
  unstage it. gate-313's bootstrap: generation 0 staged `tmp_check/probe.txt` while probing its
  tools and falsified; generation 1 found it staged at session start, kept it out of its commits
  with `git commit --only`, the reviewer flagged it three times, and the third review-fix
  committed it by accident (PRDR-213). Now, at claim and before parking, every path staged as an
  addition and absent from HEAD is unstaged — `git rm --cached`, the file stays on disk — so it
  becomes the untracked file it is and takes the path parking built: foreign ones move aside,
  owned ones stay for B-5's resume; the `worktree` journal event names what was unstaged. B-5's
  resume reset lists only what HEAD has (`--diff-filter=MDT`): `git diff HEAD` also lists a
  staged addition, and `checkout HEAD --` cannot restore a path HEAD does not have — the reset
  threw, and a resume of such a generation threw with it. And the park root is the worktree's
  OWN git directory (`rev-parse --absolute-git-dir`): under B-2″'s default, `.git` in a linked
  worktree is a file, the park root could not be created, every rename fell into the catch, and
  parking was a silent no-op exactly where the product runs. Per worktree, not the common
  directory — a foreign file in ticket A's tree was written by A's sessions, and B claims in B's
  own tree; a cross-worktree restore has no owner.

- **D-28″ (3.1.1, PRDR-215).** The spawn denial is the **guard's**, for every role, under both
  drivers. D-28 says the hook denies a direct `Task` spawn; the list existed — `Task`, `Agent`,
  `TaskCreate`, by every name the platform has shipped the spawn under — and was published in
  the claim policy the plugin driver's session file carries. The headless hook never read it:
  `guardToolUse` governs where a mutation lands and abstains on a call that names no path
  (S-2‴), a spawn names no path, and the platform grants `Agent` without consulting
  `allowedTools`. gate-313's review-fix sessions #2 and #3 each ran a `general-purpose`
  sub-agent to attempt the deletions they could not make themselves (PRDR-213): twenty assistant
  messages, a dozen tool calls, about 420k input tokens each, outside the parent's `num_turns`
  — what `session_budget` bounds — and outside anything the ledger can attribute. Three things
  D-28 promises were false of those sessions: the counter was avoidable, the spend was
  unattributable, the surface was doubled. Now the guard refuses the three names before it
  judges paths, with D-28's reason, for every role and every policy — write, read-only, init —
  and the list is one exported constant that the kernel's published policy, the plugin hook's
  driver rule and the guard itself all read. Reads and controls of tasks spawn nothing and stay
  the allowlist's. Sub-agents are denied, not metered.

- **V-1⁵ (3.1.1, PRDR-216).** Finalize never names an ignored path. V-1⁗ kept the install out
  of the change set with an exclusion pathspec — `git add -A -- . :!node_modules` — and git
  refuses a pathspec that names an ignored path even as an exclusion: *"The following paths
  are ignored by one of your .gitignore files"*. The fixture that proved V-1⁗ had no
  `.gitignore`; gate-313's bootstrap wrote `node_modules/` into its own, the referee's install
  created the directory, and the first DONE after an install exited 1 with the ticket already
  DONE, its work unmerged (PRDR-217). Now the referee asks git first: an ecosystem directory
  `check-ignore` already ignores is `-A`'s own skip and gets no pathspec; one the project does
  not ignore is excluded by name exactly as before — per directory, since a project may ignore
  some ecosystems and not others. What the referee installed is still never part of the change
  set, and the lockfile still is.

- **B-2‴ (3.1.1, PRDR-217).** A DONE ticket whose finalize did not complete is finalized at the
  next pool. `finalizeDone` runs after the DONE transition — stage, commit, merge the worktree
  into the run branch, remove it — and B-2′ made a merge CONFLICT a breach the driver routes to
  a human. Any other throw in it (gate-313: PRDR-216's `git add`) escaped as exit 1 with the
  ticket DONE, its generation `in_flight`, its branch and worktree intact and its work absent
  from the run branch; `pool()` healed claims and requeued drift and outage victims and never
  looked at a DONE ticket, so the next run's tickets would have built on a run branch without
  the bootstrap's scaffold. D-30 says resume is a referee property; this was the one DONE-side
  state a resume did not see. Now the pool's sweeps include it: DONE with the last generation
  still in flight and a worktree still standing is finalized by the same `finalizeDone` — a
  no-op commit for a clean tree, idempotent for the bootstrap's bindings — then the generation
  closes as done with a kernel note and a `finalize` journal event marked `resumed`. A conflict
  during that finalize closes the generation and the breach stands, which is B-2′'s state; DONE
  and in flight with no worktree is a crash between merge and close, and only the record
  closes; a closed generation with a surviving worktree is a human's and is left alone. Both
  drivers get it, because it lives in `pool()`.

- **V-3″ (3.1.1, PRDR-218).** The bootstrap's baseline is taken from the tree that passed. C-4
  finalizes greenfield's provisional bindings when bootstrap #1's gates pass, by rediscovering
  the tooling the bootstrap created; `finalizeDone` ran that discovery on the ROOT, before the
  merge — and under B-2″'s default worktrees the scaffold is not on the root yet. gate-313
  noted, twice, *"test, lint, typecheck, build stayed provisional — nothing discoverable backs
  them"*, while the 3.1.0 gate, run without worktrees, promoted 4 of 4 at the same moment. The
  cost was V-3 itself: a provisional binding is exempt from drift, rightly, so for the whole
  build no gate command's config region would have been watched. Now rediscovery runs in the
  ticket's WORK DIRECTORY — the tree that passed, whose hashes are the merged result's — and,
  because a root can already carry the aftermath, the pool heals it: a provisional binding
  after the bootstrap ticket is DONE is promoted from the root at the next pool with the same
  note, marked late, exactly as B-2‴ finalizes a stranded ticket. A slot nothing discoverable
  backs stays provisional, as C-4 says. Non-worktree mode is unchanged: its work directory is
  the root.

- **X-1⁶ (3.1.1, PRDR-219).** The breaker's mark is read from the file at every launch, as the
  ledger is (X-1⁷). X-1⁵'s mark — spend at the last completed unit — lives in `progress.json`,
  written by `noteUnitComplete` from wherever work completes: a slice checkpoint in `init`, the
  DONE finalize in the run. The ledger read it once, in its constructor. `init` builds a
  ledger per session launch and so always saw a fresh mark, and PRDR-191's proof ran on that
  shape; the run builds ONE ledger in its referee context, and every ticket that reached DONE
  after that moved a file the instance never read again. gate-313, take 4: the run's ledger
  was built at 08:04:32 with the mark init had left, $228.51; the bootstrap was finalized two
  seconds later and t-s01-001 reached DONE at 08:12:19, the file recording $278.31 and a unit
  cost of $1.56; at 08:26:33 the instance measured $281.27 − $228.51 = $52.76 against $52.09
  and halted a working run on its second ticket, taking two freshly claimed tickets with it.
  Now the launch gate re-reads the mark and adopts it when it has moved, deriving the
  threshold from the unit cost it carries; memory never runs ahead of the file, and a file
  that cannot be read leaves the memory value in force.

- **S-3⁶ (3.1.1, PRDR-220).** The symbol server opens nothing on the operator's machine. Serena's
  machine config ships with its web dashboard on and set to open a browser window at launch,
  and Detent's launch never said otherwise — so every session that had a symbol server, one per
  write-role launch when symbols are on, left a tab in the operator's browser. Now the launch
  passes `--enable-web-dashboard false --enable-gui-log-window false`, two flags PRDR-198's own
  inventory of `start-mcp-server` already listed, read from the pinned tool's `--help` by the
  test where the tool is installed. D-4 holds: Detent edits nothing under `~/.serena`; it
  declines, per launch, a window it never wanted. Symbol intelligence — its tools, its read-only
  surface, its pin — is unchanged.

- **S-3⁷ (3.1.1, PRDR-221).** A symbol server is on the tool list and the session is told it is
  there. S-3⁸ attached Serena to every write-role and read-only-role session of a root with
  symbols on; the platform defers MCP tools behind tool search by default, so its eighteen
  tools reached a session only as names in a deferred-tools delta — callable after a search,
  never before — and no prompt said they existed. gate-313 measured it: 113 sessions with a
  server, zero tool searches, zero Serena calls, a language-server initialisation per session
  for a capability nobody was introduced to. Now the server config asks the SDK never to defer
  this server's tools (`alwaysLoad`, the API's `defer_loading: false`), so the four read tools
  are on the turn-one list with their descriptions; and when the server is ready the variable
  inputs carry `symbol_tools` — the four callable names — while every role that receives the
  server is told what they are for: a symbol's definition, its references, its implementations
  and a file's symbol overview, before grep, and absent when the field is. A root without
  symbols keeps a byte-identical prefix and variable (S-6). The surface does not widen: the
  editing and memory tools stay refused (S-3⁸), and symbols stay the operator's flag (S-3⁗).
  The next tickets are the measurement.

- **S-3⁷′ (3.1.1, PRDR-222).** The session is told where the symbol server's boundary is. S-3⁷
  put all eighteen of the server's tools on the turn-one list — the stdio config has no
  per-tool policy — each with Serena's own description, and those descriptions recommend a
  workflow: check onboarding, read memories, list the directory. gate-313's first session after
  S-3⁷ did what the nearest text said: its first two Serena calls were the onboarding check and
  the directory listing, both refused by the allowlist, two turns before the first granted
  tool, and sessions are fresh (P1) so it repeats per session. Now the same sentence that names
  the four tools says only those are granted and the server's other tools — onboarding,
  memories, directory listing, editing — are refused and must not be called. Nothing is
  granted that was not: memory is cross-session state Detent does not control (C-8, S-6), and
  listing and reading are the session's own tools' job.

- **S-3⁷″ (3.1.1, PRDR-223).** The symbol server exposes exactly what is granted. S-3⁷ put
  the server's tools on the turn-one list; S-3⁷′ told the session which were granted. The first
  session launched with that sentence still opened with `check_onboarding_performed`, refused,
  as every gate-313 session before it had: Serena describes that tool as the one to call before
  beginning work, and a model weighs the description beside a tool above a sentence read
  earlier. Twenty-one of the twenty-four listed tools were ones Detent refuses. Serena's
  `--context` accepts a path to a custom context YAML whose `excluded_tools` removes tools from
  the MCP surface itself, so Detent now writes its own context under the root's local state
  before every launch and passes it: every tool of the pinned inventory is excluded but
  `find_symbol`, `find_referencing_symbols` and `get_symbols_overview`, with a two-line prompt
  on how to use them. Observed live: *"excluded 21 tools … Number of exposed tools: 3"*. And
  the read set is three, not four: `find_implementations`, allowlisted since PRDR-121 and named
  to sessions since S-3⁷, is not a tool the pinned Serena has — the test now reads `serena
  tools list` where the tool is installed. The S-3⁷′ sentence shrinks to what stays true: the
  listed tools are the server's whole surface. Nothing under `~/.serena` is touched (D-4).

- **X-4⁴ (3.1.1, PRDR-224).** The fix roles are told the two signal shapes the implementer is
  told. Every write-role session is handed `surface_request_out` and `falsified_out`; PRDR-073
  documented the request's shape and PRDR-212 the falsification's, both in the implementer's
  prompt only. gate-313's t-s01-004 review-fix sessions, facing a criterion that names
  `.detent/bindings.json` — immutable to sessions under SEC-3's structural floor, so never
  grantable — guessed a request shape, `{"requested_paths": […], "reason": …}`, and were refused
  twice for naming no path, then spent a third round the same way and went to a human over a
  file no request could have opened. Now blind-fix, informed-fix and review-fix carry one
  sentence: the request is `{"path", "justification"}` at `surface_request_out`, ruled on after
  the session; a criterion that cannot be met as specified is `{"note"}` at `falsified_out`; and
  a protected path is a falsification, not a request. What is grantable does not change.

- **X-4⁵ (3.1.1, PRDR-225).** A signal is cleared before a fresh launch, so the referee never
  reads one no session in this generation wrote. PRDR-072 clears a stale ARTIFACT before every
  launch — a refused reviewer once replayed the previous verdict live — but the signal files a
  session writes were not cleared. `falsified.json` is consumed only after an IN_PROGRESS
  session (X-3 admits a falsification mid-implementation alone), so one written in any other
  stage is never consumed and simply stays. gate-313's t-s01-004: a generation 0 review-fix
  session wrote `falsified.json` (the wrong stage, not even the documented shape); it survived a
  requeue; generation 1's implementer wrote nothing, and the referee admitted PREMISE_FALSIFIED
  against it — NEEDS_HUMAN on a signal with no author in that generation. Now the referee
  removes `falsified.json` and `surface_request.json` at the same seam it removes the artifact,
  after the B-5 crash-resume skip (so a genuinely in-flight session's signal is kept, as its
  artifact is). `oversized.json` is deliberately NOT cleared: it is cross-run evidence
  `sizing-evidence` reads for a later PLAN of the same documents (X-4″), and its own stale-consume
  re-lands a requeued oversized ticket at NEEDS_HUMAN rather than passing silently.
  *Amended by X-3′ (PRDR-278): the signal is read after a session in IN_PROGRESS or in any fix
  state.*

- **X-4⁶ (3.1.1, PRDR-277).** A premise that failed for want of a toolchain is re-tested once the
  toolchain is installed. PRDR-274 and PRDR-276 bounded D-4/F-2 for a REQUIRED toolchain: `run`
  probes the executable behind every bound gate before its first session, and installs a missing
  one from Detent's own table only on the operator's answer — a terminal's `[y/N]`, or
  `--install-toolchain` relayed (`docs/plan-contracts-and-symbols.md` §3.3). ksar-cloud's first
  ticket had already falsified for want of Go, and every other ticket waited on it, so the
  install alone left a run that installed Go and exited 10. Now the same question names each
  ticket in NEEDS_HUMAN whose last word is still the kernel's X-4 note — no person has touched it
  since — with its premise in the session's words, and a yes returns each through
  `HUMAN_REQUEUE`, the install as its consent, in a fresh generation, at the pool's first draw.
  The run moves on to it. The requeue is a human act because the human was shown it, as V-3's
  sweep records `verify sync`. Nothing parses the premise: a premise still false is falsified
  again, and with the toolchain present the next run installs and returns nothing. No install,
  no return; a leftover escalation with nothing installed is still `detent requeue`'s.

- **V-3‴ (3.1.1, PRDR-226).** Drift is judged against the baseline a ticket's tree BRANCHED FROM,
  and a verification change is accepted per ticket. Under B-2″'s worktrees a granted change to a
  gate's config region lives on the ticket's branch until the merge, and the run branch's
  `.detent/` is not tracked — so judging that tree against the ROOT's baseline halted the run,
  and the only sanctioned recovery, `verify sync` on the root, found nothing to re-baseline and
  requeued the ticket into the same halt. gate-313, take 9: t-s01-018 was granted `package.json`,
  changed `scripts.lint` to add a rules check, and exited 2 on a loop no operator could break.
  Now the gate arm judges a worktree against the hashes it started from (recorded once at branch
  creation under the ticket's runs directory) plus any an operator accepted for it; the halt
  names `detent verify sync <root> --ticket <id>`, which judges the ticket's own tree, executes
  its bound gates (V-1, never an unexecuted acceptance), records the accepted hashes and requeues
  it; and the ticket's merge carries the change while `finalizeDone` re-baselines the root from
  the merged tree and consumes the acceptance. Non-worktree mode is unchanged: the tree is the
  root, `verify sync` on the root is the recovery, and the base is read straight from the root.
  SEC-5 holds — a session writes none of these files (SEC-3's structural floor plus the runs
  directory being off every surface), so only an operator's executed re-baseline makes a changed
  tree agree with itself.

- **C-9″ (3.1.1, PRDR-227).** A kernel surface grant leaves the approval valid. C-9‴ checks
  the approval's hash at every run start over the fields the human was shown; PRDR-153 anchored
  it to the tickets the plan named so the run's own bookkeeping cannot stale it. A grant
  (PRDR-073, SEC-3's lever) appended the granted path to `surface`, an approved field, so the
  first restart after a grant refused: gate-313, take 10, exit 2 one second after launch on
  t-s01-018's granted `package.json`, with the justification on the record and nobody having
  edited the plan. Now the grant is a field: `granted` carries what the kernel added, `surface`
  stays the effective surface every reader uses, and the approved projection hashes `surface`
  minus `granted` — the surface as planned. An edit to any approved field still stales the
  approval, and the cap of three grants and the SEC-3 floor stand. A root granted before this
  landed carries the grant as a note only; its approval is stale once and `detent init
  --approve` re-stamps it.

- **F-1″ (3.1.1, PRDR-228).** The local set never travels, whichever path wrote into it. A
  session is told an absolute artifact path under the root's `.detent/runs/<ticket>/`, and B-2″
  admits that directory as `artifactRoot`; the policy ALSO listed `.detent/runs/**` in the
  surface, which resolves against the WORK ROOT — the worktree, under B-2″'s default — so a
  session's write to its worktree-relative runs path was admitted, finalize's `git add -A`
  staged it, and `t-s01-007: finalize` merged `.detent/runs/t-s01-007/blind_fix.json` into
  gate-313's run branch: run state in every later worktree and in the product a reader would
  clone. A tree whose `.detent/` is untracked, gate-313's, has no `.detent/.gitignore` to hide
  it. Now the surface admits the artifact root and nothing else of `.detent/` (S-1′ unchanged:
  the told path stays writable), and finalize excludes every F-1 local entry by name — `runs`,
  `state`, `claims`, `worktrees`, `logs`, the ledger, the transitions and the hook files — the
  way it excludes an install directory, asking git first (V-1⁵). Non-worktree mode is
  unchanged: the artifact root is the same directory both ways.

- **S-3⁷‴ (3.1.1, PRDR-229).** The symbol server is started on the session's work directory.
  `symbolServer()` built its config from the root; before B-2″ the root was the tree, and since
  PRDR-145b the session works in a per-ticket worktree — so every Serena process gate-313
  launched indexed the run branch checkout while the session edited its worktree: a symbol the
  session had just added was "not defined", and the callers of a function it was changing were
  the last merge's. Now the server's `--project` is the work directory, the tree the session
  edits, uncommitted work included; Detent's context file stays under the root's local state,
  since it is Detent's; and Serena's own project directory, which lands in the worktree once
  the server is started there, joins the paths finalize never stages, beside F-1's local set.
  Non-worktree mode is unchanged: the work directory is the root.

- **V-3⁗ (3.1.1, PRDR-230).** The baseline a ticket's tree is judged against is a COMMIT, and
  the record accepting a change is beyond every session's reach. V-3‴ gave each ticket a stored
  hash, written once at first claim from the root's current bindings. It was wrong twice: it
  holds whatever the root held at the instant of writing, and its write-once guard keys on a
  file that did not exist for worktrees cut before it shipped — so on gate-313 it was written
  late, against a root that had already accepted another ticket's lint change, and t-s01-003 was
  BLOCKED for a change the run branch made. Its tree and its fork both carried `eslint .`, and
  its own commits touched only its two source files; three further worktrees were primed to fail
  identically. Now the base is `git merge-base HEAD <run branch>`, computed in the work
  directory at check time: derivable by any build at any time, naming a tree nothing can edit,
  immune to a late write — and verified equal to the long-standing `claim_base.json` sha on all
  four live worktrees. The fork's configuration is read by materialising that commit's
  root-level markers into a scratch directory and running the ORDINARY discovery over them, so
  one implementation produces both sides of a region-level comparison; a fork that cannot be
  resolved, or that defines no candidate for a bound slot, falls back to the check against the
  root's approved binding, never to a weaker answer. Capturing the base by discovering in the
  tree at first claim was considered and refused as a real SEC-5 hole: that base comes from a
  directory the session writes, and it coincides with the branch point only in the case that
  never needed fixing. And the acceptance record moves from `.detent/runs/<id>/` — the session's
  own `artifactRoot`, which the containment guard admits for mutation — to `.detent/state/`,
  because a session that weakens its gate must not be able to sign the acceptance of the
  weakening; observed answering `allow` under the production policy before the move. A tree
  still runs the gate definitions it was cut with, which this records rather than hides.

- **V-1⁶ (3.1.1, PRDR-232; renumbered from V-1⁵ by PRDR-287).** The referee runs nothing the judged tree DECLARES, and installs
  only with the project's own package manager. V-1⁗ has the referee install a work directory's
  dependencies before its gates run, with `npm install` — in a tree a session has just written,
  and npm runs that manifest's `preinstall`, `install`, `postinstall` and `prepare`. Everything
  else a session does passes the D-21 hook; this did not, so a session whose surface includes
  `package.json` could have arbitrary shell executed by the referee's own process. The drift
  check cannot see it: those names appear in no adapter's rules, so they bind no gate and have
  no config region. A second, cheaper hop was found the same day: `npm run <gate>` runs that
  script's `pre` and `post` siblings, on EVERY gate evaluation, equally unbound and equally
  unseen. Suppression therefore rides the ENVIRONMENT — `npm_config_ignore_scripts` in the gate
  runner's `CI_ENV` — and not the command string, which is what makes it safe to land mid-run:
  appending a flag to a bound command would move `resolved`, which `checkBinding` compares for
  every status, and folding sibling bodies into the region would move every `config_hash`;
  either re-blocks every ticket in flight. This moves neither. Measured: the variable suppresses
  both hops, still runs the named script, and beats a project `.npmrc` setting
  `ignore-scripts=false`. An operator who needs a project's install to build exports
  `DETENT_ALLOW_LIFECYCLE_SCRIPTS=1` for the run; a session cannot, because it does not compose
  the referee's environment, and per-project per-script approval is PRDR-233. Second: an
  ecosystem row declares the package managers it may install for, and the npm row is npm's and
  greenfield's alone. Run in a pnpm or yarn project it wrote `package-lock.json`, which
  `PM_BY_LOCKFILE` reads first, so the referee's own install flipped the discovered package
  manager, moved every bound command's `resolved`, and blocked a ticket that had changed nothing
  — measured as `pnpm run test` before the install and `npm run test` after. A row that is not
  the project's installs nothing and the outcome names the manager it saw.

- **V-3⁵ (3.1.1, PRDR-231).** A configuration is a baseline only if it was EXECUTED and approved.
  V-3⁗ judges a ticket's tree against the config at its fork commit and adopted whatever that
  commit carried. Because worktrees are the default and the gate arm is the only production drift
  assertion, that left `.detent/bindings.json` with no enforcement role for any slot a fork
  defines: the safety argument was an induction — config reaches the run branch only through a
  ticket whose own change was blocked and accepted — and an induction is not a control. A
  configuration arriving by any other path was adopted silently by every worktree cut after it,
  and PRDR-232 was one such path. Now every approved binding is recorded in an append-only
  `state/approvals.jsonl`, written at the ONE funnel every mint route passes through
  (`writeBindings`), so init's binding, both `verify sync` paths, C-4's bootstrap promotion and
  the merge-time re-baseline all record without an optional dependency any of them could forget;
  an operator's per-ticket acceptance records where its gates actually ran. A hash that is not
  recorded is not admissible as a baseline: it drops out, the root's approved binding decides,
  and the outcome is an ordinary `drifted` check flowing through the halt message and the
  `--ticket` verb that already exist — no new status, no new halt path, and the remedy an
  operator is told to run is one that already works. **The migration is bounded and stated:** a
  root that predates the ledger is seeded once with what it has BEEN EXECUTING — its own approved
  bindings and the configuration every standing worktree was cut with, both read from places a
  session cannot forge (the bindings file, and run-branch commits reached by merge-base). The
  seed admits nothing new; it records the status quo so an upgrade mid-run halts nothing, and
  every root created after this is strict from its first binding. Verified on the halted gate
  root: seeded 16 rows, no standing worktree halts, and both lint hashes are recorded — the
  root's current one and the older one its standing worktrees were cut with.

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
  *Amended by C-3⁗ (PRDR-278): questions are asked at DECIDE, before planning; AWAIT_INFO may also
  be raised at DECIDE and at VALIDATE; init's research is AUDIT's (C-2⁶).*
  *Amended by C-4⁷ (PRDR-292): SLICE's and PLAN's artifacts have no questions, so none reaches
  PRESENT.*
  *Amended by C-7‴ (PRDR-296): PRESENT lists no question and raises AWAIT_INFO for none; the
  `blocking` count is gone from `presentation.json`.*

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

**The specification phase, and planning on its pack (3.1.1, PRDR-278).** The rules from C-2⁶ to
N-7′ below, with D-31 to D-33 in the decision log, were recorded on 2026-09-26, before any code,
as N-6 requires. They carry the operator's decisions of that day: sixteen for the specification
phase, in `docs/plan-specification-phase.md` §2 and cited here as *specification decision n*, and
ten for the planning phase, in `docs/plan-planning-redesign.md` §2 and cited as *planning
decision n*. PRDR-279 to PRDR-286, PRDR-289 and PRDR-290 to PRDR-298 build them; until each lands,
the code does what the rules it amends describe, and each of those rules points here.

- **C-2⁶ (3.1.1, PRDR-278).** `init` judges the documents before it plans from them. Four phases run
  between DISCOVER and DETERMINE_VERIFICATION and turn the discovered documents into a validated
  pack (C-2⁷). They are phases of `init`, not a command of their own (specification decision 1),
  so C-14′'s two commands stand. Nothing judged the documents before: a contradiction, a wrong
  external fact or a rule that is consistent but wrong reached a ticket as an assumption, and a
  session that implemented it literally shipped it with green gates, its tests written from the
  same criteria.
  - **AUDIT** reads the discovered documents and, in an existing project, the code, and checks
    the documents against it: a document that states as built what the code does not do is a
    finding. It reads dependency sources at their pinned versions and reaches the web to check
    every external claim against a primary source. It writes its checkpoint: contradictions, each
    with both passages quoted at their `file:line`; gaps; and external claims, each with its
    source and a verdict, confirmed, wrong or unverified. An unverified claim is never recorded
    as a fact. It never stops. This is the init-time research D-11 names, now done for every
    external claim rather than when a stage asks: C-3a's research leaves ANALYZE and PLAN, its
    engine and brief format (PRDR-262/264) move into AUDIT, and its pool,
    `planning_research_tool_calls`, keeps its name and is counted and reported against AUDIT's
    research. It is never told to a session as a share to stay within: nothing in the phase is
    capped (specification decision 16), and a share a session is told caps how much it checks.
    Its checkpoint is keyed by the documents and the code, never by the decision log.
  - **DECIDE** reads AUDIT's checkpoint and writes the decision log, `docs/founder-decisions.md`:
    each question asked, as `D-n`, and each gap settled as a vetoable default, as `X-n`, each
    with its value and its reason. It stops once, on a TTY, for the questions C-3⁗ lets it ask,
    and off a TTY it never stops. In greenfield it also records the stack (D-10′).
  - **WRITE** reads the documents, AUDIT's checkpoint and the decision log, and writes the pack in
    C-2⁷'s schema, citing each decision and default by id where the pack relies on it. It moves
    the originals to `archive/`, outside every discovery glob, and deletes nothing. It never
    stops.
  - **VALIDATE** reads the pack. It runs the checker first (C-2⁷), and a red checker is fixed
    before any review round starts. Each round then runs one reviewer per area of the pack; each
    finding carries its severity (blocker, major or minor), its `file:line`, a quote and the
    exact fix. A writer applies the round's findings, and the next round verifies those fixes and
    hunts for the defects they introduced. A round with no blocker and no major ends the loop,
    and its minor findings are fixed without another round (specification decision 3).
    `spec_validation_rounds`, a new X-1 ceiling with scope `init`, default 8 (specification
    decision 13), bounds the loop as a ceiling, never a retry: ksarjs converged in its seventh
    round, and a ceiling of 6 would have stopped on round 6's three majors, fixed and never
    verified. At the ceiling the last round's majors reach PRESENT as recorded risks and planning
    goes on, while a blocker stops `init` here with AWAIT_INFO, because a plan built on an
    unverified fix to a blocker can be wrong everywhere; `detent init` resumes VALIDATE once the
    operator settles it. A pack that states invariants, a ledger's or a state machine's, gets a
    reviewer that writes and runs a randomized simulation in a sandboxed scratch directory
    (S-1‴, specification decision 7); it reports and never edits. VALIDATE writes the
    conformance record (C-2⁷) and, for the phases after it, the checker's parse of the pack. It
    stops only at the ceiling, and only for a blocker.
  - **A conforming pack** goes through the checker only: AUDIT, DECIDE and WRITE are skipped,
    VALIDATE runs the checker, and `init` goes on to DETERMINE_VERIFICATION (specification
    decision 6).
  - **No switch.** Nothing skips the phase for documents that do not conform (specification
    decision 10). A switch is easy to add later if run-time outcomes show a need (D-33); taking
    one away would break whoever relied on it.
  - **No second DISCOVER.** Checkpoints are keyed by phase name (F-4), so DISCOVER cannot run
    twice. WRITE moves the originals out of every discovery glob, and VALIDATE ends by discovering
    the pack with DISCOVER's recorded patterns (PRDR-166) and handing the checker's parse of it to
    the phases after it. A later `detent init` finds the conforming pack at DISCOVER.
  - **Sessions and spend.** Every session of the four phases is an init launch under P6′: metered,
    on the ledger against ticket `init`, and journaled. Each completed phase and each completed
    round is a progress mark for X-1⁵'s breaker, as a slice's checkpoint is; without them the
    breaker, which counts sessions before the first unit completes, would announce throughout a
    healthy specification phase. Each phase's spend is reported beside planning's, in PRESENT
    and in `detent status`, and is never capped (specification decision 16). The phase names and
    every artifact the phases write are persisted shapes under F-3.
  *Amended by C-2⁹ (PRDR-279): WRITE archives the originals it rewrote into the pack and leaves
  context documents where they are.*
  *Amended by C-2¹¹ (PRDR-281): AUDIT is built. A changed pack is not audited, and AUDIT's
  checkpoint stands outside C-8's chain.*
  *Amended by C-2¹² (PRDR-282): DECIDE is built, outside C-8's chain beside AUDIT. On a TTY its
  questions are asked inline, and AWAIT_INFO is raised there when the founder answers later.*
  *Amended by C-2¹³ (PRDR-283): WRITE is built, and restarts C-8's chain. Until VALIDATE is built,
  WRITE hands the pack to the phases after it, and a later `detent init` finds it at DISCOVER as
  a pack WRITE wrote, not a conforming one.*
  *Amended by C-2¹⁴ (PRDR-284): VALIDATE is built, and hands the pack to the phases after it.
  Its simulating reviewer is not: no reviewer runs a simulation until PRDR-285 builds the
  sandbox. A red checker its writer cannot make green stops `init` at VALIDATE too.*
  *Amended by S-1⁗ (PRDR-285): the simulating reviewer is built, on macOS: each reviewer of a round
  may simulate, and where the machine has no sandbox each round says why none can.*
  *Amended by C-3⁵ (PRDR-298): planning research is deleted. AUDIT keeps what it shared with it:
  the one relaunch, X-6a's local search before the web, and `EXTERNAL_TIER`.*

- **C-2⁷ (3.1.1, PRDR-278).** The pack has a fixed schema, a committed conformance record and a
  deterministic checker (specification decision 4), so that `init` and the operator can tell a
  document set that was specified and validated from a raw PRD.
  - **Layout and precedence.** `docs/founder-decisions.md` holds decisions and defaults;
    `docs/research/verified-facts.md` holds external facts, each with an id, its source and a tag,
    `source-read`, `doc` or `unverified`; `docs/design/` holds architecture and cross-cutting
    design; `docs/adr/` holds decision records; `docs/prd/` holds the code registry, the
    milestones and the module requirements; and `archive/` holds the originals, outside every
    discovery glob. Precedence runs decisions, facts, design, ADRs, PRDs: a disagreement is a
    defect in the lower document, and the fix lands there.
  - **Requirements.** Ids are `<CODE>-F-<nnn>` for functional requirements and `<CODE>-N-<nnn>`
    for non-functional ones, each code registered in the index and each id tagged with a
    milestone, `[M0]`, `[M1]`, and so on. Requirements use MUST and SHOULD and never state unbuilt
    behaviour in the present indicative: that is the doc-claim drift PRDR-263 names, caught where
    claims are born. Every requirement is tested by at least one acceptance criterion, in
    Given / When / Then with exact values, and every criterion names the requirements it tests.
    An `[Mk]` requirement never depends on an `[Mj]` with `j > k`. Catalogues of error codes,
    events, settings, jobs and routes are optional, and checked when present. In greenfield the
    decision log carries the stack (D-10′), and a pack may declare its packages and their gate
    commands (V-5′).
  - **The conformance record** is committed beside the pack. It holds the schema version, a hash
    of the pack's documents excluding the record, the checker's result, every validation round
    with its counts by severity and the findings it left open, and the date. A pack conforms when
    its hash matches its documents and the checker is green. A pack whose documents no longer
    match is re-validated for the change only, the checker and then rounds scoped to the changed
    documents and whatever cites them, under C-2⁶'s stop rule, and `init` names the documents
    that changed. An edit never re-runs the whole phase, and a pack is never treated as a raw PRD.
  - **The checker** is deterministic: no model, no network and no clock, byte-identical output for
    the same pack, and each finding naming its rule, its `file:line` and the offending text. It
    is a referee gate that both drivers reach the same way (ARCH-2). Its rules: every id is
    defined exactly once; every reference to a requirement, criterion, decision, fact or section
    resolves; every error code, event, setting, job and route a PRD uses is in its catalogue,
    when the pack has one; every requirement has a criterion, and no criterion names an unknown
    requirement; milestone order holds; and, as a heuristic that reports to VALIDATE's reviewers
    and never blocks, present-indicative claims about unbuilt behaviour. Like
    `scripts/check-tickets.ts`, it prints what it does not check, so a green result is not read
    as a review. It runs at VALIDATE and on every amendment (X-4⁷), and a red checker blocks
    every phase after VALIDATE. Its first rule earned its place on this document: until PRDR-287
    and PRDR-288, nine marks here each named more than one rule.
  *Amended by C-2⁹ (PRDR-279): the record is `docs/conformance.json`; a document outside the
  layout's paths is context, hashed with the pack and never parsed.*
  *Amended by C-2¹⁰ (PRDR-280): the checker is built; milestone order is checked between a
  criterion and the requirements it tests, and the heuristic reads requirements only.*
  *Amended by C-2¹³ (PRDR-283): the record says whether VALIDATE finished on the pack
  (`validated`), and WRITE writes it not validated. Until VALIDATE is built, a red checker blocks
  nothing.*
  *Amended by C-2¹⁴ (PRDR-284): a red checker blocks every phase after VALIDATE. A change's
  re-validation also reviews what the last validation left open, and reads a changed decision
  log or facts file as reaching every document that cites an entry of it.*

- **C-3⁗ (3.1.1, PRDR-278).** Questions move to DECIDE, before anything is planned. C-3′ asked the
  one batch at PRESENT, after the whole plan was drafted on assumptions, so a decision counted in
  money or contracts had every slice resting on it drafted, reviewed and cached before the founder
  saw it. C-3′ is amended, not contradicted: planning still never stops for a question an
  assumption can carry, and no planning stage asks at all (C-4⁵).
  - **What is asked.** Only C-3″'s class (PRDR-119), a decision counted in money or contracts
    rather than in code (specification decision 2). Everything else is settled as a vetoable
    default, `X-n`, with its value and its reason; that is where C-3″'s settled decisions are now
    recorded, in place of a ticket's description, a slice's rationale or the analysis's
    assumptions.
  - **Where AWAIT_INFO is raised.** At DECIDE, on a TTY, for those questions, in screens of at most
    four; each lists its recommended option first, each option states its consequence, and the
    answers become `D-n` entries with the question, the answer and the reason. That is the one
    early stop (specification decision 5). At VALIDATE, for a blocker left at the ceiling
    (C-2⁶). And at PRESENT, for what blocks approval (C-7″). `INTERRUPT_PHASE` records every
    phase AWAIT_INFO may be raised at.
  - **The five stay five.** Both new stops raise AWAIT_INFO, the decision class C-3′ already
    presents, a question the documents cannot answer, so C-5's closed set holds. A sixth
    interrupt was considered and refused: it would be a new decision class, which C-14′ makes a
    major-version decision.
  - **Off a TTY** DECIDE never stops. It takes every recommended answer, logs each as a vetoable
    `X-n`, and says so in `init`'s output (specification decision 9).
  - **Asked once.** A question the decision log already answers is never asked again, in any
    words. The log does for every stage what C-3‴'s `open_questions` did for the stages after
    ANALYZE, since no later stage asks; `open_questions` and PRESENT's merge of near-duplicate
    questions go with the rest of the question machinery (PRDR-298).
  - **Vetoes.** PRESENT lists every `X-n`, marked vetoable, where C-3′ listed the assumptions the
    plan proceeded on. An answer or a veto is an edit to the decision log: the next `detent init`
    replays from DECIDE forward (C-8), never re-runs AUDIT, and re-plans only the slices whose
    inputs changed.
  *Amended by C-2¹² (PRDR-282): DECIDE is built. Every slice reads the decision log until C-2⁸
  keys slices by their requirement ids, so for now a veto re-plans every slice.*
  *Amended by C-2¹⁴ (PRDR-284): AWAIT_INFO at VALIDATE is built, for a blocker left at the
  ceiling and for a pack checker VALIDATE's writer cannot make green.*
  *Amended by C-2¹⁵ (PRDR-291): on a pack a veto re-plans the slices whose requirements cite the
  entry it edits, and every slice where it edits the stack's entry.*
  *Amended by C-7‴ (PRDR-296): PRESENT's merge of near-duplicate questions is gone, with its
  question list, and PRESENT lists every `D-n` before the `X-n`.*
  *Amended by C-3⁵ (PRDR-298): built. `similarQuestions` is DECIDE's own, in
  `src/init/decide-items.ts`, and the rest of the question machinery is gone.*

- **C-3⁵ (3.1.1, PRDR-298).** What the planning redesign replaced is deleted, and what the
  planning audit found describing more than the code does now says what it does. This settles
  what C-3⁗, D-10″, C-4⁷ and C-4⁸ left to this ticket, and amends C-3a and D-11, C-6 and C-6a
  with SEC-1 and D-15, X-6's closing sentence, F-1's committed set, S-6′, C-4⁗⁵, C-2⁶'s and
  C-2¹¹'s research, and C-7‴'s `questions.ts`.
  - **Planning research** (C-3a) is gone: `src/init/plan-research.ts`, the brief schema only it
    read, with the two refinements only that schema used, the research prompt's planning arm,
    and an init launch's switch to the research role's tools, which nothing set. No phase had
    launched it since D-10″. D-11's init-time research is AUDIT's claim checks (C-2⁶). The
    research role stays, since `run` launches it for a failing ticket (X-6), and its prompt
    answers that alone; X-6's note that planning research shares X-6a and S-3 names nothing now.
    AUDIT keeps what it shared: `withOneRelaunch`, X-6a's rule that a brief citing a page first
    searched locally, and `EXTERNAL_TIER`. `research/planning` leaves the layout, so nothing
    writes it. An older root's briefs there stay committed, since `.detent/.gitignore` lists only
    the local set, and nothing reads them. `planning_research_tool_calls` keeps its name and
    counts AUDIT's claim checks alone (C-2¹¹); no question joins a batch at its ceiling, since
    none is asked.
  - **Questions** are DECIDE's. `similarQuestions`, all that was left of `questions.ts`, is in
    `src/init/decide-items.ts` beside the DECIDE code that uses it, and the file is gone. DISCOVER
    no longer records `patterns_searched`, whose one reader was PRESENT's answer instruction,
    deleted with the question list (C-7‴).
  - **Setup consent.** `src/init/consent.ts` and `src/init/allowlist.ts`, which T-065 built for
    C-6 and C-6a, are deleted, with `bootstrapBlocks` and `planPath` in `src/init/plan.ts` and the
    tests that were their only callers. No path reached them, so no operator was ever offered a
    setup command. Detent runs none, `git init` included. AWAIT_SETUP_CONSENT is raised where it
    was (C-3b, D-10″) and says so, and the human answers it by establishing the tooling and
    re-invoking. In greenfield the bootstrap ticket establishes it as code under review (C-4), as
    before. Of C-6's configuration rule, that Detent never modifies an existing configuration
    file holds; the brownfield files it would create and C-6a's allowlisted installs are not
    built. SEC-1 has no consent to log, and D-15's rule that nothing off the list runs covers
    every command. `detent init` outside a repository says to run `git init`.
  - **The backend** loses what C-4⁸ left without a caller: S-6′'s told path and the guard's
    redirect of a write to it, C-4⁗⁵'s first-response signal and the event stream it asked for,
    and the two fields on a session's spec that set them. A session's turns are still its
    completed `assistant` frames (PRDR-072). `scripts/plan-corpus.ts` reads no ledger.
  - **Doc-blocks.** A launch's spend is read against X-1's advisory total and the no-progress
    breaker, which announce and refuse nothing (PRDR-265), where `session.ts` and
    `plan-slices.ts` still described a gate. `withOneRelaunch` names its callers, and a second
    refusal is its caller's to act on: AUDIT records the claim unverified and goes on, where the
    note said the phase fails. The symbol reminder says symbol tools reach the sessions
    `detent run` launches, and never planning's. `contracts.ts` no longer counts four tickets
    editing one file among its checks: tickets that write one file declare no contract, and
    only two that both provide it are caught. `readPresentation` returns null for a file that
    does not parse, as its doc-block said, where it threw.
  - **Size.** `src/init` held 68 files, 12,281 lines and 7,895 code lines at PRDR-297, and holds
    64, 11,566 and 7,537.
  - **Migration.** None. A DISCOVER checkpoint an earlier build wrote holds `patterns_searched`,
    which nothing reads, and its key does not move.

- **D-10′ (3.1.1, PRDR-278).** ANALYZE is folded into DECIDE, and D-10's order names DECIDE where it
  named ANALYZE: DISCOVER → AUDIT → DECIDE → WRITE → VALIDATE → DETERMINE_VERIFICATION → SLICE →
  PLAN (planning decision 5). D-10's reason holds: nothing binds before a stack exists, and the
  stack now exists after DECIDE, which still precedes DETERMINE_VERIFICATION. Unambiguous bindings
  still auto-accept (C-3b). ANALYZE handed the later phases three things, and each has a new home:
  - `greenfield` is computed by code from the stack markers, as `isGreenfield` already does, and
    reaches DETERMINE_VERIFICATION, SLICE and PLAN without a model session;
  - in greenfield the stack is a decision. DECIDE records it, asked when C-3″ applies and a
    vetoable `X-n` otherwise, as a structured entry holding the language, the toolchain, the
    documented gate command for each slot and the scaffold files. The pack carries it, and a
    greenfield pack without it does not conform (C-2⁷). DETERMINE_VERIFICATION binds from it, and
    documented commands remain the bindings: the entry holds them in structured form, where V-1′
    had ANALYZE copy them out of prose. The bootstrap ticket provides the entry's scaffold files,
    where A-1⁶ took them from ANALYZE's `stack.scaffold_files`. A conforming pack takes its stack
    from its decision log;
  - the prose summary is replaced by the checker's parse of the pack, which SLICE and PLAN receive
    in place of `analysis`.
  - **Persisted.** The phase list is persisted in checkpoints, so removing ANALYZE is an F-3 schema
    event: an `init` resumed from an ANALYZE checkpoint re-runs from DECIDE and says why.
  *Amended by C-2¹² (PRDR-282): until PRDR-290 removes ANALYZE, the stack entry reaches
  DETERMINE_VERIFICATION and the bootstrap through ANALYZE, which writes it over the stack its
  session chose.*
  *Amended by C-2¹⁴ (PRDR-284): VALIDATE hands the checker's parse to the phases after it, and
  nothing reads it until PRDR-290: SLICE and PLAN still receive ANALYZE's analysis.*
  *Amended by D-10″ (PRDR-290): built. SLICE and PLAN are handed the parse's stack entry, not the
  whole parse: SLICE's seed from it is C-2⁸'s, and PLAN's records from it C-4⁵'s.*

- **D-10″ (3.1.1, PRDR-290).** D-10′ is built. ANALYZE is gone from `INIT_PHASES`, which holds
  eleven phases, and `src/init/analyze.ts` with it. This settles what D-10′ left to its ticket,
  builds C-8⁵'s `--replan`, and amends C-3‴'s `open_questions`, C-2¹¹'s pool, C-2¹²'s route to
  the bindings, C-2¹³'s and C-2¹⁴'s handoffs, and C-8's AC.
  - **`greenfield`** is code's: `isGreenfield`, in `src/init/greenfield.ts`, is true where no
    stack marker is handed on to planning (C-2¹³). DETERMINE_VERIFICATION, SLICE and PLAN each
    compute it, and no session is asked.
  - **The stack entry**, in greenfield, is read from the checker's parse VALIDATE hands on, or from
    the decision log on disk where VALIDATE hands none, as when WRITE wrote no pack. An existing
    project has none: its stack is still found in the repository, and SLICE and PLAN are handed
    `stack: null`. The entry is in the keys of DETERMINE_VERIFICATION, SLICE, PLAN and each slice's
    cache, so a veto of it re-binds and re-plans. No key reads DECIDE's outputs for it, which
    C-8″'s scan cannot read (C-2¹²).
  - **The bindings.** DETERMINE_VERIFICATION binds, provisionally, the gate commands the entry
    names, which are the root package's rows under `## Packages`: each of the six slots the log
    names, `test_single` among them, where ANALYZE copied five slots out of prose. An entry that
    names no `test` command takes its language's conventional commands, as V-1′'s fallback did,
    and one with neither stops for `test` with AWAIT_SETUP_CONSENT, naming `## Packages`. A new
    project whose log records no stack stops for it with AWAIT_SETUP_CONSENT, naming `## Stack`:
    nothing binds before a stack exists (D-10).
  - **The bootstrap** provides the entry's scaffold files, and its description names the entry
    that settled the stack (A-1⁶).
  - **SLICE and PLAN** are handed the entry where they were handed `analysis`, and read the pack's
    documents themselves, as they did. The rest of the parse is not handed to them: SLICE's seed
    from it is C-2⁸'s (PRDR-291), and PLAN's records from it C-4⁵'s (PRDR-292). The planner's
    prompt names three stages, and in greenfield tells the planner the stack is decided.
  - **Questions and research.** ANALYZE's questions went with it. C-3‴'s `open_questions` carries
    what the slices before a draft asked, SLICE is handed none, and PRESENT lists none of
    ANALYZE's. ANALYZE was planning research's one caller, so no phase launches a research
    session: AUDIT alone counts its calls against `planning_research_tool_calls`, and X-1's site
    map names `init/audit` for it. `src/init/plan-research.ts` has no caller in `src/`, and stays
    until PRDR-298 deletes it.
  - **`--replan`** enters at DETERMINE_VERIFICATION (C-8⁵), so it never re-runs the specification
    phase.
  - **An older state.** An ANALYZE checkpoint an earlier build left is F-3's case, and needs no
    migration step: states at schema version 2 written before this build hold it too, and no
    migration runs on them. `init` says why and runs DECIDE whatever DECIDE's own checkpoint says;
    the phases after it re-run only where their keys moved. The checkpoint and ANALYZE's artifact
    are removed once DECIDE completes. Until then they are kept, and the next `init` says why
    again. A DECIDE with nothing open still runs no session (C-2¹²).
  - **C-8's AC**, inherited from v2, names ANALYZE as the phase an edited PRD.md replays from. An
    edit replays from the first phase on the chain whose key it moves, the standalone phases
    aside, and editing nothing re-executes nothing.
  *Amended by C-2¹⁵ (PRDR-291): on a pack SLICE is handed the seed, and neither the stack nor
  greenfield; the entry keys every slice PLAN drafts. Without a parse it is handed both, as here.*
  *Amended by C-4⁷ (PRDR-292): on a pack PLAN is handed the parse's records and reads no document,
  the planner reads one prompt per job, and no stage is handed `open_questions`.*
  *Amended by C-3⁵ (PRDR-298): `src/init/plan-research.ts` is deleted, with its tests.*

- **C-2⁸ (3.1.1, PRDR-278).** SLICE is seeded by code, and a slice is its requirement ids. C-2‴'s
  SLICE re-derived the pack's structure from prose and keyed each slice by the model's own words:
  identical documents drew estimates of 308 and 554 tickets, 1 of 24 slice titles survived
  between two runs, and an edit to one document could re-plan every slice.
  - **The seed.** Code groups the pack's requirement ids by milestone, then by module code, and
    counts each group's criteria.
  - **One slice session** orders and groups the seed. It puts the walking skeleton through the
    riskiest integration first, a judgement that stays the model's, and places C-2⁗'s baseline
    items as before. Code refuses its artifact unless every requirement id lands in exactly one
    slice, the slices respect milestone order, and no slice names an id the pack does not define;
    a refusal gets C-4⁗′'s one relaunch.
  - **No guessed sizes.** The slicer estimates no ticket count: `expected_tickets`, and the
    planned-tickets figure built from it, are gone. C-2⁵′'s band stays the slice session's
    guidance, since one session still drafts each slice. The announcement states N-5′'s session
    formula for the slice count, not a guess.
  - **Identity.** A slice's cache key is its sorted requirement ids; the content hash of each
    requirement with its criteria and the decisions, facts and catalogue entries it cites; the
    stack, the bindings, the session budget and the prompt. The model's own words, a slice's title
    and goal, are never in it. This replaces C-8‴'s key, whose documents and spec were prose.
  - **Reuse.** SLICE is reused while the pack's set of requirement ids and their milestones is
    unchanged, and its other inputs, the baseline, the band and the prompt, are too. The criteria
    counts guide the grouping and do not key it, so an edited requirement re-plans only its own
    slice and never re-cuts the product. An added requirement is placed by a slice session that
    may only add, to an existing slice or a new one, and existing slices keep their ids and
    members. A removed requirement re-plans its slice. This is what makes C-8⁵'s scoped re-plan
    possible.
  *Amended by C-2¹⁵ (PRDR-291): built. A slice's key adds the baseline items it carries, and
  SLICE's job stays in the planner prompt until C-4⁵.*

- **C-2¹⁵ (3.1.1, PRDR-291).** C-2⁸ is built, in `src/init/slice.ts`, `src/init/slice-seed.ts` and
  `src/init/slice-key.ts`. This settles what C-2⁸ left to its ticket, and amends C-2‴'s SLICE
  where there is no parse, C-2⁵′'s estimate, C-8‴'s key, C-2¹²'s and C-3⁗'s vetoes, D-10″'s
  handoff to SLICE and N-5′'s announcement.
  - **The seed** is built from the checker's parse VALIDATE hands on (C-2¹⁴). It holds each live
    requirement, neither withdrawn nor in a document `plan_docs` leaves out (C-2″), grouped by
    milestone in order, then by module code in the order the index registers the codes. Each
    group carries its module's area, its ids in document order and how many criteria test them,
    and each milestone its title.
  - **The session** is handed the seed, the documents planning reads, the production baseline and
    the band, and no stack: the entry keys every slice, and PLAN plans on it. Code refuses a cut
    that leaves a live id out, places one in two slices, or names one the seed does not hold,
    whether the pack does not define it, it is withdrawn, or it is in a document planning does not
    read. It also refuses a slice holding a requirement of an earlier milestone than one a slice
    before it holds, so a slice may span a milestone boundary and never go back across one. The
    refusal names each defect, and the relaunch is told what was refused, not that its content
    was sound.
  - **Each slice's documents** are code's: the module PRDs holding its requirements and their
    criteria, and every document planning reads that is not a module PRD, the decision log among
    them (C-2¹²). Another module's PRD is left out.
  - **The cut on record.** SLICE keeps its cut at `.detent/state/slicing.json`, with the milestone
    each id had and the basis it was cut under: the baseline, the band and the prompt. SLICE runs
    again whenever a phase before it on the chain does, and a cut on record under the same basis
    is kept. An id no longer live, or whose milestone moved, leaves its slice. A slice left with
    neither requirements nor baseline items goes, and so do the edges to it. The ids no kept slice
    places go to a slice session that may only add, which is shown the slices in order, each with
    its milestones, and those ids as a seed of their own. It writes `slice-additions.json`, placing
    each id in an existing slice or in a new slice that follows the slice it names; the shape has
    no field to move, rename or remove anything. Code refuses a placement of an id a slice already
    holds, into a slice that does not exist, or under an id a slice has, and any merged cut the
    checks above refuse. With nothing to add, no session runs. A cut on record under another
    basis, or one that keeps no slice, is cut again whole. `--replan` removes the record with the
    slice caches, so it still re-derives every slice (C-8′).
  - **SLICE's key** on a pack is the live ids with their milestones, and the basis. An edit to what
    a requirement says re-cuts nothing, and neither the criteria counts nor the documents' text
    key it. Without a parse, where WRITE wrote no pack (C-2¹³) or the documents planning reads hold
    no live requirement, SLICE cuts the documents as they are, is handed the stack, and is keyed
    by the documents' contents and the stack, as C-2‴ built it. It keeps no record there.
  - **A slice's cache key** is its sorted requirement ids and each one's record from the parse:
    its text, kind, milestone, level and tags; its criteria; and the decisions, defaults, facts and
    catalogue entries it and its criteria cite, read as the checker reads a citation (C-2¹⁰), a
    catalogue entry by its row. With them come the baseline items the slice carries, with what each
    is verified by, since PLAN drafts from them (C-2⁗) and C-2⁸'s list left them out; the stack;
    greenfield; the baseline; the bindings; the session budget; and the prompt. Its title, goal,
    rationale and slice-level `depends_on` are not in it. Without a parse, the contents of the
    documents the slice plans from stand in for the records, as C-8‴ keyed them. So an edit to one
    requirement re-plans its own slice, and a veto re-plans the slices whose requirements cite the
    entry it edits, or every slice where it edits the stack's entry (C-3⁗). Until C-4⁵ hands PLAN
    the records alone, a PLAN session still reads whole documents, and an edit to text no record
    holds, such as prose around a requirement, an entry no requirement cites or a design document,
    re-plans nothing.
  - **No estimate.** `expected_tickets` is gone from the slice's shape and from every skeleton. A
    SLICE checkpoint written before this build is never read, since SLICE's key moved with its
    prompt, so no migration step runs. The announcement states the formula of planning as it is
    built, counting the sessions PLAN runs after SLICE's own. N slices take at least `4N + 1`: a
    draft and three review reads per slice, and one whole-plan review. Each of the R revision
    rounds a slice review asks for adds four. Where the whole-plan review faults C slices, their
    redrafts and one more whole-plan review add `C + 1`. One slice has no whole-plan review and
    takes `4 + 4R`. When C-4⁶ and A-1⁷ are built, the announcement's part of N-5′'s
    `1 + 2N + R + C` is `2N + R + C`; the 1 is SLICE's session.
  - **The prompt.** SLICE's job stays in `prompts/planner.md`, rewritten for the seed, for the
    session that may only add, and for documents cut as they are. One prompt per job is C-4⁵'s
    (PRDR-292). Until it is built, an edit to PLAN's or the review's part of the planner prompt
    re-cuts the product, as it re-plans every slice.
  *Amended by C-4⁷ (PRDR-292): a slice cut from the pack has no documents, and PLAN drafts from
  the records its key reads. SLICE's job has its own prompt, which keys the cut and no slice's
  draft.*
  *Amended by A-1⁸ (PRDR-293): the announcement counts no whole-plan review. N slices take at
  least `4N`, `4N + 4R + C`, where C is the redrafts the checks send.*
  *Amended by C-4⁸ (PRDR-294): N slices take at least `2N`, `2N + R + C`, where R is the slices
  whose read finds a blocker or major.*

- **C-4⁵ (3.1.1, PRDR-278).** PLAN drafts from the pack's records, not from prose, and asks
  nothing.
  - **Inputs.** For each slice, from the checker's parse: each requirement's id, milestone and MUST
    or SHOULD text; its criteria, each with its id and Given / When / Then; the decisions, facts
    and catalogue entries it cites; the slice's baseline items (C-2⁗); the stack, the bindings
    and the session budget (C-4′); X-4″'s `sizing_evidence`; and a compact index of the tickets
    in the slices this one depends on, with each ticket's id, title, surface and what it provides
    as `kind:id`. Catalogue ids (routes, events, error codes, settings, jobs) are the canonical
    names in `provides` and `consumes` (A-1‴), so a drafter no longer digs through Detent's state
    files for them, as 56 of 60 drafting sessions did.
  - **Outputs.** A-1's ticket gains `criterion_ids`. Every pack criterion a ticket carries is
    copied into its acceptance criteria verbatim, and a ticket may add criteria of its own. The
    draft has no `questions`. It has `spec_defects` instead, each quoting, with ids, the pack
    passages that contradict each other, or the gap. A spec defect found while planning takes
    X-4⁷'s amendment path before approval: PRESENT raises AWAIT_INFO, an approved amendment edits
    the pack, the checker gates it, VALIDATE re-validates the change, and only the affected slices
    re-plan. The draft and ticket shapes change under F-3.
  - **Prompts.** One prompt per job, SLICE's, PLAN's and the review's (C-4⁶), where one planner
    prompt served four stages. No prompt a model reads cites a Detent PRD id, and every rule in
    one is either enforced by code or stated as a judgement the reviewer makes.
  - **Tools.** Planning sessions read with Read, Grep and Glob and write their artifact, with no
    Bash and no subagents (D-28″). The planning audit counted 2,846 read-only Bash calls, 97
    attempts to spawn subagents, and 1,104 of 6,117 tool calls that errored or were denied.
  *Amended by C-4⁷ (PRDR-292): built. An open spec defect holds approval, and the amendment path
  it takes is X-4⁷'s, not built (PRDR-286).*
  *Amended by X-4⁸ (PRDR-286): X-4⁷'s path is built for a session during `run`. A spec defect PLAN
  reports carries no proposed text and does not take it: the operator still amends the pack by
  hand.*

- **C-4⁷ (3.1.1, PRDR-292).** C-4⁵ is built, in `src/init/plan-records.ts`,
  `src/init/plan-inputs.ts` and `src/init/plan-draft-checks.ts`, with three prompts in place of
  `prompts/planner.md`. This settles what C-4⁵ left to its ticket, and amends C-2‴'s drafting,
  C-2¹⁵'s documents, key and prompt, C-3′'s and C-3‴'s questions, A-1‴'s kinds, C-7″'s refusal,
  D-10″'s handoff to PLAN, S-1‴'s `planner` and F-3″'s event.
  - **The records.** On a pack, a draft is handed the checker's parse of its slice's live
    requirements: each one's id, milestone, level, tags and text; the criteria that test them,
    each with the requirements it tests, its tags, its Given, When and Then, and `text`, the
    words a ticket carries, `<id>: Given …, when …, then ….`, built from the parse so that a
    criterion rewrapped in its document keeps its words; and the decisions, defaults, facts and
    catalogue entries they cite, read as the checker reads a citation, each entry with its row.
    The slice is named by its id, title, goal, requirement ids and baseline items, and no
    document path. Beside them are `catalogue_ids`, the ids of each kind the pack catalogues at
    least one of, and `plan_index`: the tickets of the slices the slice names in `depends_on`
    and of the slices those name, each with its id, title, surface and what it provides as
    `kind:id`. No document, no analysis and nothing an earlier stage asked is handed. Without a
    parse, or where the documents planning reads hold none of the pack's requirements and SLICE
    cut them as they are (C-2¹⁵), a draft is handed the documents, as C-2‴ built it, and names
    no criterion and no spec defect, since neither can be checked there.
  - **The key** of a slice's cache hashes the same records, so what a draft reads and what
    re-plans it are one thing. C-2¹⁵'s gap is closed: no draft reads the prose around a
    requirement, an entry no requirement cites or a design document, so an edit to one moves
    nothing a draft was handed. `plan_index` and `catalogue_ids` stay out of the key, so an
    edit to one slice re-plans no later one. A ticket id that is gone still misses a later
    slice's cache (C-8‴), and a name no ticket provides any more is a contract finding (A-1‴).
    The key covers PLAN's prompt and the review's, and SLICE's basis covers SLICE's alone, so an
    edit to SLICE's prompt re-cuts the product and re-plans only the slices the new cut moves.
  - **Criteria are copied.** A ticket names the pack criteria it carries in `criterion_ids`, and
    each one's `text` is among its acceptance criteria, word for word, with whitespace, bold
    markers and backticks set aside. Code refuses a draft naming a criterion the pack does not
    define or carrying one without its words, relaunches it once with each reason, and stops
    planning on a second refusal. Whether every criterion of a slice reaches a ticket is A-1⁷'s
    check (PRDR-293).
  - **Catalogue names.** A-1‴'s kinds gain `error_code`, `setting` and `job`, so every kind a
    catalogue lists has its contract kind. Where the pack catalogues at least one entry of a
    kind, a `provides` or `consumes` of that kind naming an id the catalogue does not hold is a
    `traceability` finding among the contract checks PRESENT lists. A kind the pack catalogues
    nothing of is named freely, as is every kind without a parse. The finding is reported, not
    refused: A-1⁷ makes a proved failure a redraft (PRDR-293).
  - **Spec defects.** Each of a draft's `spec_defects` has a kind, `contradiction` or `gap`; the
    passages it quotes, each with the id of the record that holds it, a requirement, a
    criterion, a `D-n` or `X-n`, a fact by its section, or a catalogue id; and what the pack
    leaves unsettled. A contradiction quotes at least two passages. Code refuses a draft whose
    quote is not in its record, as the parse holds it or as its document writes it, with
    whitespace, bold markers and backticks set aside. PRESENT lists each open defect with the
    slice that reported it and the `file:line` of each passage, raises AWAIT_INFO before
    approval is offered, and records the count in `presentation.json`; `detent run`'s deferred
    approval presents the plan and refuses while the count is not zero. A slice is drafted again
    when its records change, or when a passage one of its defects quotes is no longer in the
    pack. X-4⁷'s amendment path is not built (PRDR-286): the operator amends the pack by hand
    and runs `detent init` again, and a defect the operator judges false has no rejection yet,
    only `--replan`, which drafts every slice again.
  - **No questions.** Neither SLICE's artifact nor PLAN's has `questions`, and one that carries
    any is refused. No stage is handed `open_questions`. PRESENT still reads questions from their
    outputs, and finds none; its merge is PRDR-298's to delete.
  - **Prompts.** `prompts/slice.md`, `prompts/plan.md` and `prompts/plan_review.md` replace
    `prompts/planner.md`; the review's job stays in its own file until C-4⁶ gives it its role
    (PRDR-294). The `planner` role keeps its routing, and the stage a session is launched for
    picks its prompt: a planner session for any other stage is refused. The manifest pins the
    prompts by id. No planning prompt, instruction or skeleton cites a PRD id, and neither does
    the preamble every init session reads. Each rule in `slice.md` and `plan.md` is stated as
    something Detent refuses, reports or does, or as a judgement, the model's or the reviewer's,
    and PRDR-292 lists which is which. The other roles' prompts still cite PRD ids.
  - **Tools.** A planner session's tools are Read, Grep, Glob and Write, and its one write is its
    artifact: no Bash, no Edit and no subagents. Where the root holds `archive/`, its guard
    refuses a path inside it, as written or resolved, a Grep over a directory that holds it, and
    a Glob whose pattern can reach into it, so the originals WRITE archived are out of
    planning's reach as well as out of its inputs (C-2¹³). A Grep or Glob that names no path
    searches the root, and is refused there.
  - **Migration.** F-3″'s event gains PLAN's shapes: a ticket gains `criterion_ids: []`, and a
    draft, each slice's cache and the whole-plan review's cache trade `questions` for
    `spec_defects: []`. A transform may name every JSON file in one directory. An approval covers
    `criterion_ids` only where a ticket carries some, so a plan approved before the field is
    still approved after the migration.
  *Amended by A-1⁸ (PRDR-293): the whole-plan review's cache takes no step, since nothing reads
  it, and the catalogue-name finding is a failure a redraft is sent.*
  *Amended by C-4⁸ (PRDR-294): the review runs on `plan_review`, with the planner's tools, and
  reads a slice's records rather than the planning documents.*
  *Amended by C-3⁵ (PRDR-298): PRESENT reads no question, since C-7‴ (PRDR-296) deleted its list
  and its merge, and `questions.ts` is gone.*
  *Amended by X-4⁸ (PRDR-286): X-4⁷'s path is built for a session during `run`. A spec defect
  carries no proposed text, so it does not take that path: the pack is still amended by hand, and
  a false defect still has no rejection.*


- **A-1⁷ (3.1.1, PRDR-278).** What code can prove about a plan, code checks, and a proved failure is
  fixed rather than reported. A-1‴ and A-1⁵ made contracts and coverage set operations and then
  only reported what they proved: ksar-cloud's approved plan kept 34 such defects, 28 names
  consumed that no ticket provides and 6 names with two providers, because the whole-plan review
  was told to treat them as handled.
  - **The checks** run after each slice's draft and after its revision. Coverage: every
    requirement id and baseline item of the slice is in some ticket's `requirement_ids` or
    `baseline_items`, every criterion id of those requirements is in some ticket's
    `criterion_ids`, and no ticket names an id from outside its slice. Contracts: every consumed
    name has a provider in this slice or an earlier one, no name has two providers, and derived
    edges are added as A-1‴ adds them. Milestone order: no ticket delivering an `[Mk]`
    requirement depends on one delivering an `[Mj]` with `j > k`. Gates: every path of every
    ticket's surface lies in a package with bound gates (V-5′). The graph: no cycle remains, and
    a derived edge A-1‴ refuses because it would close one counts as a failure. A-1″'s repairs of
    the drafted graph run first and are still reported.
  - **One targeted redraft.** A failing slice gets one redraft with the failures as its inputs.
    They are proved, so no reviewer's judgement is needed. Then the checks run again.
  - **Across the plan.** After every slice the same checks run over the whole plan. A name nobody
    provides sends one redraft to the earliest slice that consumes it, and a name with two
    providers sends one to each owner's slice. A redraft keeps the ids later slices depend on,
    and each is checkpointed before the next begins (C-8⁗), keyed by the failures that sent it.
  - **What still fails blocks approval** (planning decision 6). PRESENT raises AWAIT_INFO naming
    each failure (C-7″); the operator amends the pack or edits the tickets, and `detent init`
    resumes.
  - **In place of the whole-plan review.** This replaces C-2‴'s whole-plan model review. The checks
    grow linearly with the plan. The review's prompt carried every ticket in full: it worked at
    about 260 tickets and reached 1.55M tokens against a 1M limit at 547, and ksarjs's pack holds
    2,024 requirements. No model reads the contracts between slices (planning decision 10); one
    is added only if run-time outcomes show tickets failing on contracts the checks passed (D-33).
  *Amended by V-5″ (PRDR-295): the gates check runs at PRESENT, over the whole plan, until
  PRDR-293 builds these checks, and no draft is redrafted for it.*
  *Amended by A-1⁸ (PRDR-293): built.*

- **A-1⁸ (3.1.1, PRDR-293).** A-1⁷ is built, in `src/init/plan-checks.ts`,
  `src/init/plan-check-gates.ts`, `src/init/plan-redraft.ts`, `src/init/plan-cross.ts` and
  `src/init/present-checks.ts`. This settles what A-1⁷ left to its ticket, and amends C-2‴'s
  whole-plan review, C-2⁗'s, A-1‴'s, A-1⁵'s and A-1⁶'s findings, C-8⁗'s checkpoints, C-2¹⁵'s
  announcement, C-7″'s refusal, V-5″'s approval, N-5′'s formula and F-3″'s event.
  - **The checks** are one pure function over the plan, the slices, the pack's parse, the
    scaffold, the gates and the work already DONE. Coverage: each requirement id and baseline
    item a slice holds is named in one of its tickets' `requirement_ids` or `baseline_ids`, and
    a slice whose tickets name none of them fails for each; A-1⁵'s "undeclared" report is gone.
    A criterion that tests a live requirement is carried in some ticket's `criterion_ids`; it
    falls to the last slice holding a requirement it tests, and is due once that slice is
    drafted. No ticket names a requirement, baseline item or criterion its slice does not hold,
    a criterion counting as held where it tests one of the slice's requirements. Contracts are
    A-1‴'s, with C-4⁷'s catalogue names and a consumer whose provider lies in a later slice; a
    name with two providers fails once in each owner's slice. Milestones: a ticket's milestone is
    the earliest of the requirements it delivers, and it may not reach, through any chain of
    edges, a ticket delivering a later milestone's; the nearest such ticket is named, with the
    chain. Gates are V-5″'s check. The graph: an edge A-1‴ refuses because it would close a
    cycle, and a cycle that remains, which only an edit of the tickets can make, since A-1″
    breaks a drafted one first. DONE work provides its names, even where this plan no longer
    drafts it, and no failure names a DONE ticket except a name with two providers, whose other
    owner still has to yield. A failure's words cite no PRD mark, since a drafter reads them.
  - **The redraft.** After a slice's draft, and after its revision, the failures that lie in the
    slice send it one redraft, with `check_failures`, each failure's family, ticket and words,
    and `draft`, the tickets as drafted. A-1″'s repairs apply to it as to a draft, and the spec
    defects it reports are kept as a draft's are. The checks run again and what still fails is
    noted. So a slice's own checks send it at most two redrafts. The slice's review reads its
    draft after the first; a redraft sent after the revision, or across the plan, is judged by
    the checks alone. The gate check runs at PLAN where bindings exist when PLAN runs, and at
    PRESENT always.
  - **Across the plan.** After every slice, reused or planned, the checks run over the slices so
    far, and each failure is sent to one slice: a name nobody provides to the earliest slice that
    consumes it, a name with two providers to each owner's slice, the rest to the slice they lie
    in. A slice is sent a failure at most once, whether its own checks or these sent it, and the
    set is checked again before each slice, since a redraft of one slice may answer or make what
    another is sent. A pass runs at most three rounds. A redraft keeps each id later slices
    depend on, handed to it as `keep_ids`, or it is discarded and the slice stands. Each redraft
    is checkpointed before the next begins, in `.detent/state/plan-checks.json`, keyed by the
    slice's own key, its draft, the failures, the ids it keeps and the tickets it builds on
    (C-8⁗); a resumed PLAN reuses it, and `--replan` wipes the record with the slice caches
    (C-8′).
  - **Approval.** PRESENT runs the checks again on the tickets as they stand under
    `.detent/plan/`, each ticket's blockers as its edges and its slice as `plan.json` lists it,
    since the operator may answer a failure by editing a ticket. While any fails it lists each
    and raises AWAIT_INFO before approval is offered, so `--approve` is not asked, and records
    the count in `presentation.json` as `check_failures`, in place of V-5″'s `ungated`; `detent
    run`'s deferred approval presents the plan and refuses while the count is not zero. PRDR-293
    read "`detent approve` refuses the plan" as these two exits: `detent approve <id>` promotes a
    ticket and approves no plan. A failure therefore never reaches the run phase, which reads the
    review's findings as before; a failure an edit had cleared would reach it stale.
  - **The whole-plan review is gone**, with its cache, `already_found` and the instruction to treat
    what code proved as handled, and its line in the revision notes. The review prompt judges one
    slice, and `coherence` within it or against `plan_index`.
  - **Where an id lands.** `sliceSchema`'s doc-block names the three places code checks that each
    id lands in exactly one slice: C-2¹⁵'s cut on a pack, `slicesSchema`, which now refuses an id
    or a baseline item placed in two slices, pack or none, and these checks. Which ids documents
    without a parse define, and which baseline items apply, remain the slicer's judgement.
  - **Migration.** F-3″'s event drops its step for the whole-plan review's cache: nothing reads
    `state/whole-plan.json`, and a state holding it keeps it as it was. `state/plan-checks.json`
    is new. A presentation carrying `ungated` was written only by a build of the unreleased
    3.1.1 line; it does not parse, and `run` sends the operator to `detent init`.
  *Amended by C-4⁸ (PRDR-294): the review reads a draft once its checks pass. A revision that still
  fails after its redraft is discarded, and the draft the review read stands.*

- **C-4⁶ (3.1.1, PRDR-278).** Each slice gets one review read, by its own role, limited to judgement
  (planning decision 2). C-4″'s REVIEW_PLAN grew into three reads, a revision and three more reads
  (C-4⁗″, PRDR-269) and took 78% of planning's spend; in the runs that built ksar-cloud's plan its
  reviewers wrote 151 verdicts, every one `changes`, and revisions resolved 121 findings while
  introducing 119.
  - **The role** is `plan_review` (S-1‴), with its own prompt, on the planner's seat (S-5⁵,
    planning decision 9), so it is never weaker than the drafts it judges.
  - **One read**, after A-1⁷'s checks pass. Its scope is four of the tags C-4″, C-4‴ and C-2‴
    defined: `sizing`, whether each ticket fits one implement session (C-4′); `shape`, the walking
    skeleton first and vertical increments; `dependency`, what contracts cannot see; and
    `coherence`, tickets that contradict each other or the pack. Coverage, traceability and
    contracts are code's (A-1⁷). The review receives X-4″'s `sizing_evidence`.
  - **Findings** carry a severity, blocker, major or minor, with their tag, their ticket and their
    fix. `approve` is the verdict when nothing is blocker or major. C-4⁗'s synonyms and C-4⁗′'s one
    relaunch apply to its artifact.
  - **One revision.** A blocker or major buys one revision of the slice. A-1⁷'s checks run on it,
    and there is no second review. Minor findings are recorded on their tickets and reach the run
    sessions by PRDR-271's path. What survives the revision is presented as a risk, not ground on:
    D-24 holds for the review, which advises and never blocks. What blocks is code's.
  - **Deleted:** the three-read sampling (C-4⁗″), and with it the draws launched together
    (C-4⁗‴) and the batch D-28′ bounds, whose rule stands for any later batch, bounded by that
    batch's own size; the review after the revision (PRDR-269); the churn and null lines; the
    held-finding labels and the advice file (D-24′). A slice costs at most three sessions, the
    draft, the review and one revision, plus A-1⁷'s targeted redrafts.
  *Amended by C-4⁸ (PRDR-294): built.*

- **C-4⁸ (3.1.1, PRDR-294).** C-4⁶ is built, in `src/init/plan-review.ts`,
  `src/init/plan-revision.ts`, `src/init/plan-slices.ts`, `src/init/present-review.ts` and
  `prompts/plan_review.md`. This settles what C-4⁶ left to its ticket, and amends C-4″'s review,
  C-4‴'s and C-4⁗'s findings and verdict, C-2‴'s slice, A-1⁸'s redraft, C-2¹⁵'s announcement,
  C-4⁷'s prompts, C-7″'s risks, D-24′, D-28′, C-4⁗″, C-4⁗‴, C-4⁗⁵, S-6′, S-1‴'s migration,
  F-3″'s event and N-5′'s formula.
  - **The role.** `plan_review` has its own prompt and routes to `claude-opus-5` at `max`
    (S-5⁵). Its session is otherwise the planner's: Read, Grep, Glob and its artifact's write, no
    reach into the root's `archive/`, and no stop gate, since it writes no code. The `planner`
    runs SLICE and PLAN alone, and a planner session launched for any other stage is refused.
    F-3″'s event routes `plan_review` in an existing config by the config's planner, model and
    effort, where it routes one, since the review ran as the planner until now, and by the
    default where it does not.
  - **One read, after the checks.** A slice's draft is read once, when A-1⁷'s checks pass on it
    or on the one redraft they send. A draft that still fails is not read: the slice is
    presented as not reviewed, with why, and its failures hold approval as before (A-1⁸). The
    read is handed the tickets, the slice, its records on a pack or its documents without one,
    the index of the earlier slices, the session budget and X-4″'s `sizing_evidence`. It is
    handed nothing code proved and no spec defect, which the operator reads at PRESENT. It reads
    what the slice's key reads, so a cached verdict goes stale when its draft does.
  - **Findings.** Each has a severity, blocker, major or minor, one of the four tags, the ticket
    whose change answers it, and its fix; an artifact without them is refused, and relaunched
    once with the validator's words (C-4⁗). Code grades the verdict: `approve` where nothing is
    blocker or major, whatever word the review wrote, and a word that disagrees with the grades
    is noted. An artifact unusable twice leaves the slice not reviewed.
  - **One revision.** A blocker or major buys one revision, handed the draft the review read and
    the blockers and majors alone. The checks run on the revision and may send it one redraft; a
    revision that still fails is discarded, and the draft the review read stands. No review
    reads the revision, so each blocker and major reaches PRESENT as a risk, with its slice, its
    ticket and its fix, blockers first. A minor is recorded in PLAN's `review_findings` beside
    A-1″'s repairs, and reaches the sessions that run its ticket by PRDR-271's path, gravest
    first. PRESENT counts the minors and lists the repairs, each a decision code made for the
    operator.
  - **Cost.** A slice takes at most three sessions, the draft, the read and the revision, plus
    the redrafts A-1⁷'s checks send and a relaunch of an unusable artifact. SLICE announces
    `2N + R + C`.
  - **Deleted**, with their tests: the sampling (`plan-sample.ts`) and the review after the
    revision; the revision rounds and their seam; the churn and null lines (`plan-signal.ts`,
    `plan-notes.ts`) and the null harness (`scripts/null-review.ts`); the held-finding labels;
    the advice file (`present-advice.ts`); and the launch batch (`launch-batch.ts`), which only
    the draws used, since VALIDATE's reviewers run one after another (C-2¹⁴). The backend still
    carries S-6′'s told path and C-4⁗⁵'s first-response signal, with no caller; PRDR-298
    deletes them. The tag set loses PRDR-101's `boundaries`: where a ticket stops is the
    drafter's to judge, as are its testability and its traceability.
  - **Migration.** F-3″'s event routes `plan_review`, as above. A slice's cache holds its read's
    graded findings and needs no step: its key folds in the review's prompt, which changed, so a
    cache written before misses, and the slice is planned again. PLAN's checkpoint keys on the
    same prompt, so PLAN runs again too.
  *Amended by C-3⁵ (PRDR-298): the told path and the first-response signal are deleted.*

- **C-7″ (3.1.1, PRDR-278).** PRESENT shows what the operator decides on, and approval is refused
  while the plan is proved wrong. ksar-cloud's PRESENT printed 457 held findings, a revision
  headline that summed 16 of 24 slices and a 457-KB advice file, and never showed the decisions
  the plan rests on.
  - **Shown:** the slices, tickets and milestones; the decision log, every `D-n` and every `X-n`,
    the `X-n` marked vetoable (C-3⁗); the checks that still fail (A-1⁷); the spec defects
    planning found (C-4⁵); VALIDATE's residual majors and the review majors left after revision,
    as risks (C-2⁶, C-4⁶); and what each specification phase and planning cost, with no cap
    (specification decision 16).
  - **Gone:** the revision and churn lines, the advice file, and the question list, which is
    DECIDE's now. The presentation is printed once, off a TTY as on one, and the persisted
    presentation `run` replays (PRDR-255) is the same text.
  - **Refused** while a check fails or a spec defect is open: PRESENT raises AWAIT_INFO with each
    item, and `--approve` refuses the plan.
  - **Mixed builds** (planning decision 8). Every planning checkpoint records the Detent build that
    wrote it (N-5′), and PRESENT names every build that contributed. A plan more than one build
    produced is approved the way a toolchain install is (PRDR-276): on a TTY, PRESENT names the
    builds and asks [y/N], and so does `run`'s deferred approval (PRDR-255); off one, `--approve`
    needs `--accept-mixed-builds` beside it, or the approval is refused. The approval record
    lists the builds. At least four builds assembled ksar-cloud's plan, and one slice of it came
    from an experiment run against the live tree.
  *Amended by C-2¹⁴ (PRDR-284): VALIDATE's residual majors are shown, as risks after the
  defaults.*
  *Amended by C-4⁷ (PRDR-292): an open spec defect holds approval on both exits, and PRESENT lists
  each with the `file:line` of its passages.*
  *Amended by A-1⁸ (PRDR-293): a check that fails holds approval on both exits; PRESENT checks the
  tickets as they stand.*
  *Amended by V-5″ (PRDR-295): a path no gate can fail holds approval on both exits, and PRESENT
  lists each with its ticket and package.*
  *Amended by C-4⁸ (PRDR-294): the review's risks are each blocker and major a slice's read found,
  with its fix, since no review reads the revision. PRESENT names the slices no review read,
  lists the repairs code made and counts the minors.*
  *Amended by C-7‴ (PRDR-296): built, but for the mixed builds, which PRDR-297 builds with N-5′'s
  record of the build that wrote each checkpoint.*
  *Amended by N-5″ (PRDR-297): the mixed builds are built. PRESENT names the builds of what
  `--replan` makes again, not the specification phases', whose pack its hash names.*

- **C-7‴ (3.1.1, PRDR-296).** C-7″ is built, in `src/init/present.ts`, `src/init/present-plan.ts`,
  `src/init/present-spec.ts`, `src/init/phase-spend.ts` and `src/kernel/ledger-rows.ts`, but for
  its mixed builds, which are PRDR-297's. This settles what C-7″ left to its ticket, and amends
  C-3′'s batch, C-3‴'s merge, C-3⁗'s vetoes, C-2¹²'s PRESENT, PRDR-166's note, PRDR-255's replay
  and S-4's ledger row.
  - **The plan.** The slices are listed in order, however many there are, before the tickets.
    Each slice shows the milestones of the requirements SLICE assigned it, and each ticket the
    milestone of what it delivers, the earliest of its requirements', as A-1⁷'s milestone check
    reads it. The bootstrap delivers none and shows none, and without a pack nothing does.
  - **The decision log.** Every `D-n`, with its question and its answer, then every `X-n`, with
    its value and its reason, marked vetoable; each block says where an entry is changed. Both
    are read from the phase that left the log, as the defaults were (C-2¹²).
  - **The cost.** Each ledger row an `init` session writes names the phase that launched it, as a
    string, so a phase a later build renames cannot make X-1's reader refuse the file. PRESENT
    sums `init`'s rows by phase: AUDIT, DECIDE, WRITE and VALIDATE apiece, SLICE and PLAN as
    planning, each with its sessions, then the total. The ledger is cumulative, so the figures
    cover every `init` on the root, and a row written before the field is counted apart, as
    earlier. Nothing caps or stops on them (specification decision 16); X-1's `run_spend_usd`
    counts the same rows and only announces (PRDR-265). They are read when PRESENT runs and are
    not in its key, since every session moves them.
  - **Gone.** The question list, its merge and its renumbering (C-3‴), the note of questions the
    log answered (C-3⁗), the instruction that named DISCOVER's globs (PRDR-166), and the
    AWAIT_INFO a blocking question raised (C-3′), with `presentation.json`'s `blocking` and
    `run`'s refusal on it. `questions.ts` keeps the similarity DECIDE uses. PRESENT raises
    AWAIT_INFO for a spec defect and for a check that still fails, as before (C-4⁷, A-1⁸), and
    PRDR-166's note on a reused DISCOVER speaks of an amendment written to a new file.
  - **Printed once.** Where approval is asked, on a terminal or by a relayed flag, the
    presentation is printed before the question, and the answer's interrupt does not repeat it.
    Anywhere else the interrupt carries it. The machine no longer copies an interrupt's message
    into the messages `init` prints before the interrupt. `presentation.json` holds the text
    printed, and `run` replays it (PRDR-255).
  - **Migration.** None. `presentation.json` came with PRDR-255 on this line, so no released
    build wrote one. One an earlier build of this line wrote carries `blocking` and does not
    parse: `run` refuses it as it refuses a plan with no presentation, and `detent init` presents
    the plan again. `spec_defects` and `check_failures` are required, since a record without
    them was written before them, and so with `blocking`. A ledger row without `phase` reads as
    before.
  *Amended by N-5″ (PRDR-297): its mixed builds are built, and `presentation.json` requires
  `builds` and `pack_hash` beside the counts.*
  *Amended by C-3⁵ (PRDR-298): the similarity is DECIDE's own, in `src/init/decide-items.ts`,
  and `questions.ts` is gone.*

- **C-8⁵ (3.1.1, PRDR-278).** Re-planning on the pack is scoped to what changed.
  - **The scoped re-plan** that an approved amendment ends in (X-4⁷): only the slices whose
    requirement ids changed are re-planned, and every other slice's cache is reused (C-2⁸).
    C-8′'s reconciliation applies: a DONE ticket is never redrafted, so a change to built code
    becomes a new ticket. C-8″'s in-flight refusal covers only the re-planned slices' tickets; it
    counts every ticket that is neither READY nor DONE, so the filing ticket's own NEEDS_HUMAN
    would otherwise refuse the re-plan it asked for. The changed plan is presented for approval
    again (C-7′), since its hash changed. Neither existing path does this: a plain `init` on an
    approved plan re-plans nothing (C-8), and `--replan` re-derives every slice.
  - **`--replan`** still re-derives every slice, for an operator who wants that (C-8′). It now
    enters at DETERMINE_VERIFICATION, where it entered at ANALYZE (D-10′), and never re-runs the
    specification phase: the pack is the founder's record, and a changed pack is re-validated by
    content (C-2⁷).
  *Amended by D-10″ (PRDR-290): `--replan`'s entry at DETERMINE_VERIFICATION is built.*
  *Amended by C-2¹⁵ (PRDR-291): a slice is keyed by its requirements' records and a cut is kept on
  record, which the scoped re-plan needs; the amendment path that ends in it is PRDR-286's.*
  *Amended by X-4⁸ (PRDR-286): built. The guard is asked of each slice PLAN plans again, before any
  session, and a reused slice keeps its tickets as they stand.*

- **X-3′ (3.1.1, PRDR-278).** X-3's table admits PREMISE_FALSIFIED from BLIND_FIX, INFORMED_FIX and
  REVIEW_FIX, each with IN_PROGRESS's outcome: hypotheses++, then a bug returns to DIAGNOSED, or
  to NEEDS_HUMAN past two, and a feature goes to NEEDS_HUMAN as a plan-level flaw.
  DEPENDENCY_DISCOVERED gains the same three rows, so a fix session's `missing` (X-4′) is a
  dependency as an implementer's is, and a retraction (X-4‴) is no signal after any of the four
  states. The referee reads `falsified.json` after a session in each of them. No state or event
  is added, and the rest of §7 stands. Implement and the three fix roles may all declare a false
  premise, and so file an amendment (X-4⁷, specification decision 12); review, diagnose and
  research stay read-only. The fix prompts have told their sessions to write the signal since
  X-4⁴, while the referee read it after IN_PROGRESS alone, so a fix session's signal was written,
  ignored and deleted at the next launch; PRDR-289 builds the rows. X-4⁵'s clearing stands: every
  launch removes a signal an earlier session left. X-4″'s oversized signal stays IN_PROGRESS's.
  *Amended by X-3″ (PRDR-289): the rows are built, the referee reads the signal after each fix
  session, and both drivers transition with it.*

- **X-3″ (3.1.1, PRDR-289).** X-3′ is built. What building it settled:
  - **Every attempt reads the signal.** `attempt` launches a session in the four states alone, so
    the referee reads `falsified.json` after each attempt, and `oversized.json` after one in
    IN_PROGRESS alone.
  - **Both drivers transition with it.** After a fix attempt the headless driver and the run
    skill transition with `falsified_ref` before any gate, as after IN_PROGRESS. D-13's reason
    stays with the informed fix's red gate (ARCH-2).
  - **The note keeps its words.** The note the referee writes still begins "falsified
    mid-implementation", which X-4⁶ selects on, so a fix session's false premise is re-tested
    after a toolchain install as an implementer's is.
  - **The prompts.** Each fix prompt gives the signal's three shapes, `note`, `missing` and
    `retracted`, and tells the session to end once it writes one. `blind_fix.md` calls a failure
    record that contradicts the hypothesis a false premise, where it said to write that in the
    commit message. `review_fix.md` calls a finding that can be fixed only by breaking a
    criterion one. `informed_fix.md` keeps its instruction for a brief whose falsifying condition
    holds: that is the brief's premise, not the ticket's, and its red gate goes to a human.
  - **The worst case does not move.** X-1's walk still computes 24 sessions for a bug and 19 for
    a feature. A fix session's false premise spends a hypothesis as an implementer's does, and
    the rungs spent before it stay spent.

- **X-4⁷ (3.1.1, PRDR-278).** A session that proves the specification wrong files an amendment, and
  the pack is fixed before the tickets built on it are (specification decision 8).
  - **Filing.** An implement or fix session (X-3′) writes `falsified.json` with an amendment: the
    affected requirement ids, the defect class, the evidence, either a failing test or two
    passages of the pack that contradict each other, quoted, and the proposed text. The referee
    admits PREMISE_FALSIFIED, and the ticket goes to NEEDS_HUMAN. No state or event is added: an
    amendment is a falsification that names its fix.
  - **Holding.** Until the operator decides, the pool draws no READY ticket whose
    `requirement_ids` include an amended requirement, as it draws none whose blockers are open,
    and the run goes on with the rest.
  - **Deciding.** The operator approves, edits or rejects the amendment through C-10's escalation:
    on a TTY inside `run`, and with exit 10 off one. A rejection returns the held tickets to the
    pool and leaves the filing ticket in NEEDS_HUMAN, with the rejection as its note.
  - **Applying.** On approval the pack is edited, the checker gates it (C-2⁷), VALIDATE
    re-validates the change, and C-8⁵'s scoped re-plan follows. The filing ticket and the held
    tickets return through HUMAN_REQUEUE, as X-4⁶ returns the tickets an install frees, or are
    superseded by the re-plan. The option the operator chose named `init --replan` for the last
    step, but C-8′ makes `--replan` re-derive every slice, so the decision is recorded with
    C-8⁵'s scoped re-plan in its place.
  *Amended by X-4⁸ (PRDR-286): built, for a session during `run`.*

- **X-4⁸ (3.1.1, PRDR-286).** X-4⁷ and C-8⁵ are built, in `src/kernel/amendment-store.ts`,
  `src/kernel/amendment-file.ts`, `src/kernel/amendment-decide.ts` and
  `src/init/amendment-replan.ts`. What building them settled:
  - **Filing.** The amendment is a field of `falsified.json`: `requirement_ids`, `defect_class`
    (`contradiction`, `wrong` or `gap`), `evidence`, and `edits`. The evidence is a failing test
    with its output, or two or more passages, each with the id of the record it quotes; a
    contradiction's is its passages. Each edit names a record and replaces text its document
    holds exactly once, on the lines that write that record. The referee files the amendment
    only when every requirement is the pack's, every quote is in its record (C-4⁵'s check) and
    every edit is so placed, and refuses one whose proposed text carries a secret (SEC-4); the
    evidence is scrubbed. A refused amendment is said on the ticket, and the falsification
    stands without it. A filed one goes to the human as PREMISE_FALSIFIED whatever it names
    missing (X-4′). It is kept at `.detent/amendments/AM-nnn.json`, committed beside the pack
    (F-1).
  - **Holding.** A filter in C-9's pool, as blockers are: an open or applied amendment holds every
    READY ticket that names one of its requirements, from filing until the re-plan. `status`
    lists a held ticket among the pending with the amendment it waits on, so a run that leaves
    only held work exits 10 where it would have exited 0, and `detent status` lists each
    amendment still holding and what it holds.
  - **Deciding.** On a TTY inside `run`, a ticket that filed an amendment escalates as the
    amendment: approve, edit with the operator's own edits in a JSON file, reject with a reason,
    skip, or quit. A decision the referee refuses is said, and the amendment offered again. An
    open amendment no escalation offered, such as one whose bug ticket went back to diagnosis or
    an earlier run's, is offered when the pool empties. Off a TTY the run exits 10, and
    `detent amend <AM-id>` shows the amendment and, with `--approve`, `--edit <file>` or
    `--reject <reason>`, decides it; it takes the run lock, so a live run refuses it. The
    `record` tool's `amendment` kind carries the decision for either driver (ARCH-2). No ticket
    moves at a decision, and the filing ticket stays in NEEDS_HUMAN.
  - **Applying.** The edits are made in order, and the checker must find the pack green, or every
    document is written back. The changed documents are committed alone, with the claimed
    ticket's trailer marker set aside for the commit, so neither a resume's reset (B-5) nor a
    finalize's sweep can take the change. The amendment is then `applied`, and still holds until
    `detent init` re-validates the pack (C-2¹⁴) and re-plans. `run` does not run `init`, so
    VALIDATE's AWAIT_INFO at its ceiling stays with `detent init`.
  - **The scoped re-plan.** An applied amendment makes a plain `detent init` re-plan an approved
    plan. C-8's early return and C-8″'s two whole-plan asks stand aside, and PLAN runs whatever
    its key says, so an amendment whose edit was undone by hand still settles. Before PLAN plans
    a slice again, it asks C-8″ of that slice's tickets alone, as the written plan lists them: the
    filing ticket's NEEDS_HUMAN does not refuse, and a filing ticket in any other state does. A
    slice PLAN reuses keeps its tickets as they stand, with their state, generations and notes,
    and takes only the new plan's blockers; so does the bootstrap. Once the plan is written, each
    applied amendment is `replanned` with the slices planned again, which frees what it held, and
    a filing ticket still in NEEDS_HUMAN returns through HUMAN_REQUEUE with the amendment as its
    guidance. `--replan` is unchanged. The plan is presented again (C-7′); the approval still
    covers it only where the approved fields did not change.
  - **Prompts.** `implement.md` and the three fix prompts give the field's shape, and review,
    diagnose and research are not told it (specification decision 12). The run skill decides an
    amendment through `record`.
  - **Not built.** A spec defect PLAN reports carries no proposed text, so it does not become an
    amendment: PRESENT's instruction to amend the pack by hand stands, and a defect the operator
    judges false still has no rejection (C-4⁷).

- **S-1‴ (3.1.1, PRDR-278).** S-1's role set gains four roles, one per tool set, because routing and
  tools are both set per role (specification decisions 11 and 15):
  - `audit` runs AUDIT. It is read-only (S-1′): it reads the repository, dependency sources at
    their pinned versions, and the web under the research role's network rules.
  - `spec_write` runs DECIDE, WRITE and VALIDATE's fixes. It reads, and it writes only the decision
    log, the pack's paths and `archive/`: a declared surface the containment hook enforces, as it
    enforces an implement session's, where S-1″ gave an init session its one artifact.
  - `spec_review` runs VALIDATE's reviewers. It is read-only, plus a scratch directory outside the
    repository and `.detent/`, created for the round and removed after it, where it may write
    throwaway scripts and run them (specification decision 7). Execution is sandboxed below the
    hook: a script cannot write outside the scratch directory or reach the network, whatever it
    contains, and it runs under a time limit and an output limit. Where the platform offers no
    such sandbox, simulation is off and the round says so. No other role has the sandbox.
  - `plan_review` runs C-4⁶'s review read. It is read-only (S-1′).
  - **One schema event.** Role ids are persisted, so the four are one F-3 `schema_version` event
    with a migration for `role@hash` assignments, paid once. C-4″ declined that cost for one role
    (PRDR-084); the planning audit found it worth paying. The migration writes the four roles'
    default routing (S-5⁵) into an existing config and leaves every role the config already
    routes untouched (S-5′). S-1's read-only set gains `audit`, `spec_review` and `plan_review`,
    and the `planner` keeps SLICE and PLAN, without Bash (C-4⁵).
  *Amended by F-3″ (PRDR-300): the event is `schema_version` 1 to 2, and its migration is the one
  entry in `MIGRATIONS` that the four roles, C-2⁶'s rounds key, D-10′'s phase list and D-5′'s
  bindings each extend.*
  *Amended by C-2¹¹ (PRDR-281): `audit` is built, and the migration writes its routing.*
  *Amended by C-2¹² (PRDR-282): `spec_write` is built for DECIDE, and the migration writes its
  routing. DECIDE's session writes its artifact alone and code writes the log, so the declared
  surface is WRITE's to build (PRDR-283).*
  *Amended by C-2¹³ (PRDR-283): the surface is built for WRITE's session, less `archive/`, which
  code writes. `spec_write` is not stop-gated by the product's gate.*
  *Amended by C-2¹⁴ (PRDR-284): `spec_review` is built, read-only, and the migration writes its
  routing. Its scratch directory and sandbox are not, so simulation is off and VALIDATE says so
  (PRDR-285). VALIDATE's writer is `spec_write` over the pack's paths.*
  *Amended by S-1⁗ (PRDR-285): the scratch directory and the sandbox are built, on macOS's
  Seatbelt; elsewhere simulation is off, and each round says so.*
  *Amended by C-4⁷ (PRDR-292): the `planner` reads one prompt per job, and its tools are Read,
  Grep, Glob and its artifact's write.*
  *Amended by C-4⁸ (PRDR-294): `plan_review` is built, with the planner's tools, and is not
  stop-gated. The migration routes it by an existing config's planner where the config routes
  one, and by the default where it does not.*
  *Amended by S-1⁵ (PRDR-302): every role's tools bind under the headless driver too: a session is
  given the built-in tools its allowlist names and no others.*

- **S-5⁵ (3.1.1, PRDR-278).** `init`'s default routing, with every role's model and effort; effort
  routing is stated in the PRD here for the first time (S-4‴ found it in neither PRD):
  `planner`: `claude-opus-5` at `max`; `plan_review`: `claude-opus-5` at `max`;
  `audit`: `claude-opus-5-5` at `max`; `spec_write`: `claude-opus-5-5` at `max`;
  `spec_review`: `claude-opus-5-5` at `max`; `review`: `claude-opus-5` at `xhigh`;
  `diagnose`: `claude-opus-5` at `xhigh`; `informed_fix`: `claude-opus-5` at `xhigh`;
  `implement`: `claude-sonnet-5` at `xhigh`; `blind_fix`: `claude-sonnet-5` at `xhigh`;
  `review_fix`: `claude-sonnet-5` at `xhigh`; `research`: `claude-sonnet-5` at `xhigh`.
  The three specification roles run on Opus 5.5 at `max` (specification decision 14): the ksarjs
  specification ran on it throughout, in its main session and its reviewer subagents, and S-5‴'s
  pin is the first whose runtime serves it; nothing was routed to it before. `plan_review` takes
  the planner's seat (planning decision 9), and the planner stays where S-5″ put it. Nothing else
  moves, and the routing is not tuned past these defaults until a run-time outcome says it should
  (D-33).

- **D-5′ (3.1.1, PRDR-278).** Gates bind per package. D-5 bound the repository root only in v1 and
  named workspace scoping a v2 migration; NG2 made per-workspace gate scoping a non-goal; V-5
  binds root entrypoints only; and OQ-4 left the design open. The operator chose to bind per
  package in this amendment (planning decision 7), was then told that it lifts a limit v1 set on
  purpose, and kept it the same day. This amends D-5 and V-5 (V-5′), lifts NG2 and resolves OQ-4.
  The per-package binding is a persisted shape, so it is the F-3 migration D-5 anticipated,
  "`schema_version` carries the upgrade". The evidence: ksar-cloud's gates ran Go at the root
  while 69 of its 547 tickets wrote `dashboard/`, 41 of them nothing else, and no gate could fail
  for any of them.
  *Amended by V-5″ (PRDR-295): built.*

- **V-5′ (3.1.1, PRDR-278).** DETERMINE_VERIFICATION finds a manifest in every package directory,
  not only the root, for each ecosystem an adapter supports, and binds each package's gates with
  that package as their working directory. V-5's rules, the orchestrator-native candidates, the
  workspace notice and `[BASE]`, govern the root package's own binding. A pack may declare
  packages and their gate commands (C-2⁷), and declared commands are the bindings, as documented
  commands are (V-1′). A ticket's gates are those of the packages its surface touches, and `run`
  runs exactly those. A surface path that lies in no package with bound gates fails A-1⁷'s gate
  check, so an approved plan has no ticket writing where no gate can fail. Nothing invents gates
  for a package that has none: its tickets wait until the pack declares them or the operator
  binds them. `run`'s toolchain check (PRDR-276) covers every package's toolchain, and V-1's
  execute-before-approve rule is unchanged.
  *Amended by V-5″ (PRDR-295): built. A-1⁷'s gate check runs at PRESENT until PRDR-293 builds
  A-1⁷.*
  *Amended by A-1⁸ (PRDR-293): the gate check is one of A-1⁷'s, run after each draft and across
  the plan.*

- **OQ-4 resolved (3.1.1, PRDR-278).** v2's open question on workspace scoping is settled by D-5′
  and V-5′: gates bind per package.

- **V-5″ (3.1.1, PRDR-295).** V-5′ is built, in `src/adapter/packages.ts`,
  `src/adapter/bind-packages.ts`, `src/init/bind-declared.ts` and `src/init/present-gates.ts`.
  This settles what V-5′ left to its ticket, and amends V-1′'s documented commands, V-3's drift,
  C-3b's questions, C-4's promotion, C-7″'s refusal and F-3″'s event.
  - **Packages.** A package is the root, and every directory holding `package.json`,
    `pyproject.toml`, `setup.py`, `setup.cfg`, `go.mod` or `Cargo.toml` that git tracks or would
    track, outside hidden directories, `node_modules`, `vendor`, `testdata`, `fixtures` and
    `__fixtures__`. A Makefile, a justfile or a tsconfig runs tasks in a package and does not make
    one. A path lies in the deepest package holding it. `.detent/bindings.json` lists the
    packages, and each binding and skip names its own. A gate outside the root is named with its
    package, `web:test`, and the root's by its slot alone, as before.
  - **Binding.** DETERMINE_VERIFICATION discovers and binds each package in its own directory, and
    runs each command there before binding it (V-1). A package with no lockfile takes the package
    manager of the package holding it. A C-3b question names the package. `test` is missing only
    where no package binds it, so a root that runs no tests beside a package that does is bound.
    A slot left unbound is an acknowledged skip only in a package that binds a gate at all. The
    phase's checkpoint key adds the other packages' marker files and the declared packages only
    where there are any, so a project with one package keeps its key.
  - **Declared packages.** DETERMINE_VERIFICATION reads the decision log's `## Packages` rows. In
    a new project each declared package other than the root is bound provisionally, as the log
    gives its commands, beside the root's from the stack entry. In an existing project a declared
    command is bound provisionally for a slot that discovery binds nothing for in that package,
    which need not exist yet; where discovery binds the slot too, the package's own command is
    bound and a notice says that the two disagree. A declared binding is not executed at `init`.
    It runs as its package's gate, and V-3 exempts it as it exempts every provisional binding,
    since no file holds its configuration. C-4's bootstrap promotes each provisional binding from
    what discovery then finds in its own package, and stores the command a gate runs, normalized.
    Outside a new project nothing promotes a declared binding.
  - **A ticket's gates.** The gate arm reads the packages a ticket's surface touches: a path
    touches the package it lies in and every package below it, a glob touches its base's package
    and every package below the base that it can reach, and an exclusion touches none. A touched
    package that binds none of the slots asked is refused as V-1″ refuses a ticket with no gate,
    naming it, and a gated package beside it does not stand in. Each touched package installs
    what its manifest declares, with its own package manager, in its own directory, and runs its
    gates there, package after package. The first red gate ends the evaluation, and
    `last_failure.json` names its package. A suspected flake is rerun with the failing package's
    `test_single`, in its directory. The falsification probe runs each changed test with its own
    package's `test_single` or `test`, in that package's directory, and passes only if all of them
    pass. `run`'s toolchain check and `doctor` read every package's gates and name them with
    their package. Every session's preamble keeps the root's gates by slot and gives each other
    package's under `packages`. No session may write under any `node_modules`, and finalization
    stages none. The Stop gate still runs the root's `test` alone, and none where the root binds
    no `test`.
  - **Drift.** V-3 re-resolves each binding in its own package. The approvals ledger keys a
    configuration by its package, and a row written before packages is the root's. The fork's
    configuration is read package by package, from each package's marker files at the fork
    commit. `detent verify sync` re-binds every package, keeps a declared binding that discovery
    does not replace, and names the package in its messages; a ticket's accepted hashes are keyed
    by the gate's name.
  - **Approval.** PRESENT lists each path of a ticket that is not DONE lying in a package that
    binds none of `lint`, `typecheck` and `test`, and each package manifest a ticket writes in a
    directory that is not a package, and raises AWAIT_INFO before approval is offered, with the
    count in `presentation.json`. `detent run`'s deferred approval presents the plan and refuses
    while the count is not zero, and a presentation written before the count counts none. This is
    the check A-1⁷ names; until PRDR-293 builds A-1⁷ it runs at PRESENT, over the whole plan, and
    no draft is redrafted for it.
    *Amended by A-1⁸ (PRDR-293): a failing slice is redrafted for it, and its count is part of
    `check_failures`.*
    *Amended by C-7‴ (PRDR-296): a presentation written before the count carries `blocking` and
    does not parse; `run` refuses it, and `detent init` presents the plan again.*
  - **Migration.** F-3″'s event carries `.detent/bindings.json` to packages: each binding and skip
    gains `package: "."`, and the file `packages: ["."]`. The approvals ledger, a ticket's accepted
    hashes and DETERMINE_VERIFICATION's checkpoint need no step, since what each held before
    packages reads as the root's.

- **N-5′ (3.1.1, PRDR-278).** Plans are measured by how they run (planning decision 3), from what
  `run` already records in `transitions.jsonl` and the ledger. The figures sit beside §14's
  metrics, and they are reported and never gated:
  - per ticket: escalations to NEEDS_HUMAN; falsifications by cause, premise, oversized or
    dependency discovered; budget breaches; whether it was DONE in its first generation; review
    rounds; cost and wall-clock;
  - per slice and per plan, with the Detent build and the pack hash that produced the plan: a
    quality section in `detent status`, and a record when a run ends. `detent status` also shows
    what each specification phase and planning cost, with no cap or threshold (specification
    decision 16);
  - evaluation hygiene: every planning checkpoint records the Detent build that wrote it (C-7″),
    and an experiment runs on a copy of the project, never on its live `.detent/` tree, which is
    how an experiment's slice reached ksar-cloud's approved plan;
  - sessions per plan: a plan of N slices takes `1 + 2N + R + C` planning sessions, where R is the
    slices revised and C the targeted redrafts. C-2‴'s pipeline took at least `4N + 3`, and
    ksar-cloud's 24 slices took 186; this takes 49 with no revision and 73 with every slice
    revised, plus redrafts. The figure is an estimate for the first run to measure.
  *Amended by C-2¹⁵ (PRDR-291): SLICE announces the formula of planning as it is built, counting
  the sessions after its own. When C-4⁶ and A-1⁷ are built, that part of this one is
  `2N + R + C`.*
  *Amended by A-1⁸ (PRDR-293): A-1⁷ is built. Until C-4⁶ is, SLICE announces at least `4N`
  sessions, `4N + 4R + C`.*
  *Amended by C-4⁸ (PRDR-294): C-4⁶ is built, and SLICE announces at least `2N` sessions,
  `2N + R + C`.*
  *Amended by N-5″ (PRDR-297): built. An experiment on a copy of the project is a practice, and
  no code enforces it; a checkpoint an experiment writes names its build, which PRESENT names.*

- **N-5″ (3.1.1, PRDR-297).** N-5′ is built, in `src/kernel/outcomes.ts`,
  `src/kernel/plan-quality.ts`, `src/kernel/build.ts`, `src/init/plan-builds.ts` and
  `src/cli/status.ts`, and so are C-7″'s mixed builds. D-33 is the rule the figures serve; it was
  stated with PRDR-278, and this adds nothing to it. This settles what N-5′ and C-7″ left to their
  ticket, and amends F-4's checkpoint, C-7's approval record, PRDR-255's replay and C-13's
  `detent status`.
  - **Per ticket**, counted from `transitions.jsonl` and the ledger alone: its stops for a human,
    less each the pool returned after an outage (PRDR-112); its falsifications by cause, a false
    premise, a ticket larger than one session or a dependency found; its budget breaches; whether
    it was DONE in its first generation, where a generation an outage's requeue opened counts as
    the same one; its review rounds, each review that reached a verdict; its cost, the ledger rows
    that name it; and its wall-clock at work, from each line that leaves it working to the line
    after it, so time in the pool, on a human or blocked is not counted. A ticket's figures are
    all its lines and rows, whichever plan it was in: no line or row marks the plan it ran under.
  - **Per slice and per plan**, summed over the plan's tickets as `plan.json`'s slices hold them,
    with the tickets no slice holds apart, and beside them the builds that made the plan and the
    pack's hash, as the approval records them, or PRESENT where the plan is not approved.
    `detent status` shows them, then what `init` spent by phase, as PRESENT does (C-7‴). A run
    ends by appending them, each ticket's too, with the build that ran it, to its journal as a
    `plan_quality` event, beside the `config` event it began with (PRDR-092), whether its loop
    returned or threw; a record that cannot be made is announced, and ends nothing. They are not
    in `detent report`, whose metrics are §14's table, key for key (T-053). Nothing gates on a
    figure.
  - **The build** is the version and the first twelve hex digits of a sha256 over the source
    under `src/`, the prompts and `package.json`, so an edited tree is a build of its own, which is
    what an experiment is. It is in no checkpoint's key: a build that changes nothing a phase reads
    reuses its checkpoint (C-8).
  - **What records it:** every checkpoint (F-4); the cut SLICE keeps, as the builds whose sessions
    cut what stands, so one that keeps a cut keeps its builds and one that adds to it joins them;
    each slice's cache; and each redraft the checks across the plan used. A record written before
    the field counts as a build of its own, unrecorded, which may have been several.
  - **What PRESENT names:** the builds of what `detent init --replan` makes again, the phases from
    DETERMINE_VERIFICATION to PREPARE_AGENTS, the cut, each slice's cache and each redraft, each
    with what it made; so that flag makes a plan one build's, whole. The specification phases are
    not among them: the pack is the founder's document set, which its hash names, and INIT_FS and
    DISCOVER write nothing the plan holds. Counting them would call every plan made after an
    upgrade mixed, and a question put to every plan is answered unread.
  - **Mixed builds** (planning decision 8): more than one build, or any part unrecorded, and
    approval is offered only once that is accepted. On a terminal a `[y/N]` follows the
    presentation, before the approval question, at `init` and at `run`'s deferred approval
    (PRDR-255); off one, `--approve` needs `--accept-mixed-builds` beside it, or the approval is
    refused. A relayed `--decline` or `--defer` approves nothing, and needs none. The plugin's
    skill asks the human, and relays the flag only on a yes.
  - **Records.** `presentation.json` requires `builds` and `pack_hash`, as it requires the counts:
    a record without them was written before them, and `detent init` presents again.
    `approval.json` gains both, optional, so a plan approved before them stays approved, and its
    figures name no build.
  - **Migration.** None. Each new field is optional where a record outlives the build that wrote
    it, and required only in `presentation.json`, which no released build wrote.

- **N-7′ (3.1.1, PRDR-278).** The self-build keeps `detent-prd-v3.md` as its only input and runs the
  specification phase headless (specification decision 9): AUDIT reads the whole PRD, DECIDE takes
  every recommended answer as a vetoable default, and the pack it writes lives in the self-build's
  folder, like everything else N-7 produces. The self-build therefore runs longer and costs more,
  so release-checklist item 5 records its wall-clock duration and its spend, per phase, beside the
  green; the first such run gives specification decision 16 its projection. The N-7 scoping note
  (§13) still governs what the skeleton plans first.

- **C-2⁹ (3.1.1, PRDR-279).** The conformance record lives at `docs/conformance.json`, and DISCOVER
  classifies every document set as raw, conforming or changed. This settles what C-2⁷ left to its
  first ticket, and amends C-2⁶'s WRITE and C-8's listing digest.
  - **The pack's documents** are everything C-2's full discovery finds, whatever `plan_docs`
    narrows planning to, and never the record. Inside `docs/`, the layout's names are typed:
    `docs/founder-decisions.md`, `docs/research/verified-facts.md`, `docs/design/<name>.md`,
    `docs/adr/ADR-<nnn>-<name>.md`, `docs/prd/index.md` and `docs/prd/<NN>-<name>.md`. Any other
    name inside `research/`, `design/`, `adr/` or `prd/` breaks the layout. Every other document
    is context, a README or a runbook. It is hashed with the pack, so an edit to it is a change
    `init` names, but it is never read for requirements and has no precedence. WRITE moves to
    `archive/` the originals it rewrote into the pack and leaves context where it is: archiving
    everything that is not the pack would move a repository's README out of its root.
  - **The hash** is sha256 over the sorted `path NUL sha256 LF` lines of the documents, and the
    record keeps each document's own hash, which is what names a change. `init` stops, naming the
    record, when the record is not JSON, breaks its schema, was written by a newer build (F-3), or
    has a hash that disagrees with its own documents.
  - **Conforming** means the documents hash to the record, the record's checker was green, and
    the schema finds nothing in them now: rules can move under unchanged documents, and in
    greenfield the stack entry is required (D-10′). Anything else with a record is **changed**,
    never raw. DISCOVER names the documents modified, added and removed, or says why the record
    no longer vouches for unchanged ones. The classification is DISCOVER's output, persisted in
    its checkpoint. The phases C-2⁶ adds are what will route on it, so until they exist nothing
    does.
  - **The digest.** With a record, DISCOVER's digest covers the pack's contents and the
    record's, since whether the pack is still the one validated is a question about what the
    files say. Without one it is the listing alone, as C-8 has it: a raw document set behaves as
    before, and no checkpoint written before this rule is invalidated.
  - **`archive/`** is the root's. The discovery walk never enters it, so no configured glob
    reaches it either, and a `docs/archive/` is an ordinary directory.
  - **The grammar**, in `src/schemas/pack.ts`, versioned with the parse. Decisions, defaults, the
    stack entry and packages are table rows under `## Decisions`, `## Defaults`, `## Stack` and
    `## Packages` in the decision log. Codes and milestones are rows under `## Codes` and
    `## Milestones` in the index, and facts are rows `| N.M | fact | source | tag |`. Catalogue
    entries are rows whose first cell is the id in backticks, under `## Error codes`, `## Events`,
    `## Settings`, `## Jobs` and `## Routes` in `docs/design/catalogues.md`. Requirements and
    criteria are bold-headed bullets in the module PRDs: `- **<CODE>-F-<nnn>** [Mk] …` and
    `- **<CODE>-AC-<nn>** [Mk] Given …, when …, then … (<ids>)`, where the ids may be a range
    joined by an en dash. A fenced code block is an example, never an entry. Whether a
    criterion's values are exact is not the schema's to judge; VALIDATE's reviewers judge it
    (C-2⁶).
  *Amended by C-2¹⁰ (PRDR-280): conforming requires the checker green on the documents now, not
  the schema alone.*
  *Amended by C-2¹¹ (PRDR-281): AUDIT routes on the classification.*
  *Amended by C-2¹³ (PRDR-283): a pack whose record is not validated is `written`, a fourth
  kind, and DECIDE and WRITE route on the classification too.*
  *Amended by C-2¹⁴ (PRDR-284): VALIDATE routes on the classification, which it takes again when
  it runs, and a written pack's record may hold the rounds of a validation that stopped.*

- **C-2¹⁰ (3.1.1, PRDR-280).** The checker is built, in `src/init/pack-check.ts`: a TypeScript port
  of ksarjs's `check_pack.py`, generalized to C-2⁹'s grammar. This settles what C-2⁷ left to its
  first ticket, and amends C-2⁷'s milestone rule and C-2⁹'s conforming.
  - **Its rules.** Blocking: the schema's own breaks, where a bold head shaped like a requirement
    or criterion id that the grammar refuses is one, and another family's ids under bold heads,
    such as ksarjs's spikes, are prose; every id defined once (requirements, criteria, decisions,
    defaults, facts, codes, milestones, ADRs, and each catalogue's entries, two spellings of one
    route counting as one); requirement ids running from 001 without a gap; each requirement and
    criterion in the PRD its code is registered to, under a milestone the registry allows; every
    requirement, criterion, decision, default, fact and milestone a document names resolving;
    every `§` a document names after a document's name existing among that document's numbered
    headings; every relative link reaching a file inside the repository; every error code,
    event, setting, job and route a document uses being in its catalogue, when `catalogues.md`
    has that section; every live requirement tested by a criterion; and no criterion testing
    what a later milestone delivers. One heuristic reports and never blocks: a requirement
    sentence that states behaviour without MUST, SHOULD or MAY.
  - **Milestone order** is checked between a criterion and the requirements it tests, the one
    dependency the schema states. A requirement that names a later one may be pointing forward,
    as to the requirement that will use a hook it provides. 47 of ksarjs's requirements name a
    later milestone's, 65 times, and a blocking rule reading each as a dependency would refuse
    them all. So the order of requirements is among the properties the checker lists as not
    checked, and C-2⁷'s rule for it is VALIDATE's reviewers' to judge.
  - **The heuristic reads requirements only.** Design documents describe the design in the
    present tense by nature. Read for "already", "currently" and "is built", ksarjs gave 137
    reports, one of them a claim about code.
  - **What a use is.** A route is `` `METHOD /path` `` or a bare path, read under a first path
    segment the catalogue's own routes use, so a framework's `GET /health` is not a route the pack
    forgot; `{a,b}` is one path per alternative, `[/x]` an optional segment, and a parameter,
    `:id`, `{id}` or an example value in capitals, matches any parameter in its place. A setting
    is the noun, "the setting `x`". Context documents are read for requirement and criterion ids
    and for links only. An entry the schema refused is still defined, so one defect is one
    finding.
  - **Its output** is sorted by file, line, rule and message, each finding quoting its line, and
    ends with the eight properties it does not check, as `scripts/check-tickets.ts` does.
  - **Where it runs.** DISCOVER calls a pack conforming only when the checker is green on it now,
    and its note lists what the checker does not check. `init` is one pipeline for both drivers,
    so both reach the checker the same way (ARCH-2), with no referee tool of its own. VALIDATE
    runs it, and a red result blocks every phase after VALIDATE, once PRDR-284 builds VALIDATE;
    an amendment runs it once PRDR-286 builds amendments.
  - **Parity.** Converted into the schema, ksarjs's pack (2,024 requirements, 1,144 criteria)
    gives no finding in any class `check_pack.py` checks, as the script gives none, and each of
    the script's seventeen ported catch types, seeded into it, is reported by both. The 35
    findings the checker adds are in classes the script never checked, each a real property of
    ksarjs: 19 criteria with no When, 9 criteria under an unregistered code, 4 requirements no
    criterion tests, 2 requirements that only say MAY, and a decision with no reason. The
    committed fixture, `tests/fixtures/pack/`, is a pack in ksarjs's shapes with content of its
    own, since ksarjs's pack is unpublished.
  *Amended by C-2¹⁴ (PRDR-284): VALIDATE is built. It runs the checker first, and a red result
  its writer cannot fix blocks every phase after it.*
  *Amended by X-4⁸ (PRDR-286): an approved amendment runs it before the pack is changed for good,
  and a red result writes the documents back.*

- **C-2¹¹ (3.1.1, PRDR-281).** AUDIT is built, in `src/init/audit.ts` and the modules beside it,
  directly after DISCOVER. This settles what C-2⁶ left to AUDIT's ticket, and amends C-8's chain.
  - **Raw only.** AUDIT runs on a raw document set. On a conforming pack it completes without a
    session, since the checker stands for the pack (specification decision 6), and on a changed
    pack it does the same: C-2⁷ has a changed pack re-validated for its change only and never
    read as a raw PRD, which is VALIDATE's once PRDR-284 builds it. Until then a changed pack
    reaches planning as every document set did before AUDIT.
  - **Two steps, one role.** A survey session reads every document and, in an existing project,
    the code. It writes the contradictions, gaps, drift and external claims it finds, and checks
    none of them. Then each claim, once per claim and subject, gets a session of its own that
    checks it against a primary source and writes a brief with a verdict. A claim the documents
    rely on in more than one place is checked once, and each place is recorded with the verdict.
    `confirmed` and `wrong` name the source that settles the claim, and `wrong` says what is true
    instead; `unverified` names neither. Both are `audit` sessions on `prompts/audit.md`, told
    their task by their inputs (S-1‴). C-3a's engine moves in with them: a brief per claim,
    cached; one relaunch carrying the validator's words; X-6a's local search before the web; and
    PRDR-266's ascent, which here has no exemption, since an external claim is never about this
    project's own state. A brief refused twice leaves its claim unverified and marked unchecked,
    and never ends the phase. A survey refused twice fails it, as an analysis does.
  - **Briefs are committed** at `.detent/research/audit/<hash>.json`, a committed layout entry
    beside planning's (F-1). The hash covers the claim and its subject, which names the
    dependency at its pinned version, so a re-run pays nothing for a claim already checked and a
    version bump checks it again. A cached brief is read with the checks a fresh one gets, so
    one citing a file that has since gone is checked again.
  - **Checked by code.** Every passage the survey cites must be in one of the documents it was
    given, at its `file:line`: whitespace aside, starting on that line. The code a drift finding
    names must exist, and no drift stands in greenfield. A first survey with anything missing is
    relaunched with the list. On the second, what is still missing is dropped, recorded in the
    checkpoint as `dropped` and said, and a document the survey still says it did not read is
    recorded as `unread`. A `confirmed` or `wrong` verdict's source is a link or a repository
    file with the lines it cites, and never one of the documents being checked.
  - **The key.** AUDIT's checkpoint is keyed by the documents' contents without the decision
    log, by the code, and by the pack's kind, the stack markers and the audit prompt's hash. The
    code is every file git tracks or would track, as the working tree has it, outside the
    documents, the decision log, `.detent/` and the root's `archive/`; where git cannot list it,
    the walk discovery makes. The survey is not given the decision log, so nothing it was given
    escapes the key.
  - **A standalone phase.** A phase may stand outside C-8's chain: its key is its own digest
    alone, it is looked up even while the phases before it replay, and running it replays
    nothing after it, so a later phase that reads its outputs names them in its own digest. It
    is never a re-plan, so C-8″'s in-flight refusal does not count it. AUDIT is the one. DECIDE
    writes the decision log, which moves DISCOVER's listing, so on the chain every answer would
    have re-run the survey and every claim. And AUDIT's key covers the code, which no phase after
    it reads, so on the chain an edit to the code would have re-planned the product. `--replan`
    does not force it (C-8⁵): it re-runs when its key moves, and only then.
  - **Progress.** Each brief written is a progress mark, as a slice's checkpoint is, and so is
    AUDIT's completion, with sessions or none (X-1⁵).
  - **Research.** The claim checks' tool calls, a turn each as C-3a counts them, are reported
    against `planning_research_tool_calls` and told to no session. Until PRDR-298 takes planning
    research out of ANALYZE, each of the two phases reports its own calls against that pool.
  - **Routing.** `audit` runs on `claude-opus-5-5` at `max` (S-5⁵). F-3″'s migration writes that
    routing into an existing config that routes no `audit`, model and effort separately, and
    leaves a routed one as it is (S-5′). `init`'s routing note is built from the routing tables,
    so it names every role, `audit` included.
  - **Nothing reads the checkpoint yet.** DECIDE is its reader, once PRDR-282 builds it. Until
    then AUDIT's note names each contradiction and drift, and each claim the documents have wrong
    or that could not be verified, up to ten of each, and planning goes on from the documents as
    written.
  *Amended by C-2¹² (PRDR-282): DECIDE is built and reads the checkpoint. DISCOVER no longer lists
  the decision log, and DECIDE is a second standalone phase.*
  *Amended by C-2¹⁴ (PRDR-284): VALIDATE re-validates a changed pack's change, so it no longer
  reaches planning unchecked.*
  *Amended by D-10″ (PRDR-290): ANALYZE is gone, so AUDIT alone reports against
  `planning_research_tool_calls`, and X-1's site map names `init/audit` for it.*
  *Amended by C-3⁵ (PRDR-298): planning research is deleted, and `research/planning` leaves the
  layout, so AUDIT's briefs are the only research `init` commits.*
  *Amended by C-2¹⁶ (PRDR-304): the claims are checked four at a time.*
  *Amended by C-2¹⁷ (PRDR-305): a stopped AUDIT keeps its checked survey, so a re-run checks the
  claims as the stopped run worded them, and a claim it briefed pays nothing. Until then a re-run
  surveyed again, and a claim the new survey worded afresh missed its brief.*
  *Amended by C-2¹⁸ (PRDR-306): a triage decides which claims are checked, and a check session
  takes up to five claims of one topic. A load-bearing claim no source could settle goes to DECIDE
  unchecked, and a claim nothing rests on is recorded and not checked.*

- **C-2¹² (3.1.1, PRDR-282).** DECIDE is built, in `src/init/decide.ts` and the modules beside it,
  directly after AUDIT. This settles what C-2⁶ and C-3⁗ left to DECIDE's ticket, and amends C-8's
  chain, C-8″'s refusal and D-10′'s route to the bindings.
  - **What it sorts.** Every item AUDIT left open: each contradiction, each gap, each drift
    finding, and each external claim that is wrong or unverified, every place the documents rely
    on one claim being one item. A confirmed claim is not open. In greenfield, while the decision
    log records no stack, the stack is an item too (D-10′). With nothing open, no session runs.
  - **One session, checked by code.** A `spec_write` session on `prompts/spec_write.md`, told its
    task by its inputs (S-1‴), sorts each item by the id its inputs gave it: into a question only
    the founder can answer (C-3″), with at least two options, the recommended one first and each
    with its consequence; into a vetoable default, with its value and its reason; or into an entry
    the log already holds, cited by its id. It writes that artifact and nothing else. Code checks
    the sorting: every item settled once, every id one of the items or one the log holds, only
    the stack's settler carrying a stack, and a question that settles it carrying one on every
    option. A question the log's decisions already answer, in C-3‴'s words, is refused, and its
    items are cited as settled by the entry that answers it. A first attempt with anything wrong
    is relaunched with the list; the second keeps what stands, and an item still settled by
    nothing is said and left to the documents as written.
  - **Code writes the log**, in the pack's grammar (C-2⁷), so every row it adds is one the checker
    reads: a `D-n` for each answer, with the question, the answer and the chosen option's
    consequence as its reason; an `X-n` for each default; and, in greenfield, `## Stack` and the
    root package's gate commands under `## Packages`. It appends under a `###` heading of its own
    in each section and changes no row the founder wrote, and a log that has a `## Stack` keeps
    it. Ids continue from the highest the log holds.
  - **On a terminal** the questions are asked inline, in screens of at most four. The stack's
    question takes no answer in the founder's own words, which would carry no stack entry. A
    founder who answers later gets AWAIT_INFO at DECIDE, listing every question with its options;
    nothing is written, and the session's checked artifact is kept, so the next `detent init`
    asks again without a session while its inputs stand. Writing the answers as `D-n` rows in the
    log is the other way to answer, and the next session reads them. `INTERRUPT_PHASE` lists
    DECIDE and PRESENT for AWAIT_INFO, and the machine refuses an interrupt raised at a phase it
    does not list. PRDR-166's note, that the document set is unchanged, is PRESENT's alone, since
    DECIDE reads the log itself.
  - **Off a terminal**, the plugin's path included, each recommended answer is taken and logged
    as a vetoable `X-n` whose reason says so, and `init`'s output lists each one (specification
    decision 9).
  - **Asked once.** DECIDE keeps a record beside its checkpoint that maps each item it sorted to
    the entry that settled it, by a key made of what a second survey of the same documents most
    likely repeats: the passages it quotes, a claim with its verdict, and for a gap, which is
    often a silence, its topic. A run whose items are all still settled by entries the log holds
    runs no session, since an answer or a veto edits an entry and leaves it standing. An item
    whose entry was deleted is asked about again, and nothing else is.
  - **The log is DECIDE's input and its output.** DISCOVER no longer lists it, so DECIDE's writes
    never move DISCOVER, and AUDIT's key already left it out (C-2¹¹). The planning phases add it
    to what they read, from disk: ANALYZE, SLICE, and every slice PLAN drafts, whatever documents
    the slice names, since a row there wins over the documents it settles (C-2⁷). Until C-2⁸ keys
    a slice by its requirement ids (PRDR-291), a veto therefore re-plans every slice, not only the
    slices whose documents it touches.
  - **Keyed after it runs, off the chain.** DECIDE writes the log its digest reads, so its
    checkpoint is keyed by the digest taken after it runs: its own write does not re-run it, and
    an edit by anyone else does. It stands outside C-8's chain beside AUDIT (C-2¹¹), keyed by the
    items AUDIT left open rather than by AUDIT's words, which a re-run survey never repeats. A code
    edit re-runs AUDIT; an item that did not move re-runs nothing; and a re-run DECIDE re-plans
    only through the log, which the planning phases name in their own digests. `--replan` does
    not force it (C-8⁵).
  - **The in-flight refusal is asked twice.** A standalone phase can now change what planning
    reads during the run, which C-8″'s scan before the run cannot see. So the refusal is asked
    again as each phase on the chain up to PLAN is about to run, before any planning session, and
    it reports what ran before it. What DECIDE recorded stays in the log.
  - **The stack.** In greenfield the decided entry reaches the bindings through ANALYZE, until
    PRDR-290 removes it. ANALYZE's session is handed the entry, and code writes it over the stack
    the session chose, keeping what the session wrote only where it wrote the decided language.
    A gate command the entry names is the binding, and the bootstrap provides the entry's
    scaffold files.
  - **Packs.** On a conforming pack DECIDE runs no session: its log is the founder's record
    already, and it reaches planning as it stands. On a changed pack it runs none either, and says
    so: applying the change is WRITE's and checking it VALIDATE's, and this build has neither.
  - **PRESENT** lists every `X-n` the log holds, with its reason, beside C-3′'s assumptions, and
    names each planning question the log's decisions already answer rather than asking it.
  - **Routing.** `spec_write` runs on `claude-opus-5-5` at `max` (S-5⁵), and F-3″'s migration
    writes that routing into an existing config as it does `audit`'s. It is not a read-only role,
    but DECIDE's session writes its artifact alone, so it has the read tools and the one artifact
    rule every init session carries (S-1″). The surface S-1‴ declares for it is WRITE's to build
    (PRDR-283).
  - **Progress.** A completed DECIDE is a progress mark, with a session or none (X-1⁵).
  *Amended by C-2¹³ (PRDR-283): WRITE is built. On a changed pack DECIDE says the change is
  VALIDATE's to check and that this build has no VALIDATE, and the surface S-1‴ declares for
  `spec_write` is built for WRITE's session, less `archive/`.*
  *Amended by C-2¹⁴ (PRDR-284): VALIDATE is built: `INTERRUPT_PHASE` lists it for AWAIT_INFO, and
  DECIDE's note on a changed pack says VALIDATE re-validates the change.*
  *Amended by D-10″ (PRDR-290): ANALYZE is gone. SLICE and every slice PLAN drafts read the log, and
  the stack entry reaches the bindings and the bootstrap directly, with no session's stack to
  write it over.*
  *Amended by C-2¹⁵ (PRDR-291): on a pack every slice still reads the log, and is keyed by the
  entries its requirements cite, so a veto re-plans those slices alone.*
  *Amended by C-7‴ (PRDR-296): PRESENT lists every `D-n` and every `X-n`, the `X-n` marked
  vetoable, and no planning question.*
  *Amended by C-2¹⁸ (PRDR-306): a claim AUDIT's triage found nothing in the documents rests on is
  not open either. A load-bearing claim no source could settle is, as an unverified claim.*

- **C-2¹³ (3.1.1, PRDR-283).** WRITE is built, in `src/init/write.ts` and the modules beside it,
  directly after DECIDE. This settles what C-2⁶ and C-2⁹ left to WRITE's ticket, and amends
  C-2⁶'s handoff, C-2⁷'s record, C-2⁹'s classification, C-8's chain, C-8″'s refusal and S-1‴'s
  surface.
  - **When it writes.** On a raw document set only. A conforming pack is never rewritten
    (specification decision 6). A changed pack's change, and a pack WRITE wrote, are VALIDATE's,
    which is not built, so WRITE writes nothing over either. `plan_docs` (PRDR-086) narrows
    discovery to part of the set and a pack is written from the whole set, so on a narrowed set
    WRITE writes nothing either, and planning reads the narrowed documents as they are. Each case
    is said.
  - **One session.** A `spec_write` session, told its task by its inputs (S-1‴), is given the
    documents DISCOVER found, AUDIT's findings each with the log entry that settled it, the claims
    AUDIT checked with their verdicts and corrections, the log's entries and the next free `X-n`.
    It writes the pack at the pack's paths, and an artifact that lists, once each, the originals
    that are not at one of them: rewritten into the pack, to be archived, or kept as context. An
    original at one of the pack's paths is rewritten in place or left as it is. The session may
    add defaults to the log for what the documents leave open that DECIDE was not shown, and
    nothing else.
  - **Checked by code.** Every original is placed once, in the list its kind allows: a planning
    document by its name, any C-2 family but README's, is never context, and one at a path the
    layout does not hold (C-2⁹) cannot stay. The log keeps every row and line it held, gains no
    decision and keeps its stack; a rewrite that breaks this is undone, and the log restored as
    DECIDE left it. Every entry that settled a finding, and every default the session added, is
    cited by id in the pack's own documents. The pack holds a requirement, and the checker
    (C-2¹⁰) is green on it as it will stand once the originals are archived. A first attempt with
    anything wrong is relaunched with the list. The second keeps what stands: code archives a
    planning document or an unplaceable one the session kept, leaves an original the session did
    not place where it is, as context, says each cite still owed, and records a red checker as
    red. A second attempt with no requirement or no usable artifact fails the phase, as a failed
    session does; the pack's paths are then put back as they were, and nothing is archived.
  - **The move.** Code moves each original the session rewrote to the root's `archive/`, at its
    own path, byte for byte, and keeps there the original bytes of each pack document the session
    rewrote in place. Nothing in `archive/` is overwritten: a second original of one name is kept
    beside the first, as `name.2.ext`. The decision log is never archived.
  - **The record.** WRITE writes the conformance record (C-2⁷) with the checker's result on the
    pack, no rounds, the day, and `validated: false`. The record gains `validated`, required;
    VALIDATE is what will write `true`. F-3″'s migration writes `true` into a record from before
    the field, which could only mean its pack was validated. Until VALIDATE is built, a red
    checker blocks nothing: the pack reaches planning, and its record says the checker was red.
  - **Written, a fourth kind.** DISCOVER classifies a pack whose record is not validated as
    `written`, whatever changed in it since, with the count of what the checker blocks on in it
    now, and says that nothing validated it and that it goes to planning as WRITE left it. AUDIT
    and DECIDE run no session on it: AUDIT read the documents it was written from, and DECIDE
    decided what it cites. An edit to it since is VALIDATE's to check.
  - **The handoff.** WRITE hands the phases after it what DISCOVER's patterns find once it is
    done, the decision log among them, with the stack markers and the log's entries, whether it
    wrote or not. ANALYZE, SLICE and PLAN read those documents, ANALYZE and DETERMINE_VERIFICATION
    those markers, and PRESENT those entries, so a default WRITE added is listed, and vetoable,
    beside DECIDE's. This is the handoff C-2⁶ gives VALIDATE's last step, made by the phase that
    ends the specification phase in this build; handing planning the checker's parse of the pack
    is D-10′'s (PRDR-290).
  - **It restarts C-8's chain.** The move takes the originals out of discovery, so the next
    `init` re-runs DISCOVER, and on the chain that re-ran every phase after it. WRITE's checkpoint
    is keyed by its own digest alone, read from the disk: the documents and markers DISCOVER's
    patterns find, the pack's contents and its record, and `plan_docs`. It is looked up even while
    earlier phases replay, it is keyed after it runs as DECIDE is (C-2¹²), and the phases after it
    chain from its key. So the next `init` re-runs DISCOVER, AUDIT and DECIDE, which write
    nothing, and re-plans nothing, and an edit to the pack re-plans from WRITE. The key never
    names the prompt: once the pack is written a new prompt writes nothing, and a key that named
    it would re-plan every written pack on an upgrade. `--replan` does not force WRITE (C-8⁵).
  - **The in-flight refusal.** C-8″'s scan goes past a miss to the phase that restarts the chain,
    and resumes there when its key stands, so DISCOVER's re-run is no re-plan. The second ask is
    not made before the phases ahead of WRITE, whose re-run replays nothing past it, and is made
    before WRITE runs.
  - **The session's surface.** WRITE's session declares the pack's paths as its write surface,
    as an implement session's is declared: the decision log, the facts file, and the markdown
    files directly under `docs/design/`, `docs/adr/` and `docs/prd/`, beside its artifact. It gets
    Edit and Write, which the hook confines to that surface, and no Bash. `archive/` is not in it,
    which narrows S-1‴: code moves the originals, and a session that could write `archive/` could
    overwrite one. DECIDE's session, the same role, keeps its artifact alone.
  - **No product gate.** `spec_write` writes documents, so the product's stop gate does not judge
    it. The live backend binds the project's test command as every non-read-only session's stop
    gate, and from PRDR-282 a re-init of a bound project whose tests were red kept DECIDE's
    session from ending over code it cannot touch. Found here.
  - **Routing and progress.** WRITE's session runs as `spec_write`, on `claude-opus-5-5` at `max`
    (S-5⁵). A completed WRITE is a progress mark, written or not (X-1⁵).
  - **Not built here.** VALIDATE, and the checker's parse reaching planning (PRDR-284,
    PRDR-290). That the pack states nothing unbuilt in the present indicative is the session's
    instruction and the checker's heuristic, which reports and never blocks (C-2¹⁰); MUST and
    SHOULD are the schema's, which blocks.
  *Amended by C-2¹⁴ (PRDR-284): VALIDATE is built. It hands the pack to planning in WRITE's
  place, restarts the chain after WRITE, whose key then reaches nothing, and a red checker it
  cannot make green blocks planning.*
  *Amended by D-10″ (PRDR-290): ANALYZE is gone. SLICE and PLAN read the documents, and
  DETERMINE_VERIFICATION, SLICE and PLAN the markers.*

- **C-2¹⁴ (3.1.1, PRDR-284).** VALIDATE is built, in `src/init/validate.ts` and the modules
  beside it, directly after WRITE. This settles what C-2⁶ and C-2⁷ left to VALIDATE's ticket, and
  amends C-2⁶'s simulating reviewer and handoff, C-2⁷'s re-validation and red checker, C-2¹³'s
  chain, C-3⁗'s AWAIT_INFO and S-1‴'s `spec_review`.
  - **When it runs.** VALIDATE classifies the pack again when it runs, since WRITE, before it,
    may have written one. With no record, where WRITE wrote no pack, nothing is validated and
    planning reads the documents as they are. A conforming pack runs no session: DISCOVER's
    classification already ran the checker on it (specification decision 6). A written pack is
    validated whole, or carried on from the rounds a stopped validation left in its record, and a
    changed pack is re-validated for its change. `plan_docs` narrows what planning reads, never
    what VALIDATE reviews.
  - **The checker first.** When the checker blocks on anything, a writer session is given its
    findings, each by an id with its rule, place, text and message, and fixes them before any
    round, checked as a round's writer is (below). A checker still red after the writer's second
    attempt has the writer's fixes undone and stops `init` at VALIDATE with AWAIT_INFO, listing
    what the checker finds: nothing plans from a red pack (C-2⁷). Nothing records that stop, so
    the next `init` runs VALIDATE again, its writer included.
  - **Areas.** The pack's own. The foundations come first: every document at the layout's paths
    that is not a module PRD, which is the decision log, the facts, design, the ADRs and the
    index. Then one area per name in the index's `## Codes`, in its order, holding the module PRDs
    its codes register; a module PRD two areas name is held by the first. A module PRD no code
    registers is an area of its own, named by its file. A context document, or a document at a
    path the layout does not hold, is never reviewed. ksarjs's five areas were an example, not a
    default.
  - **A round.** One `spec_review` reviewer per area that has a document in the round's scope or
    a finding of the round before to verify, one after another, the foundations first. Each is
    given the foundations, its area's documents in scope, the checker's heuristic reports on them
    marked as a heuristic's (C-2¹⁰), and the precedence. The first round reviews. A later round
    verifies: each reviewer is also given the findings of the round before in its area, with what
    became of each, and the diff of that round's fixes, and hunts the defects those fixes
    introduced. A finding carries its severity, blocker, major or minor, its category, every
    passage it stands on at its `file:line` with a quote, why it is wrong, and the exact fix, and
    names the finding of the round before that it continues, if any.
  - **Checked by code.** Every passage a finding quotes must be in one of the pack's documents,
    starting on its line, whitespace aside; a finding it continues must be one the reviewer was
    given; and the reviewer must list every document it was given to review as read. A first
    review with anything wrong is relaunched with the list. The second keeps the findings that
    stand and drops the rest, each said, and names each document it still did not read, which
    that round has not reviewed. A review unusable twice fails the phase, as a failed session
    does. A round's findings are numbered `R<round>-<n>` in the order reported, and two that name
    the same places for the same category are one, the more severe kept in the first one's place.
  - **The writer.** One `spec_write` session applies the round's findings to the pack's paths, its
    declared surface (C-2¹³), and accounts for each by its id, once: applied, or declined with its
    reason. Code checks the pack as it checks WRITE's: the decision log keeps what it held, and is
    restored at once where it does not; a default the writer adds is cited in the pack; the pack
    holds a requirement; and the checker is green. A first attempt with anything wrong is
    relaunched with the list. After the second, a red checker or a pack with no requirement undoes
    every fix of the round, and each finding is left `undone`. An account unusable twice puts the
    pack back as it was and fails the phase. A finding the writer calls applied is declined when
    it changed no document, and one it did not account for is declined too, each with code's
    reason. The diff of the fixes is kept under `.detent/state/validate/` for the next round.
  - **Stop rule and ceiling.** A round with no blocker and no major ends the loop, its minor
    findings fixed by its writer without another round (specification decision 3).
    `spec_validation_rounds`, scope `init`, default 8 (specification decision 13), bounds the loop
    as a ceiling and never a retry. A round at the ceiling that does not meet the stop rule ends
    the loop as well, and the blockers and majors its writer fixed are left `unverified`, beside
    the ones it declined or undid. Its majors go to PRESENT as risks, and planning goes on; a
    blocker stops `init` at VALIDATE with AWAIT_INFO, each listed with its place, its fix and why
    it is open.
  - **The record.** VALIDATE writes the conformance record (C-2⁷) after each round, with the
    rounds so far, not validated, and writes it validated when the loop ends. Each round holds its
    counts by severity, the documents its fixes changed, and the findings it left open, each with
    its first place and quote, its fix, and why it is open: `declined`, `undone` or `unverified`,
    with a reason.
  - **Carrying on.** A record that is not validated and holds rounds is a validation that
    stopped, at the ceiling or in a crash. The next `init` carries it on as a verification of its
    last round: of the findings it left open and the documents its fixes changed, with its diff
    where one was kept. With nothing moved in the pack since, it runs no round when that round met
    the stop rule or reached the ceiling: the rounds say how the validation ends, so a blocker left
    open stops `init` again without a session. An edit to the pack, a removal included, which is
    how a blocker is settled, earns one round past the ceiling to verify it; raising
    `spec_validation_rounds` allows rounds up to its new value.
  - **Re-validating a change.** A validated record whose pack changed starts a new validation, its
    rounds numbered from 1, scoped to the documents added or modified, the documents the last
    validation left findings open in, and whatever cites any of them. Whatever cites a document is
    read from the pack as it is now: a document naming a requirement or criterion it defines, a
    range included; one citing a section of it by its name, or an ADR by its id; one linking to
    it; and, for a changed decision log or facts file, every document citing any decision, default
    or fact, since the record keeps no earlier copy to say which entry moved. A context document
    is never reached, and a change that reaches no reviewed document runs no round and renews the
    record. A later round is scoped to what the round before changed and what its findings named,
    and whatever cites them.
  - **The handoff.** VALIDATE hands the planning phases what C-2¹³ has WRITE hand them: the
    documents DISCOVER's patterns find now, the log among them, the stack markers and the log's
    entries. Beside them go whether it ran, its rounds, the risks and the checker's parse of the
    pack, which no planning phase reads yet (D-10′, PRDR-290). No phase runs twice under one name
    (F-4). PRESENT lists the risks after the defaults, each with its id, its place, its fix and
    why it is open, and says how to settle one: fix it in the pack, and re-run `detent init`.
  - **The chain.** VALIDATE restarts C-8's chain, as WRITE does, keyed after it runs by WRITE's
    digest, which reads the documents, the pack and its record from the disk, and never a prompt
    or the ceiling: a new prompt or a raised ceiling never reopens a finished validation. Its
    fixes and its record move DISCOVER's key and WRITE's, so the next `init` re-runs DISCOVER,
    AUDIT, DECIDE and WRITE, none of which runs a session on a pack, and re-plans nothing: the
    planning phases chain from VALIDATE's key. An edit to the pack re-plans from VALIDATE, and
    WRITE's key reaches nothing. `--replan` does not force it (C-8⁵).
  - **The in-flight refusal.** C-8″'s second ask is made before VALIDATE runs, and not before
    WRITE, whose re-run replays nothing past VALIDATE, so a pack edited while a ticket is in flight
    is refused before any reviewer runs.
  - **Sessions.** `spec_review` is built, read-only: a reviewer writes its artifact alone. The
    scratch directory and the sandbox S-1‴ gives it are not built, so no reviewer runs a
    simulation, and VALIDATE says so once per run: the invariants a pack states are read and
    never run (PRDR-285). The writer is `spec_write`'s `fix` task, on `prompts/spec_write.md`, with
    the pack's paths as its surface (C-2¹³). Both run on `claude-opus-5-5` at `max` (S-5⁵), and
    F-3″'s migration writes `spec_review`'s routing into an existing config as it does `audit`'s.
    `spec_validation_rounds` needs no step: a config's budgets take the default of any key they
    omit.
  - **Progress.** Each round, and a completed VALIDATE with rounds or none, is a progress mark
    (X-1⁵).
  - **Not built here.** The simulating reviewer and its sandbox (PRDR-285); an amendment's
    re-validation (PRDR-286); the reader of the checker's parse (PRDR-290); and each phase's spend
    beside planning's, in PRESENT and `detent status` (C-2⁶), which none of the four phases
    reports: their sessions are on the ledger against ticket `init`, as every init session is.
  *Amended by S-1⁗ (PRDR-285): its reviewers may simulate where the machine has a sandbox, and each
  round without one says why; VALIDATE no longer says once per run that none can.*
  *Amended by D-10″ (PRDR-290): DETERMINE_VERIFICATION, SLICE and PLAN read the stack entry from
  the parse, and nothing else in it is read yet (C-2⁸, C-4⁵).*
  *Amended by X-4⁸ (PRDR-286): an amendment's edit is re-validated as every edit to the pack is,
  at the next `detent init`, which the amendment asks the operator to run.*

- **S-1⁗ (3.1.1, PRDR-285).** S-1‴'s sandbox is built, on macOS: VALIDATE's reviewers may run
  throwaway scripts in a scratch directory their round makes, and nothing a script does reaches past
  it (specification decision 7).
  - **The tool.** A reviewer whose round has a sandbox is given one more tool,
    `mcp__detent_scratch__run`, served in-process: it takes a script's source and the interpreter to
    run it with. Detent writes the script into the session's own directory inside the round's, runs it
    there, and returns how the run ended and what it printed. The reviewer holds no shell, and no Read,
    Write or Edit on the scratch directory, so the output is the only way a result leaves it. The tool
    is given per session, never per role: `spec_review`'s tools are the read tools, and the launch adds
    the scratch tool with its round's grant. No other role may be given it, and the referee's session
    arm gives it to none.
  - **The sandbox.** macOS's Seatbelt, through `/usr/bin/sandbox-exec`, under a profile written for each
    run, which denies by default. A script reads `/`, `/System`, `/usr`, its interpreter's install and its
    own directory, and the metadata of the directories above them: not the repository, and not the
    operator's home. It reads the system's settings, its processor count and host name among them,
    without which node dies and python3 cannot count its processors. It writes its own directory and
    `/dev/null`, reaches no network, local included, and makes no Mach lookup, so it cannot ask a
    system service to act for it. It starts no process: the profile allows no fork and no spawn, so a
    run is the one process Detent started, which signals nothing but itself; a simulation that needs a
    second process cannot run, and threads can. Its environment is `PATH`, a UTF-8 locale, and `HOME`
    and `TMPDIR` set to its own directory: no variable of Detent's crosses (SEC-4). The hook sees the
    tool call, and the sandbox, below it, confines what the script then does.
  - **Limits.** A run stops at 120 s of wall clock, or once its output, both streams together, passes
    64 KiB: Detent kills it, and the reviewer is told which limit stopped it. A CPU limit of twice the
    wall clock, which a script's threads spend together, ends a run Detent no longer can, as when Detent
    itself ends mid-run. A script over 128 KiB, or for an interpreter the sandbox does not offer, is
    refused, and nothing is written or run.
  - **Interpreters.** `python3`, the first on `PATH`, run by its real path in isolated mode, and `node`,
    the one running Detent, each offered with its version. A script uses what the install holds, and
    nothing can be installed. An install that would open more than itself, holding the operator's home
    or the repository, or lying inside the repository, is not read, and an interpreter that then does
    not start in the sandbox is not offered.
  - **The probe.** Before the first round that runs, VALIDATE asks once whether the machine has the
    sandbox. A canary per interpreter must write its own directory, and must fail to write beside it
    and to reach a listener Detent opens. A sandbox that lets either through is off, and so is one that
    cannot be applied, as when Detent itself runs sandboxed; so is a machine with no `sandbox-exec`, and
    every platform but macOS. Off, each round says why, a reviewer's `simulation` input is null, and it
    judges every invariant by reading.
  - **The round.** On, a round makes its scratch directory under the system's temporary directory,
    outside the repository and `.detent/`, and removes it once its reviewers are done, whatever they did;
    a temporary directory inside the repository turns simulation off. Each reviewer's inputs carry
    `simulation`: the tool, the interpreters with their versions, and the limits. The writer is given
    none of it, and VALIDATE names the interpreters once per run. A temporary directory that cannot be
    used turns simulation off for the round too, which says why.
  - **Findings.** A reviewer simulates where a document states an invariant that reading alone cannot
    settle: the rules as the pack states them, seeded, over many random sequences. A sequence that
    breaks the invariant is a finding, checked as every other is: its places quote the rules it breaks,
    and its `why` gives the seed, the sequence, the step that broke it, and how many sequences of how
    many did. Code cannot tell a simulated finding from a read one, and only VALIDATE's writer changes
    the pack.
  - **Not built here.** A sandbox on any platform but macOS: Linux's bubblewrap is not wired
    (PRDR-301), so a self-build on CI and an N-7 run simulate nothing. A memory or disk limit: macOS enforces no memory
    limit on a process, and nothing bounds what a script writes to its own directory, so a script can
    exhaust memory or fill the temporary volume until its time limit ends it. A script that waits when
    Detent ends mid-run: the CPU limit ends only one that computes, so a waiting one lives on, confined,
    until it ends, and its round's directory stays. The record does not say whether a round could
    simulate.

- **S-1⁵ (3.1.1, PRDR-302).** A headless session's built-in tools are the ones its role was given.
  S-1‴ sets tools per role and the plugin's agent files bind them, but the SDK backend passed a base
  set of built-in tools for the planning roles alone (C-4⁵), and ran every other session in the
  `default` mode with its allowlist. That mode approves a read-only shell command before any allow
  rule is read, and the containment hook abstains on a call that names no path (S-2‴), so the
  allowlist bound what it granted and nothing it left out: on tabachir's first live `init`, AUDIT's
  survey, on a role whose allowlist is Read, Grep, Glob, WebSearch and its artifact's write, ran
  `wc`, `ls` and `git log`. Now every session is given the built-in tools its allowlist names and
  no others: a rule's specifier names its tool, an MCP server's tools are left to their server, and a
  spec that names its own base set keeps it. A read-only role has no shell, and what the base set
  leaves out the model never sees, as C-4⁵ made true for the planners. The roles' lists move beside
  the roles (`src/schemas/roles.ts`), below every layer, so the kernel gives a `run` session the list
  the plugin build writes into each agent file (ARCH-2): the kernel had kept a copy, which ARCH-1's
  import rule forced and which had lost S-3⁵'s `git rm`. A write role keeps the mode's approval of a
  read-only command, since its git verbs are Bash.

- **D-22′ (3.1.1, PRDR-303).** A headless session's MCP servers are the ones Detent passes it. D-22
  emptied `settingSources` so that no user, project or local settings file contributes anything to a
  Detent session, and a project's `.mcp.json` stays out with them (probed: a planted stdio server
  was neither listed nor run). The account a session runs on is no settings file: a session on a
  claude.ai login was connected to that account's connectors, and tabachir's AUDIT survey was handed
  Claude Docs' create, update and delete tools beside its Read, Grep and Glob. It called none. Every
  session is now built with `strictMcpConfig`, so its servers are the ones `mcpServers` passes: the
  symbol server where the adapter granted one (S-3⁸) and a VALIDATE reviewer's scratch tool (S-1⁗).
  The plugin driver is unchanged: it runs inside the operator's own Claude Code, where D-29 makes
  the hook authoritative.

- **C-2¹⁶ (3.1.1, PRDR-304).** AUDIT checks its claims four at a time. C-2¹¹ gave each claim a
  session of its own and checked them one after another, so the phase took the sum of every
  check: on tabachir's first live `init` the survey found 132 claims, and each check took about six
  minutes on the `audit` role's routing, some thirteen hours before DECIDE could ask anything. The
  claims are independent. Each session is given one claim and writes one brief, to its own file
  under its own surface (S-1″), and a phase's launches share its one journal (PRDR-203), so
  `AUDIT_CLAIM_BATCH` checks run at once and the next starts as each ends. A claim the documents
  rely on in more than one place is still checked once, as its first place states it, and every
  place is recorded with its verdict in the survey's order, whatever order the checks end in. A
  cached brief still answers without a session, and a brief refused twice still leaves its claim
  unverified and unchecked. A relaunch runs in its own claim's place, so no more than four claim
  sessions are in flight at once. A session that fails still fails the phase: the checks not yet
  started stay unstarted, the ones in flight end, each committing its brief and recording its
  spend, and then the failure is raised, so a re-run pays for none of them again. Spend is read at
  each launch (D-25), and what a batch can run past a reading is one batch, the bound D-28′ states
  for any batch. The size is a constant, not a config key, until a run-time outcome asks for
  another (D-33). No other phase's sessions are batched: VALIDATE's reviewers still run one after
  another (C-2¹⁴).
  *Amended by C-2¹⁷ (PRDR-305): "a re-run pays for none of them again" holds from here. Until then
  a re-run surveyed again, and a claim the new survey worded afresh missed its brief.*
  *Amended by C-2¹⁸ (PRDR-306): a check session is given up to five claims of one topic and writes a
  brief for each, so the batch is four sessions, not four claims. "Each session is given one claim
  and writes one brief" held until then.*

- **C-2¹⁷ (3.1.1, PRDR-305).** AUDIT keeps its checked survey until the phase completes. Its
  checkpoint is written when it completes, and the claim checks after the survey run for hours on a
  large document set, so a run stopped between the two, by a signal, a usage limit longer than
  `init` waits, or a failed claim session, surveyed again on the next `init`. A new survey words its
  claims afresh, and a brief is committed under the hash of its claim's words, so the briefs the
  stopped run paid for answered none of them: tabachir's relaunch onto C-2¹⁶'s build surveyed again,
  where the first survey had taken 38 turns and $9.10. Now the survey, once code has checked it, is kept at
  `.detent/state/audit-survey-kept.json` with the key AUDIT's checkpoint is looked up by, and a run
  of AUDIT whose key has not moved launches no survey: the operator is told so, and the kept
  survey's claims are checked, each one already briefed answering from the cache. A moved key, or a
  file this build does not read, is surveyed again. A kept survey is a unit of work (X-1⁵), code
  writes it, and the structural floor keeps every session out of it (SEC-3′). The phase's
  completion removes it, and its checkpoint stands for it from then on. A session in flight when a
  run stops is not kept: its spend is lost with it (S-4).
  *Amended by C-2¹⁸ (PRDR-306): the triage is kept with the survey, so a re-run whose key has not
  moved neither surveys nor triages the claims already sorted.*

- **C-2¹⁸ (3.1.1, PRDR-306).** AUDIT triages its claims before it checks any (D-34). C-2¹¹ checked
  every claim the survey listed, each in a session of its own on the `audit` role's routing,
  whatever rested on it. On tabachir's test run 138 checks had cost $426 when the user stopped the
  phase. DECIDE is given only the claims that are not confirmed, so the 77 confirmations, about
  $238, changed nothing it was given, and many of the 48 unverified were claims no primary source
  could settle, such as how teachers find their tools or what a ministry plans.
  - **Triage.** After the survey, the claims with no committed brief go to one `audit` session with
    the task `triage` (`src/init/audit-triage.ts`). It reads the documents around each passage and
    writes, for each claim, `load_bearing` (a decision in the documents rests on it), `checkable`
    (a primary source could settle it), `topic` (what one source would settle it with) and `why`.
    Code checks that every claim it was given is sorted once and that nothing else is. A first
    attempt with anything wrong is relaunched with the list, the second keeps what stands, and a
    claim it still leaves out is checked alone, and said. A claim with a committed brief answers
    from it and is not triaged.
  - **What is checked.** Only a claim both load-bearing and checkable. A load-bearing claim no
    source could settle is recorded `unverified` and unchecked, with `triage: "uncheckable"`, and
    DECIDE is given it as an item (C-2¹²). A claim nothing rests on is recorded `unverified` and
    unchecked, with `triage: "not_load_bearing"`. DECIDE is not given it, and AUDIT's note counts
    it apart from the unverified.
  - **Grouped checks.** The claims to check are grouped by topic, compared without regard to case
    or spacing, in the order each topic first appears, at most `AUDIT_CLAIMS_PER_SESSION` (five)
    to a `verify_claims` session. The session is handed a brief's shape for each verdict and
    writes one brief per claim. Each brief is read with every check C-2¹¹ gives a brief, and is
    committed under its own claim's hash. A claim whose brief is refused or missing is left
    without one, and so is a claim two briefs check, since nothing says which the session meant.
    A brief for a claim the session was not given is refused. The claims left without a brief
    are asked for once more, in a session given only them and the validator's words, and a claim
    still without one is recorded unverified and unchecked. The groups are C-2¹⁶'s batch: four
    sessions at once.
  - **Kept.** A triage that sorted anything is a unit of work (X-1⁵), and it is kept with the
    survey (C-2¹⁷), so a re-run whose key has not moved neither surveys nor triages the claims
    already sorted. The prompt describes the three tasks, and a new prompt moves AUDIT's key
    (C-2¹¹), so a survey kept by an earlier build is surveyed again.
  - **Routing.** Unchanged: the triage and the checks are `audit` sessions, on `claude-opus-5-5` at
    `max` (S-5⁵). AUDIT's research counts the triage's session and calls with the checks'.

The `init` pipeline (§4.1 of v2) is **inherited** in its phases and interrupts — since C-2‴/C-3′ (3.1.1), and since C-2⁶/D-10′ (3.1.1, PRDR-278): `INIT_FS → DISCOVER → [AWAIT_DOCS] → AUDIT → DECIDE → [AWAIT_INFO] → WRITE → VALIDATE → [AWAIT_INFO] → DETERMINE_VERIFICATION → [AWAIT_BINDING_CHOICE | AWAIT_SETUP_CONSENT] → SLICE → PLAN → PREPARE_AGENTS → PRESENT → [AWAIT_INFO | AWAIT_APPROVAL] → READY`; the interrupt set is the same five (C-3⁗) — and re-surfaced as plugin commands and skills. C-1…C-8 hold as the dated entries above amend them (with "kernel" → "referee"). v3 restates only the surface and the loop ownership:

- **C-1′** `init` and `run` are the plugin's two commands (`/detent:init`, `/detent:run`), and Detent registers skills so the model invokes the right phase from natural intent ("plan this repo", "keep going"). The headless driver exposes the same two as the retained CLI verbs. C-1's git-root rule and the five C-5 interrupts are unchanged; interrupts are surfaced as the plugin's **presented decisions**, still a closed set of five.
  *AC:* the plugin manifest registers exactly two commands; a docs test asserts the five-decision closed set; subdirectory invocation still exits/《presents》 the root hint with no `.detent/` created.
- **C-9′…C-13′** `run` semantics (execute only an approved plan; atomic claims; resumable pool; escalation handling; exit codes; user-facing vocabulary) are inherited. Under the **model-driven driver**, the loop is: `next` → `claim` → `attempt` → `record`/`gate` → `transition`, chosen by the model, admitted by the referee. Under the **headless driver**, the same sequence is chosen deterministically. C-11 exit codes remain public API for the headless driver; the plugin surfaces the same four outcomes as presented states.
  *AC:* the oracle crash-resume class ports green under the headless driver; an interactive-abandon fixture resumes identically (D-30); both drivers produce byte-identical `transitions.jsonl` for the same admitted sequence.
- **C-14′ Porcelain freeze (major-version).** The golden path is exactly the two workflows and the five closed decisions, now surfaced as the two plugin commands and their presented interrupts. Adding a command or a decision class is a major-version decision requiring a PRD amendment. The v2→v3 re-target is itself such a decision, recorded here (D-26).
  *AC:* release-checklist item; a docs test asserts the two-command, five-decision plugin surface.

*(C-6/C-6a setup-consent, which C-3⁵ (3.1.1, PRDR-298) amends: Detent runs no setup command; C-7 approval, C-8 replay, C-10 escalation, C-12 plumbing, C-13 vocabulary: inherited from v2 §4, reconciled "kernel"→"referee". C-12 plumbing commands become read-only referee tools / plugin subcommands; claim discipline is unchanged.)*

## 8. Sessions & Agent SDK Integration (S, v3)
S-1…S-7 are inherited from v2 §8, reconciled to the two drivers:
- **S-1′ (draft.3, PRDR-067).** An artifact-producing read-only session runs
  `permissionMode: "default"` with its read-only tool surface plus exactly one scoped
  write rule, `Write(//<artifact_out>)` (S-3's specifier mechanism; `doctor` arbitrates an
  unrecognized form). Plan mode remains for artifact-less sessions (doctor's smoke).
  Read-only-ness is the allowlist plus the D-21 hook, not a mode that contradicts P2's
  artifact interface. Found by T-140's first live read-only session.
  *Amended by S-1⁵ (PRDR-302): and the base set of built-in tools, derived from the allowlist,
  since the mode approves a read-only command the allowlist does not name.*
  *Amended by S-1⁗ (PRDR-285): a `spec_review` session whose round has a sandbox is also given
  the tool that runs a script in the round's scratch directory, sandboxed, beside its one write rule.*
- **S-2′/D-21** Containment is the `PreToolUse` hook under **both** drivers — the headless driver wires it when constructing sessions; the plugin ships it as a plugin hook. It denies outside `surface[]`, denies protected globs, preserves the surface-expansion lever, and (D-28) denies ledger-bypassing ambient billable tools. A hook deny binds over every allow rule and permission mode.
- **S-2″ (draft.5, PRDR-068).** The D-21 surface check governs MUTATION: the mutating
  tools (Write/Edit/MultiEdit/NotebookEdit) are denied outside `surface[]` and denied on
  protected globs (SEC-3 is immutability, not unreadability); non-mutating path'd calls
  are allowed anywhere INSIDE the worktree, and the outside-worktree boundary (P7) holds
  for every tool. Found by T-140: a worker denied READING the PRD's §10 — its own
  specification — shipped an empty diff that only the D-6 review layer caught. Driver-mode
  policy unchanged (D-27: the driver neither reads nor writes files).
  *Amended by S-1⁗ (PRDR-285): the scratch tool names no path, so the hook leaves it to the
  allowlist; the script it runs writes outside the worktree, in its round's scratch directory, where
  the sandbox, not the hook, confines it.*
- **OQ-2 resolved (draft.6, PRDR-074).** The license is **MIT** — chosen by the user
  2026-08-20 during T-141 publish preparation. v2 posed MIT vs Apache-2.0 as the sole
  M4 blocker; MIT matches the header's "public, open source" delivery and the plugin
  ecosystem's norm. `LICENSE` at the repo root is the operative text; the v2 document
  stays frozen with the question as it stood.
- **C-12⁗ (3.0.1, PRDR-078; renumbered from C-12′ by PRDR-288).** The plumbing set gains `unclaim <id>` / `unclaim
  --stale`: an explicit, state-independent release for claims whose owner is
  verifiably dead — the crash-resume case approve/requeue cannot legally reach.
  Live owners refuse with pid and age; unreadable claims stay held (R-3); the
  break is an attributed ticket note, never a transition. Porcelain unchanged
  (plumbing sits outside C-14's freeze).
- **C-9⁗ (3.0.2, PRDR-079; renumbered from C-9′ by PRDR-288).** The resumable pool self-heals stale claims: a
  claim that is readable, recorded on this host, and held by a dead pid is
  released (kernel-noted) and its ticket rejoins the pool — D-30's crash-resume
  sentence now holds without operator surgery. Live, foreign-host, and
  unreadable claims stand. Claims record their host; one breakability
  predicate serves the pool and every plumbing verb.
- **S-3′** Per-role tool allowlists define the role surface; containment is the hook, never the allowlist (unchanged from PRDR-050).
- **D-22/D-29** Setting-source isolation splits by driver: `settingSources: []` retained headless; on the plugin the hook is authoritative over loaded settings, and referee legality never consults repo settings.
  *Amended by D-22′ (PRDR-303): headless, `strictMcpConfig` too, so an account's claude.ai connectors stay out.*

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
*Amended by C-3⁵ (3.1.1, PRDR-298): planning research is deleted, so those mechanics are later tickets' concerns.*

---

## Inheritance (from v2.0-draft.7)
The following sections are **driver-agnostic** and are inherited from `detent-prd-v2.md`, with the single reconciliation "kernel" → "referee", as the dated entries of §4 and §8 amend them; each of those entries names the rule it amends:
- **§3 Scope & Non-Goals** — including NG7 (Claude Code remains the only backend; a plugin *is* Claude Code, so NG7 is reinforced, not weakened). NG2 is lifted by D-5′ (3.1.1, PRDR-278): gates bind per package, as V-5″ (PRDR-295) builds.
- **§5 Filesystem Contract (F)** — `.detent/` layout, the committed set, content-addressed checkpoints (F-4). **F-1′ (draft.4, PRDR-066/PRDR-064 applied):** the local set gains the two D-21 hook-policy files (`active_surface.json`, `stage.json` — run-level, never committed); and the plan directory is `plan/` (tickets `<ticket-id>.json`, plus the plan artifact `plan.json` and the approval record `approval.json`) — a file in `plan/` is a ticket **iff** its name is not one of the reserved names `plan.json` and `approval.json`; the reserved set is closed, and a reader that enumerates the directory asserts against it rather than carrying its own list. This is A-2's stated home, raised unprompted by the N-7 analyst reading this document (T-140).
- **§6 Verification Adapter Contract (V)** — discovery, binding, execution, drift. V-5 is amended by V-5′ (3.1.1, PRDR-278): each package's gates are bound, as V-5″ (PRDR-295) builds.
- **§7 Execution State Machine (X)** — the twenty states, the X-3 transition table, the escalation ladder, the budgets of X-1, `GATE_DRIFT` (D-23), attempt generations (D-17). The referee *is* this machine. Its twenty states are unchanged; its table, budgets and signals are amended by the dated `X-*` entries of §4, among them X-3′ (3.1.1, PRDR-278), which admits a false premise from the three fix states, and by C-12‴'s requeue rows.
- **§9 Branch & Merge Contract (B)**, **§10 Artifacts (A)**, **§12 Non-Functional (N)** — including N-7 self-build, now naming `detent-prd-v3.md` as its target and running the specification phase headless (N-7′) — **§14 Metrics**, **§15 Risks**.

Where an inherited section says the CLI is the entry point, read "the headless driver or the plugin"; where it says "the kernel decides", read "the referee admits, the driver sequences" (D-27). An inherited requirement's *semantics* change only where a dated entry amends it by name; otherwise only the delivery surface and the loop's driver do.
