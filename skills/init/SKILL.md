---
description: Prepare a repository for Detent - discover docs and verification entrypoints, generate a plan of tickets, and obtain human approval. Use when the user asks to set up, initialize, or plan a repo with Detent.
---

# Detent init

Detent's public surface is exactly two workflows (C-14′): `init` prepares a
project; `run` executes the approved plan. You are handling `init`.

Arguments passed by the user: $ARGUMENTS

## The contract you are operating under

- **Git-root rule (C-1).** `init` acts only at the repository root. If the
  current directory is a subdirectory of a git repository, tell the user to
  re-invoke from the root and stop — create nothing, especially no `.detent/`.
- **The referee owns state (P2/ARCH-1).** Never create or edit files under
  `.detent/` yourself, and never fabricate plan tickets, bindings, or approval
  records. Every state change is admitted by the Detent referee; your job is to
  route the user to it and to present its questions faithfully.
- **The five presented decisions (C-5).** Interactive init pauses only at a
  closed set of five decisions, each answered by the human, never by you:
  1. `AWAIT_DOCS` — no planning documents found; the user supplies or names them.
  2. `AWAIT_INFO` — the analyzer has batched questions only the user can answer.
  3. `AWAIT_BINDING_CHOICE` — more than one verification binding candidate; the
     user picks.
  4. `AWAIT_SETUP_CONSENT` — a setup command needs explicit consent before it
     runs.
  5. `AWAIT_APPROVAL` — the generated plan is presented; nothing executes until
     the user approves it.

## What to do at this milestone (MP1)

The interactive init pipeline surfaces as plugin phases at MP3. Until then:

1. Report what exists: whether the current directory is a git root and whether
   `.detent/` is present (read-only checks only).
2. Direct the user to the headless driver for the actual pipeline:
   `detent init` from the Detent checkout, which requires a live backend
   (`ANTHROPIC_API_KEY`) because ANALYZE and PLAN are session outputs.
3. Do not simulate any init phase, and do not answer any of the five decisions
   on the user's behalf.
