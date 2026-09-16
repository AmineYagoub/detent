---
id: PRDR-256
title: "C-5's lint half searches raw source for the word `readline`, so prose can fail it and the three modules that actually raise a TTY prompt cannot"
state: DONE
severity: major
category: gap
labels: ["prd-review", "found-by-audit", "doc-claim-drift", "C-5", "V-6", "checker"]
surface: ["tests/docs/golden-path.test.ts", "src/schemas/init.ts"]
prd_refs: ["C-5", "C-7", "C-10", "C-14", "V-6", "N-6", "X-8"]
acceptance_criteria: ["The check matches constructs, not a package name: a module that hands a `makeTty*` asker to something that will call it is detected, even though it contains no `readline`.", "`src/cli/run.ts` and `src/cli/init.ts` are DECLARED prompt sites rather than invisible ones — the state the check reports must name them.", "The sanctioned set is two tiers — OPENS a transport, WIRES an asker — and each entry carries the constructs it is exempt for, so an exemption cannot outlive the thing it exempts.", "Totality in both directions, derived from the tree at assert time: a declared path that no longer exists fails; a declared construct no longer present fails; an undeclared module matching either tier fails; and a WIRES module that starts OPENING one fails.", "No mask is used, and the false-positive rate is MEASURED rather than assumed: every pattern requires a `(`, and across the repo's prose corpus the patterns fire zero times (V-6).", "The `prompt(` half is DELETED — it has never matched code in any commit and it matches this check's own doc-block, which is precisely what V-6 forbids from failing a ticket.", "Every clause of the check's doc-block is true afterwards, including the count of how many of its declared sites present a C-5 interrupt.", "A test drives the new predicate against `src/cli/run.ts` and fails on today's tree for a reason no allowlist edit can satisfy."]
non_goals: ["Does NOT resist an adversary. Alias imports, a prompting package other than `node:readline`, a child process inheriting fd 0, and `for await (const chunk of process.stdin)` all evade text matching over one file — measured, 17 of 18 hand-written evasions slip. The threat model here is DRIFT, which is what opened this gap: PRDR-255 wired an asker into a module nothing was watching. The adversarial version is an AST rule and is filed as PRDR-259.", "Does NOT move the check into `eslint.config.js`. A prototyped AST rule fires on `process.stdin.isTTY` — the expression that PREVENTS a prompt off a TTY — and on the piped hook payload in `src/plugin/hook-entry.ts`. Shipping it without a measured false-positive rate and a third READS-PIPE tier is what V-6 forbids, and `eslint.config.js` has four other consumers and owns the ARCH-1 zones (N-6).", "Does NOT use `codeOnly` or any mask. Measured: raw and `codeOnly` return the identical file set for every pattern here, so the mask buys nothing, and it costs three blind channels — see PRDR-257.", "Does NOT fix `mask()`. That is PRDR-257: a different surface with four consumers including the shipped `rules:check` gate.", "Does not detect a prompt raised from `prompts/`, `skills/`, `hooks/` or `scripts/`. `walkTs` starts at `src/`; all four trees were grepped and hold no prompt today, so the gap hides no live instance — and unlike this ticket, the doc-block says so."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-150", "PRDR-172", "PRDR-179", "PRDR-255", "PRDR-257", "PRDR-258", "PRDR-259"]
depends_on: []
---

# PRDR-256 — a lint that names a package cannot see a module that calls a helper

## Problem

`tests/docs/golden-path.test.ts:79-96` is C-5's lint half. It walks every `.ts` under `src/`,
skips three sanctioned paths, and fails on

```ts
if (/readline|\bprompt\s*\(/.test(body)) offenders.push(rel);
```

under the doc-block *"a `readline` anywhere else would be a sixth interrupt class in disguise."*

Three call sites in this tree put a question in front of a human at a terminal:

```
src/cli/run.ts:138    makeTtyEscalation(process.env["USER"] ?? "operator")
src/cli/run.ts:158    makeTtyApproval(process.env["USER"] ?? "operator")
src/cli/init.ts:265   makeTtyApproval(process.env["USER"] ?? "operator")
```

Neither module is sanctioned. Neither contains the string `readline` or `prompt(` — grep count
zero, both files. **The check reports an empty offender list.** Its title — *"no module raises a
prompt outside the closed set"* — is false on HEAD, and it has been false since the escalation
was wired; PRDR-255 made it more false last commit by wiring the approval asker into `run`,
which is a module nothing was watching.

The detector names the PACKAGE. The modules that prompt call a HELPER. So the check is green
in exactly the case it exists to refuse.

## The half that was noticed first

The same regex runs over the RAW body, comments included, so prose answers for code. This is
how the defect surfaced: a doc-block added in PRDR-255 to `src/cli/run.ts` explained why the
approval asker is injectable, used the word `readline`, and failed the whole suite from a
module that raises nothing. It was worked around by rewording the comment.

That direction is real but it is the smaller half, and it is **not reproducible from the
committed tree** — `git log -S'readline' -- src/cli/run.ts` returns nothing, so the token has
never been committed there. HEAD passes this check. Any falsification of the shape "the check
reports no offenders" therefore measures nothing: it is constant-true across the fix.

The `prompt(` half is worse than useless. It has never matched code in any of the 306 commits,
and it matches ordinary prose — including `tests/docs/golden-path.test.ts:83`, the check's own
doc-block, which reads *"the init CLI's inline AWAIT_APPROVAL prompt (C-7)"*. It is out of
range only because the walk starts at `src/`. V-6 (PRDR-150): a check whose false-positive rate
has not been measured must not be able to fail a ticket.

## Design

**Name the act, not the package, and match the raw body.** Every pattern requires a `(`, and
this repository writes identifiers in prose inside backticks without one — which is the
discrimination the mask was hired for and does not do. Measured: raw and `codeOnly` return the
identical file set for every pattern, so the mask buys nothing here while costing three blind
channels (PRDR-257).

```
OPENS a transport   import … from "node:readline[/promises]"   createInterface(   .question(
WIRES an asker      (?<!\bfunction\s)\bmakeTty[A-Z][A-Za-z]*\(
```

The lookbehind is what makes a declaration not a call: without it
`export function makeTtyApproval(` matches, and the sanctioned set fails on arrival. The
`makeTty*` generalisation means a third factory is caught at its definition and at its
consumer with no edit to the pattern.

**Two tiers, each entry carrying the constructs it is exempt for.** A module may hand a
sanctioned asker to something that will call it without opening a transport of its own; opening
one is what would be a sixth interrupt class. `cli/run.ts` and `cli/init.ts` become DECLARED
rather than invisible, which is the repair. Recording the constructs rather than a boolean is
what makes a stale exemption fail rather than rot.

**Totality in both directions**, on the `ENFORCEMENT_SITES` recipe: every declared path exists,
every declared construct is still present, no undeclared module matches either tier, and a
WIRES module that starts opening a transport is undeclared *in OPENS* and fails.

## What this deliberately leaves broken

Text matching over one file cannot see an aliased import, a prompting package other than
`node:readline`, a child process inheriting fd 0, or `for await (const chunk of process.stdin)`
— and that last idiom already ships at `src/plugin/hook-entry.ts:12`, so it is the shape a
contributor would copy. Seventeen of eighteen hand-written evasions slip through. This holds a
declared inventory honest against drift; it does not resist someone trying to evade it, and the
doc-block says so rather than leaving it to be discovered. PRDR-259 is the adversarial version.

## Falsification (verification protocol, item 1)

The new assertions against HEAD's predicate — the construct detector expressed through the new
interface as `/readline|\bprompt\s*\(/`, so the tests fail on what the predicate cannot see
rather than on a compile error (`npx tsc --noEmit` clean at this point):

```
× sees a prompt wired from a module that never names `readline`
  → `cli/run.ts` hands makeTtyEscalation and makeTtyApproval to the kernel and contains no
    `readline`, so the predicate this replaces returned false for it — the check reported no
    offenders while two of the three live TTY prompts were raised from a module it had never
    heard of: expected [] to deeply equal [ 'makeTtyEscalation', …(1) ]

× every declared site exists, and still does what it is exempt for
  → WIRES exempts cli/init.ts for makeTtyApproval, which it no longer contains: expected []
    to include 'makeTtyApproval'

× no undeclared module wires a TTY asker
  → expected [ …(3) ] to deeply equal []

Tests  3 failed | 14 passed (17)
```

The first cannot be satisfied by widening any allowlist, which is what makes it the honest
falsification: HEAD's predicate returns `[]` for the file, and no exemption changes that. The
third fails in the opposite direction — HEAD's predicate is so coarse that the three OPENS
modules all read as wirers — which is the same defect seen from the other side.

"The fixed check reports no offenders" is deliberately NOT offered as evidence anywhere in this
ticket. It is constant-true across the change: HEAD passes too. That is the whole problem.

## Mutation battery (verification protocol, item 2)

Every guard was removed or crossed in turn, against the fixed check:

| mutation | result | what it said |
|---|---|---|
| none | PASS | 17 passed |
| delete `run.ts`'s `makeTtyApproval` wiring | **FAIL ×2** | `WIRES exempts cli/run.ts for makeTtyApproval, which it no longer contains` |
| append a `createInterface({…})` to `run.ts` (tier crossing) | **FAIL** | `cli/run.ts opens a prompt transport (createInterface()` |
| a new `kernel/ask.ts` opening a transport | **FAIL** | `kernel/ask.ts opens a prompt transport (node:readline, createInterface(, .question()` |
| a new module calling `makeTtyApproval` | **FAIL** | `kernel/sneak.ts wires a TTY asker (makeTtyApproval)` |
| rename `cli/verify.ts` away | **FAIL ×2** | `OPENS declares cli/verify.ts, which is not a module in src/` |
| **PRDR-255's prose verbatim in an unsanctioned module** | **PASS** | the motivating false positive, green |

The last row is the point of the first half of this ticket: a doc-block naming both `readline`
and `prompt (` in a module that raises nothing no longer fails the suite.

## What changed

`tests/docs/golden-path.test.ts` — the check leaves `describe("T-069 C-5: the interrupt set is
frozen at five")`, because two of its three sanctioned modules present decisions that are not
members of `INTERRUPTS`, so the C-5 title was false about its own contents. It becomes
`describe("PRDR-256: every module that can block on a human is declared")`, holding two tiers
keyed by path, each entry carrying the constructs it is exempt for and the reason. Four
assertions derive their key set from the tree at assert time. `walkAny` was added so the walk's
own narrowing to `.ts` is checked rather than assumed — `src/` is 125 files and all of them are
`.ts`, and a `.mts` would be invisible to this walk, to eslint's `src/**/*.ts`, to tsconfig's
include and to `scripts/check-rules.ts` at once.

`src/schemas/init.ts` — the C-5 doc-block named `tests/init/interrupts.test.ts` as "the second
enforcement, scanning for any prompt raised outside this set". That file has never existed: the
string occurs exactly once in the tree, in that sentence. It now names the check that does
exist and states the weaker thing that check actually proves.

Two assertion messages were given the offender list. Without it the failure read
`expected [ Array(1) ] to deeply equal []`, naming neither the module nor the construct — a
check that fires without saying why, which is this branch's subject in miniature.
