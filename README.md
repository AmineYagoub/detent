# Detent

[![ci](https://github.com/AmineYagoub/detent/actions/workflows/ci.yml/badge.svg)](https://github.com/AmineYagoub/detent/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/AmineYagoub/detent?display_name=tag&sort=semver)](https://github.com/AmineYagoub/detent/releases)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node ≥ 22](https://img.shields.io/badge/node-%E2%89%A5%2022-brightgreen.svg)](.github/workflows/ci.yml)
[![N-7 self-build](https://github.com/AmineYagoub/detent/actions/workflows/self-build.yml/badge.svg)](docs/release-checklist.md)

Detent turns planning documents into merged, reviewed, test-gated code using
fresh, single-purpose Claude Code sessions whose every consequential move is
admitted by a deterministic referee.

Planning tools (spec-kit, Superpowers, BMAD and their peers) write excellent
documents. Those documents are Detent's *input*. Detent is the referee
underneath that layer: it makes the run auditable, budgeted, and contained,
whichever way the plan was written.

- **An auditable state machine**: every admitted transition is journaled to
  `transitions.jsonl`; the run's ground truth is never a chat log.
- **Hard budgets**: attempt and spend ceilings you set yourself; a ceiling
  never auto-retries, it presents a human decision.
- **Verification bound to your project, with drift halts**: Detent executes
  your repo's own test/lint/build commands, and halts for re-baselining if
  they change mid-run.
- **Per-ticket write containment**: a deny-enforced hook holds every session
  inside its ticket's declared surface; allow-rules cannot shadow it.

Detent maintains itself under the same rules: the N-7 self-build gate,
Detent building its own walking skeleton from its own PRD, is a permanent
release requirement, not a demo.

## Install

```bash
claude plugin marketplace add AmineYagoub/detent
```

```bash
claude plugin install detent@detent
```

For development, load the checkout with `claude --plugin-dir /path/to/detent`.
The headless driver is the same referee under a deterministic loop, for CI
and unattended runs.

## The golden path

Two commands. That is the whole public workflow.

```bash
detent init
```

`init` runs eleven phases, in order. On a terminal it asks you DECIDE's questions as it goes, and otherwise it stops between them only where VALIDATE cannot go on without you:

- **INIT_FS**: checks you're at a git root and scaffolds `.detent/`.
- **DISCOVER**: finds your planning documents and candidate verification commands.
- **AUDIT**: reads the documents before anything plans from them. It finds passages that contradict each other, gaps a plan would need filled, and, in an existing project, what the documents say is built that the code does not do. It sorts the external claims they rely on, such as a library's behaviour at the version you pin, and checks each one a decision rests on and a primary source could settle against that source, each in a session of its own. A claim a decision rests on but no source could settle goes to DECIDE, and a claim nothing rests on is recorded, not checked. It prints what it found, and DECIDE settles it.
- **DECIDE**: settles what AUDIT left open before anything plans from it. A decision counted in money or contracts is asked, in screens of at most four, the recommended answer first and each option with what choosing it means; everything else is settled as a default you can veto. Both go into `docs/founder-decisions.md`, the decision log, which every later phase reads, and a question the log already answers is not asked again. Off a terminal it takes each recommended answer and says so. In a new project it also decides the stack.
- **WRITE**: rewrites the documents into the pack, a fixed layout under `docs/` in which every requirement has an id, a milestone and MUST or SHOULD, every acceptance criterion states Given, When and Then, and every decision and default the pack relies on is cited by id. It moves each original it rewrote to `archive/` and deletes nothing; a README stays where it is. The pack checker checks what it wrote, its session is relaunched once on a blocking finding, and the result, red or green, goes into `docs/conformance.json`, which says the pack is not validated yet.
- **VALIDATE**: validates the pack before anything plans from it. A red pack checker is fixed first. Then each round runs one reviewer per area of the pack, the areas your index names, and each finding comes with its severity, blocker, major or minor, its `file:line`, a quote and the exact fix; a writer applies them, and the next round checks those fixes and what they broke. A round with no blocker and no major ends it, its minor findings fixed. `spec_validation_rounds` (default 8) is the ceiling: there, the majors left go to PRESENT as risks and planning goes on, and a blocker stops `init` for you to settle, after which `detent init` carries on where it stopped. A checker it cannot make green stops `init` too. Every round's counts and what it left open go into `docs/conformance.json`. An edit to a validated pack is re-validated for the edit and whatever cites it. The phases after it plan from the pack.
- **DETERMINE_VERIFICATION**: probes candidate test/lint/build commands and binds the ones that actually run, for the root and for every package in the repository (a directory with a manifest of its own, such as `package.json`, `go.mod`, `pyproject.toml` or `Cargo.toml`), each run in its package's directory. A ticket's gates are those of the packages its surface touches, and a plan with a ticket writing where no package has a gate cannot be approved. In a new project there is nothing to run yet, so it proposes the gate commands the decision log records for each package, and the bootstrap ticket proves them.
- **SLICE**: cuts the whole product into ordered increments — walking skeleton first — and places a production baseline (secrets, auth, backups, health checks, CI gates, …) in the slice where each item belongs, whether or not your documents asked for it. On a pack it groups the pack's requirement ids by milestone and module, refuses a cut that loses, repeats or invents one or delivers a milestone out of order, and keeps its cut from one run to the next: an edited requirement re-plans only its own slice, and a new one is placed without moving any other.
- **PLAN**: plans every slice in turn into tickets with acceptance criteria, surfaces, and dependencies. Code checks every draft, and after every slice the plan so far: each requirement, baseline item and acceptance criterion reaches a ticket, each name a ticket uses has exactly one provider in its own slice or an earlier one, no ticket waits on a later milestone's work, every path a ticket writes has a gate, and no dependency cycle remains. A draft that fails is redrafted once with its failures, and no model reads the whole plan. A draft that passes is read once by a reviewer of its own role, for what code cannot check: a ticket too big for one session, a slice that builds infrastructure before anything runs end to end, a dependency no contract names, and tickets that contradict each other or the specification. It grades each finding blocker, major or minor, with the fix. A blocker or major buys the slice one revision, which code checks and no reviewer reads again; a minor goes to the sessions that run its ticket. On a pack, each slice is drafted from its requirements as the pack checker parses them, with their acceptance criteria and what they cite, and a ticket copies each criterion it delivers word for word. Planning asks nothing: what the pack contradicts or leaves unsettled is reported as a spec defect, quoted from the pack, and a quote the pack does not hold is refused.
- **PREPARE_AGENTS**: assigns roles and, where configured, models per ticket.
- **PRESENT**: shows you the slices, the tickets and the milestone of each, the decision log (every decision, and every default, marked vetoable), every risk VALIDATE left open, every blocker and major the plan's review found, with its fix, since no reviewer read the revision it bought, any slice no reviewer read, every spec defect planning found, and what each specification phase and planning cost, which is reported and never capped. It names the Detent build that made the plan and the pack it was planned from; a plan more than one build made, or with a part written before builds were recorded, is approved only once you accept that, with y at a `[y/N]` on a terminal or `--accept-mixed-builds` beside `--approve`, and `detent init --replan` makes it again with one build. Then it stops for your approval. The plan is printed once, and `detent run` shows that same text when approval was deferred. To veto a default, edit its row in the log and run `detent init` again. A spec defect holds approval, on a terminal or not, until you amend the pack where it quotes it and run `detent init` again; the slice that reported it is then planned again. So does a check that still fails after its redraft: PRESENT checks the tickets as they stand, so amend the pack, or edit the tickets under `.detent/plan/`, and run `detent init` again.

Before each costly step, AUDIT's claim checks, each VALIDATE round's reviews and its writer's
batches, and PLAN's slices, `init` says how many it will run and what they should cost and how
long they should take: the units times a unit's figure, run as many at once as the step runs them.
The figure is the median of this project's own sessions of the kind once there are five, and
otherwise Detent's measured figure, which the note names with the run that measured it; a kind
nothing has measured yet is said to have no estimate. An estimate informs, and nothing waits for it.

```bash
detent run
```

```mermaid
flowchart TD
    I["detent init"] --> A{"your approval"}
    A --> R["detent run"]
    R --> C["claim next ticket"]
    C --> S["fresh session<br>contained to the ticket's surface"]
    S --> G{"your own gates<br>test · lint · build"}
    G -- green --> V{"independent review"}
    G -- red --> L["fix ladder<br>blind → research → informed"]
    L --> G
    L -- exhausted --> H["you<br>dossier in hand, requeue at will"]
    H --> C
    V -- changes --> S
    V -- approve --> D["DONE<br>finalized on the run branch"]
    D --> C

    classDef you fill:#fbbf24,stroke:#b45309,color:#1f2937
    classDef machine fill:#6366f1,stroke:#4338ca,color:#ffffff
    classDef verify fill:#34d399,stroke:#047857,color:#1f2937
    classDef ladder fill:#f87171,stroke:#b91c1c,color:#1f2937
    class A,H you
    class I,R,C,S,D machine
    class G,V verify
    class L ladder
```

Amber is you; indigo is the machine's moves; green is verification; red is
the fix ladder. Every arrow is a referee-admitted transition, journaled to
`transitions.jsonl`. Budgets are evaluated at session launch and a breached
ceiling routes to a human, never to a retry; a risk-labelled ticket takes
one extra stop at your approval before DONE.

## Works with existing and new projects

**Existing projects** are the primary case, however far along: Detent binds
to the repo's own verification commands, plans from your planning documents,
and works on a run branch: the existing code and history are read, never
rewritten. Scope the document to the work that REMAINS; the generated
tickets are presented for your approval before anything runs, and they are
editable: prune any the codebase already satisfies. If a stale ticket
slips through, the session discovers the premise is already met, signals it,
and stops rather than writing duplicate code. Start from a green suite:
gates run your own commands, and pre-existing failures would be blamed on
the first ticket. Plan increment by increment: an approved plan stays
frozen, and `detent init --replan` starts the next one.

**New projects** need only a folder containing the planning document:
Detent derives the stack, scaffolds through its own bootstrap ticket, and
builds from nothing. That path is the permanent release gate: every Detent
release must build Detent's own walking skeleton from its own PRD.

## Models

Every session runs on Claude Opus 5.5 or Claude Sonnet 5.5. `init` writes this
routing to `.detent/config.json`:

| Roles | Model | Effort |
|---|---|---|
| `planner`, `plan_review`, `audit`, `spec_write`, `spec_review` | `claude-opus-5-5` | `max` |
| `review`, `diagnose`, `informed_fix` | `claude-opus-5-5` | `xhigh` |
| `implement`, `blind_fix`, `review_fix`, `research` | `claude-sonnet-5-5` | `xhigh` |

The roles that judge, plan and specify run on Opus; the roles that write code
run on Sonnet. Edit `model_routing` and `effort_routing` in
`.detent/config.json` to change either. A config written by an earlier Detent
keeps its own routing: `detent doctor`, and `init` and `run` before their first
session, name each role still on a model a newer default supersedes, with the
line that moves it. Sessions run on the Claude Code the Agent SDK bundles, not
the `claude` on your PATH, so `doctor` also fails on a routed model that
runtime cannot serve.

## What Detent will never do

- Write to your base branch: work happens on a `detent/run-<id>` branch.
- Transition on a claim: only artifacts and exit codes move a ticket forward.
- Redefine a gate mid-run: if a verification command changes in flight,
  Detent halts and asks you to re-baseline.
- Own your tooling: `.detent/` never contains your project's configuration.

## Exit codes

`run` exit codes are public API:

| Code | Meaning |
|---|---|
| `0` | plan complete |
| `10` | human-gated items remain |
| `2` | not ready (no or unapproved plan, binding drift) |
| `1` | error |

## Your working tree

During a run Detent works in a per-ticket git worktree under
`.detent/worktrees/`, merged `--no-ff` into the run branch when the ticket is
done — never into your base branch. Your own checkout is left alone.

`--no-worktree` runs in your checkout instead. Say so deliberately: in that mode
Detent resets uncommitted tracked changes at resume, moves untracked files it
does not own aside, and stages the tree when a ticket finalizes. Those are the
right behaviours for a tree Detent owns and the wrong ones for yours.

## Plumbing

Documented, scriptable, and never required on the golden path:
`detent status`, `detent report`, `detent doctor`, `detent approve <id>`,
`detent requeue <id>`, `detent unclaim <id>`, `detent amend <AM-id>`, `detent verify sync`.

`detent amend <AM-id>` shows an amendment a session filed against the specification pack, and
decides it with `--approve`, `--edit <file>` or `--reject <reason>`. An applied amendment waits for
`detent init`, which re-validates the pack and re-plans the slices it changed.

`detent status` also shows how the plan is running, for the plan and for each
slice: tickets done, and done in their first generation, stops for you,
falsifications by cause, budget breaches, review rounds, cost and time at work,
with the builds that made the plan and its pack; then what `init` spent on each
phase. A run records the same figures in its journal when it ends. They are
evidence for deciding which planning mechanisms stay, and they gate nothing.
While `init` is in a costly step, `detent status` shows the step, the units done
and left, what they have spent so far, and an estimated finish from the figures
its note gave; after a stop, it shows the step the stop left and how far it got.

## License

[MIT](LICENSE).
