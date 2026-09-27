---
description: Prepare a repository for Detent - discover docs and verification entrypoints, generate a plan of tickets, and obtain human approval. Use when the user asks to set up, initialize, or plan a repo with Detent.
---

# Detent init

Detent's public surface is exactly two workflows (C-14′): `init` prepares a
project; `run` executes the approved plan. You are handling `init` — you
present, relay human answers, and re-invoke; the init machine owns every
artifact and every checkpoint (P2, C-8).

Arguments passed by the user: $ARGUMENTS

## Ground rules

- **Git-root rule (C-1).** `init` acts only at the repository root. From a
  subdirectory, present the root hint and stop — create nothing, especially
  no `.detent/`.
- **The machine owns state.** Never create or edit anything under `.detent/`,
  and never fabricate discoveries, analyses, bindings, tickets, or approval
  records. You drive the pipeline by invoking it and by relaying answers only
  a human gave.
- **Live backend required.** SLICE and PLAN are session outputs; the
  pipeline needs `ANTHROPIC_API_KEY` in the environment and says so itself if
  it is missing — report that message verbatim and stop.

## Driving the pipeline

Invoke the headless entry from the Detent checkout (this plugin's root):

    "${CLAUDE_PLUGIN_ROOT}/node_modules/.bin/tsx" "${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts" init <project-root> [flags]

Pass through flags from $ARGUMENTS (for example `--replan`). Re-invoking is
always safe: every phase checkpoints, and C-8 replays exactly what changed —
editing a planning document replays the phases that read it, and the planning
after them; editing nothing replays nothing.

## The eleven phases (C-4.1, in order)

`INIT_FS` → `DISCOVER` → `AUDIT` → `DECIDE` → `WRITE` → `VALIDATE` →
`DETERMINE_VERIFICATION` → `SLICE` → `PLAN` → `PREPARE_AGENTS` → `PRESENT`

`AUDIT` (C-2⁶) reads the documents before anything plans from them: passages
that contradict each other, gaps, and, in an existing project, what the
documents say is built that the code does not do. It checks every external
claim the documents rely on against a primary source, and prints what it
found. It never stops for a human. Its checkpoint is keyed by the documents
and the code, so re-invoking after an edit to either re-runs it, and a claim it
has checked is not checked again.

`DECIDE` (C-3⁗) sorts everything `AUDIT` left open, before anything plans from
it. A decision counted in money or contracts is a question for the human; every
other item is settled as a vetoable default, or by an entry the decision log,
`docs/founder-decisions.md`, already holds. In a new project whose log records
no stack, the stack is decided here (D-10′). On a terminal the questions are
asked in screens of at most four, and each answer is written to the log as a
decision. Invoked from this plugin there is no terminal, so `DECIDE` takes each
recommended answer and writes it to the log as a vetoable default
(specification decision 9); `PRESENT` lists every default, and the human vetoes
one by editing its row and re-invoking. A question the log already answers is
not asked again. An edit to the log re-runs `DECIDE` and the planning after
it, never `AUDIT`.

`WRITE` (C-2¹³) rewrites the audited and decided documents into the pack, the
layout C-2⁷ fixes under `docs/`: the decision log, `research/verified-facts.md`,
`design/`, `adr/` and `prd/`, where every requirement has an id, a milestone
and MUST or SHOULD, and every decision and default it relies on is cited by
id. It moves each original it rewrote to `archive/`, where no discovery
pattern looks, and deletes nothing; a README or a runbook stays where it is,
as context. It never stops for a human. The pack checker checks what it
wrote, and its session is relaunched once on a blocking finding; the result,
red or green, goes into `docs/conformance.json`, which says the pack is not
validated. A conforming pack, a changed one, a pack `WRITE` already wrote, and
documents `plan_docs` narrows are never rewritten.

`VALIDATE` (C-2¹⁴) validates the pack before anything plans from it. A red
pack checker is fixed first. Each round then runs one reviewer per area of the
pack, the areas its index names, and one writer applies what they found, each
finding with its severity, its `file:line`, a quote and the exact fix; the
next round verifies those fixes and hunts what they introduced. A round with
no blocker and no major ends the loop, its minor findings fixed.
`spec_validation_rounds` (default 8) is the ceiling: there, the majors left
open go to `PRESENT` as risks and planning goes on, and a blocker stops `init`
for the human to settle. Every round is recorded in `docs/conformance.json`, so
re-invoking carries on from the last. A conforming pack runs the checker
alone; an edited one is re-validated for the edit and whatever cites it.

`DETERMINE_VERIFICATION` binds the project's gate commands, for the root and
for each package with a manifest of its own, each in its package's directory
(V-5′). In an existing project it discovers them and runs each before binding
it; in a new one, where nothing can run yet, it proposes the commands the
decision log records for each package under `## Packages` (D-10′), and the
bootstrap ticket proves them. A ticket's gates are its packages', so a ticket
writing where no package has a gate fails one of `PLAN`'s checks.

`SLICE` (C-2‴) cuts the whole document set into ordered increments — the
walking skeleton first. On a pack (C-2⁸) code groups the requirement ids by
milestone and module for it, refuses a cut that loses, repeats or invents
one or delivers a milestone out of order, and keeps the cut from one run to
the next, so an edited requirement re-plans only its own slice. `PLAN` then
plans every slice in turn, one session-sized ticket set per slice. Code
checks every draft, and after every slice the plan so far (A-1⁷): coverage
of each requirement, baseline item and criterion, one provider for each name
a ticket uses, milestone order, a gate for every path a ticket writes, and
no dependency cycle. A draft that fails is redrafted once with its failures;
no model reads the whole plan. A `plan_review` session reads each slice's
draft once, after it passes the checks (C-4⁸), and grades each finding
blocker, major or minor with its fix: a blocker or major buys the slice one
revision, which code checks and no review reads again, and a minor reaches
the sessions that run its ticket. Planning does not pause between slices: it
runs to the end of the product, and asks nothing. On a pack (C-4⁵) each
slice is drafted from its requirements' records, and what the pack leaves
unsettled is a spec defect, quoted from it, that `PRESENT` lists.
`SLICE` also places Detent's production baseline (C-2⁗ — secrets, auth,
backups, health checks, CI gates, and the rest) into the slices where each
item belongs, so the plan is production grade even when the documents never
asked; `plan_baseline: "none"` in `.detent/config.json` opts a project out.

## The five presented decisions (C-5 — a closed set)

The pipeline pauses by printing `[DECISION_NAME]` plus a message, then
exiting. Present that message faithfully, collect the human's answer, enact
it through the decision's own channel, and re-invoke. You never answer a
decision yourself.

1. **`AWAIT_DOCS`** — raised at `DISCOVER` when no planning documents exist
   (C-2). Channel: the human supplies or names the documents; re-invoke.
2. **`AWAIT_INFO`** — raised at `DECIDE`, at `VALIDATE` or at `PRESENT`, for
   what only the human can settle. At `DECIDE` (C-3⁗), a human on a terminal
   chose to answer later: the message lists every question with its options,
   the recommended one first, and nothing was written to the decision log.
   Channel: the human answers by re-running `detent init` on a terminal, or by
   writing each answer as a row under `## Decisions` in
   `docs/founder-decisions.md`; then re-invoke. At `VALIDATE` (C-2¹⁴), the
   review rounds reached their ceiling with a blocker left open, or the pack
   checker stayed red: the message lists each one at its `file:line`. Channel:
   the human settles each in the pack, or, for a blocker, raises
   `budgets.spec_validation_rounds` in `.detent/config.json`; then re-invoke.
   `VALIDATE` runs the checker again, and carries on from the round it stopped
   at. At `PRESENT` (C-4⁵), planning found a spec defect: the pack contradicts
   itself, or leaves unsettled something a ticket cannot be built without. The
   whole plan is written first, and the message lists each defect with the
   slice that reported it and the passages it quotes, each at its `file:line`.
   Approval is not offered while one is open, on either exit. Channel: the
   human amends the pack where each defect quotes it (or dictates edits they
   approve), then re-invoke — `VALIDATE` re-validates the edit, and the slice
   that reported the defect is planned again from the amended records.
   `detent init --replan` plans every slice again without an amendment. Also
   at `PRESENT` (A-1⁷), a check still fails after the one redraft planning
   sent: a requirement, baseline item or criterion no ticket delivers, a name
   with no provider or two, a ticket waiting on a later milestone's work, a
   dependency cycle, or a ticket writing where no package has a gate a ticket
   runs (V-5′). `PRESENT` checks the tickets as they stand, and the message
   names each failure with its ticket. Approval is not offered while one
   fails, on either exit. Channel: the human amends the pack where a failure
   lies, or edits the tickets under `.detent/plan/`; for a path no gate can
   fail, declares that package's gate commands under `## Packages` in
   `docs/founder-decisions.md`, each run in the package's own directory, or
   gives the package a `test`, `lint` or `typecheck` command of its own, or
   narrows the surface that reaches it; then re-invoke.
3. **`AWAIT_BINDING_CHOICE`** — raised at `DETERMINE_VERIFICATION` when more
   than one plausible verification command exists for a slot (C-3b). Present
   every candidate verbatim; Detent never guesses between them (V-1).
   Channel: the human disambiguates the project's own tooling, then
   re-invoke.
4. **`AWAIT_SETUP_CONSENT`** — raised at `DETERMINE_VERIFICATION` when
   required verification cannot run yet (C-3b/C-6). Present the situation and
   any proposed setup command verbatim; only the human may consent, and
   Detent executes setup commands solely from its allowlist with every
   consent logged (C-6a, SEC-1). Channel: the human establishes the tooling —
   themselves, or by consenting to the proposal — then re-invoke.
5. **`AWAIT_APPROVAL`** — raised at `PRESENT` (C-7): the plan's dual-exit
   approval. Present the plan summary verbatim, once (C-7‴): the slices,
   tickets and milestones, the decision log with each default marked
   vetoable, the risks, and what each specification phase and planning cost,
   reported and never capped. It lists each blocker and major a slice's
   review found (C-4⁸), with its fix, since no review read the revision it
   bought: the human reads the tickets each one names before answering. The
   human answers approve, decline, or defer. Relay it on the re-invocation
   with exactly one flag: `--approve --by "<their name>"`, `--decline`, or
   `--defer`. After what each phase cost, the summary names the Detent build
   that made the plan (N-5″). Where it names more than one, or a part that
   names no build, ask the human whether they accept that before they
   approve, and relay `--accept-mixed-builds` beside `--approve` only on
   their yes; without it the approval is refused. Approval is recorded with
   who, when, and the hash of what was approved, and the builds that made it;
   a decline leaves the plan READY-unapproved; a deferral hands presentation
   to the first `run`, which shows the same text (C-7).

## Outcome

Report exactly where things stand: plan approved and READY (offer
`/detent:run`), a decision pending (present it as above), or the pipeline's
own refusal (not a git root, needs a live backend) verbatim.
