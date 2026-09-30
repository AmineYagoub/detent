---
id: PRDR-329
title: "Every containment decision runs its globs through picomatch 4.0.3 (R-6), which two advisories cover. Under GHSA-c2c7-rcm5-vvqj (high), a repeated extglob such as `+(+(a))` compiles to a regex that backtracks exponentially. The guard that runs it sits on Detent's own event loop and inside the plugin hook, so one surface glob and a thirty-character path stall a run for seconds. Under GHSA-3v7f-55p6-f55p (moderate), a POSIX class named after a member of `Object.prototype`, such as `[[:constructor:]]`, splices a JavaScript function's source text into the regex, so a surface grants paths spelled from that text. 4.0.4 fixes both, but its ReDoS rewrite keeps only the first branch of a multi-branch repeated extglob, so a protected glob stops protecting what its other branches name. 4.0.5 fixes that too, so the exact pin (N-3) moves to 4.0.5 and the hook bundle is rebuilt on it"
state: DONE
severity: major
category: security
labels: ["prd-review", "containment", "dependency", "npm-audit", "N-3", "R-6", "SEC-3"]
surface: ["package.json", "package-lock.json", "hooks/dist/detent-hook.cjs", "tests/sec/glob-advisories.test.ts"]
prd_refs: ["N-3", "R-6", "SEC-3", "S-2", "D-21"]
acceptance_criteria: ["package.json pins picomatch exactly (N-3) at 4.0.5, the first release that fixes GHSA-c2c7-rcm5-vvqj and GHSA-3v7f-55p6-f55p and keeps every branch of a repeated extglob, which 4.0.4 does not. package-lock.json resolves the same version. The only other change in it is that tinyglobby's nested copy of 4.0.5, a dev dependency, now dedupes to the top-level one.", "A surface holding `[[:constructor:]]` grants no path spelled from `function Object() { [native code] }`. This holds in the decision the SDK backend registers and in the shipped hook bundle.", "The guard decides a write under a surface written as a nested repeated extglob (`+(+(a))`): within a second in-process for a path of twenty-eight `a`s, and through the bundle before a fifteen-second kill for forty.", "A protected glob whose repeated extglob has two branches (`+(*(a)|*(b))`) protects what its second branch names, in-process and through the bundle. This is the case 4.0.4 drops.", "The lockfile and the installed copy are the pinned version, so a stale `node_modules` cannot rebuild the bundle on the old engine unnoticed.", "`hooks/dist/detent-hook.cjs` is rebuilt on the new pin, and its staleness test holds.", "Falsifying tests run against HEAD: the surface and the time bound fail on 4.0.3, and the dropped branch fails on 4.0.4.", "`npm audit` no longer names picomatch. Each finding left is recorded with whether it reaches a runtime path."]
non_goals: ["Does NOT move to 4.0.7, the release `npm audit fix` names. 4.0.6 and 4.0.7 change `scan()` and parenthesised globstars, and Detent's `unreadable` check and `touchedPackages` read both (vetoable call 1).", "Does NOT refuse a glob the fixed engine reads as literal text. A repeated extglob it judges risky, such as `+(a|aa)`, `+(+(a))` or one with an empty or `*`-only branch, matches only its own spelling. A protected or risk glob written that way protects less than it says, which is recorded below.", "Does NOT bound the ReDoS shapes the upstream fix misses. `+(a|b|ab)` still backtracks exponentially on every release, which is recorded below as Detent's own work.", "Does NOT fix the other audit findings. qs, hono, ip-address and fast-uri are in the MCP SDK's tree, and brace-expansion, js-yaml and vitest's are dev-only. Each is recorded below with what it reaches.", "Does NOT touch the stopped tabachir test run's pin branch, which keeps the build it ran on."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-319", "PRDR-245", "PRDR-149", "PRDR-127"]
depends_on: []
---

# PRDR-329 — the containment globs run on a picomatch with two advisories

## Where this came from

PRDR-319's install of the new SDK pin printed `npm audit`'s summary. That ticket recorded the two
picomatch advisories and offered them as a task of their own. On 2026-09-30 the user asked for the
exact pin to move to the first fixed release, with falsifying tests wherever the behaviour differs.
They asked for the hook bundle to be rebuilt and for the other findings to stay out of scope unless
one reaches a runtime path.

## Problem

**One matcher.** R-6 makes picomatch the one glob engine (`docs/implementation-plan.md`), and N-3
lists it among Detent's few direct dependencies, pinned. It decides:

- the guard's surface and protected checks (`matchAny` in `src/sessions/guard.ts`). The SDK backend
  registers these as in-process `PreToolUse` callbacks, and `scripts/build-plugin.ts` bundles them
  into `hooks/dist/detent-hook.cjs`;
- the protected check on a surface request (`src/kernel/referee-session.ts`);
- the B-4 risk globs against a ticket's changed files (`src/kernel/referee-gate.ts`);
- review scope, dependency overlap, parking and the packages a surface touches
  (`review-scope.ts`, `dependency.ts`, `worktree-park.ts`, `src/adapter/packages.ts`).

Detent declares only its protected floor. The other patterns are a plan's surfaces, which a
planner session drafts and a human approves, and the config's `protected` and `risk` globs, which
the operator edits. The strings are the paths a session names in its tool calls, the files its diff
changes, and the repository's own directory names. No glob Detent declares uses an extglob or a
POSIX class, and `grep` over `src/` finds none.

**GHSA-c2c7-rcm5-vvqj (high, CVSS 7.5).** A repeated extglob whose alternatives overlap or nest
compiles to a quantifier over a quantifier, for example `+(+(a))` to `^(?:(?=.)(?:(?:a)+)+)$`. Rejecting a
string of `a`s ending in anything else then takes time that doubles with each character. Measured
with 4.0.3 in plain `node` on this machine, twenty-six `a`s and a `b` took 317 ms, and each
further `a` doubles the time. `matchAny` runs a surface glob twice, as written and with `/**`, and
both forms backtrack alike. Under this repository's vitest, twenty-eight `a`s held the guard for
12.8 s (Falsification). The pattern needs no special character a human reviewer would stop at.
In the headless driver the guard is a callback on the event loop that also runs the kernel and
writes the ledger, so a hung decision stalls the run, not only its session. Through the plugin
hook it holds the tool call until the hook's registered timeout.

**GHSA-3v7f-55p6-f55p (moderate, CVSS 5.3).** `POSIX_REGEX_SOURCE` inherits from
`Object.prototype`. So `[[:constructor:]]` does not fail as an unknown class. It looks up
`Object`, stringifies it, and compiles `[function Object() { [native code] }]` into the regex.
The text's own `]` closes the class early. So a surface of `src/[[:constructor:]]*.ts` grants
`src/e }].ts`: one character from `function Object() { [native code`, then the ` }]` left over.
Nothing in the surface a human approved says so.
`npm audit` rates the package high, the higher of the two.

**The first fixed release is not a clean one.** Both advisories name 4.0.4 as first patched on
the 4.x line. 4.0.4 added `analyzeRepeatedExtglob`, which rewrites a repeated extglob whose branch
is itself a `*(…)` sequence. It returned at the first such branch, so `+(*(a)|*(b))` compiled to
`^(?:(?=.)a*)$`, and `b` no longer matched. For a protected glob, that means a protected path is
left writable. 4.0.5 fixes it ([micromatch/picomatch#182](https://github.com/micromatch/picomatch/pull/182)),
compiling the same pattern to `[ab]*`.

Measured across the releases, with the options Detent passes (`dot`, `nocase` on the protected
side):

- 41 ordinary patterns were matched against 42 paths under the three option sets Detent passes,
  5,166 matches in all. The patterns: `src/**`, braces, `@(…)`, `!(…)`, `+(…)` over distinct
  alternatives, classes. The paths: dotfiles, case variants, nested and bare directories. The
  results agree exactly on 4.0.3, 4.0.4 and 4.0.5. 4.0.7 differs on one: `(src/**)` matches `src`,
  from 4.0.6's parenthesised globstar fix.
- `scan()` returns the same `base`, `glob`, `isGlob` and `negated` for all 17 search patterns
  tried, on 4.0.3, 4.0.4, 4.0.5 and 4.0.7.
- Plausible extglobs compile identically on 4.0.3 and 4.0.5: `+(foo|foobar)`, `*(.ts|.tsx)`,
  `src/*.+(ts|tsx)`, `+(src|source)/**`, `*(a|ab)`, `**/*.*(ts|js)`. Only the ReDoS shapes change:
  a single character repeated in overlapping branches (`+(a|aa)`), an empty or `*`/`?`-only branch,
  and a repeated extglob nested in another.

## Design

- **The pin** moves to 4.0.5 with `npm install --save-exact picomatch@4.0.5`, in `package.json`
  and `package-lock.json`. N-3 keeps it exact.
- **The bundle** is rebuilt with `npm run plugin`. It carries its own copy of the engine, and
  `tests/plugin/hook.test.ts`'s staleness check compares it with a fresh render.
- **Tests** go in `tests/sec/glob-advisories.test.ts`, one behaviour each, run on both skins: the
  decision the SDK backend registers, and the bundle spawned as the platform spawns it. A third
  group pins the version in all three places it lives.

### Vetoable calls

1. **4.0.5, not 4.0.4 and not 4.0.7.** 4.0.4 is what the advisories name as first patched, but it
   leaves `+(*(a)|*(b))`'s protected paths writable. 4.0.5 is the first release that fixes both
   advisories and matches every ordinary glob measured the way 4.0.3 does. 4.0.7, which
   `npm audit fix` would install, also changes `scan()` and parenthesised globstars. Those are
   fixes, but they change behaviour that should move in a ticket of its own.
2. **A pattern the engine now reads as literal text is accepted, not refused.** Refusing it when a
   config or plan is read would be new validation, so it is recorded below and not built here.
3. **The ReDoS tests bound time, with a wide margin.** In-process, twenty-eight `a`s must be
   decided within a second, and 4.0.3 took 12.8 s. Through the bundle, forty must be decided
   before a fifteen-second kill. 4.0.3 would take hours, and node's start-up under a loaded suite
   is well inside the kill. Neither test asserts that the engine literalises `+(+(a))`, so a later
   release that compiles the pattern safely still passes.
4. **The pin is read in three places**: `package.json`, the lockfile, and the installed copy. The
   bundle is built from whatever is installed. After a checkout that moves the pin, a
   `node_modules` still on 4.0.3 would re-bundle the old engine the next time `npm run plugin`
   runs, and the staleness test would pass on that bundle.

## Falsification (verification protocol, item 1)

`tests/sec/glob-advisories.test.ts`, written before the fix and run against HEAD `bde9cbc`, with
4.0.3 installed and in the committed bundle:

    × PRDR-329 the decision the SDK backend registers > GHSA-3v7f-55p6-f55p: a surface naming `[[:constructor:]]` grants nothing spelled from `Object`'s source 7ms
      → expected 'allow' to be 'deny' // Object.is equality
    × PRDR-329 the decision the SDK backend registers > GHSA-c2c7-rcm5-vvqj: a write under a `+(+(a))` surface is decided within a second, for a path of twenty-eight `a`s 12778ms
      → the guard runs on Detent's own event loop: every session waits while it matches: expected 12776.835416 to be less than 1000
    ✓ PRDR-329 the decision the SDK backend registers > a protected `+(*(a)|*(b))` protects what its second branch names, which 4.0.4 dropped 0ms
    × PRDR-329 the bundled hook carries the fixed engine > GHSA-3v7f-55p6-f55p: a surface naming `[[:constructor:]]` grants nothing spelled from `Object`'s source 32ms
      → expected '' to contain 'outside this ticket\'s declared surfa…'
    × PRDR-329 the bundled hook carries the fixed engine > GHSA-c2c7-rcm5-vvqj: a write under a `+(+(a))` surface is decided before the kill, for a path of forty `a`s 15006ms
      → the hook was still matching after 15000 ms: expected Error: spawnSync /Users/workstation/.nvm/… { …(5) } to be undefined
    ✓ PRDR-329 the bundled hook carries the fixed engine > a protected `+(*(a)|*(b))` protects what its second branch names, which 4.0.4 dropped 34ms
    × PRDR-329 the pin (N-3) > is exact, and at 4.0.5 or later: past both advisories and past 4.0.4's dropped branch 1ms
      → picomatch 4.0.3: expected false to be true // Object.is equality
    ✓ PRDR-329 the pin (N-3) > is what the lockfile resolves and what is installed, which is what the bundle is built from 1ms
          Tests  5 failed | 3 passed (8)

The bundle's empty output is silence, the hook's allow. The first run put thirty `a`s in-process.
4.0.3 took 93.7 s there, and holding vitest's worker that long tripped its RPC timeout. Twenty-eight keeps the failure a clear 13x over budget. Outside
vitest the same guard call took 678 ms at twenty-six characters, against 3.4 s inside it: this
suite runs the engine about five times slower than plain `node` does.

The two tests that pass there are the case 4.0.4 breaks. With 4.0.4 copied into `node_modules`
and the bundle rendered on it (`npm run plugin`), both advisories' tests pass and those two fail:

    × PRDR-329 the decision the SDK backend registers > a protected `+(*(a)|*(b))` protects what its second branch names, which 4.0.4 dropped 4ms
      → expected 'allow' to be 'deny' // Object.is equality
    × PRDR-329 the bundled hook carries the fixed engine > a protected `+(*(a)|*(b))` protects what its second branch names, which 4.0.4 dropped 31ms
      → expected '' to contain 'b is protected'
    × PRDR-329 the pin (N-3) > is exact, and at 4.0.5 or later: past both advisories and past 4.0.4's dropped branch 0ms
      → picomatch 4.0.3: expected false to be true // Object.is equality
    × PRDR-329 the pin (N-3) > is what the lockfile resolves and what is installed, which is what the bundle is built from 1ms
      → node_modules holds another picomatch than the pin; `npm ci` installs the pinned one: expected '4.0.4' to be '4.0.3' // Object.is equality
          Tests  4 failed | 4 passed (8)

The last two are the copy standing in for an install. The installed engine and the bundle were then
restored from snapshots taken first, and the bundle compared byte for byte with HEAD's.

## Mutation battery

Each mutant undid one piece of the move: in the pin, the installed engine or the bundle. Before the
first mutant, `package.json`, `package-lock.json`, the bundle and `node_modules/picomatch` were
copied aside. After each, they were restored from those copies and compared byte for byte. Each
mutant ran `tests/sec/glob-advisories.test.ts` and `tests/plugin/hook.test.ts`, 38 cases, all
green before the first and after the last.

| Mutant | Result |
|---|---|
| M1 `package.json` pins 4.0.3 again | killed: the pin, and the lockfile check |
| M2 the pin loosened to `^4.0.5` (N-3) | killed: the pin, and the lockfile check |
| M3 the lockfile resolves 4.0.3 | killed: the lockfile check |
| M4 `node_modules` still holds 4.0.3 | killed: both advisories in-process, the installed copy, staleness |
| M5 the bundle rendered on 4.0.3 | killed: both advisories over the bundle, staleness |
| M6 engine: POSIX classes inherit `Object.prototype` again | killed: `[[:constructor:]]` in-process, staleness |
| M7 engine: the risky-extglob safeguard off | killed: `+(+(a))` in-process, staleness |
| M8 engine: 4.0.4's first-branch return put back | killed: `+(*(a)\|*(b))` in-process, staleness |
| M9 bundle: POSIX classes inherit `Object.prototype` again | killed: `[[:constructor:]]` over the bundle, staleness |
| M10 bundle: the risky-extglob safeguard off | killed: `+(+(a))` over the bundle, staleness |
| M11 bundle: 4.0.4's first-branch return put back | killed: `+(*(a)\|*(b))` over the bundle, staleness |

M6 to M11 edit the engine's own code, in `node_modules/picomatch/lib` and in the bundle. Each is
caught by the matching test on its own skin, while the same test on the other skin passes. So each
skin's tests read the engine that skin runs, and not the copy beside it.

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: 208 files, 2,306 passed and 2 skipped (2,308), on PRDR-323 (`e5a00bc`). PRDR-321 and
  PRDR-323 landed while this was built, and this was rebased onto each and run again: on `bde9cbc`,
  203 files, 2,261 passed and 2 skipped; on `6b7e836`, 207 files, 2,293 passed and 2 skipped.
- `npm run plugin`: after the render above, it wrote nothing that changed.
- `npm ci` on the new lockfile: passes, and installs 4.0.5 as the one picomatch in the tree. The
  38 cases of the two suites pass on that install.
- `npm audit`: picomatch is gone. Left: @vitest/mocker, brace-expansion, fast-uri, hono,
  ip-address, js-yaml, qs and vitest, each recorded below.

## What changed

- `package.json`, `package-lock.json`: picomatch 4.0.3 to 4.0.5, exact, by
  `npm install --save-exact picomatch@4.0.5`. In the lockfile these moved: the root dependency;
  `node_modules/picomatch`'s version, tarball and integrity; and tinyglobby's nested 4.0.5 (dev),
  which is gone. tinyglobby asks for `^4.0.4`, which the top-level 4.0.3 could not serve and 4.0.5
  does. vitest, vite, fdir and tinyglobby now share the top-level copy. The installed files equal
  the published 4.0.5 tarball.
- `hooks/dist/detent-hook.cjs`: rendered by `npm run plugin` on 4.0.5. Every changed hunk is inside
  picomatch's `constants`, `parse` and `picomatch` modules: 251 lines in and 2 out. The 2 are
  4.0.5's `matchBase` fix, and Detent never passes that option. `agents/*.md` did not change.
- `tests/sec/glob-advisories.test.ts` (new): the eight cases above.
- No source file changed. Every call site keeps its options.

## Recorded, not fixed

- **The fix closes the advisory's shapes, not the class.** `+(a|b|ab)`, whose alternatives
  overlap across characters, still compiles to `^(?:(?=.)(?:a|b|ab)+)$` on 4.0.5 and on 4.0.7.
  Rejecting `ab` twenty-six times and a `c`, 53 characters, took 2.3 s on 4.0.5, and the time
  grows about 1.4x with each character. A glob of that shape in a plan's surface, or in the
  config's protected or risk list, can still stall the guard. No release fixes it, so bounding it
  is Detent's own work: refuse repeated extglobs in the globs a plan or config supplies, or bound
  what is matched. That needs a ticket of its own.
- **A glob the engine judges risky is now literal text.** From 4.0.4, some `+(…)` and `*(…)` globs
  match only their own spelling:
  - one whose branches overlap as one repeated character (`+(a|aa)`);
  - one with an empty branch, or a branch of only `*` and `?`, beside others (`+(*|x)`);
  - one mixing a `*(…)` branch with a branch longer than one character (`+(*(a)|bc)`);
  - one nesting another repeated extglob (`+(+(a))`) past `maxExtglobRecursion`, which is 0 by
    default.

  As a surface or review scope, such a glob grants less, and that is the safe direction. As a
  protected or `risk` glob, it silently protects or gates less than it says. No glob Detent
  declares has that shape, and every plausible extglob measured compiles as before. Refusing such
  a glob when a config or plan is read would make it visible. That check has to tell a literalised
  extglob apart from 4.0.5's rewrite that keeps the meaning (`+(*(a)|*(b))` to `[ab]*`). It is new
  validation, and it belongs with the ticket above.
- **The other audit findings reach no runtime path that takes Detent's input.**
  - qs 6.15.3, hono 4.13.2, ip-address 10.5.0 and fast-uri 3.1.5 are in the production tree, all
    through @modelcontextprotocol/sdk 1.30.0. express and body-parser bring qs, @hono/node-server
    and the SDK itself bring hono, express-rate-limit brings ip-address, and ajv brings fast-uri.
  - Detent imports three of the SDK's entry points: `server/index.js`, `server/stdio.js` and
    `types.js`. Loading them loads ajv, ajv-formats, fast-deep-equal, fast-uri and
    json-schema-traverse. It does not load express, qs, hono or ip-address, which serve the SDK's
    HTTP transports and auth routes.
  - fast-uri is called twice, when the SDK's `Server` builds its ajv instance: `parse` and
    `serialize` of `http://json-schema.org/draft-07/schema`, ajv's own meta-schema id. Serving
    `initialize`, `tools/list` and a `tools/call` whose arguments held URLs made no further call.
    The server compiles a schema only in `elicitInput`, and Detent never calls it.
  - brace-expansion and js-yaml are not in the production tree (`npm ls --omit=dev`). vitest and
    @vitest/mocker are dev dependencies.
- **GitHub rates GHSA-3v7f-55p6-f55p moderate** (CVSS 5.3). `npm audit` reports picomatch at the
  higher of its two advisories, high.
- **The stopped tabachir test run keeps its pin**, `pin/tabachir-test`, on 4.0.3, as the non-goals
  say.
- **A checkout that moves this pin needs `npm ci`.** The bundle is rendered from whatever is
  installed, and the pin test names a stale copy.
