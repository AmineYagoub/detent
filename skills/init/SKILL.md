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
- **Live backend required.** ANALYZE and PLAN are session outputs; the
  pipeline needs `ANTHROPIC_API_KEY` in the environment and says so itself if
  it is missing — report that message verbatim and stop.

## Driving the pipeline

Invoke the headless entry from the Detent checkout (this plugin's root):

    "${CLAUDE_PLUGIN_ROOT}/node_modules/.bin/tsx" "${CLAUDE_PLUGIN_ROOT}/src/cli/index.ts" init <project-root> [flags]

Pass through flags from $ARGUMENTS (for example `--replan`). Re-invoking is
always safe: every phase checkpoints, and C-8 replays exactly what changed —
editing PRD.md re-runs AUDIT and replays ANALYZE-forward; editing nothing
replays nothing.

## The ten phases (C-4.1, in order)

`INIT_FS` → `DISCOVER` → `AUDIT` → `DECIDE` → `ANALYZE` →
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
it, never `DISCOVER` or `AUDIT`.

`SLICE` (C-2‴) cuts the whole document set into ordered increments — the
walking skeleton first — and `PLAN` then plans every slice in turn, one
session-sized ticket set per slice, reviews each, reviews the whole plan for
coherence and coverage, and revises what the reviews fault. Planning does not
pause between slices: it runs to the end of the product, and the questions it
could not answer ride to `PRESENT`. `SLICE` also places Detent's production
baseline (C-2⁗ — secrets, auth, backups, health checks, CI gates, and the
rest) into the slices where each item belongs, so the plan is production grade
even when the documents never asked; `plan_baseline: "none"` in
`.detent/config.json` opts a project out.

## The five presented decisions (C-5 — a closed set)

The pipeline pauses by printing `[DECISION_NAME]` plus a message, then
exiting. Present that message faithfully, collect the human's answer, enact
it through the decision's own channel, and re-invoke. You never answer a
decision yourself.

1. **`AWAIT_DOCS`** — raised at `DISCOVER` when no planning documents exist
   (C-2). Channel: the human supplies or names the documents; re-invoke.
2. **`AWAIT_INFO`** — raised at `DECIDE` or at `PRESENT`, for questions only
   the human can answer. At `DECIDE` (C-3⁗), a human on a terminal chose to
   answer later: the message lists every question with its options, the
   recommended one first, and nothing was written to the decision log.
   Channel: the human answers by re-running `detent init` on a terminal, or by
   writing each answer as a row under `## Decisions` in
   `docs/founder-decisions.md`; then re-invoke. At `PRESENT` (C-3′), the whole
   plan is written first, and every question planning could not answer — from
   analysis, slicing, and each slice's drafting — is presented ONCE with it,
   each with the assumption the plan proceeds on. It becomes `AWAIT_INFO` only
   when a question is blocking: no assumption could carry it. Channel: the
   answers go INTO the planning documents; the human edits (or dictates edits
   they approve), then re-invoke — changed contents re-run AUDIT and replay
   ANALYZE-forward (C-8), and only the slices whose inputs moved are
   re-planned. Answers written to `docs/founder-decisions.md` re-run DECIDE and
   the planning after it, never AUDIT: that file is the decision log, which
   AUDIT's key and DISCOVER's listing leave out (C-2¹¹, C-2¹²).
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
   approval. Present the plan summary verbatim; the human answers approve,
   decline, or defer. Relay it on the re-invocation with exactly one flag:
   `--approve --by "<their name>"`, `--decline`, or `--defer`. Approval is
   recorded with who, when, and the hash of what was approved; a decline
   leaves the plan READY-unapproved; a deferral hands presentation to the
   first `run` (C-7).

## Outcome

Report exactly where things stand: plan approved and READY (offer
`/detent:run`), a decision pending (present it as above), or the pipeline's
own refusal (not a git root, needs a live backend) verbatim.
