---
id: PRDR-265
title: "The X-1 budget ceilings that are genuinely budgets should count, not halt — and the five that are sequencers must be left alone"
state: DONE
severity: major
category: defect
labels: ["prd-review", "X-1", "P6", "doc-claim-drift", "budgets", "survey-backed", "D-18", "operator-signal"]
surface: ["src/kernel/stages/research.ts", "src/init/plan-research.ts", "src/init/analyze.ts", "src/init/session.ts", "src/kernel/referee-session.ts", "src/kernel/ledger.ts", "src/kernel/referee.ts", "src/kernel/worstcase.ts", "src/kernel/budgets.ts", "src/schemas/budgets.ts", "src/referee/registry.ts", "src/cli/init.ts", "prompts/research.md", "scripts/null-review.ts", "tests/kernel/x1-counting.test.ts", "tests/oracle/budgets.test.ts"]
prd_refs: ["X-1", "X-1″", "X-1⁵", "P6", "C-3a", "D-14", "D-15", "D-16", "D-18", "PRDR-106", "PRDR-179", "PRDR-191", "PRDR-219", "PRDR-250", "PRDR-261", "PRDR-262", "PRDR-264"]
acceptance_criteria: ["The four genuine budgets become pure counters, following the shape PRDR-191 (`run_spend_usd`, X-1⁵) and PRDR-106 (`turns_per_stage`, X-1″) already shipped: `breachTarget: \"NONE\"`, the read STAYS so the key keeps an executable mention in its ENFORCEMENT_SITES module (P6), and the number is announced once rather than enforced. The four: `failure_research_tool_calls`, `planning_research_tool_calls`, `sessions`, and the `spend_without_progress_*` triple which shares a single throw.", "`failure_research_tool_calls`: delete the early return at `src/kernel/stages/research.ts:112-116`. Keep lines 88-93 verbatim — the ceiling is still read and still interpolated into the session prompt as `tool_call_ceiling`, which is both the P6 grep's anchor and the only honest way the session learns the figure. Replace the conditional note with an unconditional one so the turn count is reported on every research session, not only on overrun.", "`planning_research_tool_calls`: delete the skip arm at `src/init/plan-research.ts:307-315`. That arm is the only behavioural cap — it is what makes a question past the pool get NO session at all. `pipeline.ts:187` keeps reading the key for P6.", "The clamp at `src/init/plan-research.ts:376` (`Math.min(spentHere, share)`) becomes `toolCallsUsed += spentHere`. This is D-18's actual complaint and the reason it is folded in here: under a cap, clamping made `toolCallsUsed` report ALLOCATION while reading as SPEND, and the file's own doc-block admits the excess \"has always fallen on the floor here\". With nothing to enforce there is no reason left to discard the observation, and the live run's 13-against-8 and 20-against-8 become visible.", "D-16's share allocation at `plan-research.ts:350-360` SURVIVES as advice, not as a limit. With no pool to exhaust there is no `remaining` to divide, but the even cut is still what the session is ASKED for via `tool_call_budget`, and PRDR-262 exists because the greedy alternative starved every question after the first. The ticket says this explicitly rather than dropping it silently, because dropping it changes init's cost profile without removing any halt.", "`sessions`: delete the three-line if/throw at `src/kernel/referee-session.ts:84-86`. Keep the increment at 88-92 verbatim — that is the number the dossier, `cli/status`, `cli/report` and cumulative counters all live on, and it is structurally separate from the check.", "The `spend_without_progress_*` triple: delete the single throw at `src/kernel/ledger.ts:405`. All three keys share it; none has enforcement of its own. `assertLaunchAllowed` is renamed to something honest (`recordLaunch`) and announces its evidence through the existing `announce` seam — `announceAdvisoryTotal` (`ledger.ts:310-320`) is the finished template for exactly this shape. Both call sites (`referee-session.ts:61`, `init/session.ts:347-350`) stay. `breakerTerms()` and `sessionCostEvidence()` stay: they are the only place the repo learns what a unit of work costs, and a counting regime wants that number more, not less.", "The dead budget route goes with them. `SpendExhaustedError` (`ledger.ts:168-180`) is `@deprecated` and has ZERO throw sites in src or tests — verified, `grep -rn 'throw new SpendExhaustedError' src tests` returns nothing — yet `referee/registry.ts:145-147` still maps it to error code BREACH, which reads as a live budget route. Delete both.", "`worstcase.ts:295-299`'s config-load refusal (`budgets.sessions <= computed` → ConfigRejectedError) goes, since `sessions` no longer halts anything. `maxPossibleSessions` itself and its `UnboundedWorstCaseError` (`worstcase.ts:96-103`) are KEPT. That walk is the actual termination proof for a generation and is what would catch a transition-table edit that re-enters a session-launching state without consuming a budget. It still returns a number under this scope precisely because the five sequencers are untouched — that is the property that makes this ticket shippable on its own.", "The doc-claim drift each deletion would otherwise manufacture is fixed in the same commit, because this repo's defining defect class is a doc-block stating a mechanism in the present indicative that the code only half-implements. Four sites: `ledger.ts:10-23` (the T-048 block still calls `run_spend_usd` a LAUNCH GATE — already false since PRDR-191, unrelated to this ticket's deletions and fixed here because it is the same sentence pattern); `prompts/research.md:3` (\"the tool-call ceiling in your inputs (X-1 `failure_research_tool_calls`)\" — `npm run prompts:check` only pins the TEXT, so it will not catch this); `plan-research.ts`'s \"The ceiling is enforced either way (C-3a)\" (D-18's false claim, which this ticket finally makes true by making it a counter); and `TIE_TOLERANCE` (`ledger.ts:135-155`), twenty lines justifying a boundary comparison that stops happening.", "`ENFORCEMENT_SITES` and its doc-block at `src/kernel/budgets.ts:31-34` are rewritten to mean COUNTING site. It currently reads \"a ceiling with no enforcer is a budget that routes nowhere, which P6 forbids\" — which, after this ticket, is a rule the repo deliberately breaks six times. The P6 test's skip list at `tests/oracle/budgets.test.ts:60` (today a single `if (key === \"turns_per_stage\") continue;`) grows to name every converted key, so the exemption is enumerated rather than implied.", "`scripts/null-review.ts:105-107` sets all three breaker keys to 1_000_000 to disable the breaker for the null-review sweep. That becomes a no-op and is removed, so the script stops implying a brake it no longer needs to defeat."]
non_goals: ["Does NOT touch the escalation ladder. `blind_fix_attempts`, `research_sessions` and `informed_fix_attempts` are NOT budgets — `resolveRed()` (`src/kernel/resolver.ts:26`) takes only `Counters` and has no `Budgets` parameter at all, so the configured ceiling is ALREADY inert. The `=== 0` comparisons at resolver.ts:27/30/33 are rungs 1, 2 and 3 of the escalation ladder: they decide whether a red gate becomes BLIND_FIX, RESEARCH or INFORMED_FIX. Deleting them deletes escalation, not a limit, and `machine.ts:107` routes BLIND_FIX|GATE_RED straight back into the selector — an unconditional BLIND_FIX return is an infinite loop with a paid session per lap. `consumeSlot`'s `SlotExhaustedError` (`kernel/budgets.ts:110-113`) is structural to the at-most-once semantics and stays.", "Does NOT make `review_fix_attempts` count-only. CONCRETE INFINITE LOOP: `IN_REVIEW --REVIEW_CHANGES--> REVIEW_FIX --GATE_GREEN--> IN_REVIEW` (machine.ts:110-111), and with the compare gone the guard always returns REVIEW_FIX. Any reviewer that keeps returning `changes` — the exact behaviour PRDR-250's null-rate work measured — spins forever at one review session plus one fix session per lap. Converting it needs a NON-BUDGET exit first (a fixed-point check on identical findings, or a terminating verdict), which is its own design question.", "Does NOT make `hypotheses` count-only. Two concrete loops: `DIAGNOSED --REPRO_WRONG--> DIAGNOSED` (machine.ts:92) on a bug ticket whose repro never matches the prediction, and `IN_PROGRESS --PREMISE_FALSIFIED--> DIAGNOSED --REPRO_AS_PREDICTED--> IN_PROGRESS` on an implement session that keeps writing falsified.json. Same carve-out decision as `review_fix_attempts`. The ticket-type branch at machine.ts:185-188 is routing, not a ceiling, and is not the thing that would be removed.", "Does NOT make `ticket_wall_clock_ms` count-only. The survey flags it as a judgement call and this ticket takes the conservative side: it is a TIMEOUT, in the same family as the three already excluded, differing only in bounding a ticket rather than a subprocess. It is also the ONLY wall-clock bound on `driver.ts:183`'s loop, which makes it the backstop that would catch precisely the two cycles above. Removing it in the same ticket that uncaps the spend breaker would leave the run loop with no time bound and no spend bound at once.", "Does NOT touch `gate_timeout_ms`, `binding_probe_timeout_ms` or `flake_reruns` — the three process guards excluded from the outset. They bound subprocesses and flake detection, not agent behaviour.", "Does NOT change any ceiling's DEFAULT value. Every number in CEILINGS stays exactly where it is; what changes is whether crossing it halts. An operator who has tuned a value keeps that value as the figure now reported and prompted.", "Does NOT delete the keys from `budgetsSchema` or CEILINGS. They remain configurable, loadable and reported — the strict-schema migration that removing them would force is a separate, larger change with back-compat consequences for every config already on disk.", "Does NOT re-open whether the loop should be bounded at all. After this ticket the run driver still has `ticket_wall_clock_ms`, the five ladder sequencers and `maxPossibleSessions`'s load-time termination proof; init still has the wall clock and the ladder. What it loses is the four numeric brakes that were doing arithmetic no sequencing depends on."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-106", "PRDR-179", "PRDR-191", "PRDR-250", "PRDR-261", "PRDR-262", "PRDR-264"]
depends_on: []
---

# PRDR-265 — the budgets that are budgets should count; the ones that are sequencers must not be touched

## Where this came from

A direct instruction, and an eight-agent survey commissioned to make it safe. The instruction:
convert X-1's budget ceilings to pure counters, keeping `gate_timeout_ms`,
`binding_probe_timeout_ms` and `flake_reruns` as real guards. The survey mapped every
enforcement site for every key and came back with a finding that changes the scope.

**Five of the keys on the convert list are not budgets.** They are the loop's sequencers, and
removing their comparisons removes escalation rather than a limit. Three of them are the
escalation ladder itself; two of them close concrete infinite loops. The survey verified the
consequence rather than predicting it: with `review_fix_attempts` and `hypotheses` count-only,
`maxPossibleSessions` throws `UnboundedWorstCaseError` at **config load** — so the change would
not reach a hanging loop, because `loadConfig` would refuse the config first.

This ticket therefore converts the four keys that really are budgets and names the six
exclusions explicitly, with the reason each one is not a budget.

## The test for "is it a budget"

A budget is arithmetic that decides whether to CONTINUE. A sequencer is a comparison that
decides WHAT HAPPENS NEXT. The distinction is visible in the signature:

```ts
export function resolveRed(counters: Counters): ResolveOutcome {
  if (counters.blind_fix_attempts === 0) {
    return { next: "BLIND_FIX", counters: consumeSlot(counters, "blind_fix_attempts") };
  }
```

`resolveRed` takes **only counters**. There is no `Budgets` parameter anywhere in that module,
so `CEILINGS.blind_fix_attempts` is already inert at runtime — `LADDER_CEILING_KEYS` pins it to
1 and nothing reads the value. The `=== 0` is not a cap that happens to be set to one; it is
rung one of the ladder wearing a counter's clothes.

Contrast the genuine article at `referee-session.ts:84-86`:

```ts
if (counters.sessions >= ctx.budgets.sessions) {
  throw new Breach("net session ceiling (X-1) — backstop against a kernel accounting defect");
}
```

Reads a configured ceiling, throws, orders nothing. Its own message calls it a backstop. That
is a budget, and the increment three lines below it is untouched by its removal.

## The precedent this follows

Two keys have already made this trip and are the template rather than an analogy:

- `turns_per_stage` — PRDR-106 (X-1″). `breachTarget: "NONE"`, reaches PLAN/REVIEW_PLAN as
  `session_budget.implement_turns`, nothing halts on it.
- `run_spend_usd` — PRDR-191 (X-1⁵). `overAdvisoryTotal()` returns a bool consumed only by
  `announceAdvisoryTotal()`, which writes a one-time note. `SpendExhaustedError` survives as a
  `@deprecated` class with **zero throw sites**, still wired to a BREACH route in
  `registry.ts:145-147` that nothing can reach.

That last detail is why the dead route is in scope here: PRDR-191 converted the ceiling and left
the corpse wired in, and it has read as a live budget route ever since.

## D-18, folded in

D-18 is the live-run observation that `planning_research_tool_calls` is advisory while its
doc-block claims "The ceiling is enforced either way (C-3a)". Run 4: Q1 budgeted 8, spent 13;
Q2 budgeted 8, spent 20; 33 real calls against a pool of 16.

PRDR-264 fixed the half that was a wrong prompt key and declared the enforcement half a
non-goal, because whether the ceiling should bind at all was this question. The answer is that
it should not — and once it does not, the clamp at `plan-research.ts:376` has no remaining
purpose. Today `Math.min(spentHere, share)` makes `toolCallsUsed` report what was ALLOCATED
while reading as what was SPENT; the file's own doc-block concedes the excess "has always fallen
on the floor here". Under a counting regime the honest figure is the observed one, and D-18's
33-against-16 becomes something an operator can see.

## What is NOT in scope, and why each one bites

| Key | Why it stays |
|---|---|
| `blind_fix_attempts` | Ladder rung 1. Unconditional return + `machine.ts:107` = paid loop. |
| `research_sessions` | Ladder rung 2. Bounded alone, unbounded in combination. |
| `informed_fix_attempts` | Ladder rung 3. `machine.ts:119`'s direct edge to NEEDS_HUMAN is the ladder's terminator. |
| `review_fix_attempts` | `IN_REVIEW → REVIEW_FIX → IN_REVIEW` spins on any reviewer that keeps saying `changes`. |
| `hypotheses` | `DIAGNOSED → REPRO_WRONG → DIAGNOSED` spins on any bug ticket whose repro never matches. |
| `ticket_wall_clock_ms` | The only wall-clock bound on `driver.ts:183` — the backstop for the two rows above. |

The two loop rows are not theoretical. The survey ran `maxPossibleSessions` against each and
recorded the cycle it reports: `REVIEW_FIX:1:1:0:1:2 -> IN_REVIEW` and `DIAGNOSED:0:...`.

## Falsification against HEAD

`tests/kernel/x1-counting.test.ts` — 14 tests written against HEAD before any
source change, in five groups for the four converted budgets, the dead route,
and one group of regression guards that must pass on HEAD and keep passing.

```
   × every converted key routes nowhere, joining turns_per_stage and run_spend_usd 5ms
   ✓ keeps every ceiling's DEFAULT exactly where it was — what changes is whether crossing it halts 1ms
   × a session past its ceiling still yields its brief, and still seeds the cache 142ms
   × reports the turns against the stated ceiling on EVERY session, not only on overrun 144ms
   × gives every question a session even when the pool is long gone 4ms
   × reports the calls that were actually made, not the share they were allowed 2ms
   ✓ still answers a cached question for free — C-3a's acceptance is unaffected 2ms
   × records the launch and says what it would have stopped, rather than throwing 150ms
   × says it once, not on every launch 136ms
   ✓ still computes the threshold it no longer enforces 137ms
   × SpendExhaustedError is gone from the ledger's exports 0ms
   ✓ every carved-out key keeps the breach target it had 0ms
   ✓ still escalates BLIND_FIX -> RESEARCH -> INFORMED_FIX -> NEEDS_HUMAN 0ms
   ✓ the worst case is still finite — the machine still terminates 1ms
 Test Files  1 failed (1)
      Tests  8 failed | 6 passed (14)
```

The eight failures are the eight halts. Named individually:
`expected 'RESEARCH_DRY' to be 'NONE'`, `expected 'RESEARCH_DRY' to be
'RESEARCH_VALID'`, `expected '' to match /3 turns against .*8/`,
`expected 2 to be 3`, `expected 16 to be 33`,
`TypeError: ledger.recordLaunch is not a function`, and
`expected [Function SpendExhaustedError] to be undefined`.

The six passes are the point of the group they are in. Four are the carve-out
guards — they establish that the ladder, the clock and the termination proof are
all intact BEFORE the conversion, so a later failure in them is attributable to
this ticket rather than inherited. `expected 16 to be 33` is D-18's live number
from run 4 reproduced in a unit test.

A fifteenth test was added after implementation, not before: `re-arms after a
unit completes, so a second stall is news again`. It covers behaviour the fix
introduced rather than behaviour HEAD got wrong — the breaker's say-once flag
clears on progress where the advisory total's does not — so it could not have
been written against HEAD, where there was no flag. It is mutation-verified
below like the rest.

## What changed

Four budgets became counters; six ceilings now declare `breachTarget: "NONE"`
(the `spend_without_progress_*` triple shares one throw, so three keys convert
with one deletion). Every default is untouched.

- **`failure_research_tool_calls`** — the RESEARCH_DRY early return in
  `stages/research.ts` is deleted and the conditional note is replaced with an
  unconditional one, so the turn count is reported on every research session
  rather than only on the ones that overran. The ceiling is still read and still
  interpolated as `tool_call_ceiling`.
- **`planning_research_tool_calls`** — the skip arm in `plan-research.ts` is
  deleted, and the clamp at the charge site splits in two. `toolCallsUsed` takes
  the observation whole (D-18); a new `allocated` running total takes the clamped
  charge and is what D-16's even cut divides from. This is a deviation from the
  ticket as filed, which said only "`toolCallsUsed += spentHere`": with a single
  counter, an overrunning session shrinks every later question's share and
  reproduces D-16 through the back door. Two numbers were always being conflated
  and the cap was what hid it.
- **`sessions`** — the throw in `referee-session.ts` is deleted; the increment
  beside it is untouched.
- **`spend_without_progress_*`** — `assertLaunchAllowed` is renamed
  `recordLaunch` and announces through the existing `announce` seam, on
  `announceAdvisoryTotal`'s template. `NoProgressError` and `SpendExhaustedError`
  are deleted along with the BREACH disjunct in `registry.ts` that had mapped a
  class with zero throw sites since PRDR-191.

Three deletions cascaded into work the ticket did not name, each recorded because
leaving it would have manufactured exactly the drift this repo is worst at:

- **`ConfigRejectedError` (`worstcase.ts`)** — with `sessions` counting, refusing
  to LOAD a config over it was enforcing a budget at the one moment nothing had
  been spent. The class had no other caller and is deleted.
  `maxPossibleSessions` and `UnboundedWorstCaseError` are KEPT, which mutant M12
  demonstrates is load-bearing.
- **`neverResearched` (`plan-research.ts`, `analyze.ts`)** — the skip arm was its
  only producer, so it became structurally empty on every path while ANALYZE kept
  printing a count of it. A population that cannot occur, reported every run, is
  the same corpse as the dead BREACH route this ticket deletes, so it goes the
  same way. What it guarded is kept as behaviour instead of as a field: every
  question gets a session, asserted directly.
- **`ENFORCEMENT_SITES` (`kernel/budgets.ts`)** — the doc-block said a ceiling
  with no enforcer "is a budget that routes nowhere, which P6 forbids", a rule
  the repo now breaks seven times. It is rewritten to mean the ACCOUNTABLE
  module.

Two decisions run against the ticket as filed, and both make the result stronger:

- **`TIE_TOLERANCE` is KEPT.** The survey called it twenty lines justifying a
  comparison that stops happening. The comparison does not stop happening — it
  survives as the trigger for the announcement, so deleting it would restore the
  IEEE-754 coin flip PRDR-261 removed, one rung quieter. Its doc-block is amended
  rather than deleted.
- **The P6 skip list does NOT grow.** The ticket asked for every converted key to
  be named in `tests/oracle/budgets.test.ts`'s skip list. All six keep an
  executable read in their named module, verified against the real `codeOnly`
  grep, so a `continue` for each would have stopped checking the one thing P6 is
  still worth after this ticket: a ceiling nothing reads is a dial wired to
  nothing, whether it halts or only reports. The exemption is enumerated where it
  belongs instead — `nonBreach` was `toHaveLength(7)`, the weakest form the
  statement can take, and is now the explicit list of eight keys. Its complement
  is sharper still: the keys that still halt are exactly the six carve-outs.

Nineteen existing tests were converted rather than deleted, because in every case
the SUBJECT survives and only the verb changes — D-14's denominator, D-15's
evidence, D-16's division, D-28′'s batch accounting and ARCH-2's cross-driver
parity are all claims about arithmetic, not about halting. Three asserted the
defect as the specification and are inverted with the reason recorded inline: an
over-ceiling research session losing a sound brief, a pool too small stranding a
question, and `an over-reporting backend cannot push the counter past the
ceiling` — which asserted that a session reporting 9999 calls was recorded as
having made 16.

## Mutation battery

Twelve mutants, each reverting one half of the change. Cleanup is by file
snapshot, not `git checkout` — an early mutant was cleaned with `git checkout`
and silently reverted two files to HEAD, contaminating the two results after it;
both were re-run against the restored tree and are reported below.

| # | Mutation | Caught by |
|---|---|---|
| M1 | Restore the RESEARCH_DRY early return | 2 failed — `kernel/stages` + `x1-counting` |
| M2 | Make the turn note fire only on overrun | `reports the turns … on EVERY session` |
| M3 | Restore the planning skip arm | 2 failed — `research-share` + `x1-counting` |
| M4 | Restore `toolCallsUsed += charged` | 3 failed — `init/stages` ×2 + `x1-counting` |
| M5 | Restore the `sessions` throw | `a sessions ceiling of 1 stops nothing` (whole-run) |
| M6 | Breaker throws instead of announcing | 5 failed across `no-progress-breaker` |
| M7 | Drop the say-once flag | `says it once, not on every launch` |
| M8 | Carry `breakerAnnounced` forward on progress | `re-arms after a unit completes` |
| M9 | Restore the config-load refusal | `loads a config whose net sessions are below …` |
| M10 | Revert `sessions` to `BUDGET_BREACH` | 2 failed — `oracle/budgets` + `x1-counting` |
| M11 | Re-add the dead BREACH disjunct | **NOT caught** — see below |
| M12 | Delete ladder rung 1 (`blind_fix_attempts`) | 2 failed in `x1-counting`, 5+ in `run.test.ts` |

M11 is the honest negative result. Re-adding `err instanceof SpendExhaustedError`
to `registry.ts`'s BREACH arm fails nothing, because nothing can throw it — which
is precisely why it survived four releases and why the ticket calls it a corpse.
No behavioural test can catch unreachable code. The guard is structural instead:
M11b resurrects the class on the ledger's exports and
`SpendExhaustedError is gone from the ledger's exports` fires immediately.

M12 is the one that justifies the ticket's scope. Deleting rung 1 of the
escalation ladder — a key the survey originally listed for conversion — fails the
carve-out guard with the cycle named:

```
transition table admits an unbounded session count: the cycle
APPROVED:0:0:0:0:2 -> BLIND_FIX:0:0:0:0:2 -> IN_REVIEW:0:0:0:0:2
re-enters a session-launching state without consuming a budget.
```

plus five whole-run failures in `run.test.ts` including the oracle happy path.
That is the survey's finding reproduced as a test result rather than a
prediction, and it is why `maxPossibleSessions` is kept.
