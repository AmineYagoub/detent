---
id: PRDR-273
title: "Greenfield binding proposes gate commands from a language table and writes them `provisional` without ever resolving the executable they invoke, so a machine with no compiler passes `init`, passes `doctor`, and is discovered only when the first implement session runs the gate — where the same absence costs a paid session instead of a `which`"
state: DONE
severity: major
category: defect
labels: ["prd-review", "found-by-live-run", "D-34", "greenfield", "toolchain"]
surface: ["src/adapter/toolchain.ts", "src/init/bind.ts", "src/cli/doctor.ts", "tests/init/bind-toolchain.test.ts", "tests/init/greenfield-bindings.test.ts", "tests/cli/doctor.test.ts"]
prd_refs: ["C-3b", "C-4", "D-4", "F-2", "V-1", "PRDR-115", "PRDR-121", "PRDR-198", "PRDR-211"]
acceptance_criteria: ["A greenfield binding is not written until the executable it invokes resolves. `provisionalBindingsFor` builds commands from `GREENFIELD_COMMANDS` or the documents' own `stack.verification` and returns them `provisional` with no probe of any kind. After this ticket `determineVerification` resolves the head executable of every proposed binding and raises `AWAIT_SETUP_CONSENT` when one is absent, before the phase completes.", "The interrupt names every missing tool and the exact command that installs it, for this platform. One message listing all of them, not one interrupt per slot: an operator who is missing a toolchain is missing it for every slot that toolchain serves, and three separate stops for `go test`, `go vet` and `go build` is the same fact three times. The message states the resolved platform and, where a toolchain is absent from the table, says so rather than inventing a command.", "Brownfield behaviour is unchanged. `bindSlot` already EXECUTES each candidate and already raises `AWAIT_SETUP_CONSENT` on one that will not run (C-3b interrupt 2); this ticket adds the greenfield half of a check brownfield has always had. No brownfield path gains a probe, loses one, or changes its message.", "`doctor` performs the same check. Its own doc-block calls it `the checks a run would otherwise discover mid-flight`, and this is exactly such a check: on 2026-09-23 doctor reported five green rows against a machine with no Go toolchain, and the run then spent $2.74 and 50 turns discovering it. A `toolchain` row is added, reporting per bound slot which executable backs it and whether it resolves.", "The table covers every executable `GREENFIELD_COMMANDS` can propose, and the two move together. Keyed by EXECUTABLE rather than by language, because PRDR-115 gives the documents' own `stack.verification` priority: a TypeScript project naming `pnpm test` must be probed for `pnpm` and told about `pnpm`, where a row keyed `typescript` would name `npm` — which is not what would have run. A proposable executable with no row is the defect this ticket closes, reintroduced; a row no gate command reaches is a claim of support nothing exercises, except the package-manager rows that exist for documented overrides. The suite asserts both directions.", "Falsifying test: a greenfield `determineVerification` over an analysis whose stack language is `go`, with a probe that resolves nothing. Against HEAD the phase returns `complete` with three provisional bindings and no interrupt. Observed live: ksar-cloud under `3e141a3`, where `init` completed, `doctor` reported `[ok]` five times, and `t-001-bootstrap` then falsified its own premise with `sh: go: command not found`."]
non_goals: ["Does NOT install anything. This ticket only probes and names; whether Detent may run the command it names is PRDR-274's question and carries a D-4/F-2 amendment that this ticket deliberately does not make. Everything here holds under the existing policy that Detent installs nothing.", "Does NOT probe project DEPENDENCIES. `ECOSYSTEMS` (PRDR-211) installs what a manifest declares before a gate runs, and that mechanism is untouched. A missing `node_modules` is a thing Detent already fixes; a missing `node` is the thing it cannot.", "Does NOT change which commands a greenfield binding proposes. `PRDR-115` settled that the documents' own `stack.verification` wins over the table, and ksar's three Go gates come from D44 rather than from `GREENFIELD_COMMANDS`. The probe reads whatever command was chosen; it does not choose.", "Does NOT make a missing toolchain a run-time refusal. `run` already discovers it correctly through X-4 premise falsification, and that path stays. This ticket moves the DISCOVERY earlier, to where it is free; it does not add a second gate at run time.", "Does NOT verify a toolchain's VERSION against what the project pins. ksar's `go.work` pins Go 1.27 and a machine carrying 1.21 would satisfy this probe. Version conformance is a real gap and a separate one, because it needs the pin parsed out of a project file this phase does not read."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-274"]
depends_on: []
---

# PRDR-273 — greenfield binds gates to a toolchain it never probes

## Where this came from

D-34, from the first live run of the ksar-cloud plan on 2026-09-23. The sequence, in order:

1. `detent init` bound `go test ./...`, `go vet ./...`, `go build ./...` as `provisional`,
   `approved_by: auto`.
2. `detent doctor --smoke` reported **five green rows** — config, both pins, webfetch rule
   form, and a live smoke session that cost $0.15 and passed.
3. `detent run` claimed `t-001-bootstrap`, and the implement session wrote the entire D31
   scaffold — four modules, cross-module imports, table-driven tests, `Taskfile.yml`,
   `go.work` — before running the gate.
4. The gate answered `sh: go: command not found`.

The session's own diagnosis was correct and is worth quoting, because it is the evidence that
nothing downstream of `init` could have caught this:

> "no file in the repository can put one on the gate runner's PATH, installing it is not among
> my tools (brew/npm and every other shell command are refused), and `.detent/config.json`
> declares no toolchain-install mechanism for Detent to satisfy from a manifest."

It escalated correctly, retained its work at `3448866`, and cost **$2.74 and 50 turns** to
learn something `which go` answers for nothing. With `t-001-bootstrap` at fan-out 546, the run
exited 10 with every one of the other 546 tickets blocked.

## Why greenfield and not brownfield

`bind.ts` already has this check — on one side only.

**Brownfield** discovers candidates and `bindSlot` *executes* each one. A candidate that will
not run raises `AWAIT_SETUP_CONSENT`: *"A verification command was found but could not be
used."* That is C-3b interrupt 2, and it is exactly the right behaviour.

**Greenfield** calls `provisionalBindingsFor`, which maps a language key to commands and
returns. It executes nothing. Its only `AWAIT_SETUP_CONSENT` path is *"No conventional
verification commands are known for the chosen stack"* — the case where the table has no row,
not the case where the table has a row and the machine has no compiler.

C-4's justification for not probing is explicit, and it is sound as far as it goes:

> "Greenfield binds `provisional` (C-4): there is nothing to bind against yet… That is
> precisely why they are provisional: bootstrap ticket #1 has just created it."

The reasoning assumes the missing thing is **the project's own tooling** — a `package.json`
that ticket #1 will write. It silently also covers **the machine's toolchain**, and the two are
not the same absence. The first resolves itself when ticket #1 runs. The second never does.

## The shape of the fix

A `TOOLCHAINS` table in its own module, keyed by the EXECUTABLE a gate command invokes,
carrying the arguments that prove it runs and the install command per platform. Keyed by
executable and not by language because the command actually bound is not always the table's:
PRDR-115 gives the documents priority, so `pnpm test` must be probed for `pnpm`. `determineVerification`'s greenfield branch resolves the head executable
of each proposed binding through it and raises one interrupt naming everything missing.

`defaultProbe` in `symbols.ts` runs `--help` per PRDR-198, which is right for a single pinned
tool and wrong here: `go --help` exits non-zero, `java -version` writes to stderr, and
`dotnet --version` differs again. Each row therefore names its own proof-of-life arguments
rather than sharing one convention across nine toolchains.
