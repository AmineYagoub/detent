---
id: PRDR-307
title: "The usage line says `init` does \"discover, analyze, plan, approve\". ANALYZE was folded into DECIDE by PRDR-290, and AUDIT, DECIDE, WRITE and VALIDATE, which judge and rewrite the documents before anything plans, go unnamed. And `detent init --help` is refused as an unknown option rather than showing the usage"
state: DONE
severity: minor
category: docs
labels: ["prd-review", "doc-claim-drift", "cli", "live-run"]
surface: ["src/cli/index.ts", "tests/cli/dispatch.test.ts"]
prd_refs: ["C-1′", "D-10″", "C-2⁶"]
acceptance_criteria: ["The usage line for `init` names the phases `init` runs that an operator sees, DISCOVER, AUDIT, DECIDE, WRITE, VALIDATE and PLAN, and then approval; every phase word it names is one of `INIT_PHASES`.", "`detent <verb> --help` or `-h` prints the usage and exits 0 without running the verb.", "Falsifying test: against HEAD the usage line names `analyze` and none of the four spec phases, and `main([\"init\", \"--help\"])` exits 1."]
non_goals: ["Does NOT add a per-verb help text.", "Does NOT change any verb's options."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-290", "PRDR-281"]
depends_on: []
---

# PRDR-307 — the usage line names ANALYZE, which is gone

## Where this came from

The tabachir test run, 2026-09-28. Looking up the approval flags, `detent init --help` answered
"Unknown option '--help'" and exited 1, and `detent --help` described `init` as "prepare a project:
discover, analyze, plan, approve" (`src/cli/index.ts`). ANALYZE was folded into DECIDE by PRDR-290
(D-10″), and `INIT_PHASES` has no ANALYZE. The four phases that judge the documents and rewrite
them into a pack before anything plans (C-2⁶), which are most of `init`'s time and spend, are not
named. It is the project's own defect class: a load-bearing line that states in the present what
the code no longer does.

## Problem

`USAGE` is a string nothing checks against the phase list, so it kept the pipeline of an older
build. And every verb parses its own options with `parseArgs`, strict, so `--help` after a verb is
an unknown option.

## Design

The line names DISCOVER, AUDIT, DECIDE, WRITE, VALIDATE and PLAN, and approval. `main` answers
`--help` or `-h` after any verb with the usage, before the verb runs. A test checks every phase
word the line names against `INIT_PHASES`, so the line cannot name a phase that is gone again.

## Building it

`src/cli/index.ts`: the `init` line of `USAGE` reads "prepare a project: discover, audit, decide,
write, validate, plan, approve", and `main` answers `--help` or `-h` anywhere after a known verb
with the usage and exit 0, before the verb's own strict option parsing. An unknown verb is still
refused first, with exit 2.

### Vetoable calls

1. **The line names six phases and approval**, not all of `INIT_PHASES`: INIT_FS,
   DETERMINE_VERIFICATION, SLICE, PREPARE_AGENTS and PRESENT are steps an operator meets through
   their notes, not the work the line summarizes.
2. **`--help` anywhere after a verb** shows the usage, including after `--`, where it would be a
   positional. No verb takes a positional that begins with a dash; a carve-out would be a branch
   no test could reach without running a verb against a real repository.
3. **The whole usage, not a per-verb text.** One string, kept true by the test.

## Falsification

Against HEAD (`247a2b9`), the source untouched and the test added:

```
× names DISCOVER, the four spec phases and PLAN, and no phase that is gone
  → expected [ 'DISCOVER', 'ANALYZE', 'PLAN' ] to deeply equal [ 'DISCOVER', 'AUDIT', 'DECIDE', …(3) ]
× shows the usage for --help or -h after a verb, and runs nothing
  → Unknown option '--help'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- "--help"
```

With the fix both pass, with the six dispatch cases beside them.

## Mutation battery

Five mutants of `src/cli/index.ts`, each against `tests/cli/dispatch.test.ts`, the file restored
from a snapshot copy after each and compared byte for byte after the last:

| Mutant | Result |
|---|---|
| U1 the old line back | killed |
| U2 a spec phase dropped | killed |
| U3 `--help` after a verb not answered | killed |
| U4 `-h` after a verb not answered | killed |
| U5 `--help` answered with a failure code | killed |

5 of 5 killed.

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: 189 files, 2,176 passed and 2 skipped (2,178).
- `npm run plugin`: wrote nothing that changed.

## Recorded, not fixed

- **Other help text is not checked against the code.** The README and each verb's error messages
  describe options by hand; this test covers the one line that named a phase.

