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
editing PRD.md replays ANALYZE-forward; editing nothing replays nothing.

## The seven phases (C-4.1, in order)

`INIT_FS` → `DISCOVER` → `ANALYZE` → `DETERMINE_VERIFICATION` → `PLAN` →
`PREPARE_AGENTS` → `PRESENT`

## The five presented decisions (C-5 — a closed set)

The pipeline pauses by printing `[DECISION_NAME]` plus a message, then
exiting. Present that message faithfully, collect the human's answer, enact
it through the decision's own channel, and re-invoke. You never answer a
decision yourself.

1. **`AWAIT_DOCS`** — raised at `DISCOVER` when no planning documents exist
   (C-2). Channel: the human supplies or names the documents; re-invoke.
2. **`AWAIT_INFO`** — raised at `ANALYZE`: one batch of questions planning
   research could not settle (C-3/C-3a). Channel: the answers go INTO the
   planning documents; the human edits (or dictates edits they approve), then
   re-invoke — changed contents replay ANALYZE-forward (C-8).
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
