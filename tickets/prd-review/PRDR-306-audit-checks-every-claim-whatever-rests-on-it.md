---
id: PRDR-306
title: "AUDIT checks every claim the survey lists, each in a session of its own, whatever rests on it. On tabachir 138 checks cost $426: the 77 confirmed changed nothing downstream, and many of the 48 unverified were claims no source could settle. A triage session now sorts the claims first, and only a claim a decision in the documents rests on and a primary source could settle is checked, up to five of a topic to a session. A load-bearing claim no source can settle goes to DECIDE, and one nothing rests on is recorded only"
state: DONE
severity: major
category: capability
labels: ["prd-review", "specification-phase", "C-2¹¹", "C-2¹⁶", "live-run", "spend", "user-decision"]
surface: ["src/init/audit.ts", "src/init/audit-claims.ts", "src/init/audit-triage.ts", "src/init/audit-survey.ts", "src/init/decide-items.ts", "src/schemas/audit.ts", "prompts/audit.md", "prompts/spec_write.md", "prompts/manifest.json", "detent-prd-v3.md", "README.md", "tests/init/audit-triage.test.ts", "tests/init/audit-fixture.ts", "tests/init/audit.test.ts", "tests/init/audit-checks.test.ts", "tests/init/audit-claims-batch.test.ts", "tests/init/audit-survey-kept.test.ts", "tests/init/decide-fixture.ts"]
prd_refs: ["C-2¹¹", "C-2¹²", "C-2¹⁶", "C-2¹⁷", "D-33", "S-5⁵"]
acceptance_criteria: ["After the survey, one `audit` session triages every claim that has no committed brief: whether a decision in the documents rests on it (`load_bearing`), whether a primary source could settle it (`checkable`), its `topic`, and `why`. Code checks that each claim it was given is triaged once and nothing else is. A triage refused is relaunched once with the validator's words, and a claim the second leaves out is checked alone, and said.", "Only a claim triaged load-bearing and checkable is checked. A load-bearing claim no source can settle is recorded `unverified`, unchecked, with `triage: \"uncheckable\"`, and DECIDE receives it. A claim nothing rests on is recorded `unverified`, unchecked, with `triage: \"not_load_bearing\"`, and DECIDE does not receive it.", "The claims to check are grouped by topic, at most `AUDIT_CLAIMS_PER_SESSION` (five) to a `verify_claims` session, which writes one brief per claim. Each brief is checked as a brief always was and committed under its own hash. A brief missing or refused is asked for once more, in a session given only the claims still without one, and a claim still without one is recorded unverified and unchecked.", "A claim with a committed brief is answered from it, whatever a triage would say, and is not triaged.", "A triage that cannot be read after its relaunch leaves every claim to be checked alone, and says so.", "The triage is kept with the survey until AUDIT completes (C-2¹⁷), so a re-run neither surveys nor triages again.", "The groups run `AUDIT_CLAIM_BATCH` sessions at once (C-2¹⁶), and every session stays on the `audit` role's routing: claude-opus-5-5 at max (S-5⁵).", "The PRD records the user's decision as D-34 and the mechanism as C-2¹⁸, with amendment lines on C-2¹¹, C-2¹², C-2¹⁶ and C-2¹⁷. The audit prompt describes its three tasks.", "Falsifying test: a claim nothing rests on, a load-bearing claim no source can settle, and eight load-bearing checkable claims in two topics. Against HEAD every claim gets a session of its own. With the fix there is one triage session and three check sessions (five, two and one), and DECIDE is given the uncheckable claim and not the other. The ticket records the failure against HEAD."]
non_goals: ["Does NOT change the survey's instructions or what it finds.", "Does NOT change the routing: the checks stay on claude-opus-5-5 at max (the user's decision, 2026-09-28).", "Does NOT merge near-duplicate claims; topic grouping puts them in one session.", "Does NOT change the brief cache's key: the claim and its subject."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-281", "PRDR-304", "PRDR-305"]
depends_on: []
---

# PRDR-306 — AUDIT checks every claim, whatever rests on it

## Where this came from

The tabachir test run, 2026-09-28, on `5de1ac8`. The survey found 200 claims in 23 documents, and
AUDIT checked each in a session of its own on claude-opus-5-5 at max, 40 to 87 turns apiece. By
08:06, 138 checks had cost $426: 77 confirmed, 13 wrong, 48 unverified. DECIDE receives only the
claims that are not confirmed (`openItems`), so the 77 confirmations, about $238, changed nothing.
Many of the 48 unverified were claims no primary source could settle: how Algerian teachers find
their tools, what a market holds, what a ministry plans. The 13 wrong ones, about $40 of checks,
were the payoff. The survey's size also moved between runs on the same documents, 132 claims and
then 200, and the cost follows it.

The user was asked whether this was the right workflow and chose to stop AUDIT and triage the
claims. The four decisions, 2026-09-28:

1. **Scope.** A claim gets a check only when a decision in the documents rests on it and a primary
   source could settle it.
2. **Unchecked claims.** A load-bearing claim no source can settle goes to DECIDE as an assumption
   to settle. A claim nothing rests on is recorded in AUDIT's checkpoint only.
3. **Grouping.** By topic, up to five claims to a session.
4. **Model.** Unchanged: claude-opus-5-5 at max. Quality first; the triage and the grouping do the
   saving.

## Problem

`checkClaims` (`src/init/audit-claims.ts`) launches one `verify_claim` session for every claim it
has no brief for. Nothing asks whether anything rests on a claim or whether any source could
settle it, and claims about one law or one licence each find the same sources again.

## Design

A triage step between the survey and the checks: one `audit` session given every claim that has
no brief, which writes `load_bearing`, `checkable`, `topic` and `why` for each. Code checks it,
relaunches it once, and keeps it with the survey (C-2¹⁷). The claims triaged load-bearing and
checkable are grouped by topic, five at most to a group, and each group is one `verify_claims`
session writing one brief per claim, validated and committed as before. The groups run four at a
time (C-2¹⁶). The rest are recorded unverified and unchecked with their triage, and DECIDE skips
the ones nothing rests on.

## Building it

`src/init/audit-triage.ts` is new and holds the triage: `sortClaims` sorts the claims with no brief
by what an earlier run kept and by one session for the rest; `triageSession` reads the session's
artifact strictly on the first attempt and leniently on the relaunch (`withOneRelaunch`, as the
survey does), notes the claims it left unsorted, keeps what it sorted and marks progress;
`sortedAs` maps an entry to `check` with a normalized topic, `uncheckable` or `not_load_bearing`,
and an unsorted claim to a topic of its own; `checkGroups` groups by topic in the order each first
appears and cuts each topic into sessions of `AUDIT_CLAIMS_PER_SESSION`.

`checkClaims` (`src/init/audit-claims.ts`) answers every claim with a committed brief first, sorts
the rest, records the ones kept from a check as `unverified`, unchecked, with their `triage`, and
checks the groups in C-2¹⁶'s batch. `checkGroup` launches one `verify_claims` session per group and
reads its briefs one by one (`readBriefs`), each with every check `briefFrom` gives a brief; a
brief refused, missing, for a claim not given, or one of two for the same claim leaves its claim
for one more session given only the claims still without a brief. `claimBriefsSkeleton` hands the
session the envelope and a brief's shape for each verdict.

`src/schemas/audit.ts` adds the triage entry, the triage artifact, `CLAIM_TRIAGE` and the briefs
envelope. `src/init/audit-survey.ts` keeps the triage in the kept survey's record, merged by hash,
and a survey kept anew keeps none. `auditStage` wires the triage and check sessions and adds the
note: the counts line counts the claims not checked apart from the unverified, an uncheckable
claim is listed as one "no source could settle", and a line says what the triage did.
`openItems` (`src/init/decide-items.ts`) skips a claim nothing rests on. `prompts/audit.md`
describes the three tasks, its survey paragraph byte-identical, and `prompts/spec_write.md` no
longer tells WRITE that every claim was checked. The PRD records the decision as D-34 and the
mechanism as C-2¹⁸, with amendment lines on C-2¹¹, C-2¹², C-2¹⁶ and C-2¹⁷; the README's AUDIT
line says what is checked.

The four AUDIT suites that drove one claim per session (`audit`, `audit-claims-batch`,
`audit-survey-kept`, and DECIDE's fixture) now answer the triage by checking every claim alone, so
each session is still one claim and what they test is unchanged; the counts that include the
triage session moved by one. `tests/init/audit-fixture.ts` holds the stub answers.

### Vetoable calls

1. **One triage session for every claim without a brief**, not one per document: load-bearing is
   judged against the documents, and one session words the topics that group claims.
2. **The triage is an `audit` session**, on the role's routing (claude-opus-5-5 at max). The user's
   decision 4 named the checks; a cheaper triage is a question for run-time outcomes (D-33).
3. **Topics are compared without regard to case or spacing**, and any other difference in wording
   splits them.
4. **Groups in the order each topic first appears**, and a topic's claims cut into fives in the
   survey's order.
5. **A claim the triage leaves unsorted is checked alone**, as C-2¹¹ checked it, not dropped and not
   sent to DECIDE. A triage unreadable twice leaves every claim checked alone: the phase goes on,
   at the old cost, and says so.
6. **A committed brief answers first**, whatever a triage would say, and its claim is not triaged.
7. **A claim nothing rests on keeps the verdict `unverified`**, with `triage` saying why. No new
   verdict: every reader of verdicts is unchanged, WRITE tags it `unverified` as it must, and
   DECIDE skips it by its `triage`.
8. **Two briefs for one claim leave it with neither**, and it is asked for again: nothing says which
   the session meant. The first draft took the first; the test found no reason to prefer it.
9. **One more session for the claims a group left without a brief**, given only those, not one per
   claim.
10. **A triage that sorted anything is a unit of work (X-1⁵)**; one that sorted nothing is not.
11. **The triage is kept in the kept survey's record**, merged by hash, and a survey kept anew keeps
    none: a new survey's claims are sorted afresh.
12. **AUDIT's research counts the triage's session and calls** with the checks' against
    `planning_research_tool_calls`.
13. **The note** counts the claims not checked apart from the unverified, lists an uncheckable
    claim as one no source could settle, and adds a triage line only when the triage kept a claim
    from a check.
14. **The new prompt moves AUDIT's key**, as any prompt change does (C-2¹¹), so a survey kept by an
    earlier build is surveyed again. The survey paragraph is unchanged, byte for byte.
15. **`verify_claims` is handed `brief_shapes`** for the three verdicts, and an envelope whose one
    example brief is the confirmed shape; a brief's issues are named by its index.
16. **A check session's artifact path is keyed by its group's first claim**, which belongs to that
    group alone (D-19).
17. **WRITE's prompt is corrected**, one clause: a claim that carries `triage` was not checked.

## Falsification

Against HEAD (`5de1ac8`), in a `git archive` with the new test file and its fixture copied in, all
eleven fail:

```
× checks only what a decision rests on and a source could settle, five of a topic to a session
  → expected [ 'survey', 'verify_claim', …(19) ] to deeply equal [ 'survey', 'triage', …(3) ]
× gives DECIDE the load-bearing claim no source can settle, and not the claim nothing rests on
  → expected [ …(3) ] to deeply equal [ Array(1) ]
× answers a claim with a committed brief from it, and does not triage it
  → Cannot read properties of undefined (reading 'promptVariable')
× asks once more, alone, for a brief a group left out, and records the claim unchecked when it is left out again
  → expected [] to deeply equal [ [ …(3) ], …(1) ]
× checks alone a claim the relaunched triage still leaves out, and says so
  → expected [ 'survey', 'verify_claim', …(3) ] to deeply equal [ 'survey', 'triage', 'triage', …(2) ]
× takes neither of two briefs for one claim, and asks for it again alone
  → expected [] to deeply equal [ [ …(2) ], …(1) ]
× keeps its triage with the survey, so a re-run sorts only what no run has sorted, and keeps each sort (C-2¹⁷)
  → promise resolved "{ exitCode: +0, …(6) }" instead of rejecting
× a triage kept is a unit of work, so the first check starts from it (X-1⁵)
  → the triage's spend is behind the mark before any brief lands: expected 0 to be greater than 0
× adds what a triage sorts to what is kept, and keeps nothing where no survey is kept under the key
  → (0 , keepTriage) is not a function
× checks every claim alone when the triage cannot be read twice, and says so
  → expected [ 'survey', 'verify_claim', …(5) ] to deeply equal [ 'survey', 'triage', 'triage', …(3) ]
× refuses a triage that sorts a claim it was not given, or one claim twice, and names both
  → Cannot read properties of undefined (reading 'promptVariable')
```

HEAD gives every claim a session of its own: after the survey, twenty for the first case's ten
claims, each relaunched once because HEAD reads a brief per session and not the new envelope. It
gives DECIDE three items, every claim unverified, where the fix gives one. The two
`promptVariable` failures are tests that look for a triage session, which HEAD never launches.
With the fix all eleven pass.

## Mutation battery

Thirty-four mutants of `audit-triage.ts`, `audit-claims.ts`, `audit.ts`, `audit-survey.ts` and
`decide-items.ts`, each against the new test and the AUDIT and DECIDE suites it could reach, every
file restored from an in-memory snapshot after each and checked byte for byte:

| Mutant | Result |
|---|---|
| T01 a claim nothing rests on is checked | killed |
| T02 a claim no source could settle is checked | killed |
| T03 six claims to a session | killed |
| T04 every claim checked alone | killed |
| T05 topics grouped by their exact words | killed |
| T06 the kept triage never read | killed |
| T07 the first triage taken whatever it left out | killed |
| T08 no note for unsorted claims | killed |
| T09 the triage never kept | killed |
| T10 a triage is not a unit of work | killed |
| T11 only a topic's first five checked | killed |
| T12 unsorted claims share one session | killed |
| T13 an entry for a claim not given taken | killed |
| T14 a claim sorted twice taken twice | killed |
| T15 every claim triaged again on a re-run | killed |
| T16 a triage that sorted nothing marks progress | killed |
| C01 a committed brief does not answer first | killed |
| C02 no triage recorded on the claim | killed |
| C03 the whole group relaunched | killed |
| C04 the first of two briefs taken | killed |
| C05 a brief for a claim not given taken | killed |
| C06b every claim checked whatever the triage says | killed |
| D01 DECIDE given the claim nothing rests on | killed |
| A01 no triage note | killed |
| A02 a claim nothing rests on counted unverified | killed |
| A03 an uncheckable claim reads as never checked | killed |
| A04 the kept triage not handed to the checks | killed |
| A05 the triage not written to the kept survey | killed |
| A06 the triage not given the documents | killed |
| A07 a check not given the brief shapes | killed |
| A08 the counts line hides the claims not checked | killed |
| S01 a later triage replaces the kept one | killed |
| S02 the kept triage never read back | killed |

33 of 33 valid mutants killed. C06's first form left a dangling `else`, so the file did not
compile and its kill counted nothing; it was re-run as C06b, replacing both lines, and killed.
The battery's list was written against the first draft of the tests, which had no case for a
triage entry the session was not given, one sorted twice, or a triage that sorted nothing; the two
cases that exercise T13, T14 and T16 were added before it ran.

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: 189 files, 2,174 passed and 2 skipped (2,176).
- `npm run plugin`: wrote nothing that changed.

## Found along the way

- **WRITE's prompt said every claim was checked.** `prompts/spec_write.md` told the session that
  `claims` "are the external claims AUDIT checked"; with a triage, some are recorded unchecked. The
  clause now says a claim carrying `triage` was not checked and is unverified. WRITE already tags
  an unverified claim `unverified` in the facts, so what it writes is unchanged.
- **A guard the triage made redundant.** `checkClaims` skipped `sortClaims` when no claim was
  pending, which `sortClaims` already does by launching nothing; the guard is gone.

## Recorded, not fixed

- **The survey's size is unstable.** Two surveys of tabachir's unchanged documents listed 132 and
  200 claims. The triage bounds what is checked, not what is surveyed, and the triage session's own
  cost follows the survey's count.
- **A triage can be wrong.** A claim marked not load-bearing is never checked and never reaches
  DECIDE. It is recorded with the triage's `why` in AUDIT's checkpoint and counted in the note, so
  the operator can see it, but nothing checks the triage itself. Whether that costs a run anything
  is a question for run-time outcomes (D-33).

