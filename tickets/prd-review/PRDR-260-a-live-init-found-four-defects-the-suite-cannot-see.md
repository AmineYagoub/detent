---
id: PRDR-260
title: "Four defects a live init found and the suite cannot see: an S-5 pin that fails OPEN, a slice's review evidence deleted by the next slice, a remain-count that is stationary by construction, and one AWAIT_INFO number for two opposite outcomes"
state: DONE
severity: major
category: gap
labels: ["prd-review", "found-by-live-run", "doc-claim-drift", "S-5", "C-3a", "C-4", "PRDR-200", "operator-signal"]
surface: ["src/sessions/sdk.ts", "src/sessions/backend.ts", "src/init/plan-review.ts", "src/init/plan-slices.ts", "src/init/plan-whole.ts", "src/init/plan-research.ts", "src/init/analyze.ts", "src/init/plan-notes.ts", "tests/init/review-evidence.test.ts", "tests/sessions/pin-check.test.ts", "tests/init/research-batch.test.ts", "tests/cli/pin-parity.test.ts", "tests/cli/doctor.test.ts", "tests/sessions/sdk.test.ts"]
prd_refs: ["S-5", "C-3a", "C-3′", "C-4⁗″", "C-8", "X-6a", "N-6", "V-6", "ARCH-2", "PRDR-196", "PRDR-200", "PRDR-203", "PRDR-205"]
acceptance_criteria: ["S-5's comparison is an equality on the version token both halves parse the same way — `src/init/config.ts:41` writes `raw.trim().split(/\\s+/)[0]`, and the checker reduces the probe the same way before comparing — so a pin that is a PREFIX of the installed version (`2.1.2`, `1`, `Claude` against `2.1.269 (Claude Code)`) refuses instead of passing.", "The refusal names the remediation: the config file, the key, and the version to set it to. The operator learns what to edit from the error, not from reading `sdk.ts`.", "`ClaudeCodeBackend.checkVersion` is reachable from a test. The probe is a seam on `SdkBackendConfig`, defaulting to today's `execFileSync`, and the comparison has direct coverage for the first time — accepted, refused, prefix-refused, `unknown`-refused.", "A slice's sampled review artifacts survive the next slice: `state/slices/<slice>/draws/<n>/plan-review.json` keyed by the slice that was judged, asserted on CONTENT and not only existence.", "The slice's post-revision re-review artifact survives too — the same clobbering, one path over, at `state/slices/<slice>/plan-review.json`.", "PRDR-205 is preserved exactly: every draw is still TOLD one shared, slice-free path, asserted as a set of size one across a multi-slice run.", "The operator-facing `N finding(s) remain` line carries what the round DID — resolved and introduced — at both emit sites, so a round that answered everything it was handed and raised as much again cannot read as a round that did nothing.", "PRDR-200's null rides the same line as a RATE over a named number of unrevised read pairs, never as a raw count: `sampleChurn` sums over k*(k-1) ordered pairs while a revision is one pair, and the two are not on the same scale.", "The whole-plan line says outright that it HAS no null, because that path takes a single draw and never samples — the absence is stated rather than papered over.", "`planResearch` reports which unanswered questions never got a session, and ANALYZE's closing note splits the batch into researched-without-an-answer and never-reached. The two are actionable in opposite directions.", "An init with no research configured is named as such rather than counted as `never researched`, which would read as a ceiling that was hit.", "The churn line no longer promises a number that is not always below it: it is emitted on every reviewed slice, including the ones that approve and therefore never revise."]
non_goals: ["Does NOT turn the pin into a FLOOR. Allowing `installed >= pinned` is a policy change that redefines the pin from 'the version this project was verified against' into a minimum, which readmits the unvetted-upgrade case S-5 exists to refuse (`src/sessions/live.ts:96-99`). It is defensible and it needs its own ticket, a restated guarantee, and a decision about MAJOR/MINOR bumps. This ticket makes the comparison correct, not permissive: the run that prompted it stays blocked, deliberately, and is now told how to unblock itself.", "Does NOT add an opt-out flag. `tests/oracle/pin-parity.test.ts:52-57` greps each checker's stripped source for the literal `checkVersion(`; a call wrapped in `if (!values[\"skip-pin\"])` still contains it, so the oracle would stay green while the guarantee left — the exact drift class this ticket is part of closing.", "Does NOT fix the `pinned: \"unknown\"` trap recorded at PRDR-251:118-131. A config written where `claude --version` could not run still refuses every entrypoint forever. The refusal now NAMES it, which is the first time an operator can act on it; the real fix is a semver refinement on `src/kernel/worstcase.ts:223` or an `init` that refuses to write it, and belongs to whoever takes that on.", "Does NOT key the two WHOLE-PLAN review artifacts. Both land on `state/plan-review.json` (`src/init/plan-whole.ts:144` and `:243`) and the second overwrites the first. They are one pair per init rather than one pair per slice, they carry no slice id to key on, and giving them one means threading a discriminator through `reviewPlan`. Recorded here so it is not rediscovered as new.", "Does NOT change the research ALLOCATION policy. `planning_research_tool_calls` remains one whole-init pool that the first question may consume entirely (`src/init/plan-research.ts:87`); this ticket makes the outcome legible, and whether a per-question share or a reservation is right is a separate argument with its own cost.", "Does NOT prune `state/slices/**`. Keyed artifacts now survive a re-run, and `--replan` clears `state/plan` only (`src/init/machine.ts:434`), so a slice that no longer exists leaves its draws behind. The per-file `rmSync` still guarantees no stale file is READ as a current verdict, so this is disk litter under the gitignored local set, not a correctness bug — and pruning it directly contradicts the retention this ticket is for.", "Does NOT make the cached-slice path contribute its recorded `revision` and `churn` to PRESENT. `src/init/plan-slices.ts:351-360` reuses a cached slice and `continue`s without pushing either, so a fully-resumed run still prints zeroes for numbers that are sitting on disk. Same defect class, one branch over; it needs the `SliceCache` type at :116-122 widened and belongs to its own ticket."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-181", "PRDR-196", "PRDR-200", "PRDR-203", "PRDR-205", "PRDR-251", "PRDR-253", "PRDR-254"]
depends_on: []
---

# PRDR-260 — four defects a live init found

## Where these came from

A real `detent init` was run against a large external repository for 144 minutes: 13 sessions,
$67.55, one plan slice written and a second planned and reviewed. Nine defects were tracked.
Four of them are in this ticket because they share one property — **every one is invisible to
the suite**, and three of them are invisible in the same way: a mechanism is stated in a
doc-block or a note, a test covers the half that was built, and nothing looks at the half that
was not.

The other five are not here: one resolved on reproduction (an external `SIGTERM`, not a hang),
one was withdrawn (a finding-count delta of 2 against a measured null of ±24 carries no
information), one was verified clean, and two are design arguments rather than defects.

---

## D-1 — the S-5 pin fails OPEN, and its refusal names no remedy

`src/sessions/sdk.ts:351`:

```ts
if (!installed.includes(pinned)) {
  throw new Error(`backend version mismatch (S-5): pinned=${pinned} installed=${installed}`);
}
```

`String.prototype.includes` is **substring containment**, and it fails in both directions.

`src/init/config.ts:41` writes the pin as `raw.trim().split(/\s+/)[0]` — the bare token,
`2.1.269`. `checkVersion` compares against the UN-split `raw.trim()`, `2.1.269 (Claude Code)`.
One module parses; its counterpart does not. `includes` is papering over a parse the checker
declined to do, and the paper has a hole in it.

Run against HEAD on this machine, whose CLI reports `2.1.269 (Claude Code)`:

```
pin "2.1.269" -> ACCEPTED
pin "2.1.258" -> REFUSED: backend version mismatch (S-5): pinned=2.1.258 installed=2.1.269 (Claude Code)
pin "2.1.2"   -> ACCEPTED
pin "1"       -> ACCEPTED
pin "Claude"  -> ACCEPTED
pin "unknown" -> REFUSED: backend version mismatch (S-5): pinned=unknown installed=2.1.269 (Claude Code)
```

A truncated or hand-typed pin **disables the gate on all four spending paths** — `cli/init`,
`cli/referee`, `kernel/run`, and doctor's smoke — with no signal. `src/kernel/worstcase.ts:223`
accepts any non-empty string as the pin, so nothing upstream catches it either. The
over-refusal that started the investigation (the run was blocked by a `2.1.258` pin against a
`2.1.269` CLI) is the smaller half; **failing open is worse than failing shut**, and nobody had
recorded it.

`src/sessions/backend.ts:163` declares `/** S-5: bootstrap fails when installed != pinned. */`
— an equality claim over a containment test. Nothing detects the gap because **no test
exercises the real comparison at all**: `tests/cli/pin-parity.test.ts`, `tests/cli/doctor.test.ts`
and `tests/kernel/run.test.ts` each overwrite `checkVersion` with a stub that throws a
hand-written string, and `MockBackend.checkVersion` is a documented no-op. Replacing line 351
with `if (false)` leaves `npm test` green. That is the measure of the exposure: the four call
sites are oracle-locked by `tests/oracle/pin-parity.test.ts`, and the decision they call is
untested.

The second half is the message. It names two numbers and no action. The sibling branch four
lines up already does better (`install the pinned version (${pinned}) — S-5`), and
`src/cli/doctor.ts:139-144` already carries the wording pattern this needs.

**Two closed tickets froze this deliberately.** PRDR-251:11 and PRDR-253:11 both carry the
non-goal *"Does not change `checkVersion`, nor what counts as a match (`installed.includes(pinned)`)"*.
Nothing mechanically enforces a closed ticket's non-goals, so this change passes every gate
while contradicting the written record of two prior decisions. **This ticket supersedes that
non-goal in both**, on the grounds neither had: the match rule is not merely strict, it is
unsound in the permissive direction.

## D-8 — a slice's review evidence is deleted by the next slice

`src/init/plan-review.ts:42-44` builds the artifact path from the draw index alone:

```ts
export function planReviewPath(root: string, draw?: number): string {
  return path.join(stateDir(root), "state", ...(draw === undefined ? [] : ["draws", String(draw)]), "plan-review.json");
}
```

Nothing in the path identifies the slice. `reviewOnce` deletes the draw's file before every
launch (`plan-review.ts:241`), and `planSlices` loops slices at `plan-slices.ts:345`, so **slice
02's draw 1 `rmSync`s the exact file slice 01's draw 1 wrote**. Three files exist at the end of
a ten-slice run, and all three hold the last slice's verdict.

The same defect sits one path over and was not in the original report: the post-revision
re-review (`plan-slices.ts:399`) passes no draw, so every slice writes it to
`state/plan-review.json`, and line 249 of `plan-review.ts` deletes that path on every
subsequent draw. **Slice 01's second-review verdict is deleted by slice 02's first draw.**
Fixing only the draws would retain the three samples behind the vote while still destroying
the verdict the revision actually produced — a half-audit, and a sentence about retained
evidence that would be false in the present indicative the day it was written.

Readers: exactly one, `reviewOnce` itself, milliseconds after the launch. No `readdirSync` in
`src/` or `scripts/` targets the tree; no glob reconstructs the path. So the evidence is
write-only-then-destroyed, and the aggregate notes at `plan-slices.ts:381-390` are the only
surviving trace of a judgement that cost three sessions.

**The constraint the fix must not break (PRDR-205):** the path a session is TOLD stays
slice-free and draw-free. `src/init/session.ts:131` puts `artifactTold` in the prompt cache key;
a per-draw path there cost ~25k tokens and $0.45 a draw. Only the ACTUAL file moves.

## D-7 — `N finding(s) remain` cannot move

`revisionOutcome` (`src/init/plan-signal.ts:49-53`) defines `resolved = |before| - survived`
and `introduced = |after| - survived`. Therefore:

```
|after| = |before| - resolved + introduced
```

Whenever `resolved === introduced` the printed count is **exactly the count it started with**,
for any amount of real work done. The live run's own s01 line was `9 finding(s) remain` beside
`7 resolved, 2 survived, 7 introduced` — a round that answered seven of nine complaints and was
handed seven new ones, reported to the operator as a number that did not move.

The decomposition that disambiguates it and the null it must be read against are **both already
computed and both already printed** — `plan-slices.ts:411-414` and `:386-390` — on separate
lines, so a reader has to reassemble three lines to learn whether a revision round did anything.

Two emit sites, not one. `src/init/plan-whole.ts:264-268` has the same stationary count and
**no null at all**: that file never imports `plan-signal.js` and never calls `sampleReviewPlan`,
so the whole-plan review is a single draw with no `reads` array for `sampleChurn` to run over.

**The scale trap, which the first proposed fix walked into.** `sampleChurn`
(`plan-signal.ts:66-81`) sums `revisionOutcome` over every ORDERED pair of reads — k*(k-1) = 6
pairs at `PLAN_REVIEW_SAMPLES = 3` — while a revision figure is ONE before/after pair. Printing
the raw null (`24 resolved / 42 survived`) beside `7 resolved, 7 introduced` invites precisely
the misreading the C-4⁗″ doc-block at `src/init/present.ts:277-284` exists to prevent. The null
goes on the line as a **rate**, with the pair count named.

And the churn line's own claim is already drifted: it is emitted for every slice where a review
happened, including the approve path where no revision follows, while promising *"the null the
number below is read against"*. The falsification run below shows it doing exactly that.

## D-2 (logging half) — one number for two opposite outcomes

`planResearch` collapses two distinct outcomes into one flat `unanswered` array: a question that
WAS researched and yielded no valid brief (`plan-research.ts:106`, after the X-6a refusal), and
a question the pool never reached at all (`:91`, the `remaining <= 0` skip). `analyzeStage`
reads only the merged array and emits one count.

`planning_research_tool_calls` is **one pool for the whole init** (`plan-research.ts:87`:
`const remaining = deps.budget - toolCallsUsed`). In the live run the first question consumed
all 16 calls and returned nothing usable; questions 2 and 3 were skipped unread. The operator
was told `3 question(s) carried to PRESENT with their assumptions (C-3′)`.

The two are actionable in **opposite directions**. "Researched and unanswerable" is a question
only the human can settle. "Never reached" is a budget fact — raise the ceiling, or ask fewer
questions. One number tells the operator neither.

There is a third population the fix must not absorb: when research is not configured,
`analyze.ts:148` treats every question as unanswered. Calling those "never researched" is
literally true and misleading — it reads as a ceiling that was hit.

---

## Falsification against HEAD

D-1 is the run above, executed against `HEAD` (`587fa13`) with the machine's real CLI. It needs
no test to be believed and it cannot be written as one on HEAD: `checkVersion` reaches
`execFileSync` directly, there is no seam, and this repository uses no module mocking anywhere
in `tests/` — which is the same fact as "the comparison has never been tested".

D-7 and D-8, through the real pipeline (`tests/init/review-evidence.test.ts`, new):

```
 × decomposes the slice count and prints the null it is read against, as a rate
   → expected … to match /s01 review after revision: 2 finding\(s\) remain \(2 resolved, 2 introduced;/
 × decomposes the whole-plan count and says outright that it has no null
   → expected … to match /whole-plan review after revision: 1 finding\(s\) remain \(1 resolved, 1 introduced; no null …/
 × keys every draw by the slice it judged, and keeps the told path shared
   → s01 draw 1 survived the run: expected false to be true
```

The notes HEAD actually produced for the first of those, which is the defect in one screen:

```
s01 review: sampled 3 launched together, keeping what 2 of 3 saw — 2 recurring, 0 seen once (C-4⁗″)
s01 sample churn, nothing revised between the reads: 0 resolved, 12 survived, 0 introduced — the null the number below is read against (PRDR-200)
s01 review: 2 recurring finding(s) — sizing, dependency
s01 revision: 2 resolved, 0 survived, 2 introduced (PRDR-196)
s01 review after revision: 2 finding(s) remain — coverage, shape
```

Two complaints answered, two raised, and the operator-facing line reads `2` both times. Note
also the churn line above it on the s02 APPROVE path in the same run — `0 resolved, 0 survived,
0 introduced — the null the number below is read against` — where there is no number below.

D-2 (`tests/init/stages.test.ts`, three added cases):

```
 × separates the questions research tried from the ones the pool never reached
   Expected: "1 researched without a usable answer, 2 never researched"
   Received: "3 question(s) carried to PRESENT with their assumptions (C-3′)"
 × counts never-researched as the skip arm only, not everything unanswered
   expected undefined to deeply equal []
 × does not report an init with research switched off as one that ran out of budget
   Expected: "planning research did not run for this init"
   Received: "1 question(s) carried to PRESENT with their assumptions (C-3′) — one or more blocking"
```

---

## What changed

**D-1 — `src/sessions/sdk.ts`.** `checkVersion` reduces the probe output with the same
expression `src/init/config.ts:41` uses to write the pin — `raw.trim().split(/\s+/)[0]` — and
then compares for equality. A new `versionProbe?: () => string` on `SdkBackendConfig` defaults
to the real `execFileSync`, which is the seam the comparison needed to be testable at all; it is
the same shape as the `queryFn` seam PRDR-114 added one class over, because this repository uses
no module mocking anywhere in `tests/`. The refusal now names the file, the key and the value:

```
backend version mismatch (S-5): this project pins claude_code 2.1.258, the CLI on PATH reports 2.1.269.
The pin is the version this project was verified against, and `init` never rewrites it. Set
`pinned.claude_code` to 2.1.269 in .detent/config.json once you have re-verified this project
against it, or install the pinned CLI.
```

`src/sessions/backend.ts:163`'s doc-block now says which string the equality is on. The three
test stubs that hand-wrote the old message were re-copied from production (`tests/cli/pin-parity.test.ts`,
`tests/cli/doctor.test.ts` ×2) and the two `toContain("pinned=")` assertions became
`toContain("pins claude_code")`. A stub that has drifted from the text it stands in for is a
fixture asserting against itself, which is a smaller version of the same defect.

**D-8 — `src/init/plan-review.ts`.** `planReviewPath` takes an optional slice id and puts it
above the draw segment; `reviewOnce` passes `scope.slice.id` when the scope is a slice. Paths
become `state/slices/<slice>/draws/<n>/plan-review.json` for a draw and
`state/slices/<slice>/plan-review.json` for the un-drawn re-review. Scope-less and whole-plan
calls produce byte-identical paths to before, which is why `tests/init/plan-critic-sampling.test.ts:375`
needed no edit. `told` is untouched, so PRDR-205's cache key is unchanged — and now asserted as
a set of size one across a MULTI-slice run, which no test covered.

**D-7 — `src/init/plan-notes.ts` (new), `plan-slices.ts`, `plan-whole.ts`.** Both remain lines
go through one `remainLine`, which carries `resolved` and `introduced`; the slice one adds
PRDR-200's null through `nullNote`, as a percentage over the named pair count, and the
whole-plan one states in words that it has none. The churn line gained its pair count and lost
the promise it could not keep on the approve path.

`plan-slices.ts` was at exactly 300 code lines — the ceiling — before this change, so the
operator-facing text moved out rather than the doc-blocks being trimmed to fit. `plan-notes.ts`
owns it: `nullNote`, `churnLine`, `sampleLine`, `recurringLine`, `revisionLine`, `remainLine`.
Both emit sites of the revision line now live in one module, which is the structural half of
this defect — they had drifted apart, and the whole-plan one had no null available to it at all.
`plan-slices.ts` ends at 293.

**D-2 — `src/init/plan-research.ts`, `src/init/analyze.ts`.** `PlanResearchResult` gains
`neverResearched`, a SUBSET of `unanswered` pushed only at the `remaining <= 0` skip, so no
existing consumer has a new invariant and `unanswered` keeps its exact contents. ANALYZE's
closing note splits the batch, and names an init with research switched off for what it is
rather than counting it as a ceiling that was hit.

## Mutation battery

Each row reverts one piece of the fix on the fixed tree and names the test that fails. `M12` is
the row that earned its assertion: the churn-line reword had no test until it survived, and the
two assertions that now cover it were added because of this table, not before it.

| # | mutation | caught by |
|---|---|---|
| M1 | restore `installed.includes(pinned)` | `refuses a PREFIX of the installed version` — *promise resolved "undefined" instead of rejecting* |
| M2 | drop the shared parse, compare the whole banner | `accepts the version the project was verified against` + `…says which file, which key` |
| M3 | restore the two-number refusal message | `…says which file, which key` + `names the \`unknown\` pin` |
| M4 | stop keying the review artifact by slice | `keys every draw by the slice it judged` — *s01 draw 1 survived the run: expected false to be true* |
| M5 | key the DRAWS only, leave the un-drawn re-review shared | same test — *s01 kept its post-revision verdict: expected false to be true* |
| M6 | put the slice into the TOLD path too | same test — *expected Set{…(2)} to deeply equal Set{…}* (PRDR-205) |
| M7 | restore the bare remain-count at both sites | both remain-line tests |
| M8 | print the null as a raw count, not a rate | `…prints the null it is read against, as a rate` |
| M9 | let the whole-plan line borrow a null it never sampled | `…says outright that it has no null` |
| M10 | stop recording which questions never got a session | `separates the questions research tried from the ones the pool never reached` |
| M11 | count an unconfigured init as never-researched | `does not report an init with research switched off as one that ran out of budget` |
| M12 | drop the pair count from the churn line | `…as a rate` + `…no null` (both added after this row survived) |

`M10` deliberately does NOT fail `counts never-researched as the skip arm only`: that test
asserts the set is EMPTY for a researched-and-refused question, which stays true when nothing is
recorded. It is the negative control, and a battery that reported it as a catch would be
counting a constant.

## What did NOT change, and that is the point

The run that prompted D-1 is **still blocked**. A `2.1.258`-pinned project on a `2.1.269` CLI
refuses exactly as before — the comparison got stricter, not looser, and the containment hole
closed in the direction that was letting pins through. What changed is that the operator is now
told the one-line edit that unblocks it, and that a pin of `2.1.2` no longer passes.

`npm run rules:check` stays clean and `tests/oracle/pin-parity.test.ts` is untouched — it greps
each checker's stripped source for `checkVersion(`, which is still there at all four sites. That
oracle could not have seen any of this: it certifies that the call exists, never what the call
decides. Recorded because it is the reason this defect survived two tickets that named it.

Suite: 1256 passed, 2 skipped, across 123 files.
