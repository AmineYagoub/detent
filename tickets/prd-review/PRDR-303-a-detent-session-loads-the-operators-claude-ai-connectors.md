---
id: PRDR-303
title: "A headless Detent session loads the operator's claude.ai connectors. D-22 empties `settingSources` so that nothing outside Detent's configuration reaches a session, but the SDK still connects the MCP servers of the claude.ai account the session runs on, so tabachir's AUDIT survey was handed Claude Docs' create, update and delete tools. `strictMcpConfig` keeps a session to the servers Detent passes it"
state: DONE
severity: major
category: defect
labels: ["prd-review", "D-22", "D-29", "containment", "mcp", "live-run"]
surface: ["src/sessions/sdk.ts", "detent-prd-v3.md", "tests/sessions/mcp-scope.test.ts"]
prd_refs: ["D-22", "D-29", "D-21", "S-2‴", "S-3⁸", "S-1⁗", "SEC-6"]
acceptance_criteria: ["Every session the SDK backend builds is given `strictMcpConfig: true`, so its MCP servers are the ones its spec passes and no others: the symbol server where the adapter granted one (S-3⁸), and a VALIDATE reviewer's scratch tool where its round has a sandbox (S-1⁗).", "The servers Detent passes still reach the session: `mcpServers` is unchanged.", "The PRD records it beside D-22: an empty `settingSources` does not keep out an account's connectors, and the backend's options now do.", "Falsifying test: the options built for a session carry `strictMcpConfig: true`. Against HEAD they carry none. The ticket records the failure against HEAD, and the live evidence below."]
non_goals: ["Does NOT change which MCP servers Detent passes a session.", "Does NOT change the plugin driver, which runs inside the operator's own Claude Code; there the hook is authoritative (D-29, SEC-6).", "Does NOT establish whether a call to a connector's tool would have been approved. Probing that live would act on the operator's account."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-051", "PRDR-302"]
depends_on: []
---

# PRDR-303 — a headless Detent session loads the operator's claude.ai connectors

## Where this came from

Building PRDR-302 on 2026-09-27 meant proving that a session's base set of built-in tools leaves
its MCP tools alone. The proof was a session stopped at its `system/init` message, which lists
every tool and server a session has, before any model call. It had its own probe server, as asked,
and one more:

```
{"strict":false,"mcp_servers":[{"name":"claude.ai Claude Docs","status":"connected","source":"claudeai"}],"mcpTools":8}
{"strict":true, "mcp_servers":[],"mcpTools":0}
```

The same probe, with a repository whose committed `.mcp.json` declares a stdio server that touches
a file, found that server neither listed nor run: `settingSources: []` keeps out a project's MCP
configuration. It does not keep out the account's.

The live run has it too. The transcript of AUDIT's survey session on the tabachir test copy (binary
`350155b`) carries `mcp__claude_ai_Claude_Docs__batch`, `__create`, `__delete`, `__export`,
`__guide`, `__query`, `__read` and `__update`. The session called none of them; its calls were 32
Reads and 2 Bash (PRDR-302).

## Problem

D-22 (PRDR-051) set `settingSources: []` so that "no user, project, or local settings file
contributes anything to a Detent session" (`buildOptions`, `src/sessions/sdk.ts`), and D-29 keeps it
on the headless driver. A claude.ai connector is no settings file: it comes with the login the
session runs on, and the SDK connects it unless the options say to use only the servers they pass.
So a session given Read, Grep and Glob to audit a document set also held the tools that create,
edit and delete documents in the operator's claude.ai account. Nothing in Detent's allowlists names
them, and the containment hook abstains on an MCP call, whose parameters it cannot read (S-2‴).
Whether the permission mode would have approved one was not probed.

## Design

`buildOptions` sets `strictMcpConfig: true` for every session. It "only use[s] MCP servers passed
via the `mcpServers` option", which is where Detent passes the two it grants. One line, beside
`settingSources: []`, for the same reason.

## Building it

`buildOptions` (`src/sessions/sdk.ts`) builds every session with `strictMcpConfig: true`, beside
`settingSources: []`, and its header lists it among the three load-bearing security lines. The PRD
records it as D-22′, placed after S-1⁵, and the D-22/D-29 summary in §10 points to it.

The acceptance criteria, as built:
1. **Every session is strict:** its MCP servers are the ones `mcpServers` passes, which is where
   the symbol server (S-3⁸) and a VALIDATE reviewer's scratch tool (S-1⁗) are passed.
2. **Those servers still reach it:** `mcpServers` is unchanged, and the test passes one.
3. **The PRD records it** as D-22′.
4. **The falsifying test** is `tests/sessions/mcp-scope.test.ts`'s first case; both of its cases fail
   against HEAD (below).

### Vetoable calls

1. **One option for every session, both drivers' headless sessions and `init`'s,** not a list of
   connectors to refuse: what an account holds changes, and Detent passes every server it means a
   session to have.
2. **`doctor --smoke` is strict too,** since it is built by the same function; it is given no server.
3. **The live evidence stands for the probe's other half:** a session was not asked to call a
   connector's tool, since that would act on the operator's account.

## Falsification (verification protocol, item 1)

The final `tests/sessions/mcp-scope.test.ts` was copied into a `git archive` of HEAD `7e92272` in
the scratchpad and run there, against HEAD's source. Both cases fail:

```
 × AC 4: every session is built with strictMcpConfig, beside its empty setting sources
   → AssertionError: expected undefined to be true
 × a server Detent passes still reaches the session (S-3⁸)
   → AssertionError: expected undefined to be true
 Test Files  1 failed (1)
      Tests  2 failed (2)
```

The live evidence is in "Where this came from": the probe's two `system/init` messages, and the
connector's tools in the transcript of tabachir's AUDIT survey.

## Mutation battery (verification protocol, item 2)

Two mutants on `src/sessions/sdk.ts`, run against the new suite and `tests/sessions/sdk.test.ts`,
and restored from a snapshot, never by `git checkout`: the option removed, and the option set to
`false`. Both were killed on the first pass, and the file matched its snapshot at the end.

## Gates

`npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check` and
`test` all pass: 2154 tests passed and 2 skipped, across 186 files; the two new cases are the new
suite's. `npm run plugin` builds and changes nothing.

## Found along the way

- **The same probe found a project's `.mcp.json` does not reach a session:** a committed file
  declaring a stdio server that would touch a file in the scratchpad was neither listed at init nor
  run. `settingSources: []` covers it, as D-22 meant it to.
