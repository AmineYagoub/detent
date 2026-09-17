---
id: PRDR-266
title: "An `undecidable` verdict about the outside world can be written without ever consulting it: X-6a is validated in the descent and not in the ascent, so `needs_specialist` is a cheap exit that a live A/B shows costs a real finding"
state: DONE
severity: major
category: defect
labels: ["prd-review", "found-by-live-run", "X-6a", "C-3a", "C-3′", "doc-claim-drift", "contract", "PRDR-264", "operator-signal", "regression"]
surface: ["src/schemas/init.ts", "prompts/research.md", "tests/init/research-contract.test.ts"]
prd_refs: ["X-6a", "C-3a", "C-3′", "P2", "S-3", "PRDR-260", "PRDR-262", "PRDR-264"]
acceptance_criteria: ["`planningBriefSchema` refuses an `undecidable` brief whose `reason` is `needs_specialist` or `no_public_source` unless `sources_consulted` records at least one tier ≥ 3. Both reasons are claims about what exists OUTSIDE this project — a specialist's knowledge, the public record — and tiers 1-2 are this project's own docs and code, which cannot establish either. On HEAD `requireLocalSearchBeforeWeb` enforces X-6a only in the descent (a URL requires a local search first); nothing enforces the ascent, so a brief may assert that no external source answers a question while recording that it never looked at one.", "`decision_not_made` is exempt, and the exemption is the point of the rule rather than a hole in it. That reason is a claim about THIS project's own state — the founder has not decided — and tier 1 settles it dispositively: when the project's own decision log lists the item as open, no external tier can carry an answer that does not exist anywhere. The live pricing-ladder brief (`4f04efed`, tiers 1 only) must still validate unchanged.", "`prompts/research.md` ties the undecidable clause back to the hierarchy that governs it. The sentence offering the undecidable arm currently names three reasons with no reference to X-6a, two paragraphs after the hierarchy says to escalate when a tier does not answer; a session can therefore satisfy the prompt's undecidable sentence without ever entering its escalation sentence. The reshaped clause says that `needs_specialist` and `no_public_source` are verdicts reached AFTER escalating, and that routing to a specialist means handing that specialist the current governing material — not declining to look for it.", "The refusal buys the existing one reshape relaunch rather than failing the question. PRDR-264 already wired `withOneRelaunch` + `previousAttemptInput` into planning research; a brief refused by this rule is exactly the case that pair exists for, so the session is told what was refused and gets one chance to go and look.", "A regression test pins the live A/B directly: a brief shaped like run 5's legal verdict (reason `needs_specialist`, `sources_consulted` tiers 1 and 2 only, seven evidence items) is REFUSED, and the same brief with one tier-5 entry added is ACCEPTED. Seven evidence items is the load-bearing detail — `evidence.min(1)` was PRDR-264's guard against this arm being a cheap exit, and run 5 cleared it sevenfold while never leaving tier 1."]
non_goals: ["Does NOT require a specific NUMBER of external sources, or that the external search succeed. A session that escalates to tier 5, finds nothing, and records the attempt has produced an honest `no_public_source` and must pass. The rule is that the claim was tested, never that it was refuted.", "Does NOT make WebSearch mandatory, or fail a brief when the network or the tool is unavailable. The requirement is a recorded tier ≥ 3 consultation; a session whose web tool is denied should say so in `detail` and reach for `decision_not_made` or an `answered` brief with low confidence, exactly as run 4's brief disclosed its blocked WebFetch in `version_facts` and `what_would_falsify`.", "Does NOT re-validate the briefs already cached from run 5. C-3a keys the cache by question, not by validator version; the stale legal brief is cleared by deleting the file, and this ticket does not add a migration.", "Does NOT touch the `answered` arm, `requireOutcomeArm`, or `requireLocalSearchBeforeWeb`. The descent rule is correct and stays exactly as written — this adds its mirror.", "Does NOT split the `research` role, which PRDR-264 deferred for the same reasons and which remains the right end state.", "Does NOT add a CEILINGS key, touch any budget default, or change the share allocator."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-260", "PRDR-262", "PRDR-264"]
depends_on: ["PRDR-264"]
---

# PRDR-266 — an `undecidable` verdict about the outside world can be written without consulting it

## Where this came from

A clean A/B on the same question, from two live `detent init` runs against
`/Users/workstation/ksar-cloud` on 2026-09-17. Run 4 from `aec50b9` (pre-PRDR-264), run 5
from `e189925` (post-PRDR-264). Same question, same three source documents — `data-model.md`
§4, `prd-01` §10, `security-abuse-policy.md` §9: the retention schedule, breach-notification
duties, and data-subject export/deletion duties under Law 18-07 / ANPDP.

**Run 4** found that Algeria enacted **Law No. 25-11 of 24 July 2025**, amending Law 18-07.
Every document in the project's pack says bare "18-07" and implicitly assumes the pre-2025
text. It further found that retention under that law is a storage-limitation *principle* with
no statutory figure — so "wait for counsel to give us a number" is the wrong frame, because
there is no number to be given; the controller must set and document one per category. It
found a 5-day breach-notification figure and evidence of no standalone erasure right, which
would mean the existing 30-day export window already meets the floor. It closed with four
narrowly-scoped questions for counsel and a named placeholder constant, and marked its own
confidence `medium` with its blocked WebFetch disclosed in `version_facts`.

**Run 5**, on the identical question, wrote `outcome: undecidable`, `reason: needs_specialist`,
`who_decides: ANPDP-qualified counsel` — from tiers 1 and 2 only. It never called WebSearch.
Its `detail` argues the case a priori:

> No source in tiers 2-6 changes this: the codebase has no implementation to reverse-engineer
> an answer from, and even the statute's own text (tier 3/6) would still need a licensed-counsel
> reading against this data model to be actionable

Run 4 falsifies that argument by having done the search. The brief is not wrong that counsel
must sign off (S-3 says as much about every brief). It is wrong that looking was pointless:
looking is what surfaces the fact that counsel would otherwise be briefed from a superseded
statute.

This is a regression introduced by PRDR-264, on an unreleased branch. Coverage improved in the
same run — D-18's skip arm is gone, so two questions were researched where run 4 researched
one. Depth regressed on the question both runs answered.

## What the code does

`src/schemas/init.ts:239` enforces X-6a in one direction:

```ts
const citesUrl = brief.evidence.some((e) => /^https?:\/\//i.test(e.source));
const searchedLocally = brief.local_search.docs_checked.length > 0 || brief.local_search.code_checked.length > 0;
if (citesUrl && !searchedLocally) { … }
```

A brief that cites the web must show it read the project first. That is the descent, and it is
right. The ascent has no rule: nothing checks that a brief claiming *the outside world holds no
answer* ever consulted the outside world.

PRDR-264 saw this failure mode coming. `plan-research.ts:104` says so in the skeleton it hands
the session:

```
The same `evidence.min(1)` the answered arm carries, with placeholders that say what it is FOR
here: the searches that came back empty. Without them this arm is a cheap exit — "undecidable"
costs a session nothing to write and cannot be told apart from one that did not look.
```

The guard it chose counts evidence. Run 5's brief carried **seven** evidence items and still
never left tier 1 — six project documents and one repo-wide grep. Evidence count does not
distinguish a session that looked from one that did not, because tier-1 citations are free.
`sources_consulted` carries the tier and is the field that can.

## Why this is doc-claim drift, again

`prompts/research.md` states the hierarchy in the present indicative — "escalating only when the
previous tier does not answer (X-6a)" — and the validator implements the half that stops a
session skipping ahead. The half that stops a session stopping early is stated and not
implemented. The prompt's undecidable sentence then sits two paragraphs later and names its
three reasons without referring to the hierarchy at all, so a session can satisfy it without
ever entering the escalation rule. Tests cover the built half and pass.

## The rule, and why it cuts exactly here

`needs_specialist` and `no_public_source` are claims about what exists outside this project.
Tiers 1-2 are this project's documents and code. Neither can establish either claim, so a brief
asserting one while recording only tiers 1-2 is asserting something its own evidence cannot
reach.

`decision_not_made` is different in kind: it is a claim about this project's own state, and
tier 1 settles it dispositively. When `founder-decisions.md` lists an item under "Items that
remain open (not decided today)", no external tier can carry an answer that does not yet exist
anywhere. The live pricing brief (`4f04efed`) is exactly this and is correct at tiers 1 only.

The rule therefore separates the two live briefs precisely: it refuses the one that should have
looked and admits the one that had no reason to. That separation is the falsification test.

## Falsification against HEAD

`npx vitest run tests/init/research-contract.test.ts -t "PRDR-266"` at `e189925`:

```
   × PRDR-266 a verdict about the outside world requires consulting it > refuses `needs_specialist` supported only by this project's own docs and code 9ms
     → a claim that only a specialist knows is a claim about the world outside tiers 1-2: expected true to be false // Object.is equality
   × PRDR-266 a verdict about the outside world requires consulting it > refuses `no_public_source` on the same grounds, which its own words assert 1ms
     → `no public source carries it` is self-contradictory from a brief that consulted no public source: expected true to be false // Object.is equality
   ✓ PRDR-266 a verdict about the outside world requires consulting it > exempts `decision_not_made`, which tier 1 settles dispositively 0ms
   × PRDR-266 a verdict about the outside world requires consulting it > counts seven tier-1 citations as no escalation at all 1ms
     → PRDR-264's evidence.min(1) guard is cleared sevenfold here while the question stays unresearched: expected true to be false // Object.is equality

 Test Files  1 failed (1)
      Tests  3 failed | 1 passed | 20 skipped (24)
```

Three refusals expected, three briefs accepted. The fourth is the control that must NOT move:
`decision_not_made` at tier 1 only passes on HEAD and must still pass after the fix, because
the live pricing brief is exactly that shape and was right. Each refusal test opens with its
own positive control — the same verdict carrying one tier-5 entry parses on HEAD — so none of
them can pass later for a reason unrelated to the rule.

## What changed

`src/schemas/init.ts` — `requireEscalationBeforeUndecidable`, chained onto `planningBriefSchema`
after `requireOutcomeArm`. When `outcome` is `undecidable` and `reason` is `needs_specialist` or
`no_public_source`, `sources_consulted` must carry at least one entry at `EXTERNAL_TIER` (3) or
above. `decision_not_made` returns early and is never checked. The refusal message names the
reason it refused and offers the two ways out — escalate, or settle it as a decision rather than
a source.

`EXTERNAL_TIER = 3` is its own named constant with a doc-block, because the boundary is the
claim: tiers 1-2 are this project talking about itself, tier 3 up is the outside world.

`prompts/research.md` — the undecidable clause now says the last two reasons are verdicts
reached BY escalating rather than instead of it, states that the validator refuses either from a
brief that never leaves tiers 1-2, and says what routing to a specialist means: hand them the
current governing material — the version actually in force, the shape the answer takes, the
narrow questions left. `decision_not_made`'s exemption is stated in the prompt too, so a session
reads the same rule the validator applies. `npm run prompts` and `npm run plugin` regenerated
`prompts/manifest.json` and `agents/research.md`.

`tests/init/research-contract.test.ts` — five cases, each opening with its own positive control.

## Mutation battery

Four mutants, plus a fifth pass after the battery found a real gap. Files restored from a `cp`
snapshot throughout — never `git checkout`, which on uncommitted work reverts the fix itself.

| # | Mutation | Result |
|---|---|---|
| M1 | `EXTERNAL_TIER` 3 → 1 | CAUGHT — 3 failed. The boundary is load-bearing. |
| M2 | Drop the `decision_not_made` exemption, check every reason | CAUGHT — 1 failed, the exemption test. The carve-out is pinned in both directions. |
| M3 | `s.tier >= EXTERNAL_TIER` → `s.tier > EXTERNAL_TIER` | **SURVIVED.** |
| M4 | `.superRefine(requireEscalationBeforeUndecidable)` removed from the chain | CAUGHT — 3 failed. |

M3 is the honest finding. Every other case reached tier 5, so `>=` and `>` were indistinguishable
to the whole battery, and a brief escalating exactly to tier 3 — pinned upstream documentation,
already the outside world — would have been wrongly refused with nothing to catch it. Added
"accepts escalation that stops exactly at tier 3"; M3 re-run is CAUGHT (1 failed). The gap was in
the tests, not the implementation, which is why the battery was worth running.
