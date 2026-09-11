---
id: PRDR-208
title: "Symbol intelligence can only be enabled by a person at a TTY, so every unattended init — the self-build gate included — plans and runs without it: gate-313 sent 80 symbol-level couplings to review that code could have checked"
state: DONE
severity: minor
category: gap
labels: ["prd-review", "symbols", "init", "cli", "self-build"]
surface: ["src/cli/init.ts", "src/init/config.ts", "scripts/self-build.ts", "tests/cli/init-symbols.test.ts", "tests/scripts/self-build-flags.test.ts", "docs/release-checklist.md", "detent-prd-v3.md"]
prd_refs: ["S-3′", "S-3″", "S-3‴", "D-4", "F-2", "D-16", "N-7", "V-6", "N-6", "PRDR-121"]
acceptance_criteria: ["`detent init --symbols` records `symbols.enabled: true` in `.detent/config.json` when `probeSymbols` reports the tool ready, and exits 2 naming the install command when it does not — never `enabled: true` for a tool that is not there. `--no-symbols` records `false`, which S-3″ honours as a decline. Observed FIRST: the flags are refused as unknown options (V-6).", "A non-TTY init with neither flag behaves exactly as today: `symbols` stays undecided and the earned reminder still fires when there is evidence (S-3″).", "The self-build harness passes `--symbols` when the runner's probe is ready and `--no-symbols` otherwise, so the permanent gate (D-16) runs with the tooling the host actually has, and says which.", "`detent run` on a root enabled by the flag grants the four read tools and the session's init message reports the server attached (S-3‴) — asserted on the existing fixture path, not claimed."]
non_goals: ["Does not enable symbol intelligence without a decision. Absent stays absent; the flag IS the person's decision (D-4/F-2), moved from a prompt to an argument so an unattended run can carry it.", "Does not install anything — Detent discovers the tool and names the command a human runs, exactly as before.", "Does not change what the enabled sessions may call: read tools only, SEC-3's refusal of editing tools stands."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-121", "PRDR-198"]
depends_on: []
---

# PRDR-208 — the tooling that needs a person in the room

**Severity:** minor · **Category:** gap · **Found by:** the same machine, two gates, two answers

## Problem

S-3″ made `symbols.enabled` tri-state on purpose: absent means nobody has decided, `false` means
someone said no, and only a person decides. That is right — a global tool with read access to a
private codebase is the owner's call (D-4, F-2). But the only way to decide is at a TTY, and the
runs that matter most have none: the self-build workflow (D-16), a background launch, CI.

Same machine, `serena-agent 0.1.4` installed, `probeSymbols` → `ready`:

| | init | `symbols` | outcome |
|---|---|---|---|
| gate-312 | interactive | `enabled: true` | sessions carry the four read tools |
| gate-313 | background | absent | *"Symbol intelligence is not configured. 80 finding(s) in this plan were symbol-level couplings Detent could have checked mechanically instead of leaving to review"* |

Eighty findings the review was paid to judge because nobody could say yes. The run was then
enabled by hand-editing `.detent/config.json` before `detent run` — which works, and is not a
procedure.

## The shape

A flag is a decision. `detent init --symbols` says yes, `--no-symbols` says no, and neither
present is today's undecided. Yes is honoured only when the probe finds the tool: `enabled: true`
for a command that cannot run would be the silent failure S-3‴ exists to report, so it exits 2 and
names `uv tool install -p 3.13 serena-agent==0.1.4` instead. The harness passes whichever the
runner's probe supports, so the permanent gate carries the tooling the host has and the artifact
records which.

## How it is tested

V-6 order: `init --symbols` observed refused as an unknown option; then the config it writes,
the refusal when the probe fails (injected), the decline, and the unchanged non-TTY default.

## What implementation changed

**`decideSymbols(root, "on" | "off", probe)`** in `src/init/config.ts`: reads the config, takes
`command` and `pinned` from the schema's defaults for a config that never mentioned symbols,
probes on "on" and refuses — naming `uv tool install -p 3.13 serena-agent==0.1.4` — without
writing when the tool cannot run; otherwise writes `symbols: { enabled, command, pinned }` with
every other key preserved.

**`detent init --symbols` / `--no-symbols`**: both at once is refused before anything runs
(`EXIT_ERROR`); the decision is applied right after `ensureConfig`, on a fresh config or an
existing one — a decision, not a ceiling, so unlike `--spend-cap-usd` it is honoured on a root
that already has a config — and a refused "on" exits 2 with the install named. The outcome is
said on stdout either way.

**The harness decides from the runner.** `symbolsFlagFor(probe)` → `--symbols` on `ready`,
`--no-symbols` on anything else, passed to both `init` calls and printed, so the gate's record
says which tooling it ran with. The release checklist says so.

**V-6, in order.** Observed on the tree as it was: `Unknown option '--symbols'`; `decideSymbols`
and `symbolsFlagFor` not functions. Then the change; then 19 of 19 across the new tests, the
existing init tests and the harness's dry run — which still stops at the auth gate with the flag
in its arguments.

**The end-to-end test spends nothing by construction.** It satisfies R-10 with a token the SDK
never sees: a git root with no planning document reaches DISCOVER and stops there with
AWAIT_DOCS, after the config — and the decision — is written and before any session.
