---
id: PRDR-257
title: "The masker behind `rules:check` has no concept of a regex literal or a template substitution, so it blanks executable code and lets comment text survive"
state: DONE
severity: major
category: bug
labels: ["prd-review", "found-by-audit", "doc-claim-drift", "checker", "V-6"]
surface: ["scripts/check-rules.ts", "tests/docs/rules-check.test.ts"]
prd_refs: ["V-6", "N-6"]
acceptance_criteria: ["A quote or backtick inside a regex literal does not desynchronise the scanner: `src/init/allowlist.ts` and `src/sessions/git-rm.ts` mask correctly.", "Executable code inside a template substitution `${…}` is NOT blanked — it is code, and a rule matching on masked text must be able to see it.", "Comment blanking is total: across `src/`, `tests/` and `scripts/` no line that is entirely a comment survives `codeOnly`, measured rather than asserted.", "`withoutStringLiterals` keeps its contract — string and template literal CONTENTS blanked, comments untouched — and the rules gate reports exactly what it reported before.", "The masker has unit tests, which it has never had: `codeOnly` is exercised by two oracles today and by no test of its own.", "Each of the four consumers is exercised after the change: `npm run rules:check`, `tests/docs/rules-check.test.ts`, `tests/oracle/budgets.test.ts`, `tests/oracle/pin-parity.test.ts`.", "The doc-block explaining why the scanner is hand-written is replaced by one that is true of what is there."]
non_goals: ["Does NOT change any rule in `violationsIn`. The masker is the surface; which rules read masked text and which read raw is PRDR-258's question.", "Does NOT add a third masking mode. The fourth combination — comments blanked, strings kept — was designed for PRDR-256 and then measured unsound on this very scanner; PRDR-256 shipped with no mask at all instead.", "Does NOT fix the 25 checks that scan raw source where they mean to scan code. That is PRDR-258; this ticket makes the tool they would reach for correct first.", "Does not make `rules:check` catch anything new. Measured: with the correct masker the gate reports exactly the same clean result, so this is a repair of the instrument and not a change to the standard."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-172", "PRDR-179", "PRDR-256", "PRDR-258"]
depends_on: []
---

# PRDR-257 — the scanner that decides what counts as code does not know what code is

## Problem

`scripts/check-rules.ts:79` is a hand-written scanner shared by the `rules:check` gate and by
three tests. It tracks comments and string literals. It has no concept of **a regex literal**,
so the first quote or backtick inside one opens string mode and the scanner runs on until it
finds a partner — which may be hundreds of lines away, in a doc-block.

```
src/init/allowlist.ts:63    const SHELL_METACHARACTERS = /[;&|`$(){}<>\n\\]/;
src/sessions/git-rm.ts:37   const GIT_RM_COMMAND = /(^|[;&|({`\r\n])\s*git\s+rm(\s|$)/;
```

Both directions of harm follow, and both were measured with the repository's own exported
`codeOnly`:

**Code is blanked.** `src/init/allowlist.ts` lines 65-69 — the whole of `AllowlistDecision` —
come back as pure whitespace. Any rule that matches on masked text is blind there. The region
runs to line 73, where the scanner resynchronises on the next backtick.

**Comment text survives.** The tail of `src/init/allowlist.ts:73` comes back as `` `false` ``
from the raw line *"D-15: the only question this answers is ... A `false` is not a prompt to
try harder"* — the detector vocabulary of another check, standing un-blanked in a file the
scanner was asked to strip. `src/sessions/git-rm.ts:46` leaves `` `git rm` `` and `` `null` ``.

There is a second, larger defect in the same function. A template substitution `${expr}` is
**executable code**, and the scanner blanks it along with the surrounding literal. Against a
parser-derived ground truth, `codeOnly` blanks 32,347 characters of executable text across 188
of 261 files. `src/adapter/discover/just.ts` loses exactly nine: `${target}`.

The doc-block above the scanner explains at length why it is hand-written rather than a regex —
a measured decision about backtracking, and still correct. What it does not say is that the
thing it hand-wrote is not a lexer, and the two constructs it omits are the two that carry
quotes.

## Why this outranks its blast radius

The scanner is the tool every future claim-check in this repository will reach for. PRDR-256
went looking for a mask, found that no combination of the two existing modes worked, designed a
third, had it measured unsound **because of this defect**, and shipped with no mask at all.
PRDR-258 indexes 25 more checks that match raw source where they mean to match code; the fix
for each of them is this function. A broken shared instrument does not stay a local bug.

## Design

Replace the hand-written scanner with the TypeScript compiler's own parse. `typescript` is
already a dependency of this repository and `scripts/` sits in no ARCH-1 zone. Literal spans
come from the AST — `StringLiteral`, `NoSubstitutionTemplateLiteral`, and the three template
fragment kinds, so `${…}` falls outside every span by construction. Comments come from
`getLeadingCommentRanges`/`getTrailingCommentRanges` over **every token**, not every node: a
comment before a closing brace is leading trivia of the brace, which is a token and not a node,
and a node-only walk leaves 68 comment lines standing.

Lengths and newlines are preserved exactly as before, so reported line numbers stay true.

## Falsification (verification protocol, item 1)

The masker's first unit tests, run against HEAD's hand-written scanner:

```
× a quote inside a regex literal does not open a string
  → the scanner ran past the regex and blanked live code:
    expected 'const SHELL = /[;&|`        \n       …' to contain 'export const kept = 1;'

× code inside a template substitution is code
  → `${…}` is executable text, not string content:
    expected 'const s = `                          …' to contain 'console.log(x)'

× comment blanking is total across the repository, not merely usual
  → prose survived the strip, so it can answer for code:
    src/init/allowlist.ts:73, src/sessions/git-rm.ts:46

Tests  3 failed | 13 passed (16)
```

The received values are the scanner's own output and each shows the defect directly: the
regex body blanked and everything after it consumed; the substitution blanked along with the
literal; and the two files where the scanner resynchronised inside a doc-block.

## Mutation battery (verification protocol, item 2)

| mutation | result | what it said |
|---|---|---|
| none | PASS | 16 passed |
| walk nodes instead of tokens for comment trivia | **FAIL** | 68 comment lines standing, from `adapter/approvals.ts:84` on |
| drop template-fragment handling, treat a template as opaque | **FAIL** | `expected 'const s = \`just ${console.log(x)}…' not to contain 'just'` |
| restore HEAD's hand-written scanner | **FAIL ×3** | the three falsifying assertions above, verbatim |

The second is the one worth recording: without the fragment kinds a template is either wholly
blanked or wholly kept, and the "kept" half means a literal stops being data — so the fix is
not "blank less", it is "blank the right spans".

## What changed

`mask` is now the TypeScript parse. Literal spans come from the AST — `StringLiteral`,
`NoSubstitutionTemplateLiteral`, `TemplateHead`, `TemplateMiddle`, `TemplateTail — so a `${…}`
substitution falls outside every span by construction rather than by a rule about braces.
Comments come from `getLeadingCommentRanges` and `getTrailingCommentRanges` over every TOKEN:
a comment before a closing brace is leading trivia of the brace, which is a token and not a
node, and the node-only walk this was first written with left 68 of them standing — measured,
not guessed, which is why the totality assertion runs over the real tree rather than a fixture.

Measured after: zero comment lines survive `codeOnly` across all 261 files of `src/`, `tests/`
and `scripts/`, against two at HEAD.

## What did NOT change, and that is the point

`npm run rules:check` reports the same clean result it reported before, in 1.2s against 0.9s.
No rule was touched and no violation appeared or disappeared, so nothing in the tree was being
held up by the defect — the instrument was repaired, not the standard. The three test consumers
(`tests/docs/rules-check.test.ts`, `tests/oracle/budgets.test.ts`, `tests/oracle/pin-parity.test.ts`)
pass unchanged.

## A correction to this ticket's own first measurement

The first attempt to size the defect built a reference masker on `ts.createScanner` and
reported 183 of 261 files disagreeing, 392,332 characters of comment leaking. That number was
wrong and is recorded here because it is the same mistake the ticket is about. A raw scanner
cannot lex a template with a substitution — the tail needs `reScanTemplateToken`, which only a
parser drives — so the reference desynchronised on `${…}` exactly as the thing it was
measuring did. The figures in this ticket come from `ts.createSourceFile` instead.
