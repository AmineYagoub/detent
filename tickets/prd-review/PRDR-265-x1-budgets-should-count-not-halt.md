---
id: PRDR-265
title: "The X-1 budget ceilings that are genuinely budgets should count, not halt — and the five that are sequencers must be left alone"
state: OPEN
severity: major
category: defect
labels: ["prd-review", "X-1", "P6", "doc-claim-drift", "budgets", "survey-backed", "D-18", "operator-signal"]
surface: ["src/kernel/stages/research.ts", "src/init/plan-research.ts", "src/kernel/referee-session.ts", "src/kernel/ledger.ts", "src/kernel/worstcase.ts", "src/kernel/budgets.ts", "src/schemas/budgets.ts", "src/referee/registry.ts", "prompts/research.md", "scripts/null-review.ts", "tests/oracle/budgets.test.ts"]
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

TO BE FILLED

## What changed

TO BE FILLED

## Mutation battery

TO BE FILLED
