---
id: PRDR-221
title: "Symbol intelligence is attached to every session and used by none: Serena's tools arrive deferred behind tool search and no prompt says they exist — 0 calls in 113 gate-313 sessions"
state: DONE
severity: major
category: defect
labels: ["prd-review", "symbols", "S-3′", "prompts", "sdk", "gate-313", "measurement"]
surface: ["src/adapter/symbols.ts", "src/kernel/referee-context.ts", "src/kernel/referee-session.ts", "hooks/dist/detent-hook.cjs", "prompts/implement.md", "prompts/review.md", "prompts/blind_fix.md", "prompts/informed_fix.md", "prompts/review_fix.md", "prompts/diagnose.md", "prompts/research.md", "prompts/manifest.json", "agents/implement.md", "agents/review.md", "agents/diagnose.md", "agents/research.md", "tests/sessions/symbols.test.ts", "tests/sessions/prompts.test.ts", "tests/kernel/session-policy.test.ts", "detent-prd-v3.md"]
prd_refs: ["S-3′", "S-3″", "S-3⁗", "S-6", "S-7", "C-8", "V-6", "N-6", "PRDR-121", "PRDR-123", "PRDR-198", "PRDR-220"]
acceptance_criteria: ["The symbol server's tools are never deferred: `symbolServerConfig` sets the SDK's per-server option that keeps a server's tools in the prompt instead of behind tool search (`defer_loading: false` on the API), so `find_symbol`, `find_referencing_symbols`, `find_implementations` and `get_symbols_overview` are callable on turn one. Observed FIRST (V-6): the config carries no such option, and gate-313's transcripts show the eighteen Serena tools arriving only as a `deferred_tools_delta`, with zero tool searches and zero calls across 113 sessions.", "A session with symbol tools is TOLD: when the server is configured, the variable inputs carry `symbol_tools` (the four read tools by name) and the write and read-only role prompts say what they are for — definitions, references, implementations and a file's symbol overview, before grep — and that they are absent when the field is. The stable prefix is unchanged for a root without symbols (S-6), and a root with them gets the same prefix and one more input.", "`prompts:check` hash updated; `agents/*.md` regenerated; the prompt-marker test requires the mention in every role that receives the tools.", "The next gate tickets are the measurement: Serena calls per session are counted from the transcripts and reported, so the decision S-3⁗ leaves to the operator has a number behind it."]
non_goals: ["Does not widen the tool surface: the four read tools are still the only ones allowlisted, and the editing and memory tools stay refused (S-3′).", "Does not make symbols on by default — that stays the operator's flag (S-3⁗).", "Does not change init sessions, which never receive the server."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-220", "PRDR-198", "PRDR-121", "PRDR-208"]
depends_on: []
---

# PRDR-221 — a server nobody was introduced to

**Severity:** major · **Category:** defect · **Found by:** counting, after PRDR-220 asked where
the browser tabs came from

## Problem

S-3′ makes Serena an optional MCP server a session may call for symbol reads; S-3⁗ made it a
flag at init. gate-313 has it on, so every write-role and read-only-role session gets a server:
a Python process, a language-server initialisation, a port, and until PRDR-220 a browser tab.
The measurement, across every session transcript the gate has produced:

| | |
|---|---|
| Sessions with a symbol server | 113 |
| Tool searches | 0 |
| Serena tool calls | 0 |

Two reasons, both Detent's. The platform defers MCP tools behind tool search by default, so the
eighteen Serena tools reach a session only as names in a `deferred_tools_delta` — callable
after a `ToolSearch`, never before — and Detent's server config does not set the option the
SDK offers to keep a server's tools in the prompt. And no prompt says the tools exist: the
implementer is told its tools are "reading and searching the repository", which it reads as
Read, Grep and Glob, and it uses exactly those.

Nothing was wrong with any session. The capability was configured, paid for and invisible.

## The shape

Two changes, one per cause. The server config asks the SDK never to defer this server's tools,
so they are on the turn-one tool list with their descriptions. And the session is told, in the
variable inputs (so the S-6 prefix of a root without symbols is byte-identical), that
`symbol_tools` are attached and what they are for — definitions, references, implementations
and a file's symbol overview, before grep. Then the next tickets of the gate are counted.

## What implementation changed

**On the tool list.** `symbolServerConfig` sets `alwaysLoad: true` on the `serena` server —
the SDK's per-server switch for the API's `defer_loading: false` — so the server's tools are on
the turn-one list with their descriptions instead of behind a tool search no session ever ran.
The SDK then waits for the server to connect (capped at five seconds) before the first prompt.

**Told, in the variable part.** `SessionArm.launch` reads the symbol tools once, allowlists
them as before, and when there are any adds `symbol_tools` — the four callable names — to the
inputs it serialises into the prompt variable. A root without a ready server serialises exactly
what it always did (S-6). The seven roles that receive the server say, in one sentence each,
what the tools are for — a symbol's definition, its references, its implementations and a
file's symbol overview, before grep — and that an absent field means no server. `init`
sessions are unchanged: they never receive one.

**A readiness seam.** `CoreOptions.probeSymbols` lets a test decide whether the machine has a
symbol server; production keeps the real probe.

**V-6, in order.** Observed on the tree as it was: the server config carried no `alwaysLoad`;
a launch with a ready probe serialised no `symbol_tools`; seven prompt-marker tests failed on
the missing mention. Then the change; then all green, `prompts:check` re-hashed, the agents and
the hook bundle regenerated.

