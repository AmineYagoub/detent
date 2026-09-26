---
id: PRDR-300
title: "`SCHEMA_VERSION` has been 1 since the first commit, and nothing can migrate a persisted shape. 22 schemas pin the literal, 31 places in `src/` and three prompts name it, and no command upgrades a repository's state. So the 3.1.1 line's first persisted-shape change, the specification phase's `audit` role (S-1‴), has no F-3 event to join. The version becomes 2; migrations become data that `init`, `run` and the referee apply under the run lock; every other verb refuses an older state with the upgrade hint; and nothing names a version but the constant"
state: DONE
severity: major
category: capability
labels: ["prd-review", "F-3", "specification-phase", "schema", "determinism"]
surface: ["src/schemas/common.ts", "src/kernel/migrate.ts", "src/kernel/run-lock.ts", "src/kernel/run.ts", "src/kernel/driver.ts", "src/kernel/dossier.ts", "src/kernel/drift-base.ts", "src/kernel/hook-policy.ts", "src/kernel/referee-context.ts", "src/kernel/referee-stage.ts", "src/kernel/stages/review.ts", "src/cli/", "src/init/", "src/adapter/approvals.ts", "src/adapter/drift.ts", "src/fs/checkpoints.ts", "prompts/", "scripts/hash-prompts.ts", "scripts/self-build.ts", "agents/", "hooks/dist/detent-hook.cjs", "detent-prd-v3.md", "docs/release-checklist.md", "tests/", "tickets/prd-review/"]
prd_refs: ["F-3", "F-3′", "F-3″", "S-7", "S-1‴", "X-1⁷", "C-8", "C-2⁹", "P2"]
acceptance_criteria: ["`SCHEMA_VERSION` is 2, and every writer, skeleton and prompt takes its stamp from it. A test scans `src/`, `scripts/` and `prompts/` for a literal version and finds none outside `src/schemas/common.ts`.", "Migrations are data: an ordered list, each from one version to the next, with a name and the per-file transforms it makes. A file is carried through each migration from its own stamp to the current one, nested stamps included, and a second migration changes nothing.", "`detent init`, `detent run` and the referee migrate an older state before they read it: every JSON file under `.detent/` that carries a stamp, except `worktrees/`, and the pack's conformance record. `config.json` is written last, so a migration cut short is resumed by the next command. A file that is not JSON, or carries no stamp, is left for its reader. What was rewritten is said.", "A state holding a file stamped newer than this build is refused with F-3's upgrade hint, and nothing is written.", "The migration runs under the run lock (X-1⁷). While a live process holds it, the command refuses, names the holder, and writes nothing.", "`status`, `report`, `doctor`, `approve`, `requeue`, `unclaim` and `verify` do not migrate. On an older state each refuses with a message naming `detent init` and `detent run` as the commands that migrate it.", "`agents/assignments.json` is re-pinned (S-7): each `role@hash` whose role's prompt changed takes the hash this build ships, because that prompt is the one `run` will launch.", "An approved plan stays approved, and a conforming pack stays conforming, across the migration. A test migrates a fixture holding both and reads each back."]
non_goals: ["Does NOT change any persisted shape beyond its stamp. The roles, the X-1 key, the phase list and the per-package bindings of the 3.1.1 line each add their own step to the v1→v2 migration in their own ticket (S-1‴).", "Does NOT migrate `.detent/worktrees/`: a worktree is a checkout of the project, and its `.detent/` is whatever its branch holds.", "Does NOT support a team whose members run different versions on one repository. F-3 refuses a newer file; an older file that arrives after the migration, from a teammate's older build, is refused by its reader, by name."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-137", "PRDR-278", "PRDR-281", "PRDR-284", "PRDR-294", "PRDR-295"]
depends_on: []
---

# PRDR-300 — the first F-3 event

## Where this came from

PRDR-281 adds the `audit` role, the first of the four roles S-1‴ puts in one F-3 `schema_version`
event, and its criteria say the first of them to land bumps the version and writes the
migration. Starting it found that no F-3 event has ever happened. `SCHEMA_VERSION` has been 1
since the first commit, and there is no migration code anywhere in `src/`: not the v0→v1 one v2's
F-3 describes for the `.foreman/` rename, and not a mechanism to add one to.

Moving the constant alone would break every existing repository. 22 schemas pin
`schema_version: z.literal(SCHEMA_VERSION)`, so after a bump every ticket, checkpoint, config,
binding and approval written before it reads as invalid. And 31 places in `src/` (29 values and
two types), the prompt manifest's writer and three prompts name the number 1 outright, so a bumped
build would refuse its own sessions' output. `prompts/research.md` says "`schema_version: 1` is
required".

## Problem

F-3 promises that every committed file carries `schema_version`, and that migrations are
explicit, versioned and tested. The stamp is carried, and nothing reads it except to refuse a
newer one. The 3.1.1 line has at least four persisted-shape changes waiting on the event:
- the four roles (S-1‴);
- the `spec_validation_rounds` key (C-2⁶);
- the phase list without ANALYZE (D-10′);
- the per-package bindings (D-5′).

Each would otherwise invent its own migration, or change a shape silently. Release-checklist
item 8 forbids the second.

## Design

- **One constant, one event per release.** `SCHEMA_VERSION` becomes 2. The shapes of the 3.1.1
  line each add their step to the one v1→v2 migration before the release, as S-1‴ says the four
  roles do.
- **Migrations are data.** An ordered list in `src/kernel/migrate.ts`. Each migration goes from
  one version to the next, has a name, and holds its transforms, keyed by the file they apply to.
  The stamp itself moves in every file, nested stamps too, because checkpoint outputs carry the
  artifacts they were built from.
- **Who migrates.** `init`, `run` and the referee: the commands that already write state and take
  the run lock. Each migrates before it reads the state, under the lock. For `run` that is before
  the CLI builds its backend, because building the live one reads `bindings.json`; `run()`
  migrates as well, for its other callers, and the self-build carries a resumed state the same
  way. The other verbs read, or are plumbing; on an older state each refuses with the commands
  that migrate it, rather than a list of schema errors.
- **Where the state's version is read.** From `config.json`, which every initialized repository
  has and the migration writes last. A config at the current version means nothing to do, so a
  normal command pays one small read.
- **Nothing names a version but the constant.** The writers and skeletons take `SCHEMA_VERSION`.
  The three prompts that named 1 now say the stamp is the skeleton's, so the next event does not
  edit a prompt. Their hashes move once here, and the plugin's agents are rebuilt from them.
- **Assignments.** The moved hashes are why `agents/assignments.json` needs its migration: a
  `diagnose@<old hash>` names a prompt this build no longer ships. It is re-pinned to the one it
  does.
- **What re-runs once.** Checkpoints are restamped with everything else, but some phase digests
  cover a restamped value: SLICE's and PLAN's cover the analysis, bindings and slices objects,
  and DISCOVER's covers the conformance record's bytes. So an unapproved plan re-derives once
  after the migration, from SLICE on, or from DISCOVER on where the pack carries a record (no
  build writes one yet: VALIDATE will). An approved plan does not: `init` does not walk it (C-8),
  and `run` reads no checkpoint. The 3.1.1 line re-plans every project anyway: AUDIT joins the digest chain
  (PRDR-281), and the planning redesign changes PLAN's inputs.

## Falsification (verification protocol, item 1)

The tests were written first and run against HEAD `ec63224`, before any migration existed:

```
 ❯ tests/arch/schema-version.test.ts (1 test | 1 failed)
   × PRDR-300: only the constant names a schema version > finds no literal version in a source file, a script or a prompt
     → expected [ …(35) ] to deeply equal []
 ❯ tests/cli/state-version.test.ts (12 tests | 11 failed)
   × … a verb that does not migrate refuses an older state and writes nothing > `status` names the commands that migrate it
     → ticket t-1 is invalid: schema_version: Invalid input: expected 1
   × … > `report` names the commands that migrate it
     → ticket t-1 is invalid: schema_version: Invalid input: expected 1
   × … > `doctor` names the commands that migrate it
     → expected 1 to be 2 // Object.is equality
   × … > `approve` names the commands that migrate it
     → ticket t-1 is invalid: schema_version: Invalid input: expected 1
   × … > `requeue` names the commands that migrate it
     → ticket t-1 is invalid: schema_version: Invalid input: expected 1
   × … > `unclaim` names the commands that migrate it
     → expected +0 to be 2 // Object.is equality
   × … > `verify` names the commands that migrate it
     → expected 're-baselining a verification binding …' to contain 'detent init'
   × PRDR-300: `init`, `run` and the referee migrate before they read > `run` migrates the state, says so, and reads the config it wrote
     → expected +0 to be 1 // Object.is equality
   × … > `init` migrates the state before anything else reads it
     → expected +0 to be 1 // Object.is equality
   × … > the referee migrates the state before it reads its config
     → [ { "code": "invalid_value", "values": [ 1 ], "path": [ "schema_version" ], "message": "Invalid input: expected 1" } ]
   ✓ PRDR-300: every verb is one that migrates or one that refuses > classifies exactly the verbs the dispatcher knows
   × … > each module calls what its class names
     → cli/init.ts: expected 'import { parseArgs } from "node:util"…' to match /\bmigrateState\(/u
 FAIL  tests/kernel/migrate.test.ts [ tests/kernel/migrate.test.ts ]
Error: Cannot find module '../../src/kernel/migrate.js' imported from '/Users/workstation/detent/tests/kernel/migrate.test.ts'
 Test Files  3 failed (3)
      Tests  12 failed | 1 passed (13)
```

The 35 literal hits are the 31 places in `src/`, `scripts/hash-prompts.ts:25`, and line 5 of
`prompts/diagnose.md`, `prompts/research.md` and `prompts/review.md`.

Each refusing verb fails in its own way on a state stamped one version back, and none names a
command that could carry it forward:
- `status`, `report`, `approve` and `requeue` throw the first ticket's schema error;
- `doctor` and `unclaim` return 1 and 0 where a refusal is 2;
- `verify sync` names re-baselining, which does not help.

At HEAD the constant is 1, so the older state is stamped 0. `run` and `init` leave its config at
0, and the referee throws the config's zod issues raw.
The one test that passes is the inventory's first half: the dispatcher's verbs are exactly the ten
the test classifies.

## Mutation battery (verification protocol, item 2)

44 mutants, one defect each, run against the three new test files and the checkpoint, prompt and
`init` suites. Each file was restored from a snapshot copy, never by `git checkout`, and its hash
checked. 44 of 44 were killed on the final code. They cover:
- the migration: the config written last, the fast path, both newer-file checks, the second scan
  under the lock, the lock refused, taken where there is no `.detent/`, and never released;
- what is carried: nested stamps, the file's own version, the transforms, the re-pin keeping a role
  this build does not ship, the worktrees, directory links, the conformance record, zero and
  fractional stamps, and unstamped files;
- what is said: the other newer files, the count, the stale lock broken, the older and the newer
  refusals, and the lock's holder;
- every verb: `run` (the CLI and `run()`), `init` and the referee each not migrating, ignoring a
  refusal and not saying what they migrated; the seven that refuse, with `unclaim --stale`;
- the literal: a writer, a prompt and the manifest writer each naming the version.

Writing the mutants found gaps before any ran, and each got a test: `unclaim --stale`; a refusal
on `init`, `run` and the referee; a newer file where nothing is older; a current config as the
whole check; a role this build does not ship; a directory link; a record with no `.detent/`; and a
write that races the lock. The race uses the `alive` seam, which `acquireRunLock` calls between the
two scans.

The first run, of 40 mutants, killed 39. The survivor read a zero stamp as a stamp. It survived
because the test wrote its fixtures before `age()` reformatted them, so a rewrite changed no byte.
The fixtures are written after `age()` now, in compact form, with a fractional stamp beside the
zero one.

Reading `cli/run.ts` for the verb mutants then found a defect the tests had missed: `detent run`
built its live backend, which reads `bindings.json`, before `run()` migrated. So on an older state
the CLI died on the bindings' schema error, and nothing migrated. The CLI migrates first now, as
does the self-build, and the final run adds four mutants: three for the CLI and one for unstamped
files.

Considered and left out as equivalent under the suite:
- the migration's `from` taken as the maximum rather than the minimum, since one version exists
  to migrate from;
- a nested stamp carried whatever its value, since no build nests a stamp other than its own;
- a write in place rather than a temp file and a rename, since the suite cannot kill a process
  inside a write. The config-last test cuts between files instead.

## What changed

- **`src/kernel/migrate.ts`** (new):
  - `MIGRATIONS`: one entry, from 1, named for the 3.1.1 line. Its one transform re-pins
    `agents/assignments.json`;
  - `migrateState`: a config at this version is the whole check. Otherwise it scans, takes the run
    lock, scans again, and writes each older file carried, `config.json` last, through a temp file
    and a rename;
  - `migrationNote`: what was rewritten, counted by directory, and any stale lock it broke;
  - `stateVersionRefusal`: what the verbs that do not migrate say.
- **`src/schemas/common.ts`**: `SCHEMA_VERSION` is 2.
- **The verbs:**
  - `cli/init.ts`, `cli/run.ts`, `kernel/run.ts` and `cli/referee.ts` migrate;
  - `status`, `report`, `doctor`, `approve`, `requeue`, `unclaim` (both forms) and `verify`
    refuse;
  - `init`, `run` and the referee load the prompt set once, before the migration, and hand the
    same set on. A damaged prompt set is therefore reported before the lock and the live-auth
    probe, where it used to be reported after them;
  - `kernel/run.ts` exports `notReady`, so the CLI reports a refusal as `run()` does.
- **`scripts/self-build.ts`**: a resumed build is carried before its backend reads the bindings.
- **`src/kernel/run-lock.ts`**: `lockHolder`, shared by `runLockRefusal` and the migration's
  refusal.
- **The literal:**
  - the 31 places in `src/` take `SCHEMA_VERSION`, the two types `typeof SCHEMA_VERSION`, and so
    does `scripts/hash-prompts.ts`;
  - `prompts/diagnose.md`, `research.md` and `review.md` say the stamp is the skeleton's;
  - `prompts/manifest.json` and `agents/diagnose.md`, `research.md` and `review.md` are
    regenerated. The hook bundle does not change: it reads no stamp.
- **`detent-prd-v3.md`**: F-3″, with a pointer on S-1‴.
- **`docs/release-checklist.md`**: item 8 names the migration list and the 3.1.1 line's one event.
- **Tests:**
  - `tests/kernel/migrate.test.ts` (22);
  - `tests/cli/state-version.test.ts` (18);
  - `tests/arch/schema-version.test.ts` (1);
  - 48 existing test files take `SCHEMA_VERSION` where they wrote 1, and `tests/init/pack.test.ts`'s
    newer record is `SCHEMA_VERSION + 1`.

All seven gates pass. The suite is 1644 passed and 2 skipped, across 147 files.

After the falsification run, the `init` test stubs `DETENT_NO_LIVE=1`. The migration comes before
the live-auth probe, so the probe's refusal is where that `init` stops, whatever the machine
running the suite is logged in to. The assertions did not change.

## Recorded, not fixed

- **Mixed versions on one repository** (the third non-goal). The config's stamp is the whole
  check. So an older file that arrives after the migration, from a branch cut before it and merged
  after, is refused by its reader. The reader names the file, but says "expected 2" rather than
  naming `detent init`.
- **The C-10 summary's stamp moved.** `run`'s machine-readable summary now says
  `schema_version: 2`, and its shape did not change. A script that pinned 1 sees the event, which
  is what the stamp is for.
- **JSONL rows keep their stamps.** Rows of `state/approvals.jsonl` written before the migration
  say 1, and new rows say 2. `approvedHashes` reads neither.
- **`doctor` refuses an older state** rather than reporting it as one failed check. PRDR-154 made
  `doctor` survive a broken state. An older state is not broken, and the refusal names the
  commands that carry it.
- **An unapproved plan re-derives once** (Design, "What re-runs once"). SLICE and PLAN are billed
  sessions, so the cost is real. It falls on a project once, in a release that re-plans every
  project anyway.
