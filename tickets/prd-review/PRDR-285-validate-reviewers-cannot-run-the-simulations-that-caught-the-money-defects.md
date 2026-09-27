---
id: PRDR-285
title: "ksarjs's money verifier found a rounding defect by running a randomized ledger simulation (a chargeback share that stranded a cent in 956 of 8,000 sequences), and confirmed two later majors with a 40,000-sequence run. `init` sessions are read-only and cannot run one. VALIDATE's reviewers get a sandboxed scratch directory outside the repository, where they may write and run throwaway scripts that report and never edit"
state: DONE
severity: major
category: capability
labels: ["prd-review", "specification-phase", "operator-decision", "S-1′", "S-1‴", "S-1⁗", "containment", "sandbox"]
surface: ["src/init/pipeline.ts", "src/init/session.ts", "src/init/validate-round.ts", "src/init/validate-scratch.ts", "src/init/validate.ts", "src/schemas/roles.ts", "src/sessions/backend.ts", "src/sessions/guard.ts", "src/sessions/sandbox-probe.ts", "src/sessions/sandbox.ts", "src/sessions/scratch-server.ts", "src/sessions/sdk.ts", "prompts/manifest.json", "prompts/spec_review.md", "detent-prd-v3.md", "tests/init/validate-sandbox.test.ts", "tests/init/validate.test.ts", "tests/init/write-fixture.ts", "tests/kernel/session-policy.test.ts", "tests/sessions/prompts.test.ts", "tests/sessions/sandbox.test.ts"]
prd_refs: ["C-2⁶", "C-2¹⁴", "N-7", "S-1′", "S-1‴", "S-1⁗", "S-2′", "S-2″", "SEC-4", "PRDR-067", "PRDR-278", "PRDR-284"]
acceptance_criteria: ["A reviewer that simulates, a `spec_review` session (decision 15), gets a scratch directory outside the repository and outside `.detent/`, created for the round and removed after it. It may write there and run what it wrote, and nothing else.", "Execution is sandboxed below the hook. A script the reviewer runs cannot write outside the scratch directory or reach the network, whatever it contains, and a hostile-fixture test runs a script that tries both. Where the platform offers no such sandbox, simulation is off and the round says so.", "The simulation reports and never edits. Its results are findings, each with the sequence that broke an invariant, and only VALIDATE's writer changes the pack.", "Scripts run under a time limit and an output limit. A script that exceeds either is stopped, and the reviewer is told which limit it hit: never a hang.", "Nothing in the scratch directory is committed, or read by a later phase, except the round's findings.", "The sandbox belongs to the `spec_review` role's tools and to no other role's."]
non_goals: ["Does NOT give AUDIT, DECIDE or WRITE execution; only VALIDATE's reviewers get it.", "Does NOT let a simulation install packages or fetch dependencies. It uses the interpreter the machine has, and says which.", "Does NOT keep simulation code as a pack artifact. A property a simulation checks belongs in the pack as a requirement with a criterion, and the build then tests it."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-067", "PRDR-284"]
depends_on: ["PRDR-284"]
---

# PRDR-285 — sandboxed scratch execution for VALIDATE's reviewers

## Where this came from

In ksarjs, the money reviewer ran randomized simulations of the ledger rules.
- **Round 2:** 956 of 8,000 random sequences hit a rounding collision, so the planned property
  test could never have passed.
- **Round 6:** 40,000 sequences confirmed two money majors, and showed that the proposed fixes
  removed them.
- **Round 7:** 40,000 sequences cleared the main properties.

Each simulation ran as throwaway Python inside the reviewer's session. None was saved.

## Problem

S-1′ (PRDR-067) gives `init` sessions a read-only surface plus exactly one write rule. A reviewer
that can only read can state an invariant but not test it, and in ksarjs the simulations were
what found or confirmed the money defects.

## Design

The plan's §7, step 6. Running code is a containment change, so it is sandboxed below the hook
rather than trusted to it: the hook sees the command, not what the script then does. The
sandbox's scope is the scratch directory and no network. The reviewer reports, and the writer
edits.

As built:
- **Detent runs the script, not the session.** A reviewer whose round has a sandbox gets one more
  tool, `mcp__detent_scratch__run`, an in-process MCP tool taking a script's `source` and the
  `interpreter` to run it with. Detent writes the source into the session's own directory under
  the round's scratch directory and runs it there, inside the operating system's sandbox, and
  hands back the exit and the output. The reviewer gets no Bash, and no Write, Edit or Read on
  the scratch directory: the script's output is the only channel back.
- **The sandbox is macOS's Seatbelt**, through `/usr/bin/sandbox-exec`, with a profile Detent
  writes for each run. It denies by default. It lets the script read `/`, `/System`, `/usr`, the
  interpreter's own install and the scratch directory, and nothing else: not the repository and
  not the operator's home. It lets it see file metadata only on those paths and their ancestors,
  and read the system's settings, such as its processor count and host name. It lets it write
  only its own directory and `/dev/null`, and use no network at all, local included. It
  allows no Mach lookup, so a script cannot ask a system service, such as LaunchServices or
  AppleScript, to act for it. It allows no fork and no spawn, so a run is the one process Detent
  started, which signals nothing but itself.
- **Limits.** A run is stopped at 120 s of wall clock, or once its output passes 64 KiB: Detent
  kills it, and the reviewer is told which limit stopped it. A CPU limit of twice the wall clock
  ends a run Detent no longer can, as when Detent itself ends mid-run. A script over 128 KiB is
  refused.
- **Interpreters.** `python3`, the first on `PATH`, is run by its real path in isolated mode
  (`-I`), and `node` is the one running Detent. Each is offered with its version; a script uses
  what the install holds, and nothing can be installed. The environment is `PATH`, `HOME` and
  `TMPDIR`, the last two the scratch
  directory, and a UTF-8 locale; no credential crosses (SEC-4).
- **The probe.** Before VALIDATE's first round, Detent probes the sandbox once. For each
  interpreter it runs a canary that must write inside its directory, and must fail to write
  outside it and to connect to a listener Detent opens. Any other result turns simulation off,
  with the reason; so does a platform other than macOS, a missing `sandbox-exec`, or a sandbox
  that cannot be applied, as when Detent itself runs sandboxed.
- **The round.** With the sandbox on, each round makes its scratch directory under the system's
  temporary directory, outside the repository and `.detent/`, and removes it once its reviewers
  are done. Each reviewer's inputs carry `simulation`: the tool, the interpreters and versions,
  and the limits. With the sandbox off, `simulation` is null, and each round says why.
- **The prompt.** `prompts/spec_review.md` tells the reviewer when to simulate: where a document
  states an invariant that reading alone cannot settle. It simulates the rules as the pack states
  them, seeded and over many random sequences. A sequence that breaks the invariant is a finding
  whose `why` gives the seed, the sequence, the step that broke it, and how many sequences of how
  many did.

## From PRDR-284

VALIDATE is built (C-2¹⁴), and its reviewers run as `spec_review`. The role is read-only and
writes its artifact alone. Four places say so, and each becomes false the day the sandbox lands:
- `READ_ONLY_ROLES` in `src/schemas/roles.ts`, whose doc-block names the scratch directory as
  not built;
- `READ_ONLY_STAGES` in `src/sessions/guard.ts`: a role that runs scripts may need a stop-gate
  rule of its own, but not the product's, since it changes no code;
- the note `validateStage` in `src/init/validate.ts` gives once per run, "no reviewer runs a
  simulation, since the scratch directory one needs is not built";
- `prompts/spec_review.md`, which says the reviewer changes nothing and writes only its artifact.
  The prompt says nothing of simulation, so the `invariant` category is judged by reading alone.

A reviewer's launch is `reviewArea` in `src/init/validate-round.ts`. It passes no `surface`, so
the session gets the read tools and its one artifact rule, and the scratch directory would be
declared there. The findings a simulation produces go through the same checks as any other: each
quotes the passages it stands on, at their lines. A sequence that broke an invariant belongs in
`why`.

## Building it

What building it settled. Each is recorded in the PRD as S-1⁗ and is open to the operator's veto:

1. **Detent runs the script, and the session holds no shell.** The plan's §7 step 6 gives the
   reviewer a scratch directory to write and run in. Given Bash there, its commands would be
   checked by the hook, which sees a command line and not what the script it names then does.
   Instead the reviewer hands Detent a whole script through one in-process MCP tool,
   `mcp__detent_scratch__run`, and Detent writes it into the session's own directory and runs it
   there, sandboxed. The reviewer has no Bash, and no Read, Write or Edit on the scratch directory,
   so a script's output is the one way its results come back. The Agent SDK's sandbox for the Bash
   tool was the other way: it would hand the session a shell, and the containment would be the
   SDK's setting rather than a profile Detent writes and tests.
2. **macOS's Seatbelt, and nothing else yet.** `sandbox-exec`, under a profile written for each
   run. Linux's bubblewrap is not wired: no Linux was at hand to test it on, and an untested sandbox
   is one in name only. So CI, which runs on Linux, and an N-7 self-build there simulate nothing,
   and each round says why.
3. **A deny-by-default profile, each allowance measured** on macOS 26.6 against python3 3.14 and
   node 22:
   - reading `/` itself, without which every process aborts as it starts;
   - `process-exec`, which starts the interpreter, and with which a script can only replace itself
     with another program, as confined as it was;
   - `sysctl-read`, the system's settings, without which node dies in `os`'s calls and python3
     cannot count its processors or name its platform; it also lets a script read the host name
     and the kernel's version, recorded below;
   - reading `/System`, `/usr`, the interpreter's install, the script's own directory, and
     `/dev/null`, `/dev/random` and `/dev/urandom`, and the metadata of each directory above them,
     each alone;
   - writing the script's own directory, and `/dev/null`.

   Nothing else: no network, local included, no Mach lookup, no fork, and no signal but a
   process's to itself, which Seatbelt allows unasked.
4. **A run is one process.** It was first built with `process-fork` allowed, a process-group kill,
   and a CPU limit for anything that left the group. A script could then leave behind a process
   that waited, which outlived its run, confined, since a CPU limit ends only one that computes.
   Without the rule, Seatbelt refuses `fork`, `posix_spawn`, Python's `subprocess` and node's
   `child_process`, and both interpreters start, threads and worker threads included. So stopping
   a run stops everything the script did; the group kill, and the grace for a pipe some other
   process held open, are gone. A simulation that needs a second process cannot run, and the
   prompt and the tool's description say so.
5. **Limits: 120 s of wall clock, 64 KiB of output across both streams, and 128 KiB of source**,
   sized to ksarjs's simulations, whose 40,000 sequences ran in seconds. Detent kills a run at
   either limit, and the tool says which. A CPU limit of twice the wall clock, set before the
   sandbox is entered, ends a run Detent no longer can, as when Detent itself ends mid-run; a
   script's threads spend it together.
6. **Two interpreters.** python3, since ksarjs's simulations were Python, and node, since Detent
   runs on it, so it is always there. python3 is the first on `PATH`, in isolated mode, run by its
   real path: Seatbelt judges the file a process opens, and python3 run by a link reads paths the
   profile does not open. `/usr/bin/python3` is offered only when the developer tools are
   installed, since without them it asks to install them instead of running. Nothing is
   installed: a script uses what the install holds.
7. **An install is read only where that opens nothing more.** Never `/`, never a directory holding
   the operator's home or the repository, and nothing inside the repository. An install under the
   home is read: nvm's node lives there.
8. **The probe proves the sandbox with canaries.** Each interpreter's canary must write its own
   directory, and must fail to write beside it and to reach a listener Detent opens. A canary that
   escapes turns simulation off for every interpreter, since a sandbox that let one script out
   contains none. An interpreter whose canary does not run is not offered, and the others still
   are. The probe runs once per validation, before the first round that runs, so a conforming
   pack, or a validation that runs no round, never probes.
9. **Every reviewer of a round may simulate, each in a directory of its own.** The reviewer judges
   from its documents whether an invariant needs a run. The tool makes the session's directory at
   its first script, inside the round's.
10. **A simulated finding is a finding.** Its seed, sequence and counts go in `why`, and code
    checks it as every other: its places quote the pack. Nothing records that a finding came
    from a run.
11. **The round's directory is under the system's temporary directory**, made for the round and
    removed in a `finally`. A temporary directory inside the repository, or one that cannot be
    used, turns simulation off for the round, which says why.
12. **The notes.** With a sandbox, VALIDATE names the interpreters and their versions once per
    run. Without one, each round says why, so each round's note stands on its own in the journal.
    PRDR-284's once-per-run "no reviewer runs a simulation" note is gone.
13. **The environment.** `PATH` is `/usr/bin:/bin`, `HOME` and `TMPDIR` are the script's own
    directory, and the locale is UTF-8; the shell that sets the CPU limit adds `PWD` and `SHLVL`.
    No variable of Detent's crosses (SEC-4).
14. **The role gate is code's.** `SCRATCH_ROLES` holds `spec_review` alone. `launchInitSession`
    refuses a grant for any other role before anything is gated, charged or journaled, and the
    run loop's session arm never sets one.
15. **The tool is always loaded**, never behind a tool search a session has no tool for, and a
    call outlasts its run by 30 s, so the run's own limit is what stops it.
16. **The mark is S-1⁗ (3.1.1)**, the next S-1 mark. C-2¹⁴, C-2⁶, S-1‴, S-1′ and S-2″ point to it.

## Falsification (verification protocol, item 1)

The new and changed test files, the battery's additions among them, were copied into a
`git archive` of HEAD `52b5130` in the scratchpad and run there, so the working tree was not
touched. The copy's `src/` and `prompts/` were checked against HEAD's, byte for byte. Of the five
files:
- `sandbox.test.ts` and `validate-sandbox.test.ts` cannot load at HEAD, since the modules they
  test do not exist there;
- `validate.test.ts`, `session-policy.test.ts` and `prompts.test.ts` pass at HEAD, as they should.
  The first loses PRDR-284's once-per-run note test. The second adds a negative, that no run-loop
  session carries the sandbox, which none can at HEAD. The third changes a doc comment.

```
 FAIL  tests/init/validate-sandbox.test.ts [ tests/init/validate-sandbox.test.ts ]
Error: Cannot find module '../../src/sessions/sandbox.js' imported from '…/head285/tests/init/validate-sandbox.test.ts'
 FAIL  tests/sessions/sandbox.test.ts [ tests/sessions/sandbox.test.ts ]
Error: Cannot find module '../../src/sessions/sandbox.js' imported from '…/head285/tests/sessions/sandbox.test.ts'

 Test Files  2 failed | 3 passed (5)
      Tests  49 passed (49)
```

So that each new test is seen failing on what it tests, and not on a missing module, the run was
repeated with inert stand-ins for the three new modules: an empty profile, a run that runs
nothing, a probe that says off with no reason, and a server with no instance. 44 of the 50 new
tests fail. Four are skipped, the python3 cases, since the stand-in probe offers no interpreter.
Two pass, as they should. "Starts no process, and signals none" is a negative the empty profile
meets, and "gives it to no writer" holds at HEAD, where no session gets a sandbox.

```
 ❯ tests/sessions/sandbox.test.ts (38 tests | 33 failed | 4 skipped) 92ms
   × … > denies by default, and never allows everything 5ms
     → expected '' to contain '(deny default)'
   × … > under node: every escape is refused, and the one write it may make lands 6ms
     → Cannot read properties of undefined (reading 'name')
   × … > stops a script at the time limit, never a hang 1ms
     → expected { exit: null, signal: null, …(2) } to match object { stopped: 'time', signal: 'SIGKILL' }
   × … > is off when the sandbox lets its canary write outside its directory 1ms
     → expected { kind: 'off', reason: '' } to deeply equal { kind: 'off', …(1) }
   × … > is one tool, `run`, always loaded, taking a script and one of the interpreters the sandbox offers 3ms
     → Cannot read properties of undefined (reading 'connect')
   × … > refuses an interpreter it was not given, and a script over the limit, and runs nothing 0ms
     → expected '' to match /not one of node/u
 ❯ tests/init/validate-sandbox.test.ts (12 tests | 11 failed) 1023ms
   × … > makes one for the round, outside the repository and .detent/, gives it to every reviewer of the round, …
     → a round's directory is its own: expected undefined not to be undefined // Object.is equality
   × … > says in each round why no reviewer can simulate, and a reviewer's simulation input is null 114ms
     → each round's note, and no other of the sandbox: expected [ Array(1) ] to deeply equal [ …(2) ]
   × … > refuses the grant to any other role, before its session starts 52ms
     → spec_write: expected { role: 'spec_write', …(9) } to be an instance of Error
   × … > is told when to simulate, how, and what a simulated finding carries, in the role's own prompt 7ms
     → expected 'You are the Spec Review agent (read-o…' to contain '`simulation`, when it is not null, le…'

 Test Files  2 failed | 3 passed (5)
      Tests  44 failed | 51 passed | 4 skipped (99)
```

## Mutation battery (verification protocol, item 2)

Listing the mutants found one defect before any ran. A canary that ended without a word was named
by nothing, since `split` never returns an empty list, so the probe's reason ended in a colon. It is
now named by its exit or its signal, and tested. The battery's first baseline found a flaky test:
it counted every timer in the test's process, and another test's timer could expire mid-run. It now
counts only the run's own timers.

The battery ran 127 mutants, one defect each. Every mutant ran against the two new suites and the
session arm's policy suite; the SDK's also ran against the symbol server's suite, and VALIDATE's
against VALIDATE's. Each file was restored from a snapshot copy, never by `git checkout`, and
checked byte for byte, and after the battery the nine files matched their hashes from before it.
The mutants covered:
- the profile: each allowance removed, each widened, and fork and signals allowed;
- the runner: the CPU limit, the environment, the working directory, the output cut, the stop, the
  timer, a spawn that fails, and the event a run settles on;
- what the tool says of a run, and the runner's refusals, numbering, directories and names;
- the probe: the platform, the executable, each clause of `installRoots`, both interpreters'
  discovery, each canary check, an escape, and the reasons;
- the server: its loading, its timeout, its name, its enum and its handler;
- the SDK's servers, the session's tool and grant, the role gate, and `SCRATCH_ROLES`;
- VALIDATE: the inputs, the notes, the round's directory, the probe's count and seam, and the grant
  reaching each reviewer.

The first pass killed 113, and 14 survived:
- **Seven equivalent.**
  - **P05** and **V09**, "inside" judged without the absolute-path clause. Between two absolute
    POSIX paths `path.relative` is never absolute, and the sandbox is macOS's alone. The clause
    stays, as the idiom's.
  - **P17**, python3 introspected with `site`. That changes nothing on an install with no
    `sitecustomize`, and this machine's has none; `-S` keeps one that prints from breaking the
    probe's parse.
  - **P18**, the executable's directory not read. Every python3 here keeps its executable inside a
    prefix that is read.
  - **P22** and **P23**, the probe's two witnesses of one connection: the listener's count, and the
    canary's word. Either alone saw the escape in every run. Both stay, since which sees it first
    is a race.
  - **S34**, a later limit relabelling a stopped run. The run is killed at the first limit, and a
    second could only land in the milliseconds before it dies.
- **One dead clause.** **P06**, `/` read as an install. `/` holds the operator's home, so the home
  clause already refused it. The clause is gone, and its successor mutant is killed below.
- **Two gaps, now covered.**
  - **S03**, the profile without `sysctl-read`. Both interpreters start without it, but node then
    dies in `os`'s calls, and python3 cannot count its processors or name its platform. The hostile
    fixture now counts the processors, as a simulation sizing its threads would.
  - **S22**, python3 run without `-I`. A new test has a script say it runs isolated, with its own
    directory off its import path.
- **Four not testable here**, recorded below where they leave something unbuilt:
  - **S24**, the CPU limit's failure ignored. No test lowers Detent's own hard limit.
  - **P16**, the developer-tools check skipped. This machine's python3 is Homebrew's.
  - **X04**, `validatePhase`'s own probe told no repository. Every test passes its own sandbox.
  - **S41**, a run settled at its exit rather than when its output closes. Node read every byte a
    script left in the pipe before it reported the exit, even with 400 KB unread, so no test here
    tells the two apart. `close` stays, since it is what Node documents for a finished output.

The second pass re-ran S03, S22 and S41 against the grown tests, and three mutants on the simplified
`installRoots`: no home clause, no clause for what holds the repository, and none for what lies in
it. It killed 5 of 6. S41 survived, as above.

Every mutant that changes what a test here can see is killed: 113 in the first pass, the two gaps
in the second, and the three on the changed code.

## What changed

- **`src/sessions/sandbox.ts`** (new): the profile (`seatbeltProfile`), a run (`runSandboxed`),
  and the tool's runner (`scratchRunner`), which numbers each session's scripts in a directory of
  its own and says how each run ended. The limits and names (`SCRATCH_*`, `SANDBOX_EXEC`), and the
  types `Sandbox`, `Interpreters`, `ScratchGrant` and `SandboxRun`.
- **`src/sessions/sandbox-probe.ts`** (new): `probeSandbox`, its canaries, and `installRoots`.
- **`src/sessions/scratch-server.ts`** (new): `scratchServer`, the in-process MCP server with its
  one tool.
- **`src/sessions/sdk.ts`**: `serversOf` builds a session's MCP servers, the symbol server and the
  scratch server beside it, and gives no `mcpServers` key when there are none.
- **`src/sessions/backend.ts`**: `SessionSpec.scratch`.
- **`src/init/session.ts`**: `InitSessionRequest.scratch`, which adds the tool to `allowedTools`
  and the grant to the spec; the role gate at the top of `launchInitSession`.
- **`src/schemas/roles.ts`**: `SCRATCH_ROLES`. `READ_ONLY_ROLES`' doc-block no longer says the
  scratch directory is not built.
- **`src/sessions/guard.ts`**: doc-blocks only. `READ_ONLY_STAGES` and `toolsForRole` say what a
  reviewer whose round has a sandbox gets, and why it still has no stop gate.
- **`src/init/validate-scratch.ts`** (new): `simulationInput`, `offeredNote`, and
  `withRoundScratch`, which makes and removes a round's directory, or says why the round has none.
- **`src/init/validate-round.ts`**: `reviewArea` takes the round's grant, puts `simulation` in the
  reviewer's inputs, and launches the reviewer with it.
- **`src/init/validate.ts`**: `ValidateStageDeps.sandbox`. The loop probes once, before the first
  round that runs, and runs each round's reviewers inside `withRoundScratch`. `validatePhase` asks
  the pipeline's sandbox, or probes this machine. The once-per-run note is gone.
- **`src/init/pipeline.ts`**: `PipelineDeps.sandbox`; `docPatterns` became one line, to stay in
  the file's line budget.
- **`prompts/spec_review.md`**: the `simulation` paragraph. `prompts/manifest.json` is regenerated.
- **`detent-prd-v3.md`**: S-1⁗, and its pointers on C-2¹⁴, C-2⁶, S-1‴, S-1′ and S-2″.
- **Tests:**
  - `tests/sessions/sandbox.test.ts` (new):
    - the profile, line by line;
    - the hostile fixture under node and python3: what a script may do, what it must not, and
      its environment;
    - the limits, what the tool says of each, and the CPU limit's value;
    - the probe's on and off cases, `installRoots`, and how the probe names the repository to it;
    - the tool as a session is served it, and the runner.
  - `tests/init/validate-sandbox.test.ts` (new):
    - the round's directory, and the writer's none;
    - the inputs and the notes, and the notes of a round with no sandbox;
    - a temporary directory inside the repository or unusable;
    - the probe count;
    - the role gate, `buildOptions`, and the prompt;
    - a simulation end to end, whose finding reaches the writer.
  - `tests/init/write-fixture.ts`: a fixture probes no machine's sandbox.
  - `tests/init/validate.test.ts`: PRDR-284's once-per-run note test is gone with the note.
  - `tests/kernel/session-policy.test.ts`: no run-loop session carries the sandbox or its tool.
  - `tests/sessions/prompts.test.ts`: a doc comment.

## Recorded, not fixed

- **No sandbox but macOS's.** Linux's bubblewrap is not wired, and Windows has none. CI and an
  N-7 self-build on Linux simulate nothing, and each round says so.
- **No memory or disk limit.** macOS enforces no memory limit on a process, and nothing limits what
  a script writes to its own directory, so a script can exhaust memory or fill the temporary
  volume until its time limit ends it.
- **A script that waits outlives a Detent that ends mid-run.** The CPU limit ends only a script
  that computes. A waiting one lives on, confined, until it ends, and its round's directory stays.
- **`sandbox-exec` is marked deprecated** in its manual page. macOS still ships it, and a macOS
  without it turns simulation off, with the reason.
- **A node whose libraries lie outside its install**, as Homebrew's do, cannot load them in the
  sandbox, so its canary fails and it is not offered. This machine's node is nvm's, and no
  Homebrew node was run.
- **The developer-tools check is untested.** This machine's python3 is Homebrew's, and no test runs
  `/usr/bin/python3` either way.
- **The CPU limit's failure path is untested.** When Detent's own hard CPU limit is lower than a
  run's, the shell says so and exits 125, the canaries fail, and no interpreter is offered. No test
  lowers Detent's limit.
- **Why an interpreter is not offered is said only when none is.** With node offered and python3
  not, the note names node alone.
- **A script can read the system's settings**, the host name and the kernel's version among them,
  and print them, so they can reach the reviewer's session. Nothing of the repository or the
  operator's home is among them.
- **`validatePhase`'s own probe is untested.** Every test passes its own sandbox, so that a fixture
  reads the same on every platform, and none checks that the default probe is told the repository.
- **Nothing records that a round could simulate, or that a finding came from a run.** The notes
  say the first, in the journal; a finding's `why` says the second, in words.
