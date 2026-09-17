---
id: PRDR-262
title: "One planning-research question can starve every question after it: an init-wide pool handed out greedily in document order"
state: DONE
severity: major
category: defect
labels: ["prd-review", "found-by-live-run", "X-1", "C-3a", "PRDR-260", "budget", "starvation", "operator-signal"]
surface: ["src/init/plan-research.ts", "src/init/pipeline.ts", "tests/init/research-batch.test.ts", "tests/init/stages.test.ts"]
prd_refs: ["X-1", "X-6a", "C-3a", "C-3′", "C-5", "PRDR-106", "PRDR-260"]
acceptance_criteria: ["`planResearch` divides the pool instead of draining it. Each question is offered `min(remaining, max(1, floor(remaining / (pending + 1))))`, where `pending` counts the LATER questions that still need a session. On the live shape — 16 calls, 3 questions — the offers are 5, 5 and 6, and all three get a session. On HEAD the first is offered 16 and the other two get none.", "Unused budget flows FORWARD. The share is recomputed every turn from what is actually left, so a question that stops early enlarges the share of the questions after it rather than stranding its allocation. A run whose first two questions spend 1 each leaves the third the whole remainder.", "A cache hit neither spends a call nor claims a share, and is not counted in the denominator. `C-3a`'s acceptance — a re-run answers a repeated question with zero web calls — still holds, and a cached question sitting between two uncached ones does not shrink their shares.", "The pool is never overrun. `share <= remaining` holds with no case split, therefore `toolCallsUsed <= budget` — including for a fractional ceiling, which X-1 permits because `.positive()` carries no `.int()`.", "`neverResearched` becomes a pure budget fact. Membership is reachable only when the pool could not fund one call for every question that needed one — never because of where ANALYZE happened to list a question. Formally: whenever `remaining >= pending + 1`, the charge leaves at least one call for every question still pending, so the exhausted arm cannot be reached by a greedy predecessor.", "A session that overruns its share is charged its share and the overrun is REPORTED. Clamping silently would let `toolCallsUsed` read as \"calls spent\" while meaning \"calls allocated\"; the excess is real money that this ceiling does not see, and the note says so and names `run_spend_usd` as what does bound it.", "The two ways a session comes back empty are distinguishable in the notes. One that consumed its whole share may have been cut short — a ceiling to raise or a question to drop; one that stopped early had room it did not want, and more budget is not the lever.", "A corrupt or unparseable cached brief is not a crash. `pendingAfter` reads the cache for questions the loop has NOT reached, so an unreadable file that HEAD would only have met at its own turn can now be met early — and it must degrade to \"the cache cannot answer this\" rather than taking down a run at a question nobody had reached."]
non_goals: ["Does NOT refund a failed session's calls. The money was really spent, and the clamp comment this ticket inherits is right that a refund would let a misbehaving session burn the pool unbounded. What changes is the BOUND each session is handed, not what it is charged.", "Does NOT add a new CEILINGS key. The share is derived from `planning_research_tool_calls` and the live question count, so no config migrates and `tests/oracle/budgets.test.ts` still finds the key as a plain property access in `init/pipeline`.", "Does NOT make the share a hard refusal inside the session. `kernel/stages/research` is the precedent (PRDR-106): no per-session turn ceiling exists there, because a hard stop makes an over-budget session indistinguishable from a transport death at the seam that classifies crashes. The share is what a session is ASKED for.", "Does NOT reorder the questions. Ordering by expected answerability was considered and rejected — it needs a model to judge answerability, which is the thing being researched, and it would make coverage depend on a second guess rather than removing the dependence on the first.", "Does NOT stop researching after a question returns no valid brief. One unusable brief is not evidence the rest are unanswerable; on the live run it was the FIRST question that failed and the two behind it were the ones a web search could plausibly have settled.", "Does NOT change `partial`-flagging or the ledger. A research session that produces no valid brief still writes an unflagged row, because it did not crash and its money was really spent — that is PRDR-261's question, one writer over, and it is correct as it stands.", "Does NOT parallelise research. Every question's raw session output still lands at the single fixed `state/planning-brief.json` (`pipeline.ts`), so concurrent sessions would collide on that path. Sequential is what makes the flow-forward share exact, and changing both at once would confuse two independent risks."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-106", "PRDR-260", "PRDR-261"]
depends_on: []
---

# PRDR-262 — one research question can starve every question after it

## Where this came from

A live `detent init` against `/Users/workstation/ksar-cloud` on 2026-09-17, launched from the
tree that carries PRDR-261. ANALYZE raised three open questions — which external accounts are
payable today, the trial-credit amount and price ladder, and the Law 18-07 / Law 25-11 retention
schedule. Every one is the kind a document genuinely cannot settle, which is why they were
raised.

What the run printed, verbatim:

```
planning research produced no valid brief for "Which of the platform's external accounts
  exist and are payable today, ..."
planning_research_tool_calls exhausted (16); "What are the trial-credit amount and expiry
  (CORE-F-015), ..." joins the AWAIT_INFO batch
planning_research_tool_calls exhausted (16); "What retention schedule applies to usage
  records, ..." joins the AWAIT_INFO batch
3 question(s) carried to PRESENT with their assumptions (C-3′)
  — 1 researched without a usable answer, 2 never researched
```

Three questions. One session. Zero usable answers. $0.5452 and 17 turns spent, and the two
questions never tried are the two a web search might actually have settled — a price ladder and
a statutory retention schedule are public facts; which accounts a founder has paid for is not.

That last line is PRDR-260 working, and it is the only reason this was diagnosable at all.
Without the `neverResearched` split the batch would have read as three questions research could
not settle, which is a conclusion about the questions. It was a conclusion about the budget.

## The defect

`planning_research_tool_calls` is `scope: "init"`, default 16, and `plan-research.ts` documents
it as "the whole init's allowance". The loop walked the questions in order handing each session
everything left:

```ts
const remaining = deps.budget - toolCallsUsed;
if (remaining <= 0) { unanswered.push(question); neverResearched.push(question); continue; }
const result = await deps.researchOne(question, remaining);
```

and `pipeline.ts` passed that straight through as `tool_call_budget: remaining`. Question one
was told it could spend all sixteen. It did, and returned a brief X-6a refused.

Charging those calls is not the defect — the money was really spent. **The defect is that the
allowance was handed out greedily in document order**, so which questions got researched at all
was decided by where ANALYZE happened to list them. Nothing reserved anything.

The repo already had the other scoping: `failure_research_tool_calls` is
`scope: "research-session"`, enforced per session at `src/kernel/stages/research.ts`. Planning
research was the one sharing a pool without dividing it.

## Falsification against HEAD

`npx vitest run tests/init/research-share.test.ts` against HEAD `75c85b0`, before any `src/`
change. **7 failed, 2 passed.**

```
× offers 5, 5 and 6 on the live shape, and launches a session for every question
  → each question gets an even cut of what is left, not everything that is left:
    expected [ 16 ] to deeply equal [ 5, 5, 6 ]
× flows an under-spending question's leftover forward instead of stranding it
  → 16 over 3 questions: expected 16 to be 5
× does not let a cached answer spend a call or claim a share
  → only the two uncached questions cost a session: expected 1 to be 2
× buys a session each until a pool too small for one call apiece runs out
  → a share never divides to zero: expected [ 2 ] to deeply equal [ 1, 1 ]
× charges an overrunning session its share, and says the rest is spend it cannot see
  → the second question's share is unharmed by the first's overrun: expected undefined to be 5
× says whether an empty-handed session used its whole share or stopped early
  → used everything it was given: expected 'planning research produced no valid b…' to contain 'used all'
× treats an unreadable cached brief for a LATER question as a cache miss, not a crash

Test Files  1 failed (1)
     Tests  7 failed | 2 passed (9)
```

`expected [ 16 ] to deeply equal [ 5, 5, 6 ]` is the defect in one line, and the array length is
the point: it has ONE element because the other two questions were never launched. So is
`expected undefined to be 5` — there is no second offer to inspect.

**Regression guards, not evidence.** Two pass on HEAD and are labelled as guards in the file: a
lone question is already offered the whole pool, and the pool is already never overrun. Both
are properties the fix must not break, and neither is evidence for it.

## The two tests that asserted the defect

The fix turned two existing tests red, and neither was a false alarm — both had written the
starvation down as the specification, which is why nothing detected it for as long as it lasted.

`tests/init/stages.test.ts` asserted `expect(launched).toBe(1)` under the comment *"The first
question burns the whole allowance"*, from a pool of 16 and a list of three questions. The
per-init ceiling it is named for was never the defect and still holds exactly; what it also
asserted, without saying so, was that holding the ceiling costs the other two questions their
session.

`tests/init/research-batch.test.ts` is PRDR-260's own test for the `neverResearched` split, and
its fixture was the live shape — 16 calls, three questions, the first consuming all of it. It
expected `1 researched without a usable answer, 2 never researched`. With the pool divided,
starvation by document order is unreachable, so the fixture no longer produces the split it
exists to test. It is now a pool of 2 against three questions: one call each until it runs out,
which is the only remaining route into `neverResearched` and the one the note's advice is
actually about.

Both were updated with the reason recorded in the file, not quietly re-baselined.

## What changed

`src/init/plan-research.ts` (75 → 152 code lines) —

```ts
const pending = pendingAfter(deps.root, questions.slice(index + 1));
const share = Math.min(remaining, Math.max(1, Math.floor(remaining / (pending + 1))));
```

Every term earns its place. `floor` puts the rounding remainder on the LAST question, the one
the greedy pass starved; `ceil` would divide the same pool to the same total, so this is
rounding and not policy. `max(1, …)` stops a pool smaller than the question count dividing to
zero — and a zero share is the worse failure, because the charge is `min(toolCalls, share)`, so
a session handed zero would spend real money and debit the pool nothing, which is the refund
this design is otherwise careful never to grant. `min(remaining, …)` because X-1's `.positive()`
carries no `.int()`, so a fractional ceiling loads and that `max(1, …)` must not overrun it.

Together they give the invariant with no case split: `share <= remaining`, therefore
`toolCallsUsed <= budget`. And they bound the skip arm, which is what lets its note name a
cause: whenever `r >= p + 1`, then `r - floor(r / (p + 1)) >= p`, and the charge is at most the
share, so every turn leaves at least one call for every question still pending. `remaining <= 0`
is reachable only when the POOL could not fund one call apiece — never because of who came
first, which is the whole of D-16.

Three supporting changes:

- `usableBrief` folds "file absent", "not JSON" and "schema refuses" into one outcome — the
  cache cannot answer this question. It is not tidying: `pendingAfter` reads the cache for
  questions the loop has NOT reached, so a corrupt file HEAD would only have met at its own turn
  can now be met early, and an unguarded `JSON.parse` would take down a run at a question nobody
  had reached.
- `pendingAfter` counts by hash, so repeats count once, and counts against the cache, so
  questions a re-run answers for free do not dilute the share of those that must be researched.
- An overrun is charged at the share and REPORTED. Clamping silently would let `toolCallsUsed`
  read as "calls spent" while meaning "calls allocated"; the note says the excess is real spend
  this ceiling does not see and names `run_spend_usd` as what does bound it.

`src/init/pipeline.ts` — `tool_call_budget` now carries the share. The input key was always
named for one session's budget and is only now true of the number behind it, so it is not
renamed.

The no-valid-brief note now says whether the session used its whole share or stopped early: one
may have been cut short and is a ceiling to raise, the other had room it did not want and more
budget is not the lever.

126 files, 1284 passed, 2 skipped.

## Mutation battery (verification protocol, item 2)

Nine mutations against the fixed allocator. Every one caught.

| # | mutation | caught by |
|---:|---|---|
| M1 | revert: hand each question everything left | 6 failed — the original defect |
| M2 | off-by-one: `pending + 2` | 6 failed |
| M3 | off-by-one: `max(1, pending)` — excludes the current question | 5 failed |
| M4 | `ceil` instead of `floor` | 3 failed — offers become 6,5,5 |
| M5 | drop the `max(1, …)` floor, so a share can be zero | 1 failed — the small-pool case |
| M6 | `min` → `max`, so a share may exceed what is left | 6 failed |
| M7 | denominator ignores the cache (`questions.length - index - 1`) | 1 failed — the cached-middle case |
| M8 | charge the overrun in full instead of the share | 1 failed |
| M9 | charge the share regardless of what was spent | 2 failed — flow-forward collapses |

M7 is the one worth keeping. Counting pending questions by position rather than against the
cache type-checks, reads correctly, and is wrong only when a cached question sits among uncached
ones — where it silently shrinks everyone's share for a question that will cost nothing.

**Holes, stated rather than hidden.**

- **The `floor`-versus-`ceil` choice is asserted, not argued by the suite.** M4 is caught only
  because the headline test pins the exact offers `[5, 5, 6]`. That is a real regression guard,
  but it does not demonstrate that putting the remainder on the last question is BETTER — the
  totals are identical and no test distinguishes the two on outcome. The argument is in the
  doc-block.
- **Nothing tests the live seam.** Every case here injects `researchOne`. That a real session
  honours the `tool_call_budget` it is handed is not asserted anywhere and cannot be — it is a
  model's behaviour, which is exactly why the overrun path is charged and reported rather than
  trusted.
- **`pendingAfter` is O(n²) in cache reads** across the question list. At three to five
  questions this is invisible and no test bounds it; a list of hundreds would want a single
  pre-pass.
