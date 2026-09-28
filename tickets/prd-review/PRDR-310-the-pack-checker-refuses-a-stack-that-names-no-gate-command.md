---
id: PRDR-310
title: "The pack checker refuses a greenfield stack that names no gate command, and D-10″ binds that stack from its language's conventional commands. PRDR-279's vetoable call 9 required a root command \"since without one nothing can bind\". PRDR-290 then built the fallback that binds one, and DECIDE records only the commands the documents name. On tabachir's live run DECIDE recorded a TypeScript stack from documents that name no command, and the checker refused WRITE's pack for it"
state: DONE
severity: major
category: correctness
labels: ["prd-review", "specification-phase", "C-2⁷", "D-10″", "live-run"]
surface: ["src/init/pack-parse.ts", "tests/init/pack-schema.test.ts", "tests/init/fold-analyze.test.ts", "detent-prd-v3.md"]
prd_refs: ["C-2⁷", "C-2⁹", "D-10′", "D-10″", "V-5′", "C-2¹²"]
acceptance_criteria: ["The checker accepts a greenfield decision log whose `## Stack` entry stands and whose `## Packages` declares no command for the root package, and the parsed entry's `gates` is empty. It still refuses a greenfield log with no stack entry.", "A conforming greenfield pack whose stack names no gate command is planned. DETERMINE_VERIFICATION binds the root package's gates provisionally from the language's conventional commands (D-10″), and a package the log declares still binds as the log declares it (V-5′).", "The PRD records the change as C-2²¹, with amendment lines on C-2⁷ and D-10″.", "Falsifying tests: against HEAD the checker reports \"a greenfield stack declares a gate command for the root package\" for such a log, and the pipeline stops before it plans."]
non_goals: ["Does NOT change DECIDE's contract: the stack's `gates` still hold only the commands the documents name.", "Does NOT change the language table, or what happens when the language has no row there: DETERMINE_VERIFICATION still stops for `test` with AWAIT_SETUP_CONSENT, naming `## Packages` (D-10″).", "Does NOT change a prompt, so no phase's key moves."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-279", "PRDR-290", "PRDR-295"]
depends_on: []
---

# PRDR-310 — the pack checker refuses a stack that names no gate command

## Where this came from

This comes from the live test run on tabachir's disposable clone. Tabachir's documents describe
the product and name no command. DECIDE settled the stack with a default, X-1: TypeScript on
Node.js 24 with npm 11, and eleven scaffold files. Following `spec_write.md`, it recorded no gate
command, since its `gates` hold "only the commands the documents name". WRITE's first attempt ended
at 10:29 UTC and cost $29.30. The checker refused it on six findings. Five were the session's own
mistakes: criteria that do not state Given, When and Then. The sixth was this one:

    docs/founder-decisions.md [stack] a greenfield stack declares a gate command for the root
    package (`.`) under ## Packages

The relaunch received that finding as the validator's words. It invented four root rows that no
document names: `npm test`, `npm run lint`, `npm run typecheck` and `npm run build`. WRITE's own
guard then put the log back as DECIDE had left it: "the decision log's stack is not as DECIDE left
it, and the stack is DECIDE's (D-10′)". The pack went on red, and the stack finding was one of 98
blocking findings. VALIDATE's writer has the same guard (`evaluate` in `validate-round.ts`), so no
session can clear the finding. After two attempts VALIDATE stops with AWAIT_INFO and asks the
founder to fix it. Every greenfield project whose documents name no command reaches that same
stop.

## Problem

The rule came from PRDR-279's vetoable call 9: "Greenfield requires at least one root command,
since without one nothing can bind." That was true when it was written. PRDR-290 then built
D-10″: "An entry that names no `test` command takes its language's conventional commands, as
V-1′'s fallback did". It also built the case where the language has no conventional commands:
that stack stops for `test` with AWAIT_SETUP_CONSENT, naming `## Packages`. `provisionalBindingsFor`
in `src/init/bind.ts` does exactly this. So a stack with no command can bind, and the reason the
rule gave no longer holds.

The PRD never stated the rule. C-2⁷ says "a pack may declare its packages and their gate
commands", and its list of checker rules has no such rule. So the checker refuses a pack that the
PRD accepts and that the binder can bind. D-10″'s fallback could only be reached when no checked
pack was handed on. This affects every greenfield project whose documents name no command, which
means most projects that start from a product description.

## Design

`requireStack` keeps its first finding, a greenfield pack without a stack entry, and drops the
second. The binder already handles what the dropped rule guarded against.

## Building it

- `src/init/pack-parse.ts`: `requireStack` refuses a greenfield pack without a stack entry and
  nothing else. Its doc-block says why an entry need name no command, citing D-10″.
- `tests/init/pack-schema.test.ts`: PRDR-279's case "refuses a greenfield stack that declares no
  gate command for the root package" becomes its opposite. The checker accepts that log, the
  parsed entry's `gates` is `{}`, and the one package left is `dashboard`, the package the log
  declares.
- `tests/init/fold-analyze.test.ts`: the pack fixture, conforming, with the root rows removed from
  its log, runs the whole pipeline. It reaches PRESENT. DETERMINE_VERIFICATION binds TypeScript's
  four conventional commands for `.`, provisionally, as `greenfield:typescript`, and binds
  `dashboard`'s `test` as declared.

### Vetoable calls

1. **The rule goes; it is not narrowed.** A narrower rule was possible: "a gate command, or a
   language the table knows". D-10″ already gives the no-row case its own stop, AWAIT_SETUP_CONSENT
   at DETERMINE_VERIFICATION naming `## Packages`, and that stop asks the founder when a binding is
   needed. A checker refusal at that point sends a session to invent a command, which is what
   tabachir's relaunch did.
2. **This is not an F-3 event.** The grammar relaxes inside the 3.1.1 line. Its one event,
   `schema_version` 1 to 2 (PRDR-300), is the one that line's shapes extend before release
   (release checklist, item 8). No pack a version 2 checker accepted is refused now. A record that
   was red for this rule alone is re-checked by VALIDATE, like any red record.
3. **The log guards in WRITE and VALIDATE are unchanged.** The stack is still DECIDE's. With the
   rule gone, nothing asks a writer to change the stack.
4. **The pipeline case runs a conforming pack.** It does not run DECIDE, WRITE and VALIDATE with
   fixture sessions. The defect is in the checker, and the conforming path is where no pack had
   ever reached D-10″'s fallback: under HEAD that pack is red, and VALIDATE's writer is sent to fix
   it.
5. **PRDR-279's call 9 is superseded, not edited.** Its ticket keeps its text, and this ticket
   cites it.

## Falsification

Both new cases ran against HEAD's checker before the fix:

    × … > accepts a greenfield stack that declares no gate command for the root package, which its
      language's commands bind (D-10″)
      AssertionError: expected [ { rule: 'stack', …(4) } ] to deeply equal []
      +     "message": "a greenfield stack declares a gate command for the root package (`.`) under ## Packages",
    × PRDR-310: … > plans a conforming pack whose log declares no command for the root package, and
      binds TypeScript's conventional commands
      Error: VALIDATE's writer, the checker: no usable account of the fixes: the session wrote no
      artifact; the pack is as it was before it ran

In the second case, DISCOVER found the checker red on the fixture's "conforming" pack, and VALIDATE
sent its writer to fix the pack. The fixture has no writer, so the error is VALIDATE's. On
tabachir, the writer that was sent is the one described above.

## Mutation battery

Each mutant was applied to a snapshot copy and restored from it (never `git checkout`). The runs
covered `pack-schema`, `fold-analyze`, `backhalf`, `greenfield-bindings` and `bind-packages`, 87
cases.

| Mutant | Result |
|---|---|
| M1 the refusal of an entry with no gates restored | killed: both new cases |
| M2 a pack with no stack entry accepted | killed: PRDR-279's and PRDR-290's no-entry cases |
| M3 the guard inverted, refusing every entry | killed: 21 cases, among them PRDR-290's planning cases |
| M4 the binder's fallback removed (`bind.ts`) | killed: 6 cases, among them the new pipeline case, T-064 and two of T-066's |
| M5 `requireStack` never called | killed: PRDR-279's and PRDR-290's no-entry cases |

M4 shows that the pipeline case pins D-10″'s fallback itself, not only the checker.

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: 189 files, 2,179 passed and 2 skipped (2,181).
- `npm run plugin`: wrote nothing that changed.

## Recorded, not fixed

- **The log guards compare the parsed stack.** Asked to satisfy this finding, VALIDATE's writer
  added a `## Packages` table in a wide format: `| . | npm test | npm run lint | … |`. The parse
  refuses that row, so the parsed stack did not change, the guard did not fire, and the row stood
  as a new blocking `package` finding. The checker still catches such a row, and with this rule
  gone no writer is asked for a gate.
- **The live test run.** Its `init` process had loaded the old checker. The guard stopped it at
  VALIDATE's doomed relaunch. The operator then removed the wide table and restarted the run on a
  pin: `e3b4421` with this change, whose prompts are the run's own, so AUDIT's and DECIDE's
  checkpoints stand. The pin is a local branch in a separate worktree, not for merge.
