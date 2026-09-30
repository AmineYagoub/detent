---
id: PRDR-330
title: "Detent accepts, wherever it reads a glob, two kinds picomatch cannot be trusted with. The first compiles to a regex that cannot reject a path in bounded time. `+(*)` and `+(a|b|ab)` repeat a group that can match more than one character, and on 4.0.5 rejecting a 25-character path under `+(*)` takes 1.7 s, doubling with each character. The upstream fix for GHSA-c2c7-rcm5-vvqj catches neither, and `(a|b|ab)+` compiles the same with extglobs off. The second is a shape that fix does catch, such as `+(a|aa)`, which from 4.0.4 matches only its own spelling; with a backslash escape inside, it compiles to a regex that matches nothing. So a protected or `risk` glob written the second way protects or gates less than it says. A glob of the first kind in a plan or a config lets a session freeze Detent's event loop by naming a path. Each glob a plan, a config or a policy supplies is now refused where it is read (SEC-3″), and the guard checks its policy, and a Glob call's pattern, before it matches either"
state: DONE
severity: major
category: security
labels: ["prd-review", "containment", "redos", "SEC-3″", "SEC-3", "R-6", "B-4"]
surface: ["src/schemas/glob-hazard.ts", "src/schemas/common.ts", "src/schemas/init.ts", "src/init/plan-cache.ts", "src/sessions/guard.ts", "hooks/dist/detent-hook.cjs", "tests/sec/glob-hazards.test.ts", "tests/schemas/glob-hazard.test.ts", "tests/sec/glob-advisories.test.ts", "detent-prd-v3.md"]
prd_refs: ["SEC-3″", "SEC-3", "SEC-3′", "R-6", "S-2", "D-21", "P5", "B-4", "C-2″", "C-4⁵", "V-5′", "N-3"]
acceptance_criteria: ["A config whose `protected`, `risk` or `plan_docs` holds a glob picomatch compiles to a group repeated over more than one character (`+(*)`, `+(a|b|ab)`, `(a|b|ab)+`) is refused at load, naming the field, the glob and the group. `run` refuses to start on it and says why.", "The same holds for a glob picomatch reads as its own spelling (`+(a|aa)`, `+(*|x)`, `+(*(a)|bc)`, `+(+(a))`), and for one it cannot compile (`+(a|aa|\\+\\(x)`), which it would otherwise match against nothing.", "A ticket whose surface holds such a glob is refused when read, naming the ticket. A plan draft whose ticket's surface holds one is an invalid draft, and its relaunch is told why. A cached redraft that holds one is a miss.", "`+(*(a)|*(b))`, which picomatch rewrites to `[ab]*` with its meaning kept, is accepted. So are every glob Detent declares and the extglobs that repeat one character or nothing: `@(…)`, `!(…)`, `?(…)`, `+([a-z])`, braces and classes.", "The guard refuses every write under a policy that holds such a glob, on both skins: the decision the SDK backend registers and the bundled hook. It refuses within a second in-process and before a fifteen-second kill through the bundle, for paths that take the unfixed guard seconds and minutes.", "The guard refuses a Glob call whose pattern holds such a glob where it matches that pattern against the way to an unreadable directory (C-4⁵), within a second.", "`hooks/dist/detent-hook.cjs` is rebuilt, and its staleness test holds.", "Falsifying tests run against HEAD fail there, one for each entry point above."]
non_goals: ["Does NOT bound the polynomial class: runs of `*` or `**` separated by text they can also match (`*a*a*a*b`, `*a*/*a*/*a*/*a*/*a*/b`) take seconds on paths of a few hundred characters. No extglob is involved, and the fix is of another kind. It is recorded below with measurements.", "Does NOT tell apart, and accept, a repeated group of literal alternatives that can never split one text two ways, such as `+(ts|tsx)`. It is refused like any other. Deciding that is possible, but not by eye, and braces say the same thing (vetoable call 4).", "Does NOT pass `noextglob` at the call sites. It does not close the class. And a protected `@(…)`, or a `!(…)` after the start, would then need a literal `@` or `!` in the name: `@(secrets|keys)/**` would protect `@secrets/x` and not `secrets/x` (vetoable call 2).", "Does NOT report anything upstream. That is an external action, which the user decides.", "Does NOT touch the stopped tabachir test run's pin branch."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-329", "PRDR-149", "PRDR-132", "PRDR-292", "PRDR-295"]
depends_on: ["PRDR-329"]
---

# PRDR-330 — a glob picomatch cannot match safely, or as written, is accepted

## Where this came from

PRDR-329 moved the pin to picomatch 4.0.5 and recorded two defects it did not fix, under
"Recorded, not fixed". First, `+(a|b|ab)` still backtracks exponentially on every release. Second,
the shapes the upstream safeguard does catch are matched as their own spelling. On 2026-09-30 the
user asked for both to be fixed. They gave the design question: refuse repeated extglobs, or all
extglobs, where a plan or config supplies them; pass `noextglob` at the call sites; or bound what
is matched. One constraint came with it: detecting a literalised glob must not flag the
meaning-preserving `[ab]*` rewrite.

## Problem

**Where the globs come from, and where they are matched.** Detent's own constants use no extglob:
the protected floor (`STRUCTURAL_PROTECTED`), `init`'s default protected set, the document
patterns and the pack's paths. Every other glob is supplied:

- a plan's surfaces, which a planner session drafts and a human approves;
- the config's `protected` and `risk` globs (SEC-3, B-4) and `plan_docs` (C-2″), which the
  operator edits. The config is repository content;
- `.detent/active_surface.json`, which the plugin hook reads, is repository content too;
- a Glob call's pattern, which the guard matches against the way to an unreadable directory
  (C-4⁵).

picomatch is the one engine (R-6). It matches them in:

- `matchAny` and `globDescends` in `src/sessions/guard.ts`. The SDK backend registers these as
  in-process `PreToolUse` callbacks, and `scripts/build-plugin.ts` bundles them into the plugin
  hook;
- the protected check on a surface request (`src/kernel/referee-session.ts`);
- the B-4 risk globs (`src/kernel/referee-gate.ts`);
- review scope, dependency owners and parking (`review-scope.ts`, `dependency.ts`,
  `worktree-park.ts`);
- a surface's package reach (`reaches` in `src/adapter/packages.ts`), segment by segment;
- document discovery (`src/init/discover-docs.ts`).

The strings matched are a path a session names, a request path a session writes, the files a diff
changes, and repository directory names.

**The exponential class is wider than the advisory.** picomatch compiles a glob to a backtracking
regular expression. A group it repeats that can match more than one character makes the engine,
when it rejects a path, try every way to split the path first. Measured in plain `node` on 4.0.5
on this machine, with the `dot` option Detent passes:

| Glob | Compiles to | Path | Time |
|---|---|---|---|
| `+(*)` | `(?:[^/]*?)+` | `a`×20 then `/` (21 chars) | 107 ms |
| `+(*)` | | `a`×24 then `/` (25 chars) | 1.7 s |
| `+(*)` | | `a`×28 then `/` | killed at 8 s |
| `+(a\|b\|ab)` | `(?:a\|b\|ab)+` | `ab`×22 then `c` (45) | 232 ms |
| `+(a\|b\|ab)` | | `ab`×26 then `c` (53) | 3.7 s |
| `*(a\|b\|ab)` | `(?:a\|b\|ab)*` | 53 chars | 3.7 s |
| `+(x*)` | `(?:x[^/]*?)+` | `x`×26 then `/` | 1.3 s |
| `+(ab\|ab)` | `(?:ab\|ab)+` | 45 chars | 155 ms, doubling every 4 |
| `+(*.ts)` | `(?:[^/]*?\.ts)+` | `a.ts`×22 then `x` (89) | 160 ms, ×16 per 16 chars |
| `(a\|b\|ab)+` | `(a\|b\|ab)+` | 45 chars | 351 ms |
| `(a\|b\|ab)+`, `noextglob` | the same | 53 chars | killed at 5 s |
| `{a,b,ab}+` | `(a\|b\|ab)+` | 45 chars | 352 ms |
| `(a+)+` | `(a+)+` | `a`×24 then `b` | 528 ms |

4.0.5's safeguard for GHSA-c2c7-rcm5-vvqj (`analyzeRepeatedExtglob`) catches only four shapes:
branches that overlap as one repeated character, an empty or `*`/`?`-only branch beside others,
a `*(…)` branch mixed with a longer one, and a repeated extglob nested in another. `+(*)` has one
branch, so none of the four applies. The regex rows need no extglob at all. picomatch passes a `+`
through as a regex quantifier after `)`, `]` or `}` and anywhere inside a group, whether or not
extglobs are on. So `noextglob` compiles `(a|b|ab)+` to the same regex it always did.

**The safeguard's own output.** From 4.0.4 the shapes it catches are compiled as their escaped
spelling:

- `+(a|aa)`, `+(*|x)`, `+(*(a)|bc)` and `+(+(a))` each match only a name spelled with those
  characters;
- nested, `@(+(a|aa))` and `!(+(a|aa))` keep the literal inside.

The escaping misses one case. It does not escape a backslash, so a caught shape that holds one,
such as `+(a|aa|\+\(x)`, becomes an invalid regex (`Unterminated group`). picomatch then returns
`/$^/`, which matches nothing, and says nothing. As a surface, either outcome grants less, which is
safe. As a protected glob or a `risk` glob, it protects or gates less than it says, and silently.

**What a match that does not end does, per skin.**

- *In-process* (the SDK backend, under both drivers): the guard is a callback on Detent's own
  event loop. That loop also runs the kernel, writes the ledger and reads every session's stream.
  While a match runs, Detent stops: every session stalls, and nothing is recorded. The runtime
  blocks the tool call once the callback passes its timeout, 600 s by default for an SDK callback
  hook. Detent's process stays inside the match until it ends. At 40 characters under `+(*)`,
  that is about fifteen hours, by the doubling measured above.
- *The kernel's matchers*, run on the same loop, are reached the same way. The surface-request
  check matches a path the session wrote, and it runs before that path is checked to be concrete.
- *The plugin hook*: the only policy file Detent writes is the driver's (`publishClaimPolicy`).
  It sets `driver: true`, and the hook then denies every path'd call without matching any glob.
  So the hook matches globs only from a policy file Detent did not write, which is repository
  content. A command hook that times out does not block the tool call; it goes through the normal
  permission flow (code.claude.com/docs/en/hooks, "PreToolUse"). The hook is containment's
  accelerant and fails open on a crash by design (`hook-entry.ts`, P2). So a planted policy costs
  the user's session ten minutes per call, and no Detent containment.

**What the plans hold.** ksar-cloud's plans hold 409 distinct surface globs. Each is a plain path
or `dir/**`: none uses an extglob, a brace or a class, and none has more than one `**`. The
tabachir configs' protected globs are plain too. Refusing these shapes costs no plan on record
anything.

## Design

**The rule (SEC-3″).** A glob Detent reads from a plan, a config or a policy file is refused where
it is read if picomatch, compiling it as the containment matchers do:

1. cannot compile it. picomatch then matches with `/$^/`, which matches nothing;
2. builds a regex that repeats a group matching anything other than exactly one character; or
3. reads one of its repeated extglobs as its own spelling.

A rewrite that keeps the meaning is none of these, and passes: `+(*(a)|*(b))` becomes `[ab]*`, and
`+(*(a))` becomes `a*`.

**Judged from the engine's own output.** `globHazard` in the new `src/schemas/glob-hazard.ts` does
not re-read picomatch's grammar. It reads what picomatch produces:

- for (1), `makeRe(form, { dot: true, debug: true })`. With `debug`, picomatch throws the error it
  otherwise swallows into `/$^/`;
- for (2), the compiled regex's source. A short reader walks it and finds every quantifier whose
  maximum exceeds one. Where one follows a group, the group's body must be exactly one character:
  lookarounds and anchors add nothing, and alternation or a quantifier inside is too much. Every
  group is read, lookarounds included, since backtracking inside a lookahead is still
  backtracking. Picomatch's globstar step, `(?:(?!…).)*?`, is one character;
- for (3), `picomatch.parse`'s tokens. A literalised extglob is a `text` token whose value is the
  extglob and whose output is that value escaped. The safeguard's rewrite leaves the rewrite's
  output there, so `[ab]*` passes by construction.

The exact pin (N-3) keeps the verdicts and the engine in step, and the tests name every shape.

**The forms judged.** The glob as written, and each `/` segment, which is how a surface's package
reach (`reaches`, V-5′) compiles it. A class that holds a slash is one character as a whole but
splits into segments that are not: `[+(a|b|ab)/]`. The guard also compiles a directory form,
`<glob>/**`. That form is a prefix of the glob plus a globstar, and a globstar is a one-character
step, so it cannot repeat anything the glob does not.

**Where it is checked.**

- `glob` in `src/schemas/common.ts` gains the check as a refinement. So the config's `protected`,
  `risk` and `plan_docs`, and a ticket's `surface` and `granted`, are checked when the config
  loads and whenever a ticket is read. `run`, `init` and `doctor` already refuse a config that
  does not load, with the issue's text.
- A plan draft's `surface` (`planDraftSchema`) is checked too. A draft that fails is invalid, and
  C-4⁗′'s one relaunch carries the validator's words. A draft must not reach `writePlan` holding
  one, because the ticket it becomes would then not parse.
- A cached ticket (`cachedTicketSchema`, for the slice cache and the redrafts) is checked, so one
  holding such a glob is a miss and not a crash.
- The guard checks its policy's globs before it matches any. A policy that holds such a glob denies
  every write, on both skins (P5: a policy that cannot be honoured fails closed). Reads are never
  matched against a glob, so they are unaffected. The session's own artifact area is decided
  before any glob and stays writable.
- The guard checks a Glob call's pattern before `globDescends` matches it against the way to an
  unreadable directory. A session names that pattern at will, so it is refused, not matched.

**The message** names the glob and what picomatch does with it. It says the fix: write
alternatives as braces or as globs of their own, repeat single characters only, or drop the
repeated extglob. A zod issue carries the field's path (`protected.0`), and the guard's deny
carries SEC-3″.

### Vetoable calls

1. **Refused where it is read, not bounded where it is matched.** A length bound cannot help:
   `+(*)` needs 25 characters to take seconds. A time bound cannot be put on a regex in-process,
   because a match holds the thread until it ends. Refusing the glob takes the case away.
2. **Not `noextglob`.** It does not close the class, since `(a|b|ab)+` compiles the same without
   extglobs. And the `@` of `@(secrets|keys)/**` in a protected list would become a character the
   name must hold: it would protect `@secrets/x` and not `secrets/x`, which protects less. A
   `!(…)` after the start becomes a literal `!` the same way, and one at the start is read as
   negation either way (measured on 4.0.5).
3. **The verdict reads picomatch's output: its regex, its parse and its errors.** It does not
   re-implement picomatch's grammar. So it is about the regex that will run, and a picomatch
   upgrade that changes a shape shows in the tests that name it.
4. **A repeated group must be one character.** Some alternations are safe in fact because their
   words cannot split one text two ways, and they are refused anyway: `+(ts|tsx)`,
   `+(src|source)`, `*(a|ab)`, `+(foo|foobar)`. So is `+([ab])`, which picomatch compiles to
   `(?:\[ab\]|[ab])+` so that a name spelled `[ab]` also matches. A finer check exists (a finite
   set of words that is a uniquely decodable code backtracks linearly), but containment should be
   checkable by eye. `src/*.{ts,tsx}` and `+([a-z])` say what those mean.
5. **Literalisation is read from the parse, not guessed from the regex.** Comparing the compiled
   regex with and without the safeguard (`maxExtglobRecursion: false`) cannot tell a rewrite from
   a literal. Counting escaped `+(` in the regex misses a literal that holds an escaped one. The
   parse token is exact, so `+(*(a)|*(b))` passes.
6. **A glob picomatch cannot compile is refused**, including the empty string in a draft's
   surface. picomatch throws on it, a ticket already refused it, and a draft that held one could
   not be written.
7. **Segments are judged, the directory form is not** (above).
8. **`plan_docs` is checked too.** It reaches only document discovery, but it is the same `glob`
   type, read the same way, and a repository directory named to fail it would stall `init`.
9. **A ticket already on disk that holds such a glob is refused when read**, naming the ticket, as
   any invalid ticket is (F-3′). No plan on record holds one, and a ticket the guard cannot honour
   should stop the run loudly rather than stall it later.
10. **The guard checks every policy, including those built from checked sources.** On the headless
    driver that is a second check of what was checked at read; the cost is one compile per glob
    per process, memoised. On the plugin hook it is the only check a planted policy file gets.

## Falsification (verification protocol, item 1)

`tests/sec/glob-hazards.test.ts` was written before the fix, through entry points that exist at
HEAD. It was run against HEAD `2e05308`, with 4.0.5 installed and in the committed bundle
(`PRDR-330` trimmed from each name):

    × the config refuses such a glob when it loads (SEC-3″) > a `protected` glob that repeats a group over more than one character, naming the glob 6ms
      → expected '' to contain 'protected'
    × the config refuses such a glob when it loads (SEC-3″) > a `risk` glob picomatch reads as its own spelling 2ms
      → expected '' to contain 'risk'
    × the config refuses such a glob when it loads (SEC-3″) > a `plan_docs` glob whose `+` is a regex quantifier, which no extglob option turns off 1ms
      → expected '' to contain 'plan_docs'
    × the config refuses such a glob when it loads (SEC-3″) > a `protected` glob picomatch cannot compile, which it would match against nothing 3ms
      → expected '' to contain 'matches nothing'
    ✓ the config refuses such a glob when it loads (SEC-3″) > loads the safeguard's meaning-preserving rewrite, the ordinary extglobs and the protected floor 1ms
    × the config refuses such a glob when it loads (SEC-3″) > `run` refuses to start on it, and says why 52ms
      → expected 'no approved plan — `run` executes onl…' to match /config rejected/u
    × a plan's globs are refused where they are read (SEC-3″) > a ticket whose surface holds one is refused when read, naming the ticket 4ms
      → expected [Function] to throw an error
    × a plan's globs are refused where they are read (SEC-3″) > a plan draft whose ticket's surface holds one is invalid, and says which 2ms
      → expected [Function] to throw an error
    × a plan's globs are refused where they are read (SEC-3″) > a cached redraft that holds one is a miss, not a plan 3ms
      → expected [ { key: 'k', slice: 's01', …(3) } ] to deeply equal []
    × the decision the SDK backend registers does not match such a glob > a write under a `src/+(*)` surface is refused within a second, for a run of twenty-six `a`s 7036ms
      → expected 'allow' to be 'deny' // Object.is equality
    × the decision the SDK backend registers does not match such a glob > a protected `src/+(*)` is refused before it is matched: the write is decided within a second 7020ms
      → expected 'DENY: src/aaaaaaaaaaaaaaaaaaaaaaaaaa/…' to contain 'SEC-3″'
    × the decision the SDK backend registers does not match such a glob > a protected `+(a|aa)` does not shrink to its own spelling: a write to `a` is refused 1ms
      → expected 'allow' to be 'deny' // Object.is equality
    × the decision the SDK backend registers does not match such a glob > a protected glob picomatch cannot compile does not protect nothing: a write to `a` is refused 0ms
      → expected 'allow' to be 'deny' // Object.is equality
    × the decision the SDK backend registers does not match such a glob > a Glob call whose pattern repeats a group is refused within a second where it is matched against the way to an unreadable directory (C-4⁵) 3722ms
      → expected 'abstain' to be 'deny' // Object.is equality
    ✓ the decision the SDK backend registers does not match such a glob > the safeguard's rewrite, `+(*(a)|*(b))`, still protects what its second branch names 0ms
    ✓ the decision the SDK backend registers does not match such a glob > ordinary globs are matched as before: `@(src|lib)/**` grants `lib/x.ts`, and a protected `+([a-z])` protects it 1ms
    × the bundled hook does not match such a glob > a write under a `src/+(*)` surface is refused before the kill, for a run of thirty `a`s 15005ms
      → the hook was still matching after 15000 ms: expected Error: spawnSync /Users/workstation/.nvm/… { …(5) } to be undefined
    × the bundled hook does not match such a glob > a protected `+(a|aa)` does not shrink to its own spelling: a write to `a` is refused 33ms
      → expected '' to contain 'its own spelling'
          Tests  15 failed | 3 passed (18)

The three that pass guard what must not change. The rewrite still protects its second branch;
ordinary globs are matched as before, and `+([a-z])` still protects; the config loads the ordinary
extglobs and the protected floor. Every other entry point fails.

At HEAD the guard took 7.0 s to allow the `+(*)` write, and 3.7 s to abstain on the Glob call. It
denied the protected `src/+(*)` write, but only after matching it for 7.0 s, and as "is
protected". The unfixed bundle was still matching at the fifteen-second kill. The protected
`+(a|aa)` and the uncompilable protected glob let a write to `a` through, silently.

The first run had seventeen tests. The protected `src/+(*)` test was added for the battery's
mutant C3, and all eighteen were run against HEAD again in a throwaway worktree: the output
above. PRDR-329's bundle test for `+(+(a))` now expects the SEC-3″ refusal. At HEAD it said
"outside this ticket's declared surface", because 4.0.5 reads the glob as its own spelling and
the path matched nothing. `tests/schemas/glob-hazard.test.ts` imports the new module, so it
pins the rule shape by shape and cannot run at HEAD.

## Mutation battery

Twenty-two mutants were run, one at a time, by a script. Before the first, the script copied the
six files into a snapshot; after each run it copied them back from the snapshot, not from git, so
the uncommitted fix could not be reverted to HEAD. After the last run it compared all six with
the snapshot by sha256 and found no difference. Source mutants ran against
`tests/schemas/glob-hazard.test.ts`, `tests/sec/glob-hazards.test.ts` and
`tests/sec/glob-advisories.test.ts`. Bundle mutants edit `hooks/dist/detent-hook.cjs` itself, and
ran against the two `tests/sec` files and `tests/plugin/hook.test.ts`.

| # | Mutant | Killed by |
|---|---|---|
| A1 | the compile check swallows errors again (no `debug`) | 3: the backslash case, the config's uncompilable `protected`, the guard's write to `a` |
| A2 | the literal check is off | 10: every literalised shape, the config's `risk`, the cached redraft, the guard's `+(a\|aa)` |
| A3 | the literal check flags every extglob text token, so the rewrite too | 4: the `+(*(a)\|*(b))` and `+(*(a))` rewrites, in the rule, the config and both guard tests (PRDR-329's among them) |
| A4 | the repeated-group check is off | 23: every repeated shape, the segment form, every config and plan entry point, the three timed in-process tests |
| A5 | an alternation counts as its branches' width | 1: the reader's alternation case, an empty branch included |
| A6 | a lookaround's contents are not read | 2: `!(+(a\|b\|ab))`, and the reader's lookaround case |
| A7 | a lookaround counts as one character | 9: the globstar step, every declared glob, the ordinary globs on both sides, PRDR-329's `[[:constructor:]]` |
| A8 | `?` counts as repeating | 5: the ordinary extglobs, every declared glob, the reader's bounded counts, the guard's ordinary globs |
| A9 | a fixed count above one does not repeat | 1: the reader's `{3}` |
| A10 | a nested group's hazard is dropped | 25: every repeated shape, which all nest inside picomatch's outer group |
| A11 | segments are not judged | 1: `[+(a\|b\|ab)/]` |
| A12 | a class's escapes are not skipped | 1: the reader's class that holds `\]` |
| B1 | `glob` loses the check | 6: the config's four fields, `run`, the ticket read |
| B2 | a draft's surface loses the check | 1: the invalid draft |
| B3 | a cached ticket's surface loses the check | 1: the cached redraft |
| C1 | the guard's policy check is off | 4: the `src/+(*)` surface, the protected `src/+(*)`, `+(a\|aa)` and the uncompilable glob |
| C2 | the guard checks the protected globs only | 1: the `src/+(*)` surface, timed |
| C3 | the guard checks its policy only after the protected match | 1: the protected `src/+(*)`, timed |
| C4 | the guard's Glob-pattern check is off | 1: the unreadable Glob call, timed |
| D1 | bundle: the policy check is off | 4: the bundle's `src/+(*)` (killed at fifteen seconds) and `+(a\|aa)`, PRDR-329's `+(+(a))`, staleness |
| D2 | bundle: the literal check is off | 3: the bundle's `+(a\|aa)`, PRDR-329's `+(+(a))`, staleness |
| D3 | bundle: the repeated-group check is off | 2: the bundle's `src/+(*)`, staleness |

All twenty-two were killed. A bundle mutant always fails the staleness test (T-113), so each D
mutant was also checked for a behavioural kill, and each has one. C3 is why the protected
`src/+(*)` test exists. The first seventeen tests did not kill C3, because a policy checked after
the protected match still denies: the test times the deny and requires SEC-3″ in its reason.

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: 217 files, 2,430 passed and 2 skipped (2,432), on PRDR-326 (`2e05308`).
- `npm run plugin`: after the render above, it wrote nothing that changed, and T-113's staleness
  test passes.
- After the gates, this ticket's text was corrected in three places: the non-goal on `+(ts|tsx)`
  said the opposite of vetoable call 4, and the non-goal and the call on `noextglob` now say what
  4.0.5 measurably does. `tickets:check` and `tests/docs/tickets-check.test.ts` were run again
  on the corrected ticket, and pass.

## What changed

- `src/schemas/glob-hazard.ts` (new): `globHazard`, memoised for each glob, judges the glob and
  each of its segments. It compiles each form with `debug`, reads `parse`'s tokens for a
  literalised extglob, and walks the compiled regex for a repeated group that is not one
  character (`repeatedGroup`, exported for its tests). It imports picomatch and nothing else, so
  it can go in the hook bundle, and `schemas/**` may be imported from every zone (ARCH-1).
- `src/schemas/common.ts`: `glob` gains the check as a zod refinement, which the config's
  `protected`, `risk` and `plan_docs`, and a ticket's `surface` and `granted`, all use.
  `draftGlob` is the same check on a string that may be empty, for drafts.
- `src/schemas/init.ts`: `planDraftSchema`'s ticket `surface` is `draftGlob[]`.
- `src/init/plan-cache.ts`: `cachedTicketSchema`'s `surface` is `draftGlob[]`.
- `src/sessions/guard.ts`: `policyHazard` and `searchHazard`. The Glob-pattern check comes just
  before `unreadableReached`. The policy check comes after the non-mutating abstain and before
  the first glob is matched, so the protected match is never reached with such a glob.
- `hooks/dist/detent-hook.cjs`: rendered by `npm run plugin`, 163 lines in and 43 out. All 43
  are esbuild's renames on a name collision: `escaped` to `escaped2`, `picomatch2` to
  `picomatch3`, `import_picomatch` to `import_picomatch2`. With the renames undone, every line out
  appears in the new render. The other 120 lines are the new module and the guard's two checks.
  `agents/*.md` did not change.
- `tests/sec/glob-hazards.test.ts` (new): the eighteen entry-point cases above.
- `tests/schemas/glob-hazard.test.ts` (new): thirty-five cases on the rule, shape by shape, and on
  the regex reader. It is the first test of `src/schemas` in its own mirrored directory, as
  `tests/init` is for `src/init`.
- `tests/sec/glob-advisories.test.ts`: PRDR-329's bundle case for `+(+(a))` now expects the
  SEC-3″ refusal, and the `NESTED` doc-block says why. The old expectation, "outside this ticket's
  declared surface", was 4.0.5 reading the glob as its own spelling. On 4.0.3 the glob compiles
  to `(?:(?:a)+)+`, a repeated group that is not one character, and that was checked against the
  published 4.0.3 package.
- `detent-prd-v3.md`: the SEC-3″ mark, after SEC-3′.

## Recorded, not fixed

- **The polynomial class.** Runs of `*` or `**` separated by text they can also match are
  polynomial, of a degree that grows with the run. On 4.0.5 in plain `node`:

  | Glob | Path | Time |
  |---|---|---|
  | `*a*a*b` | `a`×4096 | 7.0 s |
  | `*a*a*a*b` | `a`×255 | 586 ms |
  | `*a*a*a*b` | `a`×512 | 9.3 s |
  | `**/a/**/a/**/b` | `a/`×2048 | 3.9 s |
  | `**/a/**/a/**/a/**/b` | `a/`×512 | 8.0 s |
  | `*a*/*a*/*a*/*a*/*a*/b` | five segments of 50 `a`s, then `c` (256 chars) | killed at 10 s |

  The globs in real use are not in this class. `**/node_modules/**`, `.detent/tickets/**`,
  `**/*secret*/**`, `src/**/*.test.ts` and `**/*.test.*` each took at most 5.4 ms on crafted
  paths of up to 19,200 characters. Closing the class needs a fix of another kind: a bound on how
  many wildcards may slide over the same text, matching segment by segment with memoisation, or a
  decision the hook makes under a deadline in a worker thread. Each changes behaviour beyond this
  ticket, and it needs a ticket of its own.
- **Upstream.** Four things are not reported to micromatch/picomatch, and whether to report them
  is the user's decision:
  - `+(*)` backtracks exponentially;
  - `+(a|b|ab)` backtracks exponentially;
  - `(a|b|ab)+` backtracks exponentially;
  - a literalised extglob that holds a backslash escape compiles to `/$^/`.

  4.0.7, unpacked from npm's cache, compiles all four to the same regex as 4.0.5, and throws the
  same error under `debug`.
- **A session's own Glob and Grep patterns** reach no picomatch in Detent except the unreadable
  check above. The runtime matches them against the filesystem itself.
