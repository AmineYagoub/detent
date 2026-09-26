---
id: PRDR-280
title: "Nothing mechanical checks a pack's cross-references. ksarjs's checker caught a route a PRD used and the route inventory lacked, and Detent's own PRD gave nine marks to more than one rule each until PRDR-287 and PRDR-288 renumbered them. A deterministic pack checker becomes a referee gate, and a red result blocks planning"
state: DONE
severity: major
category: capability
labels: ["prd-review", "specification-phase", "operator-decision", "referee", "determinism"]
surface: ["src/init/pack-check.ts", "src/init/pack-check-rules.ts", "src/init/pack-check-refs.ts", "src/init/pack.ts", "src/init/pack-parse.ts", "src/init/pack-markdown.ts", "src/schemas/pack.ts", "detent-prd-v3.md", "tests/init/pack-check.test.ts", "tests/init/pack-parity.test.ts", "tests/init/pack.test.ts", "tests/init/pack-discover.test.ts", "tests/fixtures/pack/", "tickets/prd-review/"]
prd_refs: ["ARCH-2", "C-2⁷", "C-2⁹", "C-2¹⁰", "D-26", "F-3", "PRDR-263", "PRDR-278", "PRDR-279"]
acceptance_criteria: ["Each rule has a fixture that fails it and one that passes: every id is defined exactly once; every reference to a requirement, criterion, decision, fact or section resolves; every error code, event, setting, job and route a PRD uses is in its catalogue, when the pack has one; every requirement has a criterion, and no criterion names an unknown requirement; milestone order holds where the schema states a dependency, so no criterion tests a requirement a later milestone delivers (C-2¹⁰).", "The present-indicative rule reports and never blocks, and the checker's own output says the rule is a heuristic. Its findings reaching VALIDATE's reviewers moved to PRDR-284 on 2026-09-26.", "Deterministic: no model, no network and no clock. The same pack gives byte-identical output, and each finding names its rule, its `file:line` and the offending text.", "A referee gate on `init`'s one pipeline, which both drivers run (ARCH-2): DISCOVER calls a pack conforming only when the checker is green on it now. Blocking every phase after VALIDATE, and running at VALIDATE, moved to PRDR-284 on 2026-09-26; running on every amendment is PRDR-286's.", "Parity with its seed: on the ksarjs pack converted into the schema, it reports nothing in any class `~/ksar-spec-tools/check_pack.py` checks, as the script reports nothing, and each of the script's ported catch types seeded into it is reported by both. A committed fixture in the ksarjs pack's shapes, with content of its own, is green and reports each of those catch types seeded into it.", "Like `scripts/check-tickets.ts`, it prints what it does not check, so a green result is not read as a review."]
non_goals: ["Does NOT judge meaning. A rule that is consistent and wrong passes the checker; VALIDATE's reviewers and simulations are for that (PRDR-284, PRDR-285).", "Does NOT gate Detent's own repository on `detent-prd-v3.md`. The PRD is not a pack. `tests/docs/prd-requirement-ids.test.ts` (PRDR-287) already keeps its marks unique, and the duplicates PRDR-287 and PRDR-288 renumbered are this ticket's evidence, not its failure.", "Does NOT fix what it finds; VALIDATE's writer does."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-192", "PRDR-263", "PRDR-279", "PRDR-284", "PRDR-286", "PRDR-287", "PRDR-288"]
depends_on: ["PRDR-279"]
---

# PRDR-280 — the pack checker, a referee gate

## Where this came from

ksarjs's `check_pack.py`, kept at `~/ksar-spec-tools/`, ran after every fix round. It checks what
reading does not reliably see: ids defined twice, references that resolve to nothing, catalogue
entries a PRD uses and no catalogue holds, requirements with no criterion. It caught
`POST /store/customers/me/addresses`, used by a PRD and missing from the route inventory, and
the specification ended at zero problems.

Its first rule would have failed on Detent's own PRD. Until PRDR-287 and PRDR-288 (2026-09-26),
`detent-prd-v3.md` gave nine marks to more than one rule each: C-3″ named both PRDR-119 and
PRDR-207, and C-9′ three rules. Ten definitions moved, and `tests/docs/prd-requirement-ids.test.ts`
now keeps that one document's marks unique, as this checker will for every pack.

## Design

The plan's §5: a TypeScript port of the script, generalized to PRDR-279's schema, and run by the
referee so neither driver can skip it. The present-indicative rule is the one heuristic, so it
reports to the reviewers instead of blocking. The checker states its blind spots in its own
output, the way `scripts/check-tickets.ts` (PRDR-192) does.

## Falsification (verification protocol, item 1)

The tests were written first and run against HEAD `0a92eff`, before any of the checker existed:

```
 ❯ tests/init/pack-discover.test.ts (9 tests | 1 failed)
   × PRDR-279: DISCOVER classifies the document set (C-2⁷) > says what the checker does not check when it calls a pack conforming (PRDR-280)
     → Cannot find module '../../src/init/pack-check.js' imported from '/Users/workstation/detent/tests/init/pack-discover.test.ts'
 ❯ tests/init/pack.test.ts (15 tests | 1 failed)
   × PRDR-280: conformance runs the checker, not only the schema > does not call a pack conforming while its checker is red now, whatever its record says
     → expected { kind: 'conforming', …(2) } to match object { kind: 'changed', added: [], …(2) }
 FAIL  tests/init/pack-check.test.ts [ tests/init/pack-check.test.ts ]
Error: Cannot find module '../../src/init/pack-check.js' imported from '/Users/workstation/detent/tests/init/pack-check.test.ts'
      Tests  2 failed | 22 passed (24)
```

The behavioural failure is the second one. A pack whose criterion names a requirement nothing
defines, and whose record says its checker was green, is called conforming, because DISCOVER ran
only the schema. The other two fail because the checker does not exist yet.

## What changed

- **`src/init/pack-check.ts`** (new): `checkPack`, `renderPackCheck` and `UNCHECKED`. It runs the
  schema and every rule, then puts each finding in its place:
  - it quotes its line;
  - it blocks unless it is the heuristic's;
  - it appears once;
  - it is sorted by file, line, rule and message in code-unit order, never locale order.

  The render ends with the eight properties the checker does not check.
- **`src/init/pack-check-rules.ts`** (new): the rules over entries:
  - ids defined once;
  - requirement ids without gaps;
  - the registry;
  - coverage;
  - milestone order between a criterion and what it tests;
  - the present-indicative heuristic, over requirements.
- **`src/init/pack-check-refs.ts`** (new): the rules over text:
  - references, where context documents count only requirement and criterion ids under registered codes;
  - `§` sections;
  - relative links;
  - catalogue entries, each once and each route `METHOD /path`;
  - catalogue uses, with routes matched through `{a,b}`, `[/x]`, parameters and example values.
- **`src/init/pack.ts`**:
  - `classifyPack` reasons from the checker's blocking findings, as `file:line [rule] message`, so a pack is conforming only when the checker is green on it now;
  - `packNote`'s conforming note lists what the checker does not check.
- **`src/init/pack-parse.ts`**:
  - `ParsedPack.refused` holds the ids of entries the schema refused, so one defect is one finding;
  - the bold-id rule is narrowed to heads shaped like requirement or criterion ids;
  - `namedRequirements` is exported;
  - catalogue sections come from the schema.
- **`src/init/pack-markdown.ts`**: `Bullet.text`, the bullet's first line as written, is what a finding quotes.
- **`src/schemas/pack.ts`**:
  - `CATALOGUE_SECTIONS` and `CatalogueKind` move here;
  - `CRITERION_REF` is added.
- **`detent-prd-v3.md`**: C-2¹⁰, with pointers on C-2⁷ and C-2⁹.
- **Tests:**
  - `tests/init/pack-check.test.ts` (60);
  - `tests/init/pack-parity.test.ts` (18);
  - two in `tests/init/pack.test.ts`;
  - one in `tests/init/pack-discover.test.ts`;
  - the fixture pack, `tests/fixtures/pack/` (11 files).
- **PRDR-284** gains the two criteria moved from this ticket.

## Criteria refined

Three criteria asked for behaviour of phases that tickets depending on this one build, and a
fourth promised a rule the parity run showed a blocking check cannot decide.

As filed, the second:

> The present-indicative rule reports and never blocks. Its findings go to VALIDATE's reviewers,
> and the checker's own output says the rule is a heuristic.

the fourth:

> A referee gate: both drivers reach it through the same referee path (ARCH-2). A red result
> blocks every phase after VALIDATE. It runs at VALIDATE and on every amendment (PRDR-286).

and the fifth:

> Parity with its seed: on a fixture cut from the ksarjs pack, it reports what
> `~/ksar-spec-tools/check_pack.py` reports, zero problems; seeded with that script's catches, it
> reports the same findings.

VALIDATE does not exist until PRDR-284, which depends on this ticket. A test that a red checker
blocks the phases after it, or that reviewers receive the heuristic's reports, would pass
against any input today. PRDR-279 moved its routing half the same way. Both halves moved to
PRDR-284, as criteria of their own. Running on every amendment was already PRDR-286's ("the
checker gates it (PRDR-280)").

This ticket keeps the half it can prove. The checker is wired where `init` reads conformance
today: DISCOVER's classification calls a pack conforming only when the checker is green on it
now. `init` is one pipeline for both drivers (the plugin's skill runs `tsx src/cli/index.ts
init`), so both reach the checker the same way (ARCH-2), with no referee tool of its own.

The fifth moved from a literal cut to a fixture in ksarjs's shapes. The ksarjs pack is
unpublished: `origin/main` of `ksarjs/ksar` holds only `LICENSE`, and the founder pushes. This
repository is public, so a literal cut would publish the founder's specification before the
founder does. The full-pack run happened locally instead, and is recorded below. The committed
fixture is a pack in the same shapes with content of its own.

The first criterion's "milestone order holds" is refined to what a blocking rule can decide:
no criterion tests a requirement a later milestone delivers. The requirement half is listed
among what the checker does not check (see the parity run, and call 2).

## Parity with the seed (the fifth criterion)

**The run.** A scratch converter, not committed, reshaped `~/ksar/docs` and its README into
C-2⁹'s schema. It changes shape and never content:
- `D1` becomes `D-1`, and the two suffixed decisions, `D32a` and `D52a`, become `D-67` and
  `D-68`; `X1` becomes `X-1`;
- `AC-SHP-01` becomes `SHP-AC-01`, and code-less criteria take the code of the first
  requirement they name that their file holds;
- requirement and criterion tables become bold bullets, a criterion's milestone coming from its
  row or from the latest requirement it names;
- the decision log gets its four sections, and the facts their tag column;
- `catalogues.md` gets `## 6. Routes` from `api-conventions.md` §1 and §7, the seed's own
  whitelists (Medusa core routes, Medusa's events, `test_locked`), and the two method-less
  webhook rows written as `POST`;
- a stack entry is added, and `PRD.md` becomes `index.md`.

`check_pack.py` on the original reports `requirements defined: 2024 in 13 module PRDs; problems:
0`. The checker on the conversion parses 2,022 requirements and 1,125 criteria. The schema
refuses 2 requirements and 19 criteria, which makes ksarjs's 2,024 and 1,144.

**Rounds.** Round 1 gave 674 findings. Each was a converter bug, fixed in the converter, or a
checker false positive, fixed in the checker and pinned by a test:
- 17 spikes under bold heads (`**S-1**`) read as malformed ids;
- a refused requirement or criterion reported again as a gap, a reference or an untested
  requirement;
- a criterion naming a withdrawn requirement refused. ksarjs does that on purpose, to check it
  stays unbuilt, so that rule was removed;
- 62 namings of a later milestone's requirement by a requirement, each read as a dependency;
- 137 lexical "already built" reports in design documents;
- the verb "setting `x`" read as a setting;
- routes under `/health`, `/metrics` and `/auth` read as the pack's;
- example segments (`/vendor/products/Q`) read as literal paths;
- bold screen names read as sentences;
- citations inside parentheses split into sentences.

Round 3 gave nothing in any class the seed checks:
- ids defined twice, gaps, the registry;
- references to requirements, decisions, defaults and facts;
- sections, links, routes, error codes, events and jobs.

**Seeded.** Each of the script's catch types was appended to a fresh copy of ksarjs, then checked
by the script on the original and by the checker on the conversion. **Both reported all 17**,
each at the same file:
- a requirement defined twice;
- an unregistered code;
- a requirement outside its code's PRD;
- no milestone tag;
- a milestone the registry does not allow;
- a gap;
- an undefined requirement;
- an undefined decision;
- an undefined default;
- an undefined fact;
- an undefined section;
- a route outside the inventory;
- a bare path outside it;
- a broken link;
- an error code outside the catalogue;
- an event outside the catalogue;
- a job outside the catalogue.

Where the checker also reported the injected requirement as untested, that is true.
`tests/init/pack-parity.test.ts` repeats the seventeen on the committed fixture, each test named
with the script's own wording. The script's ksarjs-only catches are not ported:
- frontmatter keys;
- its PRD section template;
- its permission catalogue;
- its process leftovers;
- its spike references.

**What the checker adds: 35 blocking findings on ksarjs**, in classes the script never checked.
Each is a real property of the pack:
- **19 criteria state no When** ("Given …, then …"), across nine modules.
- **9 criteria are under a code the registry does not hold**: the pack's cross-module flows,
  whose ids name no module.
- **4 requirements are tested by no criterion.**
- **2 requirements only say MAY.** C-2⁷ says requirements use MUST and SHOULD.
- **1 decision has no reason**: its Notes cell is empty.

The heuristic reported 17 requirement sentences. Some are what it is for: a requirement stating
in the present tense what a cart never does. Others are process notes, such as a requirement's
line on how review inspects it. The whole pack checks in about 130 ms.

The ksarjs pack is unpublished, so this ticket quotes none of its sentences and names none of
its findings by id. The ids went to the operator on 2026-09-26.

## Calls for the operator's veto

1. **Where it runs now.** It runs at DISCOVER's classification: conforming requires the checker
   green on the documents now, and the note lists what it does not check. The phases that act
   on a red result are PRDR-284's and PRDR-286's. No R-1 referee tool was added, because `init`
   is one pipeline for both drivers.
2. **Milestone order is checked between a criterion and what it tests, and nowhere else.** Read
   as a dependency, a requirement naming a later one is a blocking finding: 65 on ksarjs, from 47
   requirements (round 1 gave 62, before the converter read every requirement row). Many are
   forward pointers, such as a requirement naming the later one that will use the hook it
   provides. The requirement half is listed as not checked, and C-2⁷'s rule for it is VALIDATE's
   reviewers' to judge.
3. **The heuristic reads requirements only.** Read for "already", "currently" and "is built",
   ksarjs's documents gave 137 reports. One was a claim about code: a design document saying its
   rules are implemented. Design documents describe the design in the present tense by nature.
4. **Routes are read under the catalogue's own first path segments.** The seed hard-coded
   ksarjs's `/store`, `/vendor`, `/admin` and `/hooks`. The checker reads the prefixes the
   pack's own routes use, so a framework's `GET /health` is not a missing route. A route under a
   new prefix is listed as not checked.
5. **An example value in capitals is a parameter.** `/vendor/products/Q` matches
   `/vendor/products/:id`. The seed skipped such paths entirely; the checker still checks their
   method and shape.
6. **A setting is read only as the noun**, "the setting `x`", "a setting" or "marketplace
   setting". On ksarjs, "setting `x`" in any sentence took 48 uses: the 34 the noun reading
   takes, each in the catalogue, and 14 that name no catalogue setting, 13 of them the verb
   ("…, setting `x`"). The other order, "the `x` setting", named a vendor's own setting, or a
   key inside one, in 2 of its 6 uses, so it is not read.
7. **Context documents** are read for requirement and criterion ids under registered codes, and
   for links. A README's "step D-9" is its own.
8. **The committed fixture is ksarjs's shapes with its own content** (see Criteria refined). The
   full-pack evidence is in this ticket, as counts and classes: no ksarjs sentence is quoted,
   and no ksarjs finding is named by id.
9. **Bold ids of another family are prose.** This changes PRDR-279's grammar: only heads shaped
   like requirement or criterion ids (`-F-`, `-N-`, `-AC-` and digits) are reported when the
   grammar refuses them, so ksarjs's `**S-1**` spikes pass.
10. **A route cell is `METHOD /path`.** ksarjs's two method-less webhook rows would be refused.
    The converter wrote them as `POST`.
11. **A catalogue section holds only its entries.** A table of anything else under it is refused,
    as ksarjs's increment bands under its settings would be. The converter moved them under a
    heading of their own.
12. **One defect is one finding.** A reference to an entry the schema refused resolves, its
    number fills its sequence, and the requirements a refused criterion names count as tested.
13. **A link out of the repository is refused**, since whether it resolves would depend on the
    machine. A link starting `/` resolves from the root, as a repository host renders it.

## Mutation battery (verification protocol, item 2)

57 mutants, each a single defect in `pack-check.ts`, `pack-check-rules.ts`, `pack-check-refs.ts`,
`pack-parse.ts` or `pack.ts`. Each file was copied before its mutant was applied, the five pack
test files were run, and the file was restored from the copy (never `git checkout`). A hash
compare confirmed each restore, and at the end `src/` matched the copy taken before the battery.
**57 of 57 killed**, all on the first run. They were:
- **The result:** the heuristic blocking; green only with no finding at all; findings not
  quoting their line, not sorted, or not deduplicated; the render without the unchecked list.
- **Rules left out of the run:** the section, catalogue-entry and coverage rules.
- **Ids and gaps:** facts not checked for uniqueness; the sequence ignoring refused ids.
- **The registry:**
  - the file check removed;
  - the milestone check removed;
  - a refused code's entries reported as unregistered;
  - the entries of a code whose PRD is missing reported.
- **Coverage and milestone order:** refused criteria not counting as tests; withdrawn requirements
  not exempt; equal milestones refused.
- **The heuristic:**
  - MUST ignored;
  - parentheticals kept;
  - the bold label read;
  - fragments read;
  - double spaces kept in the quote;
  - withdrawn requirements read.
- **References:**
  - context documents read under any code, or read for decisions;
  - refused ids undefined;
  - a decision id read inside a longer token;
  - a fact range's end unchecked, or a section range's;
  - a bare facts section not resolved by prefix;
  - the registry's milestones not resolved;
  - a missing `.md` document ignored;
  - an unknown bare name read as a document;
  - `verified-facts` read as a section reference;
  - the line lookup off by one at a line start.
- **Links:** schemes resolved; links in backticks read; links allowed out of the repository; root
  links resolved from the linking document.
- **Catalogues:**
  - every kind checked, whether or not its section exists;
  - the catalogue read as its own use;
  - routes read under any prefix;
  - example values not read as parameters;
  - alternatives not expanded, or optional segments;
  - namespace paths refused;
  - wildcard paths read, or elided ones;
  - the verb "setting" read;
  - a route cell without a method accepted;
  - route duplicates compared as written;
  - bare paths never known.
- **Parse and classification:**
  - the broad bold-id rule restored;
  - refused ids not recorded;
  - heuristic reports counted against conformance;
  - the conforming note without the unchecked list.

While the battery was being written, one planned mutant, removing the sort in the duplicate
rule, proved equivalent. The parse keeps entries in document order, so the sort did nothing. The
sort was removed from the code, and its doc-block says why. After the battery, three doc-blocks
were reworded; no code changed.

## Recorded, not fixed

- **ksarjs's 35 findings.** They belong to the founder's pack, which the checker has not been run
  against in place. The operator has their ids, for the founder.
- **Each markdown document is read twice**, once by the parse and once for the line map. ksarjs's
  2 MB checks in about 130 ms, so a shared reader is not worth its coupling yet.
- **A criterion id written without its code**, such as a bare `AC-1` in prose, is not an id in
  the schema's grammar and is not checked.
- **Decision references differ from the script's.** The script checks `D` references against the
  highest decision number. The checker checks each against the decisions defined, which is
  stricter; ksarjs passes both.
