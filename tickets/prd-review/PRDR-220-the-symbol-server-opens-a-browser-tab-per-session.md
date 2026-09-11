---
id: PRDR-220
title: "The symbol server opens a browser tab for every session: Detent launches Serena without disabling its web dashboard, so the machine's default opens one per implement session"
state: DONE
severity: minor
category: defect
labels: ["prd-review", "symbols", "S-3′", "serena", "operator"]
surface: ["src/adapter/symbols.ts", "tests/sessions/symbols.test.ts", "detent-prd-v3.md"]
prd_refs: ["S-3′", "S-3‴", "D-4", "V-6", "N-6", "PRDR-121", "PRDR-123", "PRDR-198"]
acceptance_criteria: ["The symbol server is launched with its web dashboard and its GUI log window explicitly OFF — `--enable-web-dashboard false --enable-gui-log-window false` — so a session's server never opens anything on the operator's machine, whatever `~/.serena/serena_config.yml` says. Observed FIRST (V-6): `SYMBOL_SERVER_ARGS` carries neither flag, and this machine's Serena config has `web_dashboard: true` and `web_dashboard_open_on_launch: true`, so every session with symbols enabled opened a browser tab.", "The flags are checked against the pinned tool the way PRDR-198 checked the context and mode: the test reads `serena start-mcp-server --help` where the tool is installed and requires both names, so a Serena that dropped them fails the suite rather than the launch.", "Symbol intelligence itself is unchanged: same tools, same read-only surface, same pin."]
non_goals: ["Does not touch the operator's Serena config: Detent overrides per launch and edits nothing under `~/.serena`.", "Does not turn symbols off or change when they are enabled (S-3⁗)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-121", "PRDR-123", "PRDR-198", "PRDR-208"]
depends_on: []
---

# PRDR-220 — a server that opens a window

**Severity:** minor · **Category:** defect · **Found by:** the operator, watching browser tabs
accumulate during a run

## Problem

S-3′ makes Serena an optional MCP server a session may call for symbol reads. Detent launches
it with `start-mcp-server --context ide-assistant --mode no-onboarding --project <root>` —
values PRDR-198 read from the tool rather than chose. Serena also has a web dashboard, and its
machine config decides whether it starts and whether it opens a browser window at launch:

```
web_dashboard: true
web_dashboard_open_on_launch: true
```

Those are the shipped defaults, and this machine has them. So every session that gets a
symbol server — one per implement, review-fix, blind-fix, informed-fix launch when symbols are
on — opens a tab in the operator's browser and leaves it there. Nothing in Detent asked for a
dashboard; nothing in Detent can use one; the process is headless and dies with the session.

Serena's CLI overrides the config per launch: `--enable-web-dashboard BOOLEAN` and
`--enable-gui-log-window BOOLEAN`, both in the pinned version's `--help`, and both listed in
PRDR-198's own inventory of the flags `start-mcp-server` has.

## The shape

Two more launch flags, both `false`, checked against the tool's `--help` the way the context
and mode already are. D-4 still holds — Detent binds to what the machine has and edits no
config under `~/.serena`; it just declines, per launch, a window it never wanted.

## What implementation changed

**Two flags, both `false`.** `SYMBOL_SERVER_ARGS` in `src/adapter/symbols.ts` now carries
`--enable-web-dashboard false --enable-gui-log-window false` after the context and mode; the
project still comes last. Nothing under `~/.serena` is touched.

**V-6, in order.** Observed on the tree as it was: the launch test found `start-mcp-server`
where `false` was expected — neither flag present — and this machine's Serena config has both
windows on. Then the change; then green, with the second test reading both flag names from the
pinned tool's `start-mcp-server --help`. Also observed live, once, with the flags: Serena
0.1.4 started, reached its MCP server and language-server setup in 116 log lines with zero
mentions of a dashboard, and opened nothing.


## Audit

Cold re-read against every place Serena runs. `symbolServerConfig` is the ONE launch, shared
by both drivers through the referee context; `probeSymbols` runs `--help` and starts no
server (PRDR-198), so the doctor and `init --symbols` open nothing. No document tells an
operator to disable the dashboard by hand, so none needed correcting. What the re-read did
turn up: the tabs the operator saw came from the live gate-313 run itself — its config has
symbols ON, which this session's notes had recorded as off — and that run was launched from a
runner clone predating this fix. The operator-side mitigation for sessions already in flight
is Serena's own `web_dashboard_open_on_launch: false` in `~/.serena/serena_config.yml`, read at
each server start; the fix reaches the run at its next restart. No code change.
