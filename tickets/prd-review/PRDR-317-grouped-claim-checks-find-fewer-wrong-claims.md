---
id: PRDR-317
title: "AUDIT's grouped checks find fewer wrong claims than a session per claim. C-2¹⁸ checks up to five claims of one topic in each `verify_claims` session. The A/B test on tabachir's 145 claims ran both ways on the same model and effort. Of the 107 claims both arms checked, a session per claim found 11 wrong and grouped checks found 8. The grouped checks left four of those eleven unverified and confirmed a fifth, spending about 28 turns per claim against 51. One of the four is that Chargily is a payment channel approved for online sales, which Law 18-05 Art. 27 contradicts. The user decided that quality comes before cost, so each claim the triage sends to a check now gets a session of its own. The triage and PRDR-309's rule for absence claims stay"
state: DONE
severity: major
category: quality
labels: ["prd-review", "specification-phase", "C-2¹⁸", "C-2¹⁶", "live-run", "user-decision", "prompt"]
surface: ["src/schemas/audit.ts", "src/init/audit-triage.ts", "src/init/audit-claims.ts", "src/init/audit.ts", "prompts/audit.md", "prompts/manifest.json", "tests/init/audit-triage.test.ts", "tests/init/audit-fixture.ts", "README.md", "detent-prd-v3.md"]
prd_refs: ["D-34", "C-2¹¹", "C-2¹⁶", "C-2¹⁸", "C-2²⁰"]
acceptance_criteria: ["Each claim the triage sends to a check gets a `verify_claims` session of its own, which is given only that claim. A claim sent to a check is one that is load-bearing and checkable, or one the triage left unsorted. The sessions run `AUDIT_CLAIM_BATCH` (four) at a time, as C-2¹⁶ runs them.", "The triage is not asked for a `topic`. The skeleton and the prompt drop the field, and the schema refuses it as it refuses any unknown key (P2). The prompt says that each claim checked gets a session of its own.", "The `verify_claims` prompt refers to the one claim in `claims` and the one brief in `briefs`. It no longer says the claims share a topic.", "The rest of PRDR-306, PRDR-308 and PRDR-309 stands. This covers the triage and its kept entries, and the rule for absence claims. A missing or refused brief is asked for once more with the validator's words. A claim with no brief after that is recorded unverified and unchecked. Two briefs for one claim leave it with neither, and a brief for a claim the session was not given is refused.", "The PRD records the user's decision as D-34′, with amendment lines on D-34, C-2¹¹, C-2¹⁶ and C-2¹⁸. The README says each checked claim gets a session of its own.", "Falsifying tests, against HEAD: three claims the triage sorts as its skeleton asks go to one `verify_claims` session. The triage's skeleton and schema ask for a `topic`. The `verify_claims` prompt says the claims share a topic."]
non_goals: ["Does NOT remove the triage. D-34 still decides which claims are checked, and PRDR-309's rule for absence claims stands.", "Does NOT change the routing (claude-opus-5-5 at max, S-5⁵) or the batch of four sessions at a time (C-2¹⁶).", "Does NOT change the envelope a check session writes. It still writes `briefs`, which now holds one entry, and its reading and checks are unchanged.", "Does NOT touch the stopped test run's pin, whose prompts stay those its AUDIT ran on."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-306", "PRDR-304", "PRDR-308", "PRDR-309"]
depends_on: []
---

# PRDR-317 — AUDIT's grouped checks find fewer wrong claims than a session per claim

## Where this came from

The user asked for an A/B test of C-2¹⁸ before its grouped checks ran on another project. Both
arms took the same 145 claims, with the survey's wording, on claude-opus-5-5 at max effort, four
sessions at a time. Arm A checked each claim in a session of its own, as C-2¹¹ did. Arm B ran
PRDR-306's triage and grouped checks. B's triage sent 107 claims to a check, and B checked them in
65 sessions, 1.65 claims per session with relaunches included.

| | sessions | cost | turns |
|---|---|---|---|
| A: a session per claim | 145 | $453.47 | 7,388 |
| B: triage, then grouped checks | 66 | $203.02 | 3,071 |

B's triage cost $8.32 over 33 turns. On top of the table, B had four sessions crash on the
account's session limit after 129 turns in total, which the ledger records at $0.

Here is how the verdicts compare on the 107 claims both arms checked:

| A \ B | confirmed | wrong | unverified |
|---|---|---|---|
| confirmed | 64 | 1 | 3 |
| wrong | 1 | 6 | 4 |
| unverified | 5 | 1 | 22 |

The arms agree on 92 of the 107. A found 11 claims wrong and B found 8, with 6 in common. B left
four of A's wrong claims unverified:

- that Chargily is a payment channel approved for online sales, which Law 18-05 Art. 27 contradicts
- ANPDP deliberation 04
- the correction window after each term
- ministry communiqués published as images

B also confirmed one claim A found wrong: Art. 39 of Law 18-07 does not require a *written*
contract. B found two wrong claims that A had not.

Per claim, A spent 51 turns and B's checks about 28. The user read this, said to go ahead with a
session per claim, and said: "yes quality comes before cost".

## Problem

D-34 made two savings at once: the triage, and the grouping. The triage decides which claims are
worth a check. PRDR-309 then made it send absence claims to a check as well: 12 of A's 14 wrong
claims are sent to one, and only 3 claims are uncheckable. The grouping decides how much attention
each checked claim gets. A session with five claims shares one context and one turn budget among
them, and the prompt tells it that "one source often settles several". On this sample, that
attention was worth three wrong claims found, and a fourth not confirmed in error.

## Design

- **A session per claim.** Each claim the triage sends to a check gets a `verify_claims` session
  of its own. That covers a claim that is load-bearing and checkable, and one it left unsorted.
  The sessions run four at a time (C-2¹⁶), as the groups did.
- **No `topic`.** Nothing groups the claims now, so the triage is not asked for a topic. The
  skeleton and the prompt drop the field, and the schema refuses it as it refuses any unknown key
  (P2).
- **The envelope stays.** The session is given `claims`, now holding one claim, and writes
  `briefs`, now holding one brief. Each brief is still read on its own. A missing or refused brief
  is asked for once more with the validator's words. Two briefs for the claim leave it with
  neither, and a brief for a claim the session was not given is refused. That can still happen
  with one claim.
- **The prompt** speaks of the one claim and its one brief, and drops the sentence saying the
  claims share a topic.

## Building it

- `src/schemas/audit.ts`: `topic` leaves `triageEntrySchema`.
- `src/init/audit-triage.ts`:
  - `AUDIT_CLAIMS_PER_SESSION`, `checkGroups` and `topicKey` are deleted.
  - `Sorted` is `"check"` or why a claim is not checked.
  - The skeleton asks no topic.
- `src/init/audit-claims.ts`:
  - `checkGroup` becomes `checkClaim`, one claim per session, and `launch` takes one claim.
  - The relaunch note names the claim.
- `src/init/audit.ts`: the check session is given its one claim.
- `prompts/audit.md`: the `triage` and `verify_claims` tasks. The manifest is re-hashed.
- `tests/init/audit-triage.test.ts` and `tests/init/audit-fixture.ts`: the new cases, and the
  grouping cases rewritten for a session per claim.
- `README.md`, and `detent-prd-v3.md`: D-34′, with amendment lines on D-34, C-2¹¹, C-2¹⁶ and
  C-2¹⁸.

### Vetoable calls

1. **A session per claim, not smaller groups.** Groups of two or three would still share one
   context, and the user's rule is that quality comes before cost.
2. **The triage stays.** It is what keeps a claim no source can settle out of a check. With
   PRDR-309's rule, 12 of A's 14 wrong claims are sent to a check. The A/B test measured the
   grouping, not the triage.
3. **`topic` is refused, not ignored.** A field nothing reads would be a request the session
   spends effort on. An entry that still carries one is refused like any unknown key. Its claim
   is asked for again, and a claim left unsorted twice is checked alone.
4. **The envelope stays.** A session holding one claim can still write two briefs for it, or a
   brief for another claim. The checks for both stand, and so do the test stubs that answer by
   `briefs`.
5. **The relaunch label stays "set of briefs".** The artifact is still the `briefs` envelope.
6. **A kept triage from an earlier build is not read.** The prompt changes, so AUDIT's key moves
   (C-2¹¹) and a survey kept under the old key is surveyed again (C-2¹⁸, "Kept"). The schema
   would refuse the old entries' `topic` anyway.
7. **The estimate is stated, not used as a limit.** On tabachir, PRDR-309's triage sends 117
   claims to a check (113 sorted, 4 unsorted). At arm A's $3.13 per claim that is about $366,
   plus the triage, against A's $453 and B's $203. Spend is reported, never a reason to stop.

## Falsification

The three new cases ran against HEAD `ed37a93`:

    × checks three claims one source could settle in three sessions, each given its one claim
        → expected [ 'survey', 'triage', 'verify_claims' ] to deeply equal [ 'survey', 'triage', …(3) ]
    × asks the triage for no topic, and refuses an entry that names one
        → expected [ 'checkable', 'claim_hash', …(3) ] to deeply equal [ 'checkable', 'claim_hash', …(2) ]
    × tells the triage and the check that each claim checked has a session of its own
        → expected '`triage`: sort the `claims` in your i…' not to match /`topic`/u

The triage filled in its skeleton, which gave all three claims the skeleton's one topic, and one
session checked all three. The skeleton asked for a `topic`, and the prompt told the triage to
name one.

## Mutation battery

Each mutant was applied to snapshot copies of `audit-triage.ts`, `audit-claims.ts`, `audit.ts`,
`schemas/audit.ts`, `prompts/audit.md` and the manifest, and the files were restored from those
copies afterwards. The prompt mutants were re-hashed so the prompt set still loads. The runs
covered six suites, 90 cases.

| Mutant | Result |
|---|---|
| M1 the skeleton asks a topic again | killed |
| M2 the schema takes a topic | killed |
| M3 the triage prompt asks a topic | killed |
| M4 the check prompt says the claims share a topic | killed |
| M5 the triage prompt does not say each check has its own session | killed |
| M6 an unsorted claim is not checked | killed |
| M7 no relaunch | killed |
| M8 the relaunch not told why | killed |
| M9 a claim whose brief stood launched again | killed |
| M10 no note of the relaunch | killed |
| M11 an uncheckable claim checked | killed |
| M12 one check at a time | killed |
| M13 a verdict recorded on the first claim checked | killed |
| M14 the check session given no claim | killed |

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: 193 files, 2,209 passed and 2 skipped (2,211).
- `npm run plugin`: wrote nothing that changed.

## Recorded, not fixed

- **One sample.** The A/B test is a single run of each arm on one project's claims. The four claims
  B left unverified could be a matter of luck in which sources a session reached. A later run's
  wrong-claim rate is the outcome to watch (D-33).
- **The stopped test run's AUDIT completed before this.** Its checkpoint stands on its pin. A new
  `init` on tabachir at this build would audit again, since the prompt moves AUDIT's key.
