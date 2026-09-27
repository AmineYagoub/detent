---
id: PRDR-295
title: "Gates bind at the repository root only, a deliberate v1 limit (D-5, V-5, NG2), so a ticket whose surface lies in another package has no gate that can fail: 69 of ksar-cloud's tickets wrote `dashboard/`, 41 wrote nothing else, and its gates ran Go at the root. The operator's decision settles OQ-4: DETERMINE_VERIFICATION binds every package's gates, a pack may declare them, and a ticket that no bound gate covers cannot be approved"
state: DONE
severity: major
category: capability
labels: ["prd-review", "planning-redesign", "operator-decision", "D-5", "V-5", "OQ-4", "F-3", "gates"]
surface: ["src/adapter/packages.ts", "src/adapter/bind-packages.ts", "src/adapter/bind.ts", "src/adapter/approvals.ts", "src/adapter/discover/index.ts", "src/adapter/drift.ts", "src/adapter/workspace.ts", "src/cli/doctor.ts", "src/cli/verify.ts", "src/init/bind.ts", "src/init/bind-declared.ts", "src/init/decide-log.ts", "src/init/pipeline.ts", "src/init/plan.ts", "src/init/present.ts", "src/init/present-gates.ts", "src/kernel/drift-base.ts", "src/kernel/falsify.ts", "src/kernel/migrate.ts", "src/kernel/referee.ts", "src/kernel/referee-context.ts", "src/kernel/git.ts", "src/adapter/install.ts", "src/sessions/backend.ts", "src/init/present-inputs.ts", "src/kernel/referee-gate.ts", "src/kernel/referee-stage.ts", "src/kernel/referee-sweeps.ts", "src/kernel/run.ts", "src/schemas/common.ts", "src/schemas/records.ts", "src/sessions/live.ts", "README.md", "skills/init/SKILL.md", "detent-prd-v3.md", "tests/adapter/packages.test.ts", "tests/init/bind-packages.test.ts", "tests/init/packages-fixture.ts", "tests/kernel/package-gates.test.ts", "tests/kernel/migrate.test.ts"]
prd_refs: ["D-5", "V-5", "NG2", "OQ-4", "V-1", "C-3b", "F-3", "PRDR-115", "PRDR-211", "PRDR-276", "PRDR-278"]
acceptance_criteria: ["DETERMINE_VERIFICATION finds a manifest in every package directory, not only the root, for each ecosystem an adapter supports. It binds each package's gates with that package as their working directory, and records the bindings in the persisted shape D-5 anticipated, under F-3.", "A pack may declare packages and their gate commands (PRDR-279). Declared commands are the bindings, as documented commands are today (PRDR-115).", "A ticket's gates are those of the packages its surface touches, and `run` runs exactly those. A test with a two-package repository asserts that a ticket touching one package runs only that package's gates, and a ticket touching both runs both.", "A ticket with a surface path that lies in no package with bound gates fails the gate-coverage check (PRDR-293), which blocks approval (V-5′, PRDR-278).", "`run`'s toolchain check (PRDR-276) covers the toolchain of every package.", "The PRD amendment (PRDR-278) records the change to D-5, V-5 and NG2, and closes OQ-4."]
non_goals: ["Does NOT invent gates for a package that has none. That package's tickets block approval until the pack declares its gates or the operator binds them.", "Does NOT weaken V-1's execute-before-approve rule."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-115", "PRDR-211", "PRDR-276"]
depends_on: ["PRDR-278"]
---

# PRDR-295 — gates per package

## Where this came from

The ksar-cloud plan (the planning audit of 2026-09-26, §8). 69 tickets write `dashboard/`, a Node
package, and 41 of them write nothing else. The repository's gates were bound at the root, to Go.
No gate could fail for those tickets. The planner saw the gap and wrote it into the notes of
t-s13-001, and nothing acted on it.

## Problem

Root-only binding is deliberate. D-5 says "root-only in v1; workspace scoping is a named v2
migration", NG2 lists per-workspace gates as a non-goal, V-5 binds root entrypoints only, and OQ-4
left the design open. `src/adapter/workspace.ts` keeps that promise: a detected workspace changes
which ROOT command is proposed, and nothing else.

A product with more than one package, which ksar-cloud and ksarjs both are, therefore has tickets
that are verified by nothing.

## Design

The redesign plan's §8. This is the migration D-5 named, with `schema_version` carrying the
upgrade, as D-5 said it would.

Lifting a limit v1 set on purpose is the operator's call, and it was made knowingly. The operator
chose per-package gates before anyone noticed that D-5 makes root-only binding deliberate; told so
on 2026-09-26, the operator kept the decision, in this redesign.

## From PRDR-290

In greenfield, DETERMINE_VERIFICATION binds from the stack entry (`provisionalBindingsFor` in
`src/init/bind.ts`), whose `gates` are the root package's rows under `## Packages` and no other
package's. The checker's parse carries every declared package with its gates (`packages`), and
`planningPack` in `src/init/pipeline.ts` reads the parse VALIDATE hands on.

## Building it

V-5′ is built, and the PRD records it as V-5″. `src/adapter/packages.ts` says what a package is and
which packages a path or a surface touches; `src/adapter/bind-packages.ts` binds each one in its own
directory; `src/init/bind-declared.ts` binds what the decision log declares under `## Packages`;
`src/init/present-gates.ts` holds approval on a path no gate can fail. Every reader of a binding
reads it per package: the gate arm, drift, the approvals ledger, the fork's discovery,
`detent verify sync` and its per-ticket acceptance, the falsification probe, the flake rerun, the
session preamble, the toolchain check, `doctor` and the bootstrap's promotion. The persisted shape
changes under F-3″'s one event.

The acceptance criteria, as built:
1. **Every package, bound in its own directory.** DETERMINE_VERIFICATION finds the root and every
   directory holding a package manifest of an ecosystem an adapter supports, discovers each in its
   own directory and runs each candidate there before binding it. `.detent/bindings.json` lists
   the packages, and each binding and skip names its own; the migration gives every binding and
   skip written before `package: "."`.
2. **Declared packages.** The decision log's `## Packages` rows are bindings: in a new project as
   the root's documented commands are (V-1′), and in an existing one for each slot discovery binds
   nothing for.
3. **A ticket's gates are its packages'.** The gate arm runs exactly the gates of the packages a
   ticket's surface touches, each in its package's directory. `tests/init/bind-packages.test.ts`
   runs a ticket touching one package of two, which runs that package's gate alone, and one
   touching both, which runs both.
4. **No gate can fail, no approval.** PRESENT lists each path that lies in no package with a gate a
   ticket runs and holds approval on both exits. PRDR-293 has not built A-1⁷'s checks, so this one
   runs at PRESENT, over the whole plan, and the ticket's criterion names a check that does not yet
   exist beside it (vetoable call 20).
5. **Every package's toolchain.** `run` reads every package's gates, and names a missing tool with
   the gate that needs it, `go — needed by web:test`.
6. **The PRD.** PRDR-278 recorded D-5′, V-5′ and OQ-4's resolution. V-5″ records what was built,
   and D-5′, V-5′, V-1′, A-1⁷, C-7″, F-3″ and the inherited §3 and §6 each point to it.

### Vetoable calls

1. **What a package is.** A directory holding `package.json`, `pyproject.toml`, `setup.py`,
   `setup.cfg`, `go.mod` or `Cargo.toml`. A Makefile, a justfile or a tsconfig runs tasks in a
   package and does not make one, so a directory holding only a Makefile belongs to the package
   holding it.
2. **What is never a package.** A manifest under a hidden directory, `node_modules`, `vendor`,
   `testdata`, `fixtures` or `__fixtures__`, or anything git ignores. Packages are listed from
   `git ls-files --cached --others --exclude-standard`, and from a walk of the tree with the same
   exclusions where git cannot say.
3. **Which package a path lies in.** The deepest package holding it, by whole path segments, as
   each ecosystem reads a nested manifest. `webapp/x.ts` does not lie in `web`.
4. **What a surface touches.** A path touches the package it lies in and every package below it,
   as the kernel reads a directory named in a surface. A glob touches its base's package and every
   package below the base that it can reach, read segment by segment until a `**`; a brace holding
   a slash is read as reaching everything. An exclusion touches nothing, and `.` is the whole
   repository.
5. **Names.** A gate outside the root is `web:test`, and the root's keeps its slot alone. Every
   label, message and accepted-drift key a single-package project wrote reads as it did.
6. **A package with no lockfile** takes the package manager of the package holding it, as a
   workspace's members share the lockfile at its root.
7. **A root without tests.** `test` is missing only where no package binds it, so a project whose
   root runs no tests beside a package that does is bound. Its root's tickets are held at PRESENT
   unless the root binds `lint` or `typecheck`.
8. **Skips.** A slot left unbound is an acknowledged skip only in a package that binds a gate at
   all. A package with none records no skips: PRESENT's hold is its record.
9. **Where the pack and a manifest disagree,** the manifest's command is bound, since V-1 ran it
   and it is what the package runs, and a notice names both commands. The pack is not amended.
10. **A declared binding in an existing project** is provisional and not executed at `init`: its
    package may not exist yet. It runs as its package's gate from the first ticket, so a command
    that cannot run goes red there. V-3 exempts it as it exempts every provisional binding, since
    no file holds its configuration, and nothing promotes it outside a new project. V-1‴'s
    vacuous-gate notice is not given for it, since nothing executes it at `init`.
11. **A gated package does not stand in for a gate-less one.** The gate arm refuses a ticket whose
    surface touches a package that binds none of the slots asked, naming the package, even where
    another touched package's gates would pass. The ticket needs a human, as V-1″'s ticket with no
    gate does. PRESENT already holds such a plan; this is the run-time floor, for a plan approved
    before the upgrade re-bound and for a surface granted at run time.
12. **Order.** Package after package, the root first and then by path, and within a package
    `lint`, `typecheck`, `test`. The first red gate ends the evaluation, as it did at the root.
13. **The Stop gate** still runs the root's `test`, where the session works, and none where the
    root binds no `test`. It does not know the ticket's packages, and a package's test run at the
    root would test the wrong thing.
14. **The flake rerun** uses the failing package's `test_single`, else the command that failed,
    in that package's directory.
15. **The falsification probe** runs each changed test with the `test_single` or `test` of the
    package it lies in, in that package's directory, and passes only if every one does. A package
    with no test gate answers false, as the root with none always has: a missing binding never
    makes an accusation.
16. **The preamble** keeps `bindings` as the root's gates by slot and adds `packages` only where
    there is another, so a single-package project's session prefix is byte-identical (S-6).
17. **The slots PRESENT counts** are `lint`, `typecheck` and `test`, the ones a ticket's gate
    evaluation runs. A package that binds only `build` or `e2e` has no gate a ticket runs.
18. **A manifest a ticket writes outside a package** starts a package with no gate, and is held.
    Until a re-bind its paths would run the holding package's gates, so this is the stricter of
    the two readings.
19. **A DONE ticket** runs no gate again and is not held.
20. **The check runs at PRESENT**, over the whole plan, and nothing redrafts for it. PRDR-293 makes
    it one of A-1⁷'s checks; its "From PRDR-295" section says what it inherits.
21. **`run`'s deferred approval** refuses while any path is ungated, as it does for a spec defect.
22. **The upgrade re-binds nothing by itself.** The migration makes every binding the root's and
    the root the one package, so an approved plan keeps running the root's gates until `detent
    init` re-binds. DETERMINE_VERIFICATION's key gains other packages' markers only where there are
    any: a single-package project replays nothing, and a multi-package one re-binds on its next
    `init`.
23. **`verify sync`** re-binds every package on disk, and keeps a declared binding that discovery
    does not replace. A slot whose candidates wait on a choice is asked about, not reported as
    missing.
24. **A ticket's acceptance** does not count a declared binding the tree does not bind as a gate
    removed, since no file ever bound it.
25. **Install directories.** No session may write under any `node_modules`, and finalization
    stages no package's install directory.
26. **The packages list** is the root, every package found and every package declared, and
    `writeBindings` adds any package a binding or skip names.
27. **A package path** is refused unless it is `.` or a relative path inside the repository: no
    empty, `.` or `..` segment, no leading slash and no backslash. Gates run there.
28. **Bootstrap promotion** matches each provisional binding to a candidate in its own package,
    and stores the command a gate runs, normalized (found along the way, below).

## Falsification (verification protocol, item 1)

The final test files were copied into a `git archive` of HEAD `816a34e` in the scratchpad and run
there, against HEAD's source, so the working tree was not touched. The copy holds every test file
that differs from HEAD: three new suites, thirteen changed ones and three fixtures. A `diff -r`
against a fresh archive shows the copy's `src/`, `prompts/`, `skills/` and `scripts/` unchanged.

As copied, the three new suites fail to load: HEAD has no `src/adapter/packages.ts`. The thirteen
changed suites fail 15 of 215 tests. Five of those are HEAD's strict schema refusing `package` in a
fixture's binding, in `doctor`, `bootstrap-worktree` (three) and `drift-worktree`, whose fork
discovery also returns a map now. A second run, with those fixtures in HEAD's shape, passes all 39
tests of those four files and `vacuous-gate`. The other ten fail on what they test:
- a skip records no package, a re-baselined file keeps no package list, and `bindings.json` has no
  `packages` key;
- the workspace notice says that only root entrypoints are bound;
- the pack's declared `dashboard` binds nothing, the bootstrap's criteria name no
  `dashboard:test`, and a re-run's bindings name no package;
- the migration carries nothing to packages, and a current file that names no package is not the
  root's.

The four changed suites that pass at HEAD are controls: an older presentation is approvable, and
`decide-items`, `pack-schema` and `vacuous-gate` only gained the new fields in their fixtures.

Because the new suites cannot load at HEAD, a probe of four tests was written against HEAD's own
exports and run in both trees. At HEAD all four fail, each for the defect's own reason. With the
change all four pass:

```
 × binds web's gate, in web
   → three gates: the root's two and web's test: expected [ 'test', 'lint' ] to have a length of 3 but got 2
 × a ticket writing web alone runs web's gate, and a red web holds it
   → web's gate ran: expected false to be true
 × PRESENT holds a plan whose ticket writes where no gate can fail
   → expected 'AWAIT_APPROVAL' to be 'AWAIT_INFO'
 × a vitest-backed test the bootstrap promotes does not drift on the next ticket
   → "test: the bound COMMAND no longer matches what discovery finds — stored `npm run test`,
      current `npm run test -- --run` (package.json). Run `detent verify sync` to accept it."
      Tests  4 failed (4)                                  (with the change: 4 passed)
```

## Mutation battery (verification protocol, item 2)

The battery ran 72 mutants, one defect each, against the three new suites and, where a mutant
reaches them, `migrate`, `fold-analyze`, `drift` and `e2e`. Each file was restored from a snapshot,
never by `git checkout`, and checked byte for byte after every mutant; at the end all 23 files
matched the snapshot directory. The mutants covered:
- **Packages:** the first holder instead of the deepest; a dependency's, a hidden directory's and
  an ignored directory's manifest making a package; an exclusion touching its package; a glob
  reaching every package below its base, a globstar reaching none, and a directory a glob names
  counted as a path in it; a path not touching its own package; `.` touching the root alone; no
  inherited package manager, in `packages.ts` and in discovery; a package's gate named by its slot;
  every package's directory the root; a package path allowed to leave the repository.
- **Binding:** each package probed at the root; every binding and every gap the root's; a declared
  command bound beside the manifest's; no notice of a disagreement; a declared command approved; a
  declared package missing from the list; a root without tests refused beside a package with
  them; gaps for a package with no gate; either kind of project ignoring the declared packages;
  DETERMINE_VERIFICATION not handed them; its key blind to package markers.
- **PRESENT and approval:** a DONE ticket held; a `build` gate counted; a manifest in an existing
  package starting one; nothing raised; gated paths flagged and ungated ones not; no count
  recorded; every path read as the root's; `run` offering approval; the bootstrap's criteria
  naming gates without their package; the binding table hiding a package with no gates.
- **The gate arm:** every ticket running the root's gates; a gated package standing in for a
  gate-less one; a red gate followed by a green one passing; a package's gate, install or flake
  rerun at the root; the root's `test_single` for the rerun; the root's package manager for a
  package's install; the failure record without its package; a package's install directory
  committed; a package's `node_modules` writable.
- **Drift, sync and acceptance:** a package's binding compared with the root's candidates; an
  approval admissible in any package, and an old row nobody's; the fork's packages read from the
  root's listing; sync dropping declared bindings, reporting a pending choice as no way to run,
  recording gaps for a package with no gate, and judging drift at the root; a ticket's accepted
  hashes keyed by slot; the requeue sweep judging at the root.
- **The probe, the preamble, promotion, migration, toolchains:** a package's test run at the root,
  passed without a gate, or run by the root's gate; sessions not told other packages' gates, or a
  package's gate overwriting the root's slot; promotion storing the raw command or taking another
  package's candidate, in the bootstrap's finalize and in the late promotion; `bindings.json` not
  migrated, or migrated without packages; `run` and `doctor` naming a gate without its package.

First pass: 70 killed, 2 survived. D02 was killed by a syntax error, not a test.
- **D04** (a declared package dropped from `packagesWith`) survived because `writeBindings` adds
  every package a binding names, so the file was right. The phase's `packages` output was wrong,
  and no test read it. A test reads it now.
- **B03** (the bootstrap's own promotion reading the root alone) survived because the late
  promotion (PRDR-218) promoted `web` at the next pool of the same run, so the end state matched.
  The test now asserts that both were promoted when the bootstrap finished, and that no late note
  was written.

Second pass, with D02 as a valid mutant: D02b, D04 and B03, 3 killed. A third pass ran B01, the raw
command, against the new drift regression alone: killed.

A fourth pass ran against the code the line ceiling moved (Gates, below). The preamble's two
mutants and the install directories' were killed. So was PRDR-228's own defect, a finalize commit
made whether or not anything was staged. A commit forced with `--allow-empty` survives, since no
test counts a finalize's commits; it survived at HEAD in `referee.ts` too.

## Gates

`lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check` and `test` all
pass: 2107 tests passed and 2 skipped, across 179 files. `npm run plugin` builds.

`lint`'s line ceiling failed three files on the first run, and each was split by what it does:
- PRESENT's reader of the phases' outputs, `presentInputsFromOutputs`, moved to
  `src/init/present-inputs.ts`;
- the session preamble moved beside `stablePrefix` in `src/sessions/backend.ts`, as
  `bindingsPreamble`;
- the list of install directories moved to `src/adapter/install.ts`, as `installDirs`;
- PRDR-228's commit of what was staged moved to `src/kernel/git.ts`, as `commitStaged`.

## Found along the way

- **The bootstrap's promotion stored a command the gate never runs.** `finalizeBootstrap` stored
  the candidate's raw `resolved`, `npm run test`, while every binding `init` makes, and drift's
  comparison, use the normalized invocation, `npm run test -- --run` for vitest. So a new
  TypeScript project whose scaffold ran vitest halted its first ticket after the bootstrap on
  "the bound COMMAND no longer matches", until the operator ran `detent verify sync`. The probe
  above shows it at HEAD. The per-package promotion stores the normalized command, and
  `bind-packages.test.ts` holds the regression.

## Recorded, not fixed

- **Promotion takes the first of two candidates.** Where discovery finds two plausible commands for
  a slot after the bootstrap, `finalizeBootstrap` promotes the first, where C-3b would ask at
  `init`. This predates PRDR-295.
- **The Stop gate is the root's** (vetoable call 13). A session working on `web` is Stop-gated by
  the root's `test`, or by nothing where the root binds none. The referee's gates, per package,
  are what judge the ticket.
- **Declared bindings in an existing project are never executed at `init`, promoted or checked for
  vacuity** (vetoable call 10).
- **An approved plan keeps the root's gates until `detent init` re-binds** (vetoable call 22).
  ksar-cloud's plan is paused and is re-planned by the new planner anyway.
- **A drafter sees packages only as labels in `bound_slots`.** PRDR-293's "From PRDR-295" section
  says what a redraft for an ungated path needs.
- **No live run has bound a repository with more than one package.** Every test here is a real
  git repository with real gate scripts, and no model session. Detent is not run against ksar or
  any other project in this build of the redesign.
