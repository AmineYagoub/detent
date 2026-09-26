---
id: PRDR-287
title: "`detent-prd-v3.md` defines eight requirement marks twice each, for two different rules — C-3″, C-9′, F-1′, P6′, S-3′, S-5′, V-1⁵ and X-1‴ — so each of those marks names two rules, and a reader following any of the 148 citations of them outside the PRD cannot tell which rule is meant. The earlier-dated definition keeps its mark and the later one takes its family's next free mark; every citation is re-pointed by what it means, and a test now fails on a mark defined twice"
state: DONE
severity: major
category: consistency
labels: ["prd-review", "found-by-audit", "specification-phase", "traceability", "N-6"]
surface: ["detent-prd-v3.md", "docs/implementation-plan-v3.md", "src/adapter/symbols.ts", "src/cli/init.ts", "src/cli/referee.ts", "src/init/bind.ts", "src/init/machine.ts", "src/init/pipeline.ts", "src/init/plan.ts", "src/init/plan-write.ts", "src/init/present.ts", "src/init/questions.ts", "src/init/slice.ts", "src/kernel/ledger.ts", "src/kernel/referee-context.ts", "src/kernel/referee-session.ts", "src/kernel/run-lock.ts", "src/kernel/run.ts", "src/kernel/worstcase.ts", "src/sessions/backend.ts", "src/sessions/sdk.ts", "tests/cli/init.test.ts", "tests/init/open-questions.test.ts", "tests/kernel/ledger.test.ts", "tests/kernel/run-fixture.ts", "tests/kernel/run.test.ts", "tests/referee/registry.test.ts", "tests/sessions/symbols.test.ts", "tests/docs/prd-requirement-ids.test.ts", "tickets/prd-review/**"]
prd_refs: ["N-6", "C-3″", "C-3‴", "C-9′", "C-9″", "C-9‴", "C-12′", "F-1′", "F-1‴", "P6′", "P6″", "S-3′", "S-3⁸", "S-5′", "S-5⁗", "V-1⁵", "V-1⁶", "X-1‴", "X-1⁷", "PRDR-065", "PRDR-078", "PRDR-079"]
acceptance_criteria: ["Each of the eight marks names one rule. The definition introduced first, by the date of the commit that wrote its text, keeps the mark; the later one takes its family's next free mark, which appears nowhere in the tree before this ticket: C-3″ PRDR-207 → C-3‴, C-9′ PRDR-139 → C-9‴, F-1′ PRDR-118 → F-1‴, P6′ PRDR-142 → P6″, S-3′ PRDR-121 → S-3⁸, S-5′ PRDR-141 → S-5⁗, V-1⁵ PRDR-232 → V-1⁶, X-1‴ PRDR-136/PRDR-147 → X-1⁷.", "The PRD carries a dated amendment note (2026-09-26) naming every move and why, and each moved definition says in its own parenthetical which mark it had.", "Every citation of the eight old marks in src/, tests/, scripts/, prompts/ and docs/ names the rule it means, decided one citation at a time from what the text describes, the date its line was written and any ticket it names — never by replacement. A citation that meant the rule keeping its mark is unchanged.", "In tickets/, a ticket's own words follow the rename — title, frontmatter lists and prose — and a quotation of the document, the code or a tool's output as it stood is left as it stood (N-6).", "A test fails when the PRD defines any mark twice, and when a moved rule is not found under its new mark with its own ticket. It is observed to FAIL against `cddacca` first, and every mutant that re-duplicates a mark or moves the wrong half of a pair is killed.", "No file under prompts/ changes, so no prompt hash moves; the slice cache keys hash the prompt file, not the rendered instruction, so no checkpoint or cache is invalidated. Every changed string a session or an operator reads is named in this ticket."]
non_goals: ["Does NOT resolve the overlap of §4's range restatement `C-9′…C-13′` (PRDR-065) with PRDR-079's C-9′ and PRDR-078's C-12′. Applying this ticket's rule there would move PRDR-079 as well, which the pairing this ticket fixes keeps. Whether a range restatement defines its members is the owner's decision; the test pins both overlaps exactly (Recorded, not fixed). The owner applied the rule to the range: PRDR-288 moved PRDR-079 to C-9⁗ and PRDR-078 to C-12⁗.", "Does NOT change any behaviour. Only marks change, including in six places where an operator or a planner session reads them.", "Does NOT edit commit messages, which are history, or `detent-prd-v2.md`, which is frozen; the dated note maps their old marks.", "Does NOT edit `docs/plan-specification-phase.md`, PRDR-278 or PRDR-280, which live on `feat/specification-phase` and say five ids (Recorded, not fixed).", "Does NOT check `detent-prd-v2.md` against v3. v3 inherits v2's sections unchanged, and the one mark both documents define, ARCH-1, v3 restates as the same rule.", "Does NOT check citations mechanically. Which rule a citation means is a reading; the heuristic measured for it is rejected under Design."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-278", "PRDR-280", "PRDR-165", "PRDR-056", "PRDR-079", "PRDR-078", "PRDR-288"]
depends_on: []
---

# PRDR-287 — one mark, one rule

**Severity:** major · **Category:** consistency · **Found by:** checking the specification-phase
design against the PRD (`docs/plan-specification-phase.md` §5, on `feat/specification-phase` at
`fc4360a`) · **Amends:** C-3″, C-9′, F-1′, P6′, S-3′, S-5′, V-1⁵, X-1‴, under N-6

## Problem

A requirement mark is how everything else in this repository points at a rule. Doc-blocks cite
the requirement that demands them (AGENTS.md), audit tests quote marks, tickets file under them,
and a planner session is told which rule to record against. A mark that names two rules breaks all
of that at once, and nothing notices: every citation still resolves to *a* definition, just not
necessarily the one its author meant. `X-1‴` in `src/kernel/ledger.ts` meant "the run ceiling is
enforced against the FILE"; a reader who searched the PRD for `X-1‴` met "`review_fix_attempts` is
read by the machine" three hundred lines earlier.

The specification-phase plan found five such marks while designing a pack checker whose first rule
is that every id is defined exactly once, and PRDR-278 deferred renumbering them to an amendment of
their own. This is that amendment. A mechanical census of every bold definition in the PRD —
bullet heads, composite heads such as `V-3′ / S-5′ / R-10′`, and the inline `F-1′` of the inherited
§5 bullet — found **eight**. The three the plan missed have the same shape as the five it found. A
ninth overlap has a different shape and is recorded rather than fixed (below).

Severity is major, not minor, although no behaviour changes. 109 of the 148 citations of these
marks outside the PRD meant the later rule. Six of them are in strings an operator or a planner
session reads. One OPEN ticket, PRDR-233, stated its non-goal against a mark that resolved to the
wrong rule. And the self-build's specification phase would meet all eight at once (plan §9).

## Evidence (verbatim from `detent-prd-v3.md` at `cddacca`)

Quoted as the document stood, per N-6. Dates are those of the commit that introduced each
definition's text (`git log -S`), not its release tag: three pairs share the tag 3.1.1.

| Mark | Earlier definition — keeps the mark | Later definition — moves |
|---|---|---|
| C-3″ | l.825, 0b1c5c0, 2026-09-05: "**C-3″ (3.1.1, PRDR-119).** A question is for a fact outside the documents AND outside" | l.1081, 461f775, 2026-09-11: "**C-3″ (3.1.1, PRDR-207).** A question is asked **once**." |
| C-9′ | l.1507, 667809e, 2026-08-22: "**C-9′ (3.0.2, PRDR-079).** The resumable pool self-heals stale claims" | l.443, 7b652d1, 2026-09-07: "**C-9′ (3.1.1, PRDR-139).** \"Executes only an approved plan\" is CHECKED" |
| F-1′ | l.1537, e305ec4, 2026-08-19: "**F-1′ (draft.4, PRDR-066/PRDR-064 applied):** the local set gains the two D-21 hook-policy files" | l.843, 2895f5d, 2026-09-03: "**F-1′ (3.1.1, PRDR-118).** A ticket id is a FILE NAME under `.detent/plan/`" |
| P6′ | l.89, ddae79b, 2026-08-28: "**P6′ (3.0.3, PRDR-088).** Init sessions are metered." | l.431, ccdc501, 2026-09-07: "**P6′ (3.1.1, PRDR-142).** A bound that cannot be read is refused rather than dropped" |
| S-3′ | l.1513, 36d133e, 2026-08-18: "**S-3′** Per-role tool allowlists define the role surface; containment is the hook, never the allowlist (unchanged from PRDR-050)." | l.331, f93d2c4, 2026-09-05: "**S-3′ (3.1.1, PRDR-121).** Symbol intelligence is an OPTIONAL adapter" |
| S-5′ | l.227, 24f28e6, 2026-09-02: "**S-5′ (3.1.1, PRDR-114).** `init` writes an opinionated `model_routing`" | l.413, ccdc501, 2026-09-07: "**V-3′ / S-5′ / R-10′ (3.1.1, PRDR-141).** Five features were implemented, tested, documented" |
| V-1⁵ | l.1150, b5027ff, 2026-09-11 08:57: "**V-1⁵ (3.1.1, PRDR-216).** Finalize never names an ignored path." | l.1385, f57af2b, 2026-09-11 18:24: "**V-1⁵ (3.1.1, PRDR-232).** The referee runs nothing the judged tree DECLARES" |
| X-1‴ | l.165, 6d6a6ce, 2026-09-02: "**X-1‴ (3.1.0, PRDR-108).** `review_fix_attempts` is read by the machine" | l.508, e02cf44, 2026-09-07: "**X-1‴ (3.1.1, PRDR-136/PRDR-147).** The run ceiling is enforced against the FILE, and a root" |

## Design

**Which half moves.** The owner's rule: keep the earlier-dated definition's mark and give the later
one the next free prime or suffix. It agrees with the PRDR-165 precedent, where the id everything
else already meant stayed and the newcomer moved (PRDR-166's "Renumbered by PRDR-165" note).

**The next free mark** is the family's next unused ordinal in the document's own convention:
′ ″ ‴ ⁗, then superscript numerals (X-1⁵, S-3⁷, C-4⁗⁵). A sub-amendment mark such as S-3⁷′
belongs to S-3⁷ and does not occupy S-3⁸. Before this ticket, not one of the eight new marks
occurred anywhere in the tree.

A mark is an identifier, not a chronology, and the renumbering makes that visible. C-9″ (PRDR-227)
amends what is now C-9‴, and S-3″ through S-3⁷‴ build on what is now S-3⁸. The dated note says
so where a reader meets it, and each moved definition names the mark it had.

**Which rule a citation means** was decided one citation at a time, never by replacement, from
three kinds of evidence:

- what the citing text describes — `review_fix_attempts` or the ledger and the lock;
- when its line was written, from `git blame` — a citation older than the later definition can only
  mean the earlier one;
- the ticket it names — `X-1‴ (PRDR-147)` names its own rule.

39 of the 148 citations outside the PRD mean the rule that keeps its mark and are unchanged.

| Mark | Cited outside the PRD | Moved | Unchanged |
|---|---:|---:|---:|
| C-3″ → C-3‴ | 14 | 12 | 2 |
| C-9′ → C-9‴ | 19 | 16 | 3 |
| F-1′ → F-1‴ | 3 | 2 | 1 |
| P6′ → P6″ | 0 | 0 | 0 |
| S-3′ → S-3⁸ | 38 | 33 | 5 |
| S-5′ → S-5⁗ | 6 | 0 | 6 |
| V-1⁵ → V-1⁶ | 10 | 5 | 5 |
| X-1‴ → X-1⁷ | 58 | 41 | 17 |
| **total** | **148** | **109** | **39** |

Inside the PRD, eight definitions move, and so do seven cross-references to the moved rules:

- C-9″'s "C-9′ checks the approval's hash";
- S-2‴'s "the editing tools S-3′ was written to keep out", and S-3⁷'s two;
- X-1⁵'s "before X-1‴ two runs on one root", D-28′'s "re-reads the file at the gate (X-1‴)", and
  X-1⁶'s "as the ledger is (X-1‴)".

Five cross-references stay:

- the range `C-9′…C-13′`;
- F-1″'s "asking git first (V-1⁵)";
- C-12″'s "which X-1‴ made false", which is about review rounds;
- S-5″'s and S-5‴'s two citations of PRDR-114's pin.

The decisions a reader might question:

- `src/init/questions.ts:69` is the instruction a drafting stage receives. Its closing `(C-3″)`
  follows PRDR-207's own sentence nearly word for word — "told not to ask any of them again in
  any words, recording a differing assumption where the stage decides instead" — so it moves.
  It is built in code rather than read from `prompts/`, so no prompt hash moves. The slice cache
  keys hash the prompt FILE (`deps.prompts.hashes.planner`), not this text, so no checkpoint or
  cache is invalidated by it.
- `src/adapter/symbols.ts:221`, "the allowlist would still refuse the call (S-3′)", uses the
  same construction as S-3⁷'s "the editing and memory tools stay refused (S-3′)". Both cite
  PRDR-121's grant of the read tools alone, not the role-allowlist rule, so it moves.
- `src/init/plan-write.ts:162`, "C-9′ (PRDR-153): the live-claim check", is the second half of
  PRDR-139's own definition ("Separately, `writePlan` deleted a claim without asking whether its
  holder was alive"). It is not PRDR-079's pool self-heal, so it moves.
- `src/kernel/git.ts:61` and all four PRDR-228 citations say "asking git first (V-1⁵)". That is
  PRDR-216's `check-ignore`, so they stay.
- `prompts/review_fix.md:5` cites `(X-1‴ review_fix_attempts)`, which is PRDR-108, so it stays.
  That is why no prompt file changes.
- The strings a reader outside the code sees are listed here because a doc-block is not the only
  place a mark lives:
  - PRESENT's merged-question line: `src/init/present.ts:259` → C-3‴;
  - the planner instruction above → C-3‴;
  - `init --symbols`' confirmation: `src/cli/init.ts:202` → S-3⁸;
  - the stale-lock notice in `src/cli/init.ts:124`, `src/cli/referee.ts:175` and
    `src/kernel/run.ts:272` → X-1⁷. All three print it; the run's copy goes through `announce`,
    and none of them persists it.

  No test asserts any of them.

**Tickets, and N-6.** N-6 says `prd-review` tickets "quote the document as it stood when the
finding was filed: evidence blocks predating a rename or amendment are preserved verbatim and never
retro-edited, because they record what the document said, not what it says."

So a ticket's own words follow the rename: its title, its frontmatter lists and its prose. A
quotation of the document, the code or a tool's output is left as it stood. PRDR-056, the rename
that wrote that rule, left whole tickets untouched, and every pre-rename ticket still says Foreman.
That is safe for a product name, because an old name still points at the right product. A stale
mark points at a different rule. PRDR-233 is OPEN, and its non-goal "Does not weaken V-1⁵'s
default" would have sent its implementer to PRDR-216's finalize rule. So the line is drawn exactly
where N-6 draws it, at evidence.

As it happens, no moved mark sat inside a quotation. None was in a blockquote or a fence, and a
check for inline quotation found only one hit: PRDR-222's own acceptance criterion, which is a JSON
string. So the rule withheld nothing this time; it is stated for the next rename.

**The note.** The PRD gains one dated note beside its reading guide, which is where it explains its
marks. The note lists every move, the rule that chose it, what it means for a reader of an older
citation, and the overlap left open. Each moved definition's parenthetical names its former mark,
the way PRDR-166 carries "Renumbered by PRDR-165".

**The test** (`tests/docs/prd-requirement-ids.test.ts`) makes the property checkable rather than
remembered. It checks three things:

- every mark the PRD defines, it defines once;
- the two overlaps of the range are pinned exactly, so a new duplicate fails, and resolving an
  overlap fails until it is taken off the list;
- each moved rule is found under its new mark carrying its own ticket, while the earlier rule
  keeps the old mark. That third check catches moving the wrong half of a pair, which uniqueness
  alone would pass.

A definition is:

- a bold id at the head of a bullet — one id, ids joined by `/`, or a range joined by `…`;
- a decision-log row;
- a bold id followed at once by its release in parentheses, anywhere in a line, which is how §5
  defines F-1′.

A bold sentence that merely opens with an id is not a definition. D-29's row opens "**D-22 splits by
driver.**", and that cites D-22; it defines nothing.

One rule stated twice is a restatement, not a collision, and only a reader can tell the two apart.
The first falsification run showed it: it also listed D-29, which the decision log states and §8
restates beside D-22, the decision it amends. So restatements are pinned in their own list, exactly,
apart from the overlaps that wait on a decision.

**Why the test does not check citations.** Which rule a citation means is a reading, not a pattern.
The obvious heuristic was measured: flag a mark cited beside a ticket that defined a sibling mark,
such as `X-1‴ (PRDR-147)`. It is blind to this very defect. On `cddacca` each duplicated mark
carried both tickets, so every pairing looked valid, and the ambiguity hid itself. On the fixed tree
it can judge 349 pairs and flags two, and both are parallel lists read as pairs:

- `(PRDR-114, S-5″)` in `src/cli/init.ts:164`;
- `C-4⁗‴ / C-4⁗⁵ (PRDR-204, PRDR-210)` in `src/sessions/backend.ts:47`.

So it would guard nothing and need exceptions to pass. The citation half's evidence is instead the
census above and a diff check: each of the 108 changed lines outside the PRD differs from its
original by a mark move and nothing else.

## Falsification (verification protocol, item 1)

`tests/docs/prd-requirement-ids.test.ts` was written before any mark moved and run against
`cddacca`, with the PRD byte-identical to HEAD:

```
× … > every mark the PRD defines, it defines once — the range's two overlaps excepted, exactly
  → expected { 'P6′': [ …(2) ], …(8) } to deeply equal { Object (C-9′, C-12′) }
✓ … > the parser sees every shape a definition takes, and a citation is not one
× … > C-3″'s later rule, PRDR-207's, is C-3‴; the earlier rule keeps C-3″
  → C-3‴ is defined once: expected [] to have a length of 1 but got +0
× … > C-9′'s later rule, PRDR-139's, is C-9‴; the earlier rule keeps C-9′
  → C-9‴ is defined once: expected [] to have a length of 1 but got +0
× … > F-1′'s later rule, PRDR-118's, is F-1‴; the earlier rule keeps F-1′
  → F-1‴ is defined once: expected [] to have a length of 1 but got +0
× … > P6′'s later rule, PRDR-142's, is P6″; the earlier rule keeps P6′
  → P6″ is defined once: expected [] to have a length of 1 but got +0
× … > S-3′'s later rule, PRDR-121's, is S-3⁸; the earlier rule keeps S-3′
  → S-3⁸ is defined once: expected [] to have a length of 1 but got +0
× … > S-5′'s later rule, PRDR-141's, is S-5⁗; the earlier rule keeps S-5′
  → S-5⁗ is defined once: expected [] to have a length of 1 but got +0
× … > V-1⁵'s later rule, PRDR-232's, is V-1⁶; the earlier rule keeps V-1⁵
  → V-1⁶ is defined once: expected [] to have a length of 1 but got +0
× … > X-1‴'s later rule, PRDR-136's, is X-1⁷; the earlier rule keeps X-1‴
  → X-1⁷ is defined once: expected [] to have a length of 1 but got +0
× … > the dated amendment note names every move
  → a dated note beside the reading guide: expected undefined to be defined
Tests  10 failed | 1 passed (11)
```

The first assertion's received value lists every collision by the heads that define it. Only the
two lines without a `+` were expected:

```
  {
    "C-12′": [
      "C-9′…C-13′",
      "C-12′ (3.0.1, PRDR-078)",
    ],
+   "C-3″": [
+     "C-3″ (3.1.1, PRDR-119)",
+     "C-3″ (3.1.1, PRDR-207)",
+   ],
    "C-9′": [
+     "C-9′ (3.1.1, PRDR-139)",
      "C-9′…C-13′",
      "C-9′ (3.0.2, PRDR-079)",
+   ],
+   "F-1′": [
+     "F-1′ (3.1.1, PRDR-118)",
+     "F-1′ (draft.4, PRDR-066/PRDR-064 applied)",
+   ],
+   "P6′": [
+     "P6′ (3.0.3, PRDR-088)",
+     "P6′ (3.1.1, PRDR-142)",
+   ],
+   "S-3′": [
+     "S-3′ (3.1.1, PRDR-121)",
+     "S-3′",
+   ],
+   "S-5′": [
+     "S-5′ (3.1.1, PRDR-114)",
+     "V-3′ / S-5′ / R-10′ (3.1.1, PRDR-141)",
+   ],
+   "V-1⁵": [
+     "V-1⁵ (3.1.1, PRDR-216)",
+     "V-1⁵ (3.1.1, PRDR-232)",
+   ],
+   "X-1‴": [
+     "X-1‴ (3.1.0, PRDR-108)",
+     "X-1‴ (3.1.1, PRDR-136/PRDR-147)",
    ],
  }
```

The one test that passes on HEAD pins the parser's shapes, and none of them depends on the fix. The
first run also listed D-29, which is a restatement rather than a collision; that is recorded under
Design, and it is why the test has a separate, exactly pinned list for restatements.

## What changed

- `detent-prd-v3.md`:
  - the eight moved definitions, each head naming the mark it had — for example
    `**X-1⁷ (3.1.1, PRDR-136/PRDR-147; renumbered from X-1‴ by PRDR-287).**`;
  - the seven cross-references to moved rules;
  - the dated note "One mark, one rule (3.1.1, PRDR-287, 2026-09-26)" after the reading guide.
- 109 citations on 108 lines in 50 files:
  - `src/`: 39 lines in 19 files;
  - `tests/`: 16 lines in 7 files;
  - `docs/implementation-plan-v3.md`: 4 lines;
  - `tickets/prd-review/`: 49 lines in 23 tickets.

  One line held two marks: `docs/implementation-plan-v3.md`'s 3.0-30 entry cites the ledger rule
  twice, and both moved. The 38 lines that still carry an old mark are exactly the citations of the
  rules that kept theirs.
- Unchanged by design:
  - `prompts/`;
  - `tests/oracle/PARITY.md` and `tests/oracle/parity.map.ts`, which cite PRDR-108's X-1‴;
  - `scripts/build-plugin.ts` and `tests/plugin/agents.test.ts`, which cite the role-allowlist S-3′.

  So neither `prompts:check` nor `parity:check` has a derived file to regenerate.
- `tests/docs/prd-requirement-ids.test.ts`: 11 tests.

## Mutation battery (verification protocol, item 2)

Seventeen mutants, each applied to the fixed PRD and run against
`tests/docs/prd-requirement-ids.test.ts` (baseline 11/11 green). The PRD was restored between
mutants from a scratchpad copy, never from git, and its SHA-256 was checked equal to the fixed file
after the last one. The fix was then re-verified present and the test re-run green.

| Mutant | Result |
|---|---|
| M1 C-3‴ given back its old mark (re-duplicates C-3″) | KILLED (2) |
| M2 C-9‴ given back its old mark (a third C-9′) | KILLED (2) |
| M3 F-1‴ given back its old mark (duplicates the inline draft.4 F-1′) | KILLED (2) |
| M4 P6″ given back its old mark | KILLED (2) |
| M5 S-3⁸ given back its old mark | KILLED (2) |
| M6 S-5⁗ given back its old mark inside the composite head | KILLED (2) |
| M7 V-1⁶ given back its old mark | KILLED (2) |
| M8 X-1⁷ given back its old mark | KILLED (2) |
| M9 the wrong half of C-3″ moved: PRDR-119 renumbered, PRDR-207 kept | KILLED (1) |
| M10 a moved head drops the mark it had | KILLED (1) |
| M11 a new amendment reuses a mark (A-5′) | KILLED (1) |
| M12 a known overlap resolved without leaving the list (C-12′ → C-12⁗) | KILLED (1) |
| M13 the dated note drops one move | KILLED (1) |
| M14 a bullet reuses a decision-log mark (D-27) | KILLED (1) |
| M15 an inline definition reuses a mark (P7′) | KILLED (1) |
| M16 the restatement disappears, so the pinned list is stale (D-22/D-29 → D-22) | KILLED (2) |
| M17 the dated note loses its date | KILLED (1) |

17/17 killed. The count is the number of tests that failed.

- M9 is the one only the move tests catch: every mark is still unique, but the wrong rule moved.
- M12 and M16 show that neither pinned list can go stale silently.
- The citation half has no mutant, because it has no mechanical check (Design).

Seven gates green: 1438 tests across 138 files (2 skipped).

## Recorded, not fixed

- **The range restatement.** §4's `C-9′…C-13′` (PRDR-065, 36d133e, 2026-08-18) restates C-9…C-13
  for v3, so it names C-9′ and C-12′. PRDR-079 (C-9′) and PRDR-078 (C-12′) define both again, four
  days later. The census counts this as a third C-9′ and a second C-12′. This ticket's rule would
  keep the range's marks and move PRDR-079 and PRDR-078 as well, yet the pairing this ticket was
  asked to fix keeps PRDR-079 at C-9′. Whether a range restatement defines its members is a
  decision for the owner, and it is PRDR-280's to settle for packs in any case. The test pins both
  overlaps exactly, so they can only shrink. **Resolved by PRDR-288** (2026-09-26): the owner
  applied the rule to the range, so PRDR-079 moved to C-9⁗ and PRDR-078 to C-12⁗, and the test now
  pins no overlap.
- **The specification-phase branch says five.** `docs/plan-specification-phase.md` §5 and §9,
  PRDR-278's non-goal and PRDR-280's title all say five ids, on `feat/specification-phase`. The
  census found eight, plus the range. When that branch is rebased onto this one, they should cite
  PRDR-287 instead. PRDR-278's own `C-3″` means PRDR-119, which keeps its mark.
- **History keeps the old marks.** Commit messages are immutable, and `detent-prd-v2.md` is frozen.
  The dated note is their map.
