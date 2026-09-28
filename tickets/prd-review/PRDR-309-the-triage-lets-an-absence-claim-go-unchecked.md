---
id: PRDR-309
title: "AUDIT's triage lets an absence claim go unchecked. On the A/B copy it marked \"No Algerian rule requires a private tool to store its data in Algeria\" as nothing resting on it, reasoning that \"the absence of a rule is not something a primary source confirms\"; arm A's check had found two rules that bind the project (Law 18-05 Art. 8 on hosting an online shop in Algeria under .com.dz, and ARPCE's cloud-hosting specifications). One source that shows the rule refutes such a claim, so the prompt now says an absence claim is checkable, and load-bearing wherever the rule would bind the plan"
state: DONE
severity: major
category: quality
labels: ["prd-review", "specification-phase", "C-2¹⁸", "a-b-test", "prompt", "user-decision"]
surface: ["prompts/audit.md", "prompts/manifest.json", "detent-prd-v3.md", "tests/init/audit-triage.test.ts"]
prd_refs: ["C-2¹⁸", "D-34", "C-2¹¹"]
acceptance_criteria: ["The `triage` task in `prompts/audit.md` says that a claim that a rule, limit or obligation does not exist is checkable, since one primary source that shows the rule proves it wrong, and that it is load-bearing wherever such a rule would bind what the documents plan, even when the documents reach that decision by another route.", "Nothing else in the prompt changes; the manifest carries the new hash.", "The PRD records it as C-2²⁰, with an amendment line on C-2¹⁸, and says that a new audit prompt moves AUDIT's key.", "A test pins the rule in the triage paragraph. Falsifying test: against HEAD the paragraph says nothing of absence claims.", "Verified on the real claims: a triage with the new prompt, over the 145 claims arm A checked, marks the data-localisation claim load-bearing and checkable."]
non_goals: ["Does NOT change the balance the user chose in D-34 for any other kind of claim.", "Does NOT re-run the live test run's AUDIT: the live run's remaining `init` calls stay on the build they started on."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-306", "PRDR-308"]
depends_on: []
---

# PRDR-309 — the triage lets an absence claim go unchecked

## Where this came from

The A/B test the user asked for on 2026-09-28. Arm B's triage, on PRDR-306's prompt, sorted the
145 claims arm A had checked one session apiece. Of A's 14 wrong claims it would have left three
unchecked, and one of them bears on the project directly: "No Algerian rule requires a private tool
to store its data in Algeria". The triage's reason: "Hosting in Algeria is decided on the transfer
rule anyway, so nothing changes with this, and the absence of a rule is not something a primary
source confirms." A's check had found Law 18-05 Art. 8, under which an online shop must be hosted
in Algeria with a `.com.dz` address (the project sells sync online), and ARPCE's specifications
for cloud hosting, which keep an authorised operator's clients' data on Algerian territory. The
user asked for the triage prompt to be fixed so that absence claims get checked.

## Problem

The `triage` paragraph defines `checkable` by the kinds of source that settle a claim, and
`load_bearing` by what would change were the claim false. It says nothing of a claim that
something does not exist, and the session reasoned that such a claim cannot be confirmed, so it
cannot be checked, and that another rule decides the matter, so nothing rests on it. Both are
wrong: one source that shows the rule refutes the claim, and a rule that exists binds the project
whatever route the documents took to their decision.

## Design

One sentence in the `triage` paragraph, after `checkable`'s definition. The prompt's hash is in
AUDIT's key (C-2¹¹), so a project whose AUDIT has completed audits again on its next `init` under
this prompt. The live test run's remaining `init` calls are pinned to the build they started on.

## Building it

- `prompts/audit.md`: one sentence in the `triage` task, directly after `checkable`'s definition,
  so it reads as the exception to "false for a claim about people, a market or the future". The
  manifest carries the new hash (`npm run prompts`).
- `tests/init/audit-triage.test.ts`: the triage line of the loaded prompt states the three things
  the sentence says: what an absence claim is, that it is checkable and why, and where it is
  load-bearing.
- `detent-prd-v3.md`: C-2²⁰, with an amendment line on C-2¹⁸.

### Vetoable calls

1. **A sentence, not a field.** The triage entry keeps its shape. An `absence` flag would change
   the schema and the kept triage, and code has nothing to do with it: whether an absence claim is
   checked is still the triage's judgement of `load_bearing` and `checkable`.
2. **It sits beside `checkable`'s definition,** because the session's error was reading "no source
   confirms an absence" as "no source settles it".
3. **"Even when the documents reach that decision by another route"** answers the session's second
   reason ("hosting in Algeria is decided on the transfer rule anyway"): a rule that exists binds
   the plan whatever route the documents took to it.
4. **D-34's balance is otherwise unchanged:** no other kind of claim is named, and the instruction
   not to mark a claim load-bearing to have it checked still stands.
5. **The change ships knowing it moves AUDIT's key.** A project whose AUDIT completed on the old
   prompt audits again on its next `init`, and C-2²⁰ says so. The live test run is pinned to the
   build it started on.

## Falsification

The test run against HEAD `e3b4421`, before the sentence was written:

    AssertionError: expected '`triage`: sort the `claims` in your i…' to match /A claim that a rule, limit or obliga…/u

## Verification on the real claims

On `~/tabachir-detent-ab2`, a copy of the A/B clone restricted to the 145 claims arm A checked, a
triage ran with the new prompt ($6.39, 182,936 output tokens, 35 turns). Its first launch crashed
on the account's session limit after 38 turns, and the ledger records that attempt as $0. A guard
kept the triage when it landed and stopped the run before any check. The comparison is against arm
B's triage on PRDR-306's prompt:

| | check | uncheckable | not load-bearing | unsorted |
|---|---|---|---|---|
| PRDR-306's prompt | 107 | 18 | 20 | 0 |
| this prompt | 113 | 3 | 25 | 4 |

- **"No Algerian rule requires a private tool to store its data in Algeria"** moved from not
  load-bearing to **check**. The session's reason: "Such a rule would bind where every server that
  touches personal data runs, and one Algerian text requiring local storage would prove the claim
  wrong."
- **Arm A's 14 wrong claims:** 12 are checked, against 11 on the old prompt. "INRE's Tarbya-Up
  Challenge is the only structured entry point for outside innovators" moved from uncheckable to
  check. "Ministry communiqués are published as images" moved from check to not load-bearing. "In
  2025/26 the term-3 exams were brought forward by seven weeks" is not load-bearing on both prompts.
- **Uncheckable fell from 18 to 3.** The claims that "no official X exists" (thresholds, a journal
  layout, an API, new plan editions) now go to a check, each with the source that would refute it.
  One absence claim the session still judged not load-bearing ("the 2026/27 assessment circular had
  not been published") is a status that the plan keys whenever the circular appears.
- **The 4 unsorted** are an artifact of the guard. It stopped the run when the first attempt's
  sort was kept (C-2¹⁹), before the relaunch that sorts the rest.

## Mutation battery

Each mutant was applied to snapshot copies of the prompt and the manifest, repinned with
`npm run prompts`, and restored from the snapshots:

| Mutant | Result |
|---|---|
| M1 the sentence removed | killed |
| M2 an absence claim "is not checkable" | killed |
| M3 "even when … another route" removed | killed |
| M4 narrowed to "a claim that a law does not exist" | killed |

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: 189 files, 2,178 passed and 2 skipped (2,180).
- `npm run plugin`: wrote nothing that changed.

## Recorded, not fixed

- **One sample per prompt.** Three claims that are not absence claims moved from check to not
  load-bearing: the ministry's roadmap items, and "Ministry communiqués are published as images",
  which arm A found wrong. Nothing in the sentence speaks to them, so the move may be the
  session's variance. One triage per prompt cannot tell the two apart.
- **The A/B's checks are still running.** They will show whether grouped checks agree with arm A's
  verdicts, which this ticket does not measure.
