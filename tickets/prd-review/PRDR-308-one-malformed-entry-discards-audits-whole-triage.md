---
id: PRDR-308
title: "One malformed entry discards AUDIT's whole triage. The triage artifact is parsed as one schema, so a single entry whose claim_hash is not a sha256 digest refuses every entry, and the relaunch sorts every claim again. On the A/B copy 6 of 145 entries (four hashes cut to 8 characters, two missing characters) threw away the 139 that stood, at $8.32 for the attempt"
state: DONE
severity: major
category: spend
labels: ["prd-review", "specification-phase", "C-2¹⁸", "live-run", "spend", "a-b-test"]
surface: ["src/init/audit-triage.ts", "src/schemas/audit.ts", "detent-prd-v3.md", "tests/init/audit-triage.test.ts"]
prd_refs: ["C-2¹⁸", "C-2¹⁷", "C-4⁗′", "X-1⁵"]
acceptance_criteria: ["The triage artifact's entries are read one by one: an entry the schema refuses, one for a claim the session was not given, and two for one claim are each named in the issue, and every other entry stands. Two entries for one claim leave it with neither, as two briefs do (C-2¹⁸).", "The claims still unsorted after the first attempt, and only they, are given to one relaunch, with the validator's words; what it sorts joins what stood. A claim still unsorted is checked alone, and said, as before.", "What stands after each attempt is kept with the survey (C-2¹⁷) and is a unit of work (X-1⁵); an attempt that sorted nothing is not.", "The PRD records it as C-2¹⁹, with an amendment line on C-2¹⁸.", "Falsifying test: a first triage that sorts three claims, one of them under a hash cut to eight characters. Against HEAD the relaunch is given all three claims and nothing from the first attempt stands; with the fix the relaunch is given the one claim, and the other two keep the first attempt's sort."]
non_goals: ["Does NOT change the audit prompt or what the session is told to write: AUDIT's key covers the prompt, and a live run's completed AUDIT stays valid.", "Does NOT match a mistyped hash to the claim it resembles: a claim whose entry is refused is asked for again.", "Does NOT change how briefs are read; they are read one by one already."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-306"]
depends_on: []
---

# PRDR-308 — one malformed entry discards AUDIT's whole triage

## Where this came from

The A/B test the user asked for on 2026-09-28: arm B runs the 145 claims arm A checked one session
apiece through PRDR-306's triage and grouped checks, on a disposable copy of tabachir's test
clone. B's first triage session wrote 145 entries, and six of their `claim_hash` values were not
sha256 digests: four cut to their first eight characters (`fa445a7f`, `047bc89c`, `dbef71e6`,
`cf4afe2e`) and two missing one and two characters. `claimTriageSchema` holds every entry to
`triageEntrySchema`, so the parse refused the artifact whole, the 139 entries that stood with it,
and `withOneRelaunch` launched the triage again on all 145 claims. The attempt had cost $8.32
(247,636 output tokens), and the relaunch costs about as much again. The live run's triage, over
55 claims, wrote none wrong.

## Problem

A brief is read on its own (`readBriefs`), so one refused brief sends only its claim back. The
triage, which PRDR-306 built beside it, is read as one artifact, so its cost on any failure is the
whole triage twice, and the larger the survey the likelier a failure: 145 hashes of 64 characters
each are 9,280 characters to copy exactly.

## Design

Read the envelope, then each entry with `triageEntrySchema`, as `readBriefs` reads briefs: a
refused entry, a foreign one and a claim sorted twice are issues, and the rest stand. The first
attempt's standing entries are kept; the claims without one go to one relaunch, alone, with the
issues; its entries join the rest. Nothing in the prompt changes.

## Building it

`readTriage` (`src/init/audit-triage.ts`) reads the envelope, then each entry with
`triageEntrySchema`: a refused entry is named by its index with the schema's words, a foreign
entry and a claim sorted twice are named, and two entries for one claim leave it with neither.
`triageSession` no longer goes through `withOneRelaunch`: the first attempt's standing entries are
kept (with the survey, and as a unit of work), the claims without one go to one relaunch with the
issue, and its entries join the rest. `claimTriageSchema`'s `claims` is an array of unknowns, read
entry by entry, as `claimBriefsSchema`'s `briefs` is. The PRD records it as C-2¹⁹, with an
amendment line on C-2¹⁸.

### Vetoable calls

1. **Two entries for one claim leave it with neither**, as two briefs do, rather than the first
   standing, which is what PRDR-306 did for the triage.
2. **Each attempt's standing entries are kept, and each is a unit of work**, so a run stopped during
   the relaunch keeps the first attempt's sort.
3. **The relaunch note names what the first attempt left and why**: "sorted all but N claims
   (issues) — relaunching once for those alone".
4. **No matching of a mistyped hash to the claim it resembles.** A cut hash is usually a unique
   prefix, but a hash with a character dropped in the middle is not, and a guess could file a
   claim's sort under another claim.

## Falsification

Against HEAD (`626b350`), the source untouched and the new case added:

```
× keeps every entry that stands when one is refused, and asks again for that claim alone (C-2¹⁹)
  → expected [ [ …(3) ], [ …(3) ] ] to deeply equal [ [ …(3) ], …(1) ]
```

HEAD's relaunch is given all three claims, the first attempt's two good entries thrown away. With
the fix it is given the one claim whose entry was refused, and the four AUDIT suites pass 52 of
52.

## Mutation battery

Eight mutants of `src/init/audit-triage.ts`, each against `tests/init/audit-triage.test.ts` and
`tests/init/audit-survey-kept.test.ts`, the file restored from a snapshot copy after each and
compared byte for byte after the last:

| Mutant | Result |
|---|---|
| P1 two entries for one claim: the first stands | killed |
| P2 the relaunch given every claim | killed |
| P3 a refused entry discards what stood | killed |
| P4 an attempt's entries not kept | killed |
| P5 an attempt that sorted is not a unit of work | killed |
| P6 no relaunch note | killed |
| P7 an entry for a claim not given stands | killed |
| P8 no relaunch | killed |

8 of 8 killed.

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: 189 files, 2,177 passed and 2 skipped (2,179).
- `npm run plugin`: wrote nothing that changed.

## Recorded, not fixed

- **Echoing 64-character hashes is where the errors are.** Six of 145 entries mistyped theirs. A
  short id per claim, mapped back by code, would remove the copying, but it changes what the
  prompt tells the session, and a changed prompt moves AUDIT's key: a run whose AUDIT has
  completed would audit again. It waits for a moment no run is mid-`init`.
- **Arm B's own run paid the old cost**, since it had loaded PRDR-306's code before this was built:
  its triage relaunch sorted all 145 claims again.

