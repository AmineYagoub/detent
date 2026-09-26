---
id: PRDR-288
title: "The owner's decision on the overlap PRDR-287 left open: §4's range restatement `C-9′…C-13′` (PRDR-065, 2026-08-18) was written first, so it keeps its marks, and the two amendments that reused them four days later move to their families' next free marks — PRDR-079's C-9′ to C-9⁗ and PRDR-078's C-12′ to C-12⁗. PRDR-287 already counted a restatement as a definition for S-3′; this applies the same rule to the range"
state: DONE
severity: minor
category: consistency
labels: ["prd-review", "operator-decision", "traceability", "N-6", "specification-phase"]
surface: ["detent-prd-v3.md", "docs/implementation-plan-v3.md", "tests/kernel/run.test.ts", "tests/docs/prd-requirement-ids.test.ts", "tickets/prd-review/PRDR-287-eight-requirement-marks-each-name-two-rules.md"]
prd_refs: ["N-6", "C-9′", "C-9⁗", "C-10′", "C-11′", "C-12′", "C-12⁗", "C-13′", "S-3′", "PRDR-065", "PRDR-078", "PRDR-079", "PRDR-287"]
acceptance_criteria: ["§4's range restatement `C-9′…C-13′` keeps C-9′ through C-13′. It was written first (PRDR-065, 36d133e, 2026-08-18), and a restatement is a definition, as PRDR-287 already held for §8's S-3′.", "PRDR-079's rule moves from C-9′ to C-9⁗ and PRDR-078's from C-12′ to C-12⁗: the next free marks, since C-9″, C-9‴, C-12″ and C-12‴ are taken. Neither new mark occurs anywhere in the tree as a definition or a citation before this ticket, and each moved head names the mark it had.", "Every citation of the two moved rules names its new mark, and a citation of the range keeps its mark.", "The PRD's dated note lists all ten moves, says why the range kept its marks, and no longer calls an overlap open.", "The test pins no overlap. Any mark defined twice fails, except a restatement of the SAME rule, named one by one (D-29). It is observed to FAIL against `60aedc1` first, and every mutant that undoes a move or moves the wrong half is killed.", "PRDR-287's non-goal and its recorded item point at this ticket; what PRDR-287 recorded is otherwise left as it stood."]
non_goals: ["Does NOT reorder marks by date. PRDR-139 keeps C-9‴ (PRDR-287), though PRDR-079 is older: the rule gives each later definition the next FREE mark, and handing C-9‴ to PRDR-079 would move sixteen citations again for no gain in meaning.", "Does NOT touch C-10′, C-11′ or C-13′, which the range alone defines.", "Does NOT edit PRDR-078's or PRDR-079's tickets, which cite C-12 and C-9 without a prime."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-287", "PRDR-065", "PRDR-078", "PRDR-079"]
depends_on: ["PRDR-287"]
---

# PRDR-288 — the range restatement keeps C-9′ and C-12′

**Severity:** minor · **Category:** consistency · **Found by:** PRDR-287's census, recorded there
and left for the owner · **Amends:** C-9′, C-12′, under N-6

## The decision

PRDR-287 renumbered eight marks and recorded a ninth overlap of a different shape. §4's range
`C-9′…C-13′` restates C-9…C-13 for v3, so it names C-9′ and C-12′, and PRDR-079 and PRDR-078
define both again. Applying PRDR-287's rule there would move PRDR-079 as well, which the pairing
PRDR-287 was asked to fix kept at C-9′. So it was left for the owner, with a recommendation to
apply the rule anyway, for consistency with S-3′.

The owner's decision, verbatim: "Apply the rule to the range too: move PRDR-079 and PRDR-078".

The consistency argument is the one PRDR-287 already relied on. §8's `**S-3′** Per-role tool
allowlists define the role surface …` is also a restatement, of v2's S-3, and PRDR-287 kept it as
the earlier definition and moved PRDR-121. A range restatement is the same kind of thing: it
states, for v3, rules inherited from v2, under marks that later amendments then reused.

## Evidence (verbatim from `detent-prd-v3.md` at `60aedc1`)

Quoted as the document stood, per N-6. Dates are those of the commits that introduced each text.

| Line | Commit | Date | Head |
|---|---|---|---|
| 1488 | 36d133e | 2026-08-18 19:27 | "**C-9′…C-13′** `run` semantics (execute only an approved plan; atomic claims; resumable pool; escalation handling; exit codes; user-facing vocabulary) are inherited." |
| 1516 | 8dd11bf | 2026-08-22 15:24 | "**C-12′ (3.0.1, PRDR-078).** The plumbing set gains `unclaim <id>`" |
| 1522 | 667809e | 2026-08-22 15:33 | "**C-9′ (3.0.2, PRDR-079).** The resumable pool self-heals stale claims" |

The PRD's own note then said: "One overlap is left open: §4's `C-9′…C-13′` restates C-9…C-13 and
so names C-9′ and C-12′, which PRDR-079 and PRDR-078 also define."

## Design

**The marks.** C-9 has C-9″ (PRDR-227) and C-9‴ (PRDR-139, since PRDR-287), so PRDR-079 takes
C-9⁗. C-12 has C-12″ (PRDR-236) and C-12‴ (PRDR-238), so PRDR-078 takes C-12⁗. Neither occurred
anywhere in the tree at `60aedc1` as a definition or a citation. The only hit was PRDR-287's
mutation table, which describes the mutant "C-12′ → C-12⁗", the very move made here.

Both families now read against their dates:

| Mark | Rule | Introduced |
|---|---|---|
| C-9⁗ | PRDR-079 | 667809e, 2026-08-22 |
| C-9‴ | PRDR-139 | 7b652d1, 2026-09-07 |
| C-9″ | PRDR-227 | 53cf7d4, 2026-09-11 |
| C-12⁗ | PRDR-078 | 8dd11bf, 2026-08-22 |
| C-12″ | PRDR-236 | d80ed2b, 2026-09-11 |
| C-12‴ | PRDR-238 | dde25ec, 2026-09-12 |

The dated note already says a mark is an identifier, not a chronology, and it now names these two
cases. PRDR-139 keeps C-9‴ although PRDR-079 is older. The rule hands each later definition the next
FREE mark, and reassigning C-9‴ would move sixteen citations again and change nothing a reader
needs.

**The citations,** decided as PRDR-287 decided them, by what the text describes:

- `docs/implementation-plan-v3.md:106`, "The release carries C-12′/C-9′: `detent unclaim <id> |
  --stale` (PRDR-078 …)", is the v3.0.1 release entry for PRDR-078 and PRDR-079. Both marks
  move.
- `tests/kernel/run.test.ts:822`, "C-9′/PRDR-079: only a …", names its rule. It moves.
- `tests/plugin/parity.test.ts:21`, "C-9′…C-13′", is the range itself. It stays.

Inside the PRD, no cross-reference cites either moved rule by mark. C-12‴'s text mentions PRDR-078
and PRDR-079 by ticket only.

PRDR-078's and PRDR-079's own tickets cite `C-12` and `C-9` without a prime, and no other ticket
cites either moved rule by mark, except PRDR-287. What PRDR-287 says about them is what it decided:
PRDR-079 kept C-9′, and the range's two overlaps stayed open. Rewriting those words to C-9⁗ would
make PRDR-287 claim a move it did not make. So they stay, like a quotation, and PRDR-287 gains a
link to this ticket and a pointer in its non-goal and its recorded item.

**The note** keeps its place and its date, and names both tickets. It now lists ten moves under the
rule and says why S-3′ and the range kept their marks: each restatement was written before the
amendment that reused its mark. The sentence that called an overlap open is gone. PRDR-287's account
of that overlap joins the records that keep an old mark and read through the note, beside N-6's
quotations and the commit messages, so "every citation in the tickets was re-pointed" stays true.
Its closing sentence now says what the test still lets through: a restatement of the same rule,
named one by one.

**The test** drops PRDR-287's pinned overlaps. Every mark the PRD defines, it now defines once,
except D-29, which the decision log states and §8 restates as the same rule. A restatement of the
SAME rule is not a collision, and only a reader can tell the two apart, so each is named. Two
entries join the move table. The note is found by its title and checked for its date, rather than
found by PRDR-287's id alone.

## Falsification (verification protocol, item 1)

`tests/docs/prd-requirement-ids.test.ts` was changed before any mark moved and run against
`60aedc1`, with the PRD byte-identical to HEAD:

```
× … > every mark the PRD defines, it defines once — a restatement of the same rule excepted, by name
  → expected { Object (C-9′, C-12′) } to deeply equal {}
✓ … > the parser sees every shape a definition takes, and a citation is not one
✓ … > C-3″'s later rule, PRDR-207's, is C-3‴; the earlier rule keeps C-3″
✓ … > C-9′'s later rule, PRDR-139's, is C-9‴; the earlier rule keeps C-9′
× … > C-9′'s later rule, PRDR-079's, is C-9⁗; the earlier rule keeps C-9′
  → C-9⁗ is defined once: expected [] to have a length of 1 but got +0
× … > C-12′'s later rule, PRDR-078's, is C-12⁗; the earlier rule keeps C-12′
  → C-12⁗ is defined once: expected [] to have a length of 1 but got +0
✓ … > F-1′'s later rule, PRDR-118's, is F-1‴; the earlier rule keeps F-1′
✓ … > P6′'s later rule, PRDR-142's, is P6″; the earlier rule keeps P6′
✓ … > S-3′'s later rule, PRDR-121's, is S-3⁸; the earlier rule keeps S-3′
✓ … > S-5′'s later rule, PRDR-141's, is S-5⁗; the earlier rule keeps S-5′
✓ … > V-1⁵'s later rule, PRDR-232's, is V-1⁶; the earlier rule keeps V-1⁵
✓ … > X-1‴'s later rule, PRDR-136's, is X-1⁷; the earlier rule keeps X-1‴
× … > the dated amendment note names every move
  → C-9′ → C-9⁗: expected '> **One mark, one rule (3.1.1, PRDR-2…' to match /C-9′ \(PRDR-079[^)]*\) → C-9⁗/u
Tests  4 failed | 9 passed (13)
```

The first assertion's received value is exactly the two overlaps PRDR-287 pinned, and nothing else:

```
- {}
+ {
+   "C-12′": [
+     "C-9′…C-13′",
+     "C-12′ (3.0.1, PRDR-078)",
+   ],
+   "C-9′": [
+     "C-9′…C-13′",
+     "C-9′ (3.0.2, PRDR-079)",
+   ],
+ }
```

The nine that pass on HEAD are PRDR-287's parser and moves, which this ticket must not disturb. The
note test found the note by its title and passed its date check on HEAD. It failed on the first move
the note lacked.

## What changed

- `detent-prd-v3.md`:
  - the two moved definitions, in §8, each head naming the mark it had:
    `**C-12⁗ (3.0.1, PRDR-078; renumbered from C-12′ by PRDR-288).**` and
    `**C-9⁗ (3.0.2, PRDR-079; renumbered from C-9′ by PRDR-288).**`;
  - the dated note, now "One mark, one rule (3.1.1, PRDR-287/PRDR-288, 2026-09-26)":
    - nine marks and ten moves;
    - a sentence on restatements;
    - C-9⁗ and C-12⁗ in its chronology sentence;
    - PRDR-287's account among the records that keep an old mark;
    - no open overlap.
- Two citations, one line each:
  - `docs/implementation-plan-v3.md:106` → C-12⁗/C-9⁗;
  - `tests/kernel/run.test.ts:822` → C-9⁗/PRDR-079.
- `tests/docs/prd-requirement-ids.test.ts`:
  - `KNOWN_OVERLAPS` is gone, and the first test expects no duplicate beyond `RESTATED`;
  - `MOVES` has ten entries;
  - the note is found by its title and its date is checked.

  It has 13 tests.
- PRDR-287 gains a link to this ticket, and a pointer at the end of its range non-goal and of its
  recorded item.
- No string a session or an operator reads changes. Both moved citations sit in a plan doc and a
  test's doc-block. No file under `prompts/` changes, so no prompt hash moves and no checkpoint or
  cache is invalidated.

## Mutation battery (verification protocol, item 2)

Twenty-five mutants, each applied to the fixed PRD and run against
`tests/docs/prd-requirement-ids.test.ts` (13/13 green on the fixed PRD):

- ten are new;
- fifteen are PRDR-287's, re-run because the test's first assertion changed.

M12 is retired with the list it guarded, and N7 replaces M17, whose anchor was the note's old date
line. The PRD was restored from a scratchpad copy between mutants, never from git, and its SHA-256
was checked equal to the fixed file after the last one.

| Mutant | Result |
|---|---|
| N1 C-9⁗ given back its old mark (re-duplicates the range's C-9′) | KILLED (2) |
| N2 C-12⁗ given back its old mark (re-duplicates the range's C-12′) | KILLED (2) |
| N3 the wrong half of C-12′ moved: the range gives it up (`C-9′…C-11′ / C-13′`), PRDR-078 keeps it | KILLED (2) |
| N4 a moved head drops the mark it had (C-9⁗) | KILLED (1) |
| N5 the dated note drops C-9′ (PRDR-079) → C-9⁗ | KILLED (1) |
| N6 the dated note drops C-12′ (PRDR-078) → C-12⁗ | KILLED (1) |
| N7 the dated note loses its date | KILLED (1) |
| N8 the note loses its title, so nothing finds it | KILLED (1) |
| N9 a new amendment reuses a mark only the range defines (C-10′) | KILLED (1) |
| N10 a restated mark is stated a third time (D-29) | KILLED (2) |
| PRDR-287's M1–M11 and M13–M16, re-run | 15/15 KILLED |

25/25 killed. The count is the number of tests that failed.

- N1 and N2 recreate exactly the overlaps PRDR-287's list pinned. That list would have let both
  through the uniqueness assertion. Now it fails on both.
- N3 leaves every mark unique. Only the C-12 move test and the parser's pinned range head catch it.
- N10 shows that the restatement exception is pinned by count as well as by name.

Seven gates green: 1440 tests across 138 files (2 skipped).

## Recorded, not fixed

- **The specification-phase branch still says five.** `docs/plan-specification-phase.md` §5 and
  §9, PRDR-278's non-goal and PRDR-280's title say five duplicated ids, on
  `feat/specification-phase`. With the range resolved, there were nine duplicated marks, and ten
  definitions moved. When that branch is rebased onto this one, those should cite PRDR-287 and
  PRDR-288.
- **PRDR-287's census is PRDR-287's.** Its table counts `docs/implementation-plan-v3.md:106`'s and
  `tests/kernel/run.test.ts:822`'s C-9′ among the citations it left alone, which was true of it.
  This ticket moved both. The table, its falsification output and its mutation table stay as its
  record, and the forward pointers say what came after.
