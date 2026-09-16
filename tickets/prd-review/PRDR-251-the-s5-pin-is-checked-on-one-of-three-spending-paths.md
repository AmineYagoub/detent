---
id: PRDR-251
title: "`detent init` and the plugin referee never verify the S-5 pinned CLI version, so PRDR-181's \"checked on the path that runs\" covers one of the three paths that run"
state: DONE
severity: major
category: gap
labels: ["prd-review", "found-by-audit", "S-5", "ARCH-2", "driver-parity"]
surface: ["src/cli/init.ts", "src/cli/referee.ts", "src/sessions/live.ts", "tests/cli/pin-parity.test.ts", "tests/oracle/pin-parity.test.ts"]
prd_refs: ["S-5", "ARCH-2", "C-11", "P6"]
acceptance_criteria: ["`detent init` refuses with exit 2, naming the mismatch, when the backend reports a version other than `config.pinned.claude_code` — before the pipeline is built and before anything spends.", "`detent referee` refuses on the same terms, before `acquireRunLock`, so the refusal leaves no lock behind; `--backend mock` is unaffected.", "The pin each entrypoint checks is read from the config that entrypoint just loaded, asserted against the fixture's own `2.1.191` rather than a constant the test invented.", "`PIN_CHECK_SITES` is total over the cli verbs that obtain a live backend, derived from the tree — a new verb that builds one fails the oracle until its row exists.", "Each module named as a checker calls `checkVersion` in code with comments and string literals stripped, on the P6 oracle's terms."]
non_goals: ["Does not add a pin check to `doctor` — it has had one since PRDR-158/162 and is the row this map was written from.", "Does not change `checkVersion` itself, nor what counts as a match (`installed.includes(pinned)`).", "Does not fix the `pinned: \"unknown\"` trap described below; that is a separate defect this ticket only records.", "Does not make `run`'s banner, the approval schema, or any other PRDR-181 precondition part of the oracle — only the S-5 pin."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-181", "PRDR-174", "PRDR-158", "PRDR-153", "PRDR-246"]
depends_on: []
---

# PRDR-251 — a pin checked on the path that runs, on one of the three paths that run

## Problem

`SessionBackend.checkVersion` had exactly two production callers: `doctor` and
`kernel/run.ts`. Detent has three entrypoints that can spend money — `detent
run` (headless), `detent referee` (the plugin's MCP driver), and `detent init`.
Two of them never verified the pin.

`init` is the expensive one. It has no fixture path at all — its own refusal
says so, "`detent init` needs a live backend: ANALYZE and PLAN are session
outputs" — so its sessions are the first genuinely billed ones in a project's
life, and it planned against whatever `claude` happened to be on PATH.

The claim that made this read as closed is in `kernel/run.ts`, in the present
indicative:

> S-5 (PRDR-181): the pinned CLI version is CHECKED, on the path that runs.

The plugin referee is a path that runs. It is the path the plugin actually
drives.

## The same ticket stated the rule and then broke it

PRDR-181 added four preconditions. Three went to both drivers, each under a
sentence the file still carries:

- approval — "An approval is a human's signature on a plan; the two drivers must read it identically (ARCH-2)."
- the bound `test` gate — "ARCH-2: a precondition on one driver is a precondition on both."
- the run lock — "one referee per root, on the terms `run` already uses."

The fourth, the S-5 pin, went to `kernel/run.ts` alone. This is the shape
PRDR-246 found for `ticket_wall_clock_ms` one commit earlier in this branch:
the parity rule is written down, applied to the checks someone thought of, and
the one that was missed is invisible because the prose reads as covering all of
them.

`doctor` then reported the gap as covered. With no live backend supplied it
pushes a PASSING check whose detail reads "no live backend supplied; checked at
run time" — true for `run`, false for `init` and `referee`. That string is now
true for all three, as a consequence of this fix rather than a change to it.

## Falsification (verification protocol, item 1)

The seam had to land first — `init` and `referee` constructed their backends as
inline literals, so no test could reach the precondition without launching real
billed sessions. That is the argument PRDR-174 already made for `run`, and
PRDR-158/162 for `doctor`; the two remaining entrypoints simply never got it.

`tests/cli/pin-parity.test.ts` against the tree with the seam and WITHOUT the
two checks:

```
× S-5 `detent init` ... > refuses a pin mismatch, names it, and never launches
  → a pin mismatch is a precondition failure (C-11 exit 2), not a crash:
    expected +0 to be 2
× S-5 `detent init` ... > a matching pin is read from config (the control)
  → the check ran, against the config's pin: expected [] to deeply equal [ '2.1.191' ]
× S-5 the plugin referee verifies the pin too (ARCH-2 driver parity)
  → Test timed out in 60000ms.
```

`init` returned **0** — a clean success — against a backend reporting a
mismatch. The referee did not fail an assertion at all: with nothing to refuse
it went on to `buildServer` and served over stdio until the test timed out,
which is precisely what it would do to an operator on a drifted CLI.

The oracle was falsified separately by deleting the `cli/init` row:

```
× the map is total over the cli verbs that obtain a live backend
  → a verb that can build a live backend needs a PIN_CHECK_SITES row:
    + "cli/init",
```

## Design

Each entrypoint checks its own pin and maps the throw onto its own refusal
shape — `init` to `EXIT_NOT_READY`, `referee` to 2 — because the three have
three different refusal contracts and a shared wrapper would have to invent a
fourth. What is shared is the CLAIM, and that is a map:

```ts
export const PIN_CHECK_SITES = {
  "cli/doctor": "cli/doctor",
  "cli/init": "cli/init",
  "cli/referee": "cli/referee",
  "cli/run": "kernel/run",
} as const;
```

`tests/oracle/pin-parity.test.ts` asserts two things. The second — each named
checker really calls `checkVersion`, with comments and string literals stripped
by the rules gate's own `codeOnly` — is the P6 budgets oracle's property.

The first is the one that matters: the key set is DERIVED from the tree, by
scanning `src/cli/*.ts` for a module that constructs or builds a live backend,
and must equal the map's keys. A prose claim about which modules do a thing
cannot fail; a totality check over a derived set can, and does, for a verb
nobody has written yet. `cli/run` is the single row whose checker is another
module, and the exception is a row rather than a special case.

## Recorded, not fixed: `pinned: "unknown"`

`src/init/config.ts` writes `claude_code: installedClaudeVersion()`, which
returns the string `"unknown"` when `claude --version` cannot run. A config
written on such a machine pins `"unknown"` forever, and `installed.includes
("unknown")` is false for every real version — so `run` has always refused
against such a config, and now `init` and `referee` do too.

This is pre-existing on the `run` path and this ticket does not widen it: a
machine that cannot run `claude --version` cannot run `init` either, since the
live-auth probe gates on the same CLI. It is written down here because the
first init on a CI box is exactly where it would fire, and nothing else in the
tree says so.

## What changed

`src/cli/init.ts`: an `InitMainDeps.buildBackend` seam and a `defaultBackend`
holding the policy literal verbatim; the pin checked after the config loads and
before `buildPipeline`. `src/cli/referee.ts`: a `RefereeMainDeps.buildBackend`
seam and the same `defaultBackend` extraction; backend construction moved above
`acquireRunLock` so the pin check sits with the other preconditions and a
refusal touches nothing. `src/sessions/live.ts`: `PIN_CHECK_SITES`. Two new
test files; no existing test changed.
