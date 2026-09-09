---
id: PRDR-198
title: "Symbol intelligence cannot start: the default command is a package name, the probe uses a flag the tool lacks, and the context and mode are values Serena does not have"
state: DONE
severity: major
category: bug
labels: ["prd-review", "found-by-live-run", "dead-control", "unverified-claim"]
surface: ["src/kernel/worstcase.ts", "src/adapter/symbols.ts", "src/cli/doctor.ts", "tests/adapter/symbols.test.ts"]
prd_refs: ["S-3", "S-3′", "S-3″", "PRDR-121", "D-4", "V-1‴"]
acceptance_criteria: ["`symbols.command` defaults to an EXECUTABLE the pinned package installs, not to the package name.", "The liveness probe uses an invocation the tool answers. `--version` exits 2 on this CLI, so the probe reports `missing` for a correctly installed tool.", "`--context` and `--mode` carry values Serena actually has, and the comment records HOW that was established rather than asserting it.", "`doctor` verifies symbol intelligence end to end when it is enabled — the command resolves AND the context and mode validate. A unit test cannot check values that live in another program; only a live probe can, and this defect is what a missing one costs."]
non_goals: ["Does not install tooling. D-4 stands: Detent binds to what the machine has.", "Does not change what symbol intelligence is for, or S-3's tool surface."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-121", "PRDR-141", "PRDR-148"]
depends_on: []
---

# PRDR-198 — four values, none of which exist

**Severity:** major · **Category:** bug · **Found by:** enabling symbol intelligence for the
first time, 2026-09-09

## Problem

S-3's symbol intelligence cannot start. Four independent defects, each verified against the
pinned tool (`serena-agent==0.1.4`) rather than reasoned about:

1. **The default command is the PACKAGE name.** `symbols.command` defaults to `serena-agent`.
   `uv tool list` reports that package installing `index-project`, `serena` and
   `serena-mcp-server` — **there is no `serena-agent` executable.** The schema's own comment
   says the field "is an executable name resolved on PATH", which is exactly the distinction
   the default gets wrong.

2. **The probe uses a flag the CLI does not have.** `defaultProbe` runs `command --version`.
   `serena --version` exits **2** — the CLI has no such option — so `probeSymbols` reports
   `missing` for a correctly installed tool, and hands the operator `symbolsSetupMessage`
   telling them to install the package they just installed.

3. **`--context claude-code` is not a context.** The binary says so:
   `FileNotFoundError: Context claude-code not found`. Serena's contexts are `agent`,
   `chatgpt`, `codex`, `context.template`, `desktop-app`, `ide-assistant`.

4. **`--mode no-memories` is not a mode.** Serena's modes are `editing`, `interactive`,
   `no-onboarding`, `onboarding`, `one-shot`, `planning`.

## The comment claims the opposite

`SYMBOL_SERVER_ARGS` carries this doc-block:

> Every flag here is upstream's and was verified against Serena's own configuration
> documentation rather than assumed — an earlier version of this function passed
> `--context ide-assistant` (not a valid context) and `--enable-memory false` (not a flag at
> all), so the memory this comment claims to disable would have stayed on and the test
> asserting otherwise proved nothing.

Both halves are wrong. **`ide-assistant` IS a valid context** — and reading its definition, it
is precisely the one Detent wants: *"Non-symbolic editing tools and general shell tool are
excluded… file operations, basic edits and reads, and shell commands are handled by your own,
internal tools."* That is the comment's own stated goal, "drops the tools that would duplicate
the built-in ones". The fix replaced a correct value with an invented one, and recorded the
correct one as the mistake.

And the flags it was verified against do not include memory control at all: `start-mcp-server`
accepts `--project --project-file --context --mode --transport --host --port
--enable-web-dashboard --enable-gui-log-window --log-level --trace-lsp-communication
--tool-timeout`. **There is no way to disable memory by flag**, so the sentence about C-8 replay
and S-6 prefixes describes a guarantee the code never had.

## Why a unit test could not catch this

Every value here lives in ANOTHER PROGRAM. A test asserting `SYMBOL_SERVER_ARGS` contains
`--context claude-code` passes forever and proves nothing — which is what the existing tests
do. This is PRDR-141's class (implemented, tested, documented, unreachable) with the additional
sting that the feature is reachable and fails.

The durable fix is therefore a `doctor` check that runs the real thing, because that is the only
place the question "is this a value Serena has" can actually be asked.

## Resolution

`command: "serena"`, probe on `--help` (exit 0), `--context ide-assistant`,
`--mode no-onboarding`. Verified live: the server reaches "MCP server lifetime setup complete",
and the context excludes the five duplicating tools (`create_text_file`, `read_file`,
`execute_shell_command`, `prepare_for_new_conversation`, `replace_regex`) exactly as intended.

**Memory is still not suppressed, and the first draft of this fix wrongly said it was.** Two
runs were compared with and without `--mode no-onboarding`: the MCP tool surface is IDENTICAL,
carrying `write_memory`, `read_memory`, `list_memories`, `delete_memory`, `onboarding` and
`check_onboarding_performed` either way. Serena logs the exclusion and exposes the tools
regardless. So the memory guarantee this file has claimed in two successive versions does not
exist, and cannot be obtained from a flag. If C-8 replay genuinely depends on it, that is a
separate mechanism Detent must own — recorded here rather than asserted away for a third time.

One practical note from the same run: `ValueError: No source files found` — a PRD-only root has
nothing to index, so symbol intelligence is inert until the first code lands.
