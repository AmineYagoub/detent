---
id: PRDR-123
title: "`symbols.command` accepted any path, so a repository could choose which executable Detent runs; and a symbol server that failed to connect degraded every session silently"
state: DONE
severity: normal
category: security
labels: ["prd-review", "found-by-audit"]
surface: ["src/kernel/worstcase.ts", "src/adapter/symbols.ts", "src/sessions/sdk.ts", "src/sessions/backend.ts", "src/kernel/referee-session.ts", "detent-prd-v3.md"]
prd_refs: ["S-3′", "D-4", "F-2", "SEC-3", "S-4", "V-1"]
acceptance_criteria: ["`symbols.command` is a bare executable name — no path separator, no `..`, no absolute path — refused when the config loads rather than when it runs, so a repository cannot choose which file on disk Detent executes.", "A session whose configured MCP server did not connect reports it: the status is read from the SDK's own init message, carried on the result, noted on the ticket and journalled, in the same shape as a model fallback.", "An absent or unrecognised init message is treated as no information, never as failure."]
non_goals: ["Does not claim to make Detent safe against a hostile repository. Detent executes repo-defined verification commands by design; this restores parity with that boundary rather than inventing a new guarantee.", "Does not re-probe the command per ticket. Whether the binary exists is the wrong question — whether THIS session's server attached is the one that matters, and the init message answers it directly.", "Does not fail a session when a server did not connect. Symbol intelligence is optional; losing it degrades the session, and the operator is told."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-114", "PRDR-121", "PRDR-122"]
depends_on: ["PRDR-121"]
---

# PRDR-123 — the command could name any path, and a dead server said nothing

**Severity:** normal · **Category:** security · **Found by:** an adversarial audit of PRDR-121,
5 September 2026

## What happened

**The command.** `symbols.command` was `nonEmptyString` with no restriction, executed by
`probeSymbols` at `DETERMINE_VERIFICATION` and again on every `detent run`. A relative path
resolves against the orchestrator's own working directory, so a repository shipping an
executable script and a `.detent/config.json` pointing at it got that script run — at the
operator's privilege, in the orchestrator process, outside the whole per-ticket containment
model, before anything was presented or approved.

The honest framing matters here. Detent already executes repo-defined commands: that is what a
verification binding IS, and `npm test` runs whatever `scripts.test` says. The boundary has
always been "do not run Detent on a repository you do not trust". What was wrong is that this
setting was WEAKER than that boundary — bindings are discovered from known structured
locations and re-validated against drift before every gate (V-3), while this accepted an
arbitrary path with no provenance at all.

**The dead server.** `RefereeContext` memoises the probe for the life of a run. A server that
was uninstalled, crashed, or simply failed to attach for one session produced no note, no
journal event and no operator-visible signal anywhere — the run quietly stopped benefiting
from symbol intelligence, discoverable only by reading a raw transcript.

## Resolution

The command is constrained at the schema to a bare executable name, so a repository can only
name something already installed on the operator's PATH rather than choose a file on disk.
This restores parity with the binding boundary; it does not claim to exceed it.

The SDK's init message already reports `mcp_servers: { name, status }[]`. A status that is
neither `connected` nor `pending` is carried on the session result and handled exactly as a
model fallback is (PRDR-114): a note on the ticket and a journal event. Re-probing the binary
per ticket would have answered the wrong question — the binary can exist while this session's
server never attached.
