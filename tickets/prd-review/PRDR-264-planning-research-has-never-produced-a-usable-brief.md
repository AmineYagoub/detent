---
id: PRDR-264
title: "Planning research has never produced a usable brief: the one init session launched without an `expected_output`, answering a question it is never bound to, with no way to say the question is undecidable"
state: DONE
severity: major
category: defect
labels: ["prd-review", "found-by-live-run", "C-3a", "X-6a", "P2", "T-140", "doc-claim-drift", "contract", "PRDR-262", "operator-signal"]
surface: ["src/schemas/init.ts", "src/init/plan-research.ts", "src/init/pipeline.ts", "src/init/analyze.ts", "prompts/research.md", "tests/init/research-contract.test.ts", "tests/init/research-share.test.ts", "tests/init/research-batch.test.ts"]
prd_refs: ["C-3a", "C-3′", "X-1", "X-6a", "P2", "T-140", "PRDR-179", "PRDR-250", "PRDR-260", "PRDR-262"]
acceptance_criteria: ["The planning-research session is handed a contract. `init/pipeline` passes `expected_output: planningBriefSkeleton()` and the `question_hash` the loop asked under, exactly as every other init session does (`analyze.ts:105`, `slice.ts:93`, `plan.ts:225`, `plan-review.ts:277`) and exactly as the LOOP's own research call already does (`referee-stage.ts:169`). On HEAD this one caller passes neither, and there is no `planningBriefSkeleton` in the repo at all.", "`prompts/research.md` stops hard-coding one artifact shape. The prompt already declares `expected_output` authoritative in the same sentence that then names the A-4 failure shape unconditionally; the A-4 skeleton becomes what a FAILING-TICKET input gets, and `expected_output` is what the session follows. Without this the skeleton and the prose contradict each other and passing a skeleton is not sufficient.", "A refused brief buys exactly one reshape relaunch, via the `withOneRelaunch` + `previousAttemptInput` pair that SLICE and PLAN already use, so the session is told what the validator refused instead of guessing. On HEAD planning research is the only artifact-producing init stage with no retry at all.", "`planningBriefSchema` can express a question research has SETTLED as not researchable. An `outcome` discriminator of `answered` | `undecidable`, defaulting to `answered` so any brief written under the old shape still parses. The `undecidable` arm carries `reason` (`decision_not_made` | `needs_specialist` | `no_public_source`), a `detail`, and `who_decides`; it requires no `answer`, and the `answered` arm continues to require one.", "An undecidable brief is a SUCCESS, not a failure. It parses, it caches under the question hash so a re-run does not pay to rediscover it (C-3a), and it is reported apart from a session that produced nothing. Both live questions land here: the DZD/USD price ladder as `decision_not_made` (the founder), the Law 18-07 retention schedule as `needs_specialist` (counsel).", "The AWAIT_INFO batch line separates FOUR populations where HEAD separates two: answered, confirmed undecidable, researched without a usable answer, and never researched. The first two need no human research and the last two need opposite acts, so a single `unanswered` count cannot direct any of them.", "D-19: each question's raw artifact gets its own path and that path is cleared before the session launches. On HEAD every question writes the single fixed `state/planning-brief.json`, which is never deleted between sessions, so a session that writes nothing leaves its predecessor's file to be read as its own answer.", "D-19: a brief is BOUND to the question it answers. The `question_hash` the session echoes is checked against the hash the loop asked under; a mismatch is refused with its own note and never silently adopted or cached. On HEAD nothing compares them, so a stale or mismatched brief would be cached under the asking question's hash and answer it for free on every future run."]
non_goals: ["Does NOT split the `research` role in two. A dedicated `plan_research` role with its own prompt is the right end state — `prompts/research.md` still opens \"Blind fixing is over; your job is to inject NEW evidence into a failing ticket\" and still tells the session to search upstream issues \"with the exact error string\", neither of which describes a pricing question. It is deferred because a new role id touches `ROLE_IDS`, both routing defaults PRDR-263 has just written, the prompt manifest and config back-compat, and none of that is needed to make the contract hold.", "Does NOT enforce the tool-call budget (D-18). The session still spends what it spends — one budgeted 8 spent 13 and another spent 20 on the live run. This ticket removes the WRONG-KEY half, because the sentence being edited for the skeleton is the same sentence that told the session to read `failure_research_tool_calls` when the pipeline passes `tool_call_budget`; making the ceiling binding is a separate question about whether it should bind at all.", "Does NOT change the share allocator. PRDR-262's division stands untouched — this ticket changes what a session is ASKED to produce and whether the result is usable, not how much it may spend.", "Does NOT parallelise research. The per-question artifact path removes the collision that PRDR-262's non_goals named as the reason it could not, but sequential remains what makes the flow-forward share exact, and changing both at once would confuse two independent risks.", "Does NOT re-ask a cached undecidable question. A founder decision made after the brief was cached will not be picked up until the cached file is deleted. This is C-3a's own bargain — the cache is keyed by question, not by the world — and the note says the answer came from cache so an operator can clear it.", "Does NOT require the model to COMPUTE a hash. `question_hash` is handed to the session in its inputs and echoed back, so the binding check is a comparison of a string the session was given, never a sha256 the session had to derive. A garbled echo is what the one relaunch is for.", "Does NOT add a CEILINGS key or touch any budget default."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-179", "PRDR-250", "PRDR-260", "PRDR-262"]
depends_on: []
---

# PRDR-264 — planning research has never produced a usable brief

## Where this came from

A live `detent init` against `/Users/workstation/ksar-cloud` on 2026-09-17 (run 4), launched
from `aec50b9`, the tree carrying PRDR-261/262/263. ANALYZE raised two open questions and
PRDR-262's new share allocator gave each one a session — the first time in this project's
history that every raised question was actually researched.

Both came back refused. `.detent/research/planning/` was empty at the end: two questions,
$0.98 of `xhigh` research across 33 tool calls, and not one cached brief.

That is not a bad pair of questions. It is a contract that has never been connected.

## What the code does

`src/init/pipeline.ts:198` launches the planning-research session:

```ts
const result = await launchInitSession(sessionDeps(deps, journal), {
  role: "research",
  inputs: { question, tool_call_budget: share, hierarchy: "X-6a: …" },
  artifactOut,
  withWeb: true,
});
```

No `expected_output`. So the session follows `prompts/research.md`, which is the LOOP's
failure-triage prompt:

> You are the Research agent … Blind fixing is over; your job is to inject NEW evidence into a
> failing ticket.

and which names one artifact shape unconditionally:

> Output JSON to `artifact_out` matching the `expected_output` skeleton in your inputs EXACTLY
> … The A-4 shape: {failure_signature, cache_key, root_cause, evidence, version_facts,
> recommended_fix, alternative?, what_would_falsify, upstream_bug?, sources_consulted,
> local_search}

The session does exactly what it was told. Parsing run 4's live artifact against
`planningBriefSchema` gives nine issues — the whole A-4 shape:

```
question:       Invalid input: expected string, received undefined
question_hash:  Invalid input: expected string, received undefined
answer:         Invalid input: expected object, received undefined
sources_consulted.0..6: Invalid input: expected object, received string
<root>: Unrecognized keys: "failure_signature", "cache_key", "root_cause",
        "version_facts", "recommended_fix", "alternative"
```

`question_hash` appears in **no prompt in the repo** — only `src/init/analyze.ts` and
`src/schemas/init.ts`. Nothing anywhere has ever asked a session to write a planning brief.

## Why it is this caller and not the prompt

Every other init session passes a skeleton: `analyze.ts:105`, `slice.ts:93`, `plan.ts:225`,
`plan-review.ts:277`. So does the LOOP's research call — `referee-stage.ts:169` passes
`expected_output: researchBriefSkeleton()`. The same role, launched from two places, and only
one of them states the contract.

The repo already knows this is the mechanism. `src/init/plan.ts:116`:

> T-140: prose contracts drift; `expected_output` plus a strict validator …

Every artifact in the tree has a skeleton helper. There is no `planningBriefSkeleton`.

## Why the plumbing alone is not the fix

Pass the skeleton and run it against the two live questions and it still fails, because
neither question has a researchable answer. Run 4's first brief says so itself:

> This is not a missing technical fact recoverable by research — it is a business decision the
> founder has deliberately not yet made.

`planningBriefSchema` is a `strictObject` requiring `answer: {claim, confidence}` and
`evidence.min(1)`. A session that correctly establishes that no such value exists cannot
produce a valid brief. The schema has no shape for a true negative, so a correct result is
indistinguishable from a broken session — and the operator is told to raise a ceiling.

ANALYZE already carries the concept: each open question has `blocking` and an `assumption`,
so "confirmed undecidable, proceed on the assumption, and here is who must decide" is a BETTER
outcome than an answer. Today it is unrepresentable.

## D-19, folded in because the fix arms it

`artifactOut` is the single fixed `state/planning-brief.json` for every question, never
deleted between sessions, and `plan-research.ts:270-274` parses whatever it finds and caches it
under the hash of the question the LOOP asked — without ever checking the brief is about that
question. If a session writes nothing, `existsSync(artifactOut)` is still true from the
previous one, and question N is answered by question N-1's brief and cached under N's hash
for every future run.

This is unreachable today only because nothing parses. Ship the contract without the binding
and it becomes reachable in the same commit.

## Falsification against HEAD

`tests/init/research-contract.test.ts`, 20 tests, run against HEAD's `src/`:

```
Tests  19 failed | 1 passed (20)
```

The three that matter, verbatim:

```
× the pipeline hands planning research its contract (D-17) > passes both expected_output arms
  → TypeError: (0 , planningBriefSkeleton) is not a function

× the pipeline hands planning research its contract (D-17) > binds the session to its question
  by hash and by artifact path (D-19)
  → the session echoes this; it is what proves the brief answers THIS question:
    expected undefined to be 'b96a6850b5194ec5811862cb4f9fcb47c3614…'

× the pipeline hands planning research its contract (D-17) > tells the reshape relaunch what the
  validator refused, and the first attempt nothing
  → one attempt and one reshape relaunch: expected 1 to be 2
```

The first is the defect stated as a type error: the mechanism the repo uses everywhere else
does not exist for this artifact. The second is D-19 at the call site — HEAD passes no
`question_hash` at all, so there is nothing a brief could be checked against. The third is the
missing retry.

**One test passes on HEAD and is kept:** `hands the session its SHARE of the pool under the key
the prompt reads`. PRDR-262 already shipped `tool_call_budget`, so this is a regression guard on
the one part of the call site that was correct — not a falsification. It is recorded here rather
than dropped, because a battery that only contains failures is a battery whose positive controls
were never written.

Three tests in this file passed VACUOUSLY on a first run and were repaired before this record
was taken: HEAD's `strictObject` refuses the unknown `outcome` key, so every `undecidable`
fixture was rejected for a reason unrelated to the rule under test. Each now carries a positive
control asserting the complete brief parses, plus an assertion naming the specific refusal.

## What changed

**The contract (Layer 1).** `planningBriefSkeleton(question, hash)` and
`undecidableBriefSkeleton(question, hash)` in `src/init/plan-research.ts`; `pipeline.ts:198`
passes both, plus `question_hash`. `prompts/research.md` no longer names the A-4 shape
unconditionally — it scopes A-4 to failing-ticket inputs and makes `expected_output`
authoritative — and the same sentence's wrong budget key (`failure_research_tool_calls`, which
this caller never passes) now reads `tool_call_budget` when present. Manifest rehashed;
`agents/research.md` re-rendered via `npm run plugin`.

**The reshape relaunch (Layer 1).** `planResearch` wraps its launch in `withOneRelaunch` and
spreads `previousAttemptInput(previous, "planning brief")` at the call site — the pair SLICE and
PLAN already use. Both attempts are charged against the ONE question's share and the sum clamped
to it, so a retry cannot spend a later question's budget and `toolCallsUsed <= budget` still
holds.

**The undecidable arm (Layer 2).** `planningBriefSchema` gains
`outcome: "answered" | "undecidable"`, defaulted to `answered` so every brief written under the
old shape still parses, and a `requireOutcomeArm` refinement enforcing exclusivity. `evidence`
stays `.min(1)` on BOTH arms — deliberately: a settled verdict is a claim about the world, and
without it `undecidable` is a cheap exit that costs a session nothing to write and cannot be
told apart from one that did not look. The undecidable skeleton's placeholders say what that
evidence is for ("where you looked", "what it did NOT establish").

`PlanResearchResult` gains `undecidable`, and `analyze.ts` carries it to PRESENT with the
unanswered set while counting it apart: the batch line now names four populations, and the
settled one is the only one whose advice is a named human rather than a ceiling.

**D-19.** `planningArtifactPath(root, hash)` gives each question its own raw artifact, cleared
with `rmSync` before every launch; `readBrief` distinguishes "wrote no artifact" / "not JSON" /
validator issues / "answers another question's hash" and the note carries the refusal verbatim
instead of the fixed string "no valid brief".

**A bug this ticket's own tests caught mid-implementation.** The cache-hit path pushed every
cached brief into `briefs` without checking `outcome`, so a settled verdict came back as an
answer on the second run and dropped out of the batch a human sees — the verdict survived on
disk and stopped being told to anyone. Both paths now route by the same rule.

**Test files updated to the new launcher contract** (`researchOne` writes `artifactOut` instead
of returning a brief): `research-share.test.ts`, `stages.test.ts`, `research-batch.test.ts`. The
last was passing for the wrong reason — its fake returned the brief, so
`BRIEF_REFUSED_FOR_EMPTY_LOCAL_SEARCH` never reached the validator and X-6a was named in the
fixture and exercised by neither test that cited it.

## Mutation battery

Thirteen mutants, each reverting one claim; the named test that caught it. Every mutant compiles
except where noted, so none is caught by `tsc` standing in for a test.

| # | Mutation | Caught by |
|---|---|---|
| M1 | `pipeline` passes no `expected_output` (D-17 itself) | `passes both expected_output arms` |
| M2 | `pipeline` passes no `question_hash` | `binds the session to its question by hash and by artifact path` |
| M3 | one shared artifact path for every question | `gives every question its own artifact path` |
| M4 | stale artifact not cleared before launch | `clears a stale artifact before the session runs` |
| M5 | `readBrief` does not compare `question_hash` | `refuses a brief that answers a different question than the one asked` |
| M6 | `withOneRelaunch` never relaunches | `relaunches once with the validator's own words` |
| M7 | cache-hit path ignores the outcome arm | `caches an undecidable verdict so a re-run does not pay to rediscover it` |
| M8 | fresh path files undecidable as answered | `treats an undecidable question as researched and settled` |
| M9 | schema drops `requireOutcomeArm` | `still requires an answer on the answered arm` |
| M10 | `analyze` drops settled questions from the batch | `counts a settled question apart from one a bigger ceiling could still answer` |
| M11 | `analyze` counts settled as researched-no-answer | same |
| M12 | research call site drops `previous_attempt` | `tells the reshape relaunch what the validator refused` |
| M13 | relaunch told a generic string, not the validator's words | `relaunches once with the validator's own words` |

Two mutants were discarded rather than recorded as caught. One broke compilation instead of
behaviour (`withNoRelaunch`), and was replaced by M6, which compiles. One survived and is not a
defect: removing the undecidable skeleton's evidence placeholders leaves the inherited
placeholder from `planningBriefSkeleton`, so both shapes parse and the difference is prose.

M12 was a genuine gap the battery found: `previousAttemptInput` was pinned at the plan-review
call site and merely spread at this one — the same "the mechanism exists, the call site does not
use it" shape as D-17. A test was added rather than the mutant excused.

`analyze.ts`'s handling of the settled population had no test at all when the battery started —
M10 and M11 both survived. `counts a settled question apart from one a bigger ceiling could
still answer` was written to close it, and found a second real problem while being written: the
fixture could not be expressed, because `evidence.min(1)` had no placeholder telling a session
that evidence-of-absence is what the arm wants.
