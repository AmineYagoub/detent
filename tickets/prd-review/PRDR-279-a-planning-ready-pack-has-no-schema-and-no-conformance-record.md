---
id: PRDR-279
title: "Nothing defines a planning-ready document set, so neither `init` nor the operator can tell a pack that was specified and validated from a raw PRD, and a validated pack would be audited all over again. The pack gets a fixed schema and a committed conformance record, and a conforming pack goes through the checker only, straight to planning"
state: DONE
severity: major
category: capability
labels: ["prd-review", "specification-phase", "operator-decision", "F-3", "traceability"]
surface: ["src/schemas/pack.ts", "src/init/pack.ts", "src/init/pack-parse.ts", "src/init/pack-markdown.ts", "src/init/discover-docs.ts", "src/init/pipeline.ts", "src/init/machine.ts", "detent-prd-v3.md", "docs/release-checklist.md", "tests/init/pack.test.ts", "tests/init/pack-schema.test.ts", "tests/init/pack-discover.test.ts", "tests/init/pack-fixture.ts", "tickets/prd-review/**"]
prd_refs: ["C-2‴", "C-2⁗", "C-2⁶", "C-2⁷", "C-2⁹", "C-8", "D-10′", "V-5′", "A-1", "F-3", "F-3′", "F-4", "PRDR-166", "PRDR-278"]
acceptance_criteria: ["The schema is written once, as a versioned zod schema under `src/schemas/`. It covers the layout and precedence (decisions, facts, design, ADRs, PRDs); the id grammar `<CODE>-F-<nnn>` and `<CODE>-N-<nnn>`, with registered codes and milestone tags; MUST and SHOULD wording; criteria in Given / When / Then with exact values; milestone order; and optional catalogues of error codes, events, settings, jobs and routes.", "The conformance record holds the schema version, a hash of the pack's documents excluding the record, the checker's result, every validation round with its counts by severity and the findings it left open, and the date. It is committed with the pack, at a path this ticket fixes.", "A pack conforms when its hash matches its documents and the checker is green: the record's checker was green, and the schema finds nothing in the documents now. DISCOVER classifies every document set as raw, conforming or changed and persists the result in its outputs, and a test drives a fixture pack through DISCOVER to `conforming`. Refined on 2026-09-26: skipping AUDIT, DECIDE and WRITE on a conforming pack, VALIDATE running only the checker (decision 6), and the test that no specification session is launched moved to PRDR-284, because those phases do not exist until PRDR-281 to PRDR-284 build them.", "A pack whose documents no longer match the hash is classified changed, never raw, and `init` names the documents modified, added and removed. Refined on 2026-09-26: its re-validation for the change only (plan §4.3) is PRDR-284's, which already carried it.", "`archive/` is outside every discovery glob. An archived original is never planned from, and a test puts one there to prove it.", "Traceability: every ticket's `requirement_ids` and `criterion_ids` resolve in the pack (PRDR-292, PRDR-293).", "In greenfield, the decision log carries the stack as a structured entry (language, toolchain, the gate command for each slot, the scaffold files), and a greenfield pack without one does not conform (PRDR-290).", "A pack may declare its packages and each package's gate commands, and declared commands are the bindings (PRDR-295).", "The record and every new artifact are versioned persisted shapes under F-3, and release-checklist item 8 names them."]
non_goals: ["Does NOT implement the checker's rules; PRDR-280 does. This ticket fixes the schema they check and the record they write.", "Does NOT ask an operator to reshape documents by hand; WRITE produces the pack (PRDR-283).", "Does NOT make catalogues mandatory. A pack without one conforms, and the checker skips its rules."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-166", "PRDR-280", "PRDR-283", "PRDR-284", "PRDR-290", "PRDR-292", "PRDR-295"]
depends_on: ["PRDR-278"]
---

# PRDR-279 — the pack's schema and its conformance record

## Problem

`init` discovers whatever documents it finds (DISCOVER, PRDR-166) and treats every set the same
way. The specification phase has to know what it is looking at. A raw PRD is audited. A pack that
was already specified and validated is not. `~/ksar/docs` after its seven rounds is the example
(decision 6). Nothing defines the difference today, and nothing records that a validation
happened.

## Design

The plan's §4. The schema is the shape of the ksarjs pack, generalized: a decision log, a facts
file with a source for every fact, design documents, ADRs, and module PRDs whose requirements
and criteria have ids. Precedence settles every disagreement in favour of the higher document,
and the fix lands in the lower one.

The record makes "conforming" decidable: a hash that matches and a checker that is green, not a
person's say-so. An edit breaks the hash, and the pack is then re-validated for what changed,
not from scratch.

## Falsification (verification protocol, item 1)

Three test files were written before any code and run against HEAD `ebf2564`.
`tests/init/pack-discover.test.ts` imports only code that existed then, so its failures are
behaviour, not a missing module:

```
   × … records a pack whose hash matches and whose checker was green as conforming
     → expected undefined to deeply equal { kind: 'conforming', …(2) }
   × … does not call a pack conforming when its record says the checker was red
     → expected undefined to be 'changed' // Object.is equality
   × … re-runs DISCOVER on an edited pack, names the document, and never calls the pack raw
     → expected undefined to be 'conforming' // Object.is equality
   × … names documents added to and removed from a recorded pack
     → expected undefined to be 'changed' // Object.is equality
   × … keeps C-8's listing digest for a document set with no record, so an edit still reuses DISCOVER
     → expected undefined to deeply equal { kind: 'raw' }
   ✓ … never discovers an archived original under the default patterns
   × … never discovers one under a configured glob that would reach it
     → expected [ 'archive/PRD.md', …(4) ] to deeply equal [ 'docs/archive/notes.md', …(1) ]
   × … never hands one to planning, through the pipeline
     → expected [ 'archive/PRD.md', …(4) ] to deeply equal [ 'docs/archive/notes.md', …(1) ]
 FAIL  tests/init/pack-schema.test.ts
Error: Cannot find module '../../src/init/pack-parse.js' imported from '…/tests/init/pack-schema.test.ts'
 FAIL  tests/init/pack.test.ts
Error: Cannot find module '../../src/init/pack-parse.js' imported from '…/tests/init/pack.test.ts'
 Test Files  3 failed (3)
      Tests  7 failed | 1 passed (8)
```

The one pass is expected: C-2's default patterns (`PRD*.md` at the root, `docs/**`) never reached
`archive/`. A configured `plan_docs` of `**/*.md` did, and planning received the originals. The
passing test stays as a guard. The other two files failed because nothing defined a pack.

## What changed

- **`src/schemas/pack.ts`** is the schema. It holds:
  - the layout (`packKindOf`) and the precedence (`PACK_PRECEDENCE`);
  - the id grammar: module codes, requirement and criterion ids, `D-n`, `X-n`, fact ids `N.M`,
    and milestones ordered by number;
  - `levelOf`, where MUST outranks SHOULD and lower case is prose;
  - a zod schema for every entry, carrying the rules: MUST or SHOULD, a milestone tag or
    `[withdrawn]`, Given / When / Then, and a criterion naming what it tests;
  - `packSchema` (the parse), `conformanceRecordSchema`, `packStatusSchema` and
    `packFindingSchema`, all under `schema_version`.
- **`src/init/pack-markdown.ts`** reads the markdown:
  - Lines keep their true numbers through frontmatter.
  - A fenced block reads as blank lines, closed by CommonMark's rule.
  - Sections are `##` headings, with their `###` subsections.
  - A table is any header with a dash separator, as GitHub renders one.
  - A bold-headed bullet is an entry, indented or not, with its continuation lines.
- **`src/init/pack-parse.ts`** extracts every entry and admits it through its schema. Each refusal
  becomes a finding at the entry's line. It also requires the decision log, the index and a
  module PRD, and the stack entry in greenfield. `unresolvedIds` is traceability's one definition.
- **`src/init/pack.ts`**:
  - `packDocuments` is always the full C-2 discovery.
  - `packHash` is the pack's one hash.
  - `conformanceRecord` and `writeConformanceRecord` build and write the record.
  - `readConformanceRecord` refuses, as a named `ConformanceRecordError`, a record that is not
    JSON, is invalid, is newer, or has a hash that disagrees with its own documents.
  - `classifyPack` returns raw, conforming or changed.
  - `packNote` says it aloud.
- **`src/init/discover-docs.ts`**: the walk never enters the root's `archive/`, so no pattern,
  configured or not, reaches it.
- **`src/init/pipeline.ts`**: DISCOVER classifies, notes the result and persists `pack` in its
  outputs. Its digest adds the pack's and the record's contents only where a record exists. Without
  one the digest is byte-identical to before, so no checkpoint is invalidated by the upgrade.
- **`src/init/machine.ts`**: C-8's doc-block now states that exception.
- **`detent-prd-v3.md`**: C-2⁹ records what this ticket settled, with pointers on C-2⁶ and C-2⁷.
- **`docs/release-checklist.md`**: item 8 names the three new persisted shapes.
- **Tests** (all citing PRDR-279):
  - `tests/init/pack-discover.test.ts` (8 tests);
  - `tests/init/pack.test.ts` (13);
  - `tests/init/pack-schema.test.ts` (29);
  - `tests/init/pack-fixture.ts`, a small greenfield pack holding every table kind and both
    bullet kinds. It also holds an oracle record computed with `node:crypto` rather than the code
    under test, so a wrong hash cannot agree with itself.

## Criteria refined

Two criteria asked for behaviour of phases this ticket's own dependants build. As filed:

> A pack conforms when its hash matches its documents and the checker is green. `init` on a
> conforming pack skips AUDIT, DECIDE and WRITE, and VALIDATE runs only the checker (decision 6).
> A test drives a fixture pack down that path and asserts that no specification session is
> launched.

> A pack whose documents no longer match the hash is re-validated for the change only (plan
> §4.3), and `init` names the documents that changed. It is never treated as a raw PRD.

Those phases do not exist until PRDR-281 to PRDR-284, all of which depend on this ticket. Today
no specification session exists to launch, so the test would pass against any input. A
criterion only an absent phase can fail is not evidence, so the routing half moved to PRDR-284,
which lands with the last of them. This ticket keeps the half it can prove: the classification,
recorded where those phases will read it, and the changed documents named. The re-validation
half of the second criterion was already PRDR-284's.

## Calls the plans left open (for the operator's veto)

1. **The record's path is `docs/conformance.json`.** It sits inside `docs/`, beside the pack.
   No C-2 pattern matches `.json`, so it can never hash itself, and a test holds that.
2. **Context documents.** Inside `docs/`, the layout's names are typed. Any other name inside
   `research/`, `design/`, `adr/` or `prd/` breaks the layout. Every other discovered document,
   a README or a runbook, is context: hashed with the pack, never read for requirements, and never
   archived. Archiving everything that is not the pack would move a repository's README out of its
   root. So WRITE archives only the originals it rewrote (PRDR-283 is aligned).
3. **`changed` also covers unchanged documents a record no longer vouches for.** Two cases: a
   record whose checker was red, and documents the schema refuses now. `reasons` says which, and
   the pack is still never raw.
4. **The pack is the whole discovery.** `packDocuments` ignores `plan_docs`. Otherwise a narrowed
   increment would read as every other document removed.
5. **DISCOVER's digest reads contents only with a record.** A raw document set keeps C-8's
   listing digest exactly, and no existing checkpoint is invalidated. With a record, an edit
   re-runs DISCOVER, which is one scan, since everything after it replays anyway.
6. **`archive/` is the root's only**, excluded by the walk rather than a pattern, because `**`
   reaches it. `docs/archive/` is an ordinary directory.
7. **A record that cannot be read stops `init`.** This follows `bindings.json`'s pattern, rather
   than silently re-validating everything. A merge that leaves conflict markers in the record is
   the realistic case, and the message names the file.
8. **The grammar is one form each:**
   - decision-log entries are table rows under four fixed sections, and any other table there is
     refused;
   - requirements and criteria are bold-headed bullets;
   - criteria are `<CODE>-AC-<nn>`, one form where ksarjs used three;
   - a criterion's requirements are every id it names, and an en-dash range stands for the ids
     between;
   - a fenced block is an example.
9. **One home for gate commands.** `## Packages` holds every package's, the root's as `.`. The
   stack entry's `gates` are the root's rows, so the parsed entry is whole, as D-10′ asks.
   Greenfield requires at least one root command, since without one nothing can bind.
10. **"Exact values" is not checked mechanically.** A floor such as "Then names a digit or a
    literal" would refuse "then no row exists", which is exact. The reviewers judge exactness
    (C-2⁶), and the schema's doc-block says so.
11. **One `schema_version`** versions both the record's shape and the grammar. A change to what a
    pack must say is an F-3 event, as a change to the record is. Item 8 says so.
12. **File names are lower-case kebab** for design documents, ADRs and module PRDs. They are
    identifiers that `§` references resolve against.

## Mutation battery (verification protocol, item 2)

36 mutants, each a single defect. Each was applied to a snapshot copy, the three pack test files
were run, and the file was restored from the copy (never `git checkout`). **36 of 36 killed.**
They were:
- the archive skip removed, or widened to any depth;
- DISCOVER's digest ignoring the record, or reading contents without one;
- DISCOVER's note silenced;
- a red checker ignored;
- the schema skipped at classification;
- the hash's NUL dropped;
- the reader trusting a forged hash;
- removed documents never named;
- a changed pack called raw;
- each of the MUST/SHOULD, milestone and Given/When/Then rules removed;
- ranges not expanded;
- trailing ids left in Then;
- the greenfield stack not required, or reported twice;
- a slot declared twice, a package path climbing out, or an unknown slot accepted;
- fences never opening, or closing on any fence;
- the strict separator restored;
- indented bullets swallowed;
- research notes typed as facts;
- milestones left in file order;
- any fact tag accepted;
- SHOULD outranking MUST;
- frontmatter lines not counted;
- the module PRD not required;
- a layout breach accepted;
- a decision-log table outside the four sections accepted;
- `unresolvedIds` ignoring criteria;
- a bold typo ignored;
- catalogue sections ignored.

Two survived the first run, and both are fixed:
- **The first fence mutant was too weak.** It un-blanked only a fence's opening line, which no
  rule can read. Its replacement, "a fence never opens", is killed.
- **"A table outside the four sections accepted" exposed a real gap.** No test put a table under
  any other heading. One does now, and the mutant is killed.

## Recorded, not fixed

- **Nothing routes on the classification yet.** The specification phases do (C-2⁶), and PRDR-284
  carries the test that a conforming pack launches no specification session. Until then a
  conforming pack is planned as any document set is, with ANALYZE forward, and DISCOVER only says
  what it found.
- **Several functions have no production caller:**
  - `conformanceRecord` and `writeConformanceRecord`: VALIDATE is the writer (PRDR-284);
  - `unresolvedIds`: SLICE and PLAN resolve against the pack once they read it (PRDR-291 to
    PRDR-293).

  Each doc-block says so rather than implying a caller.
- **ksarjs's pack does not conform to this schema as it stands:**
  - its index is `docs/prd/PRD.md`;
  - its criteria come in three forms, two of them tables;
  - its decisions are `D1`, not `D-1`, grouped under topic headings;
  - its facts carry `[FACT]` tags.

  Its first `init` therefore takes the specification phase, and WRITE reshapes it. PRDR-280's
  parity criterion ("a fixture cut from the ksarjs pack") needs that cut in this schema's form.
- **A planning session can still read `archive/` with its own tools.** Discovery never hands it
  the originals, but nothing stops a session globbing for them. PRDR-292, which sets the
  planning sessions' tools, now carries it.
- **An approved plan hides a pack edit.** `init` on an approved plan returns before DISCOVER runs
  (C-8), so an edited pack is not named until `--replan`. During `run`, a spec change is X-4⁷'s
  amendment path (PRDR-286).
