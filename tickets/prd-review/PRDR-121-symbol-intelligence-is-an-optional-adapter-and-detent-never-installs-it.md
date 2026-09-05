---
id: PRDR-121
title: "Detent has no way to ask what code actually references a symbol, so a declared contract cannot be verified and a session cannot see what its change will break"
state: OPEN
severity: normal
category: capability
labels: ["prd-review"]
surface: ["src/adapter/symbols.ts", "src/sessions/backend.ts", "src/kernel/referee-context.ts", "src/kernel/worstcase.ts", "src/cli/init.ts", "detent-prd-v3.md"]
prd_refs: ["D-4", "F-2", "S-2′", "S-3", "SEC-3", "D-21", "C-6", "C-8", "S-6"]
acceptance_criteria: ["Symbol intelligence is discovered and optional, configured by `symbols: { enabled, command, pinned }`, probed for health like a verification candidate; absent, every stage runs unchanged and says so once.", "Detent never installs it. `enabled: true` with the command missing raises AWAIT_SETUP_CONSENT naming the pinned command; no code path executes an install.", "Only read tools are ever allowlisted. The editing tools write from inside the MCP server process and would bypass the D-21 containment hook, so a test fails if any editing tool name appears in the allowlist.", "The server's own cross-session memory is disabled, because a hidden per-project memory would make two identical runs diverge (C-8, S-6).", "A ticket's declared `symbol:` provides are verified against the real symbol table after a green gate; unavailable tooling skips the check with a note rather than failing the ticket.", "A reminder to install it appears only when the run just completed contains evidence it would have helped, at most once per invocation, naming the specific tickets, and states how to silence it permanently."]
non_goals: ["Does not vendor the tool or add it as a dependency. It is a global install on the operator's machine, and Detent binds rather than owns (D-4/F-2).", "Does not grant editing tools under any configuration.", "Does not make any stage depend on it. Contracts (PRDR-120) are checked with no external tooling.", "Does not add a memory layer. What Detent needs remembered is the plan and the code, both already durable artifacts."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-120"]
depends_on: ["PRDR-120"]
---

# PRDR-121 — symbol intelligence as an optional adapter

**Severity:** normal · **Category:** capability

## Why

PRDR-120 lets a ticket declare that it provides `v1.TerminalStates`. Nothing can check whether
it did. And at run time a session changing a symbol has no way to ask who depends on it, which
is the mechanism behind an implementation destroying what an earlier ticket built.

[Serena](https://github.com/oraios/serena) (MIT, LSP-backed, 40+ languages) answers both
questions through MCP: `find_symbol`, `find_referencing_symbols`, `find_implementations`.

## Three constraints found before writing code

**Its editing tools bypass containment.** `replace_symbol_body`, `insert_after_symbol`,
`safe_delete` and `rename` write files from inside the MCP server process, so they never pass
through the `Write`/`Edit` calls the D-21 hook inspects. Granting them would silently void
per-ticket write containment (S-2′, SEC-3). Read tools only, enforced by an allowlist and a
test.

**Its memory must be off.** Detent's sessions are memoryless by design — artifacts are the
interface (P2), prefixes are byte-identical (S-6), replay is content-addressed (C-8). A hidden
per-project memory would make two identical runs diverge.

**It is the operator's tooling, not Detent's.** D-4/F-2: bind, do not own. It is a global
install with read access to a private codebase, so it is discovered, never installed, and the
decision stays the operator's.

Full design: `docs/plan-contracts-and-symbols.md`.
