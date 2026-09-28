---
id: PRDR-311
title: "The build stamp names the tree as it is at the first checkpoint, not the tree the process loaded. `detentBuild()` digests the tree the first time it is called, which is the first checkpoint write, and keeps that digest for the rest of the process. On tabachir's live run the `init` process loaded 247a2b9 (3.1.0+65e7283f323d) at 08:56. It first stamped at 09:52, by which time the same checkout held PRDR-307 and part of PRDR-308, so AUDIT and DECIDE are stamped 3.1.0+517b414e313b, a tree that never ran"
state: DONE
severity: major
category: correctness
labels: ["prd-review", "N-5″", "planning-redesign", "live-run"]
surface: ["src/kernel/build.ts", "tests/init/mixed-builds.test.ts", "detent-prd-v3.md"]
prd_refs: ["N-5″", "C-7″", "C-8"]
acceptance_criteria: ["The running build is digested when `src/kernel/build.ts` is first imported, which is while the process loads, and every later call returns that digest.", "An edit to the tree after the process has loaded does not move the stamp of any record the process writes.", "The PRD records the change as N-5‴, with an amendment line on N-5″.", "Falsifying test: a copy of `build.ts` in a temporary tree is imported, then a prompt in that tree is edited. Against HEAD, `detentBuild()` returns the digest of the edited tree. With the fix it returns the digest of the tree as it was imported."]
non_goals: ["Does NOT digest the modules as they were loaded: the tree is digested at import, and an edit made while the imports are resolving can still slip in.", "Does NOT restamp the tabachir run's checkpoints."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-297"]
depends_on: []
---

# PRDR-311 — the build stamp names the tree at the first checkpoint

## Where this came from

This comes from the live test run on tabachir's disposable clone. The `init` process started at
08:56:20 from `~/detent` at 247a2b9, whose build is 3.1.0+65e7283f323d. That checkout stayed the
development tree. PRDR-307 was committed at 09:01, and PRDR-308 was being built in the same tree
when AUDIT completed at 09:52. The checkpoints read:

    INIT_FS   3.1.0+344a6f4c5719  2026-09-27T22:03:58Z   (the previous night's process)
    DISCOVER  3.1.0+344a6f4c5719  2026-09-27T22:03:58Z
    AUDIT     3.1.0+517b414e313b  2026-09-28T08:52:34Z
    DECIDE    3.1.0+517b414e313b  2026-09-28T09:29:30Z

The build that ran AUDIT and DECIDE, 3.1.0+65e7283f323d, appears nowhere. The build they name was
never run. It is a digest of the tree at 09:52, mid-edit.

## Problem

`detentBuild()` keeps its digest in `running ??= buildOf(TREE)`. That memoizes the first call, and
the first call is the first checkpoint write, not the process start. The doc-block says "the
running build, the same for every call in a process". The value is the same on every call, but it
is not the running build once the tree has changed between loading and the first stamp.

N-5″ stamps builds so that PRESENT can name every build that made the plan, and so that a plan
made by several builds needs approval. A late digest defeats both checks:

- **A mix is hidden.** Process A loads build X, and the tree then becomes Y. Process B loads Y.
  If A stamps first after the change, both stamp Y, and a plan that X and Y made is shown as one
  build.
- **A mix is invented.** A process that loaded X but stamps a half-edited tree names a build that
  nothing ran. A restart on X then stamps X, and PRESENT asks for approval of a mix that never
  happened.

Nothing checks the stamp against the code that runs, so the gap never shows in a test run, where
the tree does not change under the process.

## Design

Digest the tree when the module is evaluated. The CLI imports it statically, through `init` and
`run` down to the checkpoint writer, so evaluation happens while the process loads. `detentBuild()`
returns that value.

## Building it

- `src/kernel/build.ts`: `const running = buildOf(TREE)` at module level, and `detentBuild()`
  returns it. The doc-block says when the digest is taken and why.
- `tests/init/mixed-builds.test.ts`: a copy of `build.ts` in a temporary tree, with a
  `package.json` and one prompt, is imported by URL, so the copy is a fresh module whose `TREE` is
  that tree. Its prompt is then edited. The tree's digest moves, and `detentBuild()` still names
  the tree as it was imported.
- `detent-prd-v3.md`: N-5‴, with an amendment line on N-5″.

### Vetoable calls

1. **The digest is taken at import, not by a call in each `main`.** An import-time digest needs no
   caller to remember it, and it covers the referee and every script that imports the module. The
   cost is one digest of `src/`, `prompts/` and `package.json` in each process that imports it,
   tests included.
2. **The tree is digested, not the modules as they were loaded.** Under tsx, Node gives no
   access to the source a module was compiled from. The tree at import is the closest record of
   it, and the gap is only the moments while the imports resolve.
3. **The live run's stamps stay as they were written.** PRESENT does not name the builds of the
   specification phases (N-5″), and the run's restart on its pin stamps the pin's own build from
   VALIDATE on.

## Falsification

The case ran against HEAD `8926f84`:

    AssertionError: expected '9.9.9+b00e0230b9d0' to be '9.9.9+08b24edf4246' // Object.is equality

`b00e0230b9d0` is the edited tree, and `08b24edf4246` the tree as it was imported. The same
behaviour had been reproduced outside the suite, in a scratch tree run under tsx.

## Mutation battery

Each mutant was applied to a snapshot copy of `build.ts` and restored from it. The runs covered
`mixed-builds`, `init-mixed-builds` and `plan-quality`, 31 cases.

| Mutant | Result |
|---|---|
| M1 the lazy memo restored | killed |
| M2 digested again on every call | killed |
| M3 the working directory's tree digested, not the module's | killed |

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: 189 files, 2,180 passed and 2 skipped (2,182).
- `npm run plugin`: wrote nothing that changed.

## Recorded, not fixed

- **The checkout a run loads from is still the development tree.** The digest now names what the
  run loaded, but a run and development sharing one checkout is how the stamp went wrong. The
  live test run now loads from a separate worktree.
