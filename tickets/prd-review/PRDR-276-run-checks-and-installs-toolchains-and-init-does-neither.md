---
id: PRDR-276
title: "PRDR-274 installs a missing toolchain from `init`'s binding phase, but an approved plan's `init` returns before any phase runs (C-8) — so the installer is unreachable for exactly the project it was built for, and the only route to it, `--replan`, discards the plan. The operator's decision: `run`, where a gate first needs a compiler, checks and installs; `init` does neither"
state: DONE
severity: major
category: defect
labels: ["prd-review", "found-by-live-run", "D-34", "toolchain", "D-4", "F-2", "operator-decision"]
surface: ["src/kernel/run-toolchain.ts", "src/kernel/run.ts", "src/cli/run.ts", "src/cli/approve.ts", "src/adapter/toolchain.ts", "src/cli/doctor.ts", "src/init/bind.ts", "src/init/pipeline.ts", "src/cli/init.ts", "docs/plan-contracts-and-symbols.md", "tests/kernel/run-toolchain.test.ts", "tests/init/bind-toolchain.test.ts", "tests/init/greenfield-bindings.test.ts", "tests/adapter/toolchain-install.test.ts", "tests/cli/doctor.test.ts", "tests/cli/init-toolchain-flag.test.ts", "tests/cli/run-toolchain.test.ts", "tests/cli/run-toolchain-tty.test.ts", "tests/cli/approve-toolchain.test.ts", "tests/docs/golden-path.test.ts"]
prd_refs: ["C-4", "C-5", "C-8", "C-10", "D-4", "F-2", "S-5", "X-4", "PRDR-115", "PRDR-123", "PRDR-181", "PRDR-211", "PRDR-255", "PRDR-273", "PRDR-274"]
acceptance_criteria: ["`run` checks the toolchain behind every bound gate before anything spends. After the S-5 pin check and before the run lock, the head executable of each bound slot that Detent's table knows is probed with that row's own proof. A missing one stops the run before any session launches: the ksar failure — $2.74 and 50 turns to learn that `go` was absent — becomes a free check at the start.", "A missing toolchain is installed only on the operator's answer. On a terminal, `run` names every missing executable, the slots it blocks and the exact command, then asks `Install now? [y/N]`; anything but yes installs nothing. Off a terminal, `detent run --install-toolchain` is the relayed answer, in T-131's shape; given, it is the answer on a terminal too, and nothing is asked twice. With neither, `run` refuses with exit 2, naming the commands and the flag. Nothing is synthesized from the environment (C-5).", "Only Detent's table runs, and only a table executable is ever probed. The command is `TOOLCHAINS[n].install[platform]`, split to argv with no shell — PRDR-274's boundary, unchanged. An executable with no row is neither probed nor installed: it may be a script the plan itself creates (C-4), and probing `./scripts/test.sh --version` would execute project code, which PRDR-273's `doctor` row did for any such binding.", "The install is re-probed, not assumed, and recorded. Only a resolving executable lets the run continue; an install that exits 0 and leaves nothing on PATH refuses, naming what it tried. A run that proceeds announces what each install left behind and journals each attempt as a `toolchain_install` event after its `config` event; a refusal names each command it ran and what stayed unresolved, as every precondition's refusal does, before any journal exists.", "`init` neither checks nor installs. PRDR-273's greenfield `AWAIT_SETUP_CONSENT` and PRDR-274's `init --install-toolchain` are removed, with the `DetermineDeps`, `PipelineDeps` and `InitMainDeps` seams that existed only for them, and greenfield binds `provisional` as C-4 describes. Kept, the init-time stop would deadlock a fresh project: `init` would stop for a compiler that only `run` can install, and `run` needs a plan `init` never finished.", "`doctor`'s `toolchain` row applies the same rule and points at `run`: it names the missing executable and its slots, and says `detent run` installs it on the operator's approval — instead of instructing a manual `brew install go`, the manual step the operator ruled out.", "`docs/plan-contracts-and-symbols.md` §3.3 names `run` as the place a required toolchain is installed, and says why.", "Falsifying test: a `run` whose `test` gate is bound to `go test ./...`, with a probe that resolves nothing until an install runs, an approval that answers yes, and a recording installer. Against HEAD the installer is never called; with no one to ask and a ticket in the plan, the first session launches anyway, because `run` has no toolchain step."]
non_goals: ["Does NOT supersede silently. It supersedes, in writing, PRDR-273's criteria 1–2 and its non-goal 4 (\"Does NOT make a missing toolchain a run-time refusal\"), and PRDR-274's criterion 1 and its non-goal 5 (\"Does NOT run anything at RUN time. The flag is an `init` flag\"). Grounds neither ticket had: an approved plan's `init` runs no phase at all (C-8), so an init-time install can never reach a project that has already planned — ksar's exact state; and the operator's call is that planning does not need a compiler while execution does, so the question belongs where the need first arises.", "Does NOT cover the plugin driver. `/detent:run` drives the referee over MCP, where the answer would have to be relayed by the model; that transport is its own change. The headless `run` is the command that failed live, and the one this changes.", "Does NOT change brownfield binding. `bindSlot` still executes its candidates at `init` (C-3b interrupt 2), because choosing between candidates needs a command that runs. A brownfield repository on a machine without its toolchain still stops at `init`, as it did before PRDR-273.", "Does NOT verify a toolchain's VERSION against a project's pin — PRDR-273's non-goal stands — and does NOT re-check mid-run: a toolchain that disappears after the start is X-4's premise falsification, which already retains its work.", "Does NOT install an executable the table lacks, or guess a command for one. The table is the allowlist; extending it is a separate, reviewed change."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-273", "PRDR-274"]
depends_on: ["PRDR-274"]
---

# PRDR-276 — `run` checks and installs toolchains; `init` does neither

## Where this came from

D-34, a third time. PRDR-274 shipped `detent init --install-toolchain`, and the next step on
ksar-cloud was to run it. It would have done nothing:

```ts
/** C-8: an approved plan prints status and requires --replan to regenerate. */
if (approval.approved && !approval.stale && opts.replan !== true) {
  return { exitCode: 0, reachedPhase: "READY", executed: [], reused: [], … };
}
```

ksar's plan is approved and not stale (`56880251ee57`), so `init` returns before the binding
phase where the installer lives. The only route back into that phase is `--replan`, which drafts
every slice again — $1,067 of planning thrown away to install a compiler. PRDR-274 was tested at
the phase and at the handler, never through an `init` over an approved plan. It is PRDR-156's
shape again: complete, covered, and unreachable from where the operator stands.

The operator's decision, verbatim: "I want the run command to checks and installs toolchains not
init". It is also where the need arises. Planning reads documents and needs no compiler;
the first thing that needs `go` is the first gate a run executes.

## Why a table executable, and only a table executable

PRDR-273's probe ran `<head> --version` over every bound command. Moved to `run`, that covers
every binding a run has — including commands the planning documents name (PRDR-115) and an
operator's edited bindings — and `./scripts/test.sh --version` executes the project's script.
PRDR-273's `doctor` row already did. Restricting the check to the table fixes both: a row is a
machine toolchain no ticket installs, whose proof is known to be harmless (`go version`,
`mvn -v`); anything else may be a script the plan creates (C-4) and is the gate's to discover.

## Falsification against HEAD

`2aa38fa`, with this ticket's tests copied into a scratch worktree of it. Twenty tests fail, each on
the property it names:

```
× run checks … > an approved install runs the table's command, and the run proceeds
  → the command the operator approved, from Detent's own table: expected [] to deeply equal [ 'brew install go' ]
× run checks … > with no one to ask, the run refuses before any session launches
  → nothing spent discovering what one probe answers: expected [ { ticketId: 't1', …(2) } ] to have a length of +0 but got 1
× run checks … > a declined install runs nothing, and the run refuses
  → expected [ { ticketId: 't1', …(2) } ] to have a length of +0 but got 1
× run checks … > an install that leaves nothing runnable refuses, naming what it tried
  → it was run: expected [] to deeply equal [ 'brew install go' ]
× run checks … > each install is journaled beside the configuration the run loaded
  → expected undefined to match object { exe: 'go', …(3) }
× run checks … > the question is asked before the run lock is taken
  → a refusal here touches nothing, as every precondition's does: expected [] to deeply equal [ false ]
× `detent run` carries … > `--install-toolchain` is the relayed yes: the table's command runs and the run proceeds
  → Unknown option '--install-toolchain'. …
× `detent run` carries … > with no flag and no terminal, nothing is installed and the refusal names the flag
  → expected +0 to be 2 // Object.is equality
× `detent run` carries … > a terminal's no installs nothing          → expected +0 to be 2
× `detent run` carries … > a terminal's yes installs                 → expected [] to deeply equal [ 'brew install go' ]
× `detent run` carries … > the flag is the answer: given in advance, it is not asked again
  → Unknown option '--install-toolchain'. …
× greenfield binds … > a machine with no Go still binds the documented Go gates, provisional
  → expected completion, got interrupt: The verification commands for this stack need tooling this machine does not have (macOS (Homebrew)):
× greenfield binds … > a language outside the table binds its documented command without a lookup
  → expected 'interrupt' to be 'complete' // Object.is equality
× the table is the only thing probed > missingToolchains never probes a head the table does not know
  → each table executable once, and nothing else: expected [ 'go', './scripts/lint.sh', 'zig' ] to deeply equal [ 'go' ]
× the table is the only thing probed > probeExecutable executes nothing for an executable with no row
  → expected true to be false // Object.is equality
× what the operator is shown … > names the executable once, the slots it blocks, and the platform's command
  → expected 'The verification commands for this st…' to contain 'only with your approval'
× what the operator is shown … > sends the operator nowhere else — `init` no longer checks or installs
  → expected 'The verification commands for this st…' not to contain 'init'
× doctor checks … > names the missing executable, the slots it blocks, and that `detent run` installs it
  → the operator is sent to run, not to a terminal: expected '`go` (test, lint) does not run — brew…' to contain '`detent run` installs it'
× doctor checks … > is ok when every table executable runs, and says so when there is nothing to resolve
  → expected false to be true // Object.is equality
× doctor checks … > never probes a head the table does not know — it may be the project's own script
  → nothing Detent could install is missing: expected false to be true // Object.is equality
Tests  20 failed | 32 passed (52)
```

The two files written after that run fail on HEAD as well: all eleven of
`tests/cli/approve-toolchain.test.ts` (`makeTtyToolchainApproval is not a function`), and both of
`tests/cli/run-toolchain-tty.test.ts` — on a terminal, HEAD asks nothing
(`expected [] to deeply equal [ '\nInstall now? [y/N] ' ]`) and installs nothing.

The second line is ksar's failure in miniature: with Go absent and nobody asked, HEAD launched the
ticket's first session. The three kernel tests that pass on HEAD are guards — a machine that has
the toolchain is not asked, a row-less head is not probed, a run S-5 refuses installs nothing —
and cannot fail on a `run` that never asks.

## What changed

- `src/kernel/run-toolchain.ts` (new): `ensureToolchains` — probe the table executables behind
  the bindings, announce what is missing, take the answer, install from the table, re-probe,
  announce the outcome. No answer is a refusal, never a yes.
- `src/kernel/run.ts`: calls it after S-5 and before the lock; journals each attempt as a
  `toolchain_install` event after the `config` event. V-1″'s bindings read is kept, not repeated.
- `src/cli/run.ts`: `--install-toolchain`, and the TTY asker behind the one `interactive`
  expression the file already computes; the flag wins over the terminal. `src/cli/approve.ts`:
  `makeTtyToolchainApproval` — `Install now? [y/N]`, only `y`/`yes` installs.
- `src/adapter/toolchain.ts`: only a table executable is probed — `missingToolchains` skips a
  row-less head, and `probeExecutable` executes nothing for one. Every `MissingToolchain` carries
  a row, so the "no install command is known" branches are gone. The message says what a yes
  runs and sends the operator nowhere else.
- `src/init/bind.ts`, `src/init/pipeline.ts`, `src/cli/init.ts`: PRDR-273's greenfield stop and
  PRDR-274's `--install-toolchain`, with every seam that existed only for them, removed.
  `init.ts` and `pipeline.ts` are byte-for-byte their pre-PRDR-274 selves; `bind.ts` keeps
  PRDR-273's JVM/Ruby/.NET/PHP stack rows, which binding still proposes.
- `src/cli/doctor.ts`: the `toolchain` row applies the same rule, takes an injectable probe, and
  points at `detent run`.
- `docs/plan-contracts-and-symbols.md` §3.3: where the question is asked, and why there.
- `tests/docs/golden-path.test.ts`: PRDR-256's inventory of modules that can block on a human
  declares the new asker — `cli/run.ts` now wires three, and `cli/approve.ts` opens a second
  question that is not a C-5 interrupt.

Tests: `tests/kernel/run-toolchain.test.ts` (the kernel, 9), `tests/cli/run-toolchain.test.ts`
(argv, 5), `tests/cli/run-toolchain-tty.test.ts` (the terminal wiring, with the line reader
replaced, 2), `tests/cli/approve-toolchain.test.ts` (how an answer is read, 11);
`tests/adapter/toolchain-install.test.ts`, `tests/init/bind-toolchain.test.ts` and
`tests/cli/doctor.test.ts` rewritten to the new rule, every probe injected;
`tests/cli/init-toolchain-flag.test.ts` deleted with the flag it tested.

## Mutation battery

Thirty-two mutants, one per way this could be wrong, each run against the eight test files that
cover it (baseline 69/69 green) and restored from a snapshot, never from git. Every run used a
PATH with Homebrew removed, so a mutant that reached the real installer met `ENOENT`, not
`brew install go`: K4 and C6 are exactly those mutants, and both were killed that way.

| Mutant | Result |
|---|---|
| R1 `run` never checks (`missing.length >= 0`) | KILLED (13) |
| R2 no asker is not a refusal | KILLED (2) |
| R3 a decline is ignored | KILLED (3) |
| R4 the installer's exit code is believed | KILLED (1) |
| R5 the question is asked without the message being shown | KILLED (1) |
| R6 a completed install is not reported | KILLED (1) |
| R7 the probe seam is ignored | KILLED (6) |
| R8 the `test` slot is not checked | KILLED (13) |
| K1 the refusal is dropped | KILLED (6) |
| K2 the answer is not forwarded to the check | KILLED (10) |
| K3 the probe is not forwarded | KILLED (6) |
| K4 the installer is not forwarded — the real one runs | KILLED (7) |
| K5 `announce` is not forwarded | KILLED (2) |
| K6 the journal event is misnamed | KILLED (1) |
| K7a the check moved after the run lock | KILLED (1) |
| K7b the check moved before S-5 | KILLED (1) |
| K9 an attempt goes unjournaled | KILLED (1) |
| C1 `--install-toolchain` defaults on | KILLED (3) |
| C2 the flag is ignored | KILLED (2) |
| C3 the flag does not win over an asker | KILLED (1) |
| C4 the asker seam is dropped | KILLED (1) |
| C5 the probe seam is dropped | KILLED (3) |
| C6 the installer seam is dropped — the real one runs | KILLED (4) |
| C7 a terminal is answered yes without asking | KILLED (1) |
| A1 anything but `n` is yes | KILLED (6) |
| A2 the answer is not trimmed | KILLED (1) |
| T1 a row-less head is probed | KILLED (32) |
| T2 a row-less executable runs `--version` | KILLED (1) |
| T3 the message sends the operator to `init` | KILLED (1) |
| D1 `doctor` ignores the probe seam | KILLED (1) |
| D2 `doctor` points at a manual command | KILLED (1) |
| B1 `init` checks again — HEAD's `bind.ts` restored | KILLED (2) |

32/32 killed. The count is the number of tests that failed.

Seven gates green: 1415 tests across 136 files (2 skipped).
