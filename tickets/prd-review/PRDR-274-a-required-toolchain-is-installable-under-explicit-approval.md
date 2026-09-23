---
id: PRDR-274
title: "`AWAIT_SETUP_CONSENT` names a missing toolchain and stops there, because D-4/F-2 say Detent binds to what a machine has rather than changing it — but that rule was reasoned for an OPTIONAL global tool whose absence costs a skipped note, and a REQUIRED toolchain's absence makes every ticket in the plan unimplementable, so the operator is asked to leave and run a command Detent already knows verbatim"
state: DONE
severity: major
category: enhancement
labels: ["prd-review", "found-by-live-run", "D-34", "toolchain", "D-4", "F-2"]
surface: ["src/adapter/toolchain.ts", "src/init/bind.ts", "src/cli/init.ts", "src/init/pipeline.ts", "docs/plan-contracts-and-symbols.md", "tests/init/bind-toolchain.test.ts", "tests/adapter/toolchain-install.test.ts", "tests/cli/init-toolchain-flag.test.ts"]
prd_refs: ["C-3b", "C-4", "D-4", "F-2", "SEC-5", "V-4", "PRDR-123", "PRDR-211", "PRDR-232", "PRDR-273"]
acceptance_criteria: ["A missing REQUIRED toolchain is installable, and only under a flag the operator passed. `detent init --install-toolchain` runs the commands the `AWAIT_SETUP_CONSENT` message named; without it the phase behaves exactly as PRDR-273 shipped it — named, not run. There is no config key, no default, and no prompt that can be answered by anything but an operator's own invocation.", "Only a command from Detent's own table may run. The command executed is `TOOLCHAINS[n].install[platform]` and nothing else: never a string from `.detent/config.json`, never one from a planning document, never one derived from the analysis. This is PRDR-123's constraint applied to a second execution path — an unrestricted string there let a repository point the orchestrator at an executable it shipped and have it run at operator privilege, and a toolchain installer is a strictly more attractive target than a symbol server.", "A toolchain with no table row is named but never run. `missingToolchains` already reports `toolchain: null` for an executable the table does not know, and that entry must be skipped by the installer with its reason stated rather than guessed at. An operator who approved installing Go has not approved installing whatever `zig` might resolve to.", "The install is re-probed, not assumed. A command that exits 0 has not proved the executable resolves — Homebrew exits 0 on an already-installed formula whose binary is not linked, and a `sudo apt-get` on a host without sudo fails in ways the exit code alone does not always carry. After each install the same probe PRDR-273 uses re-runs, and only a resolving executable clears the slot; anything else raises the interrupt again, naming what it tried and what is still absent.", "Each install is recorded. It is a mutation of the operator's machine performed by Detent, which is exactly the thing D-4/F-2 refused, so it leaves a record: the command, the exit, and whether the re-probe resolved. `PRDR-211` set the precedent for the ledger of an adapter-run command and the reasoning for it — `the referee running the same command is one process the operator chose, logged`.", "D-4/F-2 are amended in the docs, with the boundary stated. `docs/plan-contracts-and-symbols.md` section 3.3 currently reads `Detent installs nothing, and this changes that for nothing… there is no install path anywhere in the codebase`, which this ticket makes false. It is rewritten to distinguish an OPTIONAL global tool — Serena, which stays never-installed and keeps all three of its original reasons — from a REQUIRED toolchain the bound gates cannot run without, where the third reason (`nothing depends on it`) inverts completely. Leaving that sentence standing beside an install path is precisely the doc-claim drift this repository exists to catch.", "Falsifying test: `determineVerification` greenfield, a probe that resolves nothing, and `installToolchain: true` with a recording runner. Against HEAD the phase raises `AWAIT_SETUP_CONSENT` and the runner is never called, because no install path exists."]
non_goals: ["Does NOT install Serena, or any optional tool. Its three reasons in section 3.3 hold unchanged: it is global, it takes read access to a private codebase, and nothing depends on it. Only the third distinguishes a toolchain, and it is the one that decides.", "Does NOT install project DEPENDENCIES. `ECOSYSTEMS` (PRDR-211) already does that before a gate, unprompted, and is untouched. The two are different: a manifest install is scoped to the work directory and recoverable by deleting it; a toolchain install is global and is why this one needs a flag.", "Does NOT choose a package manager, or detect one beyond `currentPlatform`. The table names brew on darwin and apt on Debian, says which it resolved, and an operator on dnf or apk reads a command they can translate. Detecting every package manager is a larger surface with its own failure modes and no evidence yet that it is needed.", "Does NOT verify the installed VERSION against a project's pin — PRDR-273's non-goal stands. `brew install go` on a machine whose `go.work` wants 1.27 may land 1.26, and this ticket's re-probe proves the executable resolves, not that it satisfies the project.", "Does NOT run anything at RUN time. The flag is an `init` flag; `run` neither installs nor prompts. A toolchain that disappears mid-run is X-4's premise falsification, which already works and already retained its work."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-273"]
depends_on: ["PRDR-273"]
---

# PRDR-274 — a required toolchain is installable under explicit approval

## Where this came from

D-34, continued. PRDR-273 made `init` say this instead of discovering it 50 turns later:

```
The verification commands for this stack need tooling this machine does not have (macOS (Homebrew)):

  go — needed by test, lint, build
    brew install go      (Go)

Detent does not install tooling — it binds to what the machine has (D-4/F-2).
```

Detent has resolved the platform, identified the executable, and knows the exact command. It
then asks a human to go and type it. The operator's question was the obvious one: why does it
not offer to run what it just wrote?

## Why the existing rule does not cover this case

`docs/plan-contracts-and-symbols.md` §3.3 gives three reasons Detent installs nothing. They
were written about Serena, and they do not transfer:

| Reason | A language toolchain? |
|---|---|
| A **global** tool — installing it is Detent modifying the user's machine (D-4, F-2) | **Holds.** This is the reason the flag exists. |
| A third-party MCP server with **read access to a private codebase** | **Does not apply.** A compiler does not read a codebase and report elsewhere. |
| **Nothing depends on it** — Phase 1 works without it, the gate is skipped with a note | **Inverts.** Every ticket in the plan is unimplementable; ksar's 547 were blocked behind one. |

So the rule is not wrong; it is scoped to an absence that costs a note. An absence that costs
the entire run is a different case, and the only surviving objection — that Detent would be
mutating the machine — is what an explicit, per-invocation operator flag is for.

## The security boundary, which is the whole design

The command that runs is **`TOOLCHAINS[n].install[platform]`, from Detent's own source, and
nothing else.** Not a string from `.detent/config.json`, which is repository content; not one
from a planning document; not one derived from the analysis the planner wrote.

PRDR-123 already settled this for the symbol server and the reasoning is quoted here because it
applies with more force, not less:

> "`.detent/config.json` is repository content, and an unrestricted string let a repo point the
> orchestrator at an executable it shipped and have it run at the operator's privilege, before
> anything was presented or approved."

A toolchain installer is a strictly better target than a symbol server: it is expected to run
with elevated privilege and to fetch from the network. The table is the allowlist, and an
executable with no row is named but never run — which is also why the `zig` case in PRDR-273's
suite matters beyond its message.

## Why the exit code is not the check

`brew install go` exits 0 when the formula is already installed but not linked. `sudo apt-get`
fails differently on a host with no sudo than on one with no package. The install is therefore
followed by the same `probeExecutable` PRDR-273 introduced, and only a resolving executable
clears the slot. An install that exits 0 and leaves nothing on PATH raises the interrupt again,
naming what was attempted.

## What the mutation pass forced

Three mutants survived the first pass, all in the same place and none in the adapter:

| Mutant | Survived |
|---|---|
| `--install-toolchain` defaults to `true` | the flag was covered nowhere above `determineVerification` |
| the CLI's forward of the flag deleted | — |
| `pipeline.ts`'s forward of the flag deleted | — |

That is PRDR-156 exactly: a feature complete, covered at the adapter layer, and reachable only
through a translation nothing asserted. For a flag whose entire security property is *"true
only when the operator passed it"*, a silently-unreachable — or silently-always-on —
translation is the defect, not a testing nicety.

Two seams close it, each mirroring one the file already had:

- `PipelineDeps.probe` / `.runInstall`, injectable like `sleep` and `now`. Without them a
  greenfield Go test passes on a CI host that happens to have Go and runs a real `brew install`
  on one that does not.
- `InitMainDeps.buildPipeline`, mirroring `buildBackend`, so the argv→deps translation is
  observable at the boundary where it is written.

Final: **18/18 mutants killed**, including the allowlist bypass (a row-less executable handed
to the runner) and the re-probe removal.
