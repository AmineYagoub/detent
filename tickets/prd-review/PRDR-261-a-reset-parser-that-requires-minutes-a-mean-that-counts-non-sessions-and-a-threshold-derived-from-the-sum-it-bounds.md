---
id: PRDR-261
title: "One live init, three defects, one chain: a reset parser that requires minutes the backend did not send, a mean whose denominator counts rows that transacted nothing, and a threshold derived from the very sum it bounds"
state: DONE
severity: critical
category: defect
labels: ["prd-review", "found-by-live-run", "doc-claim-drift", "X-1⁵", "PRDR-189", "boundary", "floating-point", "operator-signal"]
surface: ["src/init/session.ts", "src/kernel/ledger.ts", "tests/init/reset-hour.test.ts", "tests/kernel/no-progress-breaker.test.ts"]
prd_refs: ["X-1⁵", "S-4", "D-25", "C-8", "ARCH-2", "PRDR-053", "PRDR-185", "PRDR-189", "PRDR-191", "PRDR-195", "PRDR-219"]
acceptance_criteria: ["D-13: `msUntilReset` reads a reset time whose minutes are absent. The live message — `You've hit your session limit · resets 5pm (Africa/Algiers)` — returns a number, and at 13:00 in that zone the number is 241 minutes, not `null` and not `NaN`. `(\\d{1,2}):(\\d{2})` becomes `(\\d{1,2})(?::(\\d{2}))?` and the absent group defaults to `0` rather than being read as `Number(undefined)`.", "D-13: a bare integer is still not a time. `resets 5 minutes from now`, `resets 2026-09-17T17:00:00Z` and `resets 5` all return `null`, so making the colon optional does not manufacture a sixteen-hour sleep out of a duration or read a year as an hour. A reset states minutes or a meridiem; a bare integer is neither.", "D-13: `resets 17:00` — minutes present, meridiem absent — still parses, so the new guard is a conjunction and not a disjunction.", "D-13: `12am` and `12pm` stay apart with the minutes absent: midnight resolves to hour 0 and noon to hour 12, matching what `resets 12:00am` and `resets 12:00pm` return on HEAD to the millisecond.", "D-13: through `buildPipeline`/`runInit`, the first wait after the live limit message is the stated reset (14_460_000 ms), the operator note says `for the stated reset`, and no note anywhere contains `NaN`.", "D-14: the per-session mean excludes rows flagged `partial`, numerator and denominator alike. On the live ksar-cloud shape — 3 paid rows totalling $11.0275965 and 21 zero-cost `crash` rows — the threshold is `(11.0275965 / 3) * 20`, not `(11.0275965 / 24) * 20`, and the run is not halted.", "D-14: the exclusion is keyed on the `partial` FLAG, not on a zero cost. A `partial` row carrying a non-zero cost is excluded too — it is a flagged lower bound, and a lower bound is not an observation of what a session costs — while its money still counts toward `readRecordedSpend` and toward spend-since-progress.", "D-14: with no qualifying row the mean is `0` and the FLOOR governs. It is never `NaN`: `Math.max(floor, 0, NaN)` is `NaN`, `x > NaN` is always false, and a breaker that cannot fire is worse than one that fires at the wrong number.", "D-15: before any unit completes the boundary is a COUNT and does not move with the price. Twenty sessions at $0.251 and twenty sessions at $251 reach the same verdict — allowed — and the twenty-first is refused at both prices.", "D-15: the tolerance forgives a round trip through `mean * sessions` and cannot forgive a session. At the default of 20 the nearest real decision is 5e-2 relative and the guard is 1e-9, so the nineteenth stays allowed and the twenty-first stays refused at both scales.", "D-15: the halt never prints one figure as past itself. Where the old message rendered `$12.00 spent ... past the $12.00 this run allows`, the refusal now names the ceiling KEY that governs, its configured value, and the observation it multiplies — and money renders at four decimal places, so a sub-cent ceiling is no longer reported as `$0.00 past $0.00`.", "D-15: the term named in the refusal is the term that actually governed `Math.max`. A halt bounded by `spend_without_progress_multiple` says so and prints the unit cost; one bounded by `spend_without_progress_sessions` says so and prints the mean and the count it was taken over."]
non_goals: ["Does NOT carry the reset parse to the run loop. `src/kernel/driver.ts:139-140` reads `OUTAGE_BACKOFF_MS[this.outages]` and has no reset parsing at all, so `detent run` still burns 1/5/15 minutes against a limit that states its own reset — including one stating `10:30pm`, which `init` has honoured since PRDR-189. `src/init/session.ts` states the rule this violates in as many words (ARCH-2: a control on one driver belongs on both). `msUntilReset` and `MAX_RESET_WAIT_MS` are already exported, but `Driver` holds a `DriverRefusal` whose reset text is inside `refused.message`, so the wiring is real work. It is a bigger defect than D-13 and it gets its own ticket rather than being smuggled into this one.", "Does NOT handle a reset stated with a word between `resets` and the time. `resets\\s+` demands a digit immediately, so `resets at 5pm`, `resets in 5 minutes` and `resets midnight` return `null` before and after this change. They fall to PRDR-185's ladder, which is the harmless direction and the posture PRDR-189's doc-block already declares.", "Does NOT normalise the init path's crash detection. `src/init/session.ts` records the raw result and depends on the backend's own `crashed` flag, where `src/kernel/referee-session.ts:258` derives one from `telemetryParsed`. On this run every failed session WAS flagged, so no unflagged row exists in the evidence — but the two drivers do not agree on how a crash is recognised, and a flag-keyed filter is only as good as the flag. That is a write-side question about which driver is right, not a read-side one, and it is not settled here.", "Does NOT flag out-of-band rows. `recordOutOfBandSpend` writes no `partial` key at all, so a crashed `doctor --smoke` session lands as an unflagged $0 row and dilutes the mean in D-14's exact shape while wearing no flag. Same question as above, one writer over.", "Does NOT fix the perSession term's mis-scoping on a RESUMED root. With a non-zero progress mark, `sinceProgress` is `total - mark` while the mean's numerator is still the LIFETIME total, so the threshold is inflated by history the breaker is not measuring. It is the permissive direction, so it is not the live failure, but the same term is wrong there and this ticket does not touch it.", "Does NOT make the tie tolerance an injected config field. This repository's optional-injected-field idiom is for POLICY. A tolerance on a floating-point comparison is a property of the arithmetic, and making it tunable is an invitation to move a boundary that is supposed to be a count.", "Does NOT change `spend_without_progress_sessions`'s default of 20, and does NOT turn the pre-progress regime into a dollar rule. Before any unit completes the comparison reduces to `rows > sessions` and magnitude survives only through the floor. That is a count rule and a defensible runaway detector; what is fixed is that its boundary was decided by IEEE-754 rather than by the rule, and that the doc-block described it as an allowance in dollars."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-053", "PRDR-185", "PRDR-189", "PRDR-191", "PRDR-219", "PRDR-260"]
depends_on: []
---

# PRDR-261 — a parser that required minutes, a mean that counted non-sessions, and a threshold derived from the sum it bounds

## Where these came from

A real `detent init` was run against `/Users/workstation/ksar-cloud` and died after 24 ledger
rows and $11.03. Three defects, and they are not three findings that happen to share a run:
each one is the next one's input. The run was killed by the third, would not have reached the
third without the second, and would not have reached the second without the first.

The ledger the run left behind is the whole chain in 24 lines: three `planner` rows carrying
$3.2017305, $4.030336 and $3.79553, then twenty-one rows reading
`"cost_estimate_usd":0, ... "models":[], "partial":"crash"`.

## The causal chain

**D-13 turned one usage limit into twenty-one dead sessions.**

`src/init/session.ts:242`:

```ts
const m = /resets\s+(\d{1,2}):(\d{2})\s*(am|pm)?(?:\s*\(([A-Za-z]+\/[A-Za-z_]+)\))?/i.exec(message);
```

The `:` between groups 1 and 2 is unconditional and group 2 is `{2}`, so **minutes are
mandatory**. The live backend sent `You've hit your session limit · resets 5pm (Africa/Algiers)`.
No minutes. `exec` returned `null`, the next line returned `null`, and `const wait = untilReset
?? ladder` fell through to PRDR-185's 1/5/15-minute ladder — against a window that reset four
hours later. Three retries, 21 minutes, all three hit the same limit.

PRDR-189 was written to fix exactly this failure and fixed it only for the format it happened to
observe. Its doc-block says *"a usage limit names its own reset time — wait until THAT"* in the
present indicative, over code that reads one of the two formats the backend emits. Every test in
the repository that reaches this function uses a non-zero minute: `10:30pm` four times in
`tests/init/stages.test.ts`, and `5:20pm` once in `tests/sessions/sdk.test.ts`, which never calls
`msUntilReset` at all. The no-minutes family is untested end to end, and the existing test
asserting `null` for `"resets soon"` reads as *"unparseable inputs return null"*, which made
HEAD's `null` for `resets 5pm` look like intended behaviour rather than a hole.

`isOutage` is why this was survivable rather than fatal: `/session limit/i` matches, so the retry
loop engaged. Only the DURATION was wrong. That is also the mechanism by which the gap hid —
`isOutage`'s tests stayed green the entire time. The operator-visible tell was there and unread:
the note said `backend outage during planner` rather than `backend limit during planner —
waiting N min for the stated reset`, and those are two different branches of the same call.

**D-14 then let the corpses set the budget.**

Each failed session wrote a ledger row: `crashed: true` (`src/sessions/sdk.ts:293`,
`zeroed && subtype === "error_during_execution"`) becomes `partial: "crash"` in
`ledger.record`, with `cost_estimate_usd: 0`. `src/schemas/records.ts:127-128` says what that
flag means: telemetry the backend **zeroed** on a crash, recorded as a **flagged lower bound**
rather than dropped.

`meanSessionCost` does not read the flag — it counts every parseable row. Twenty-one rows that
transacted nothing left the numerator untouched and grew the denominator from 3 to 24, and the
breaker's scale signal fell from `(11.0275965 / 3) * 20 = $73.52` to
`(11.0275965 / 24) * 20 = $9.19`.

The doc-block never claims the rows are sessions. The NAME does, and so does the only consumer:
`progressThreshold` wants *"the mean session cost is observable after ONE session"* — a scale
estimate, what a session costs on this project. A crash row is not a cheap session; it is a
non-session, and the repository already reasons this way about the same rows one axis over:
`src/init/sizing-evidence.ts:45` excludes `row.partial !== undefined` from turn evidence for
precisely this reason. This change makes the two readers agree.

Nothing detected the gap because nothing asserted on it. `meanSessionCost` and
`progressThreshold` had **zero direct test coverage** in the entire suite; every test that
reached the threshold wrote unflagged, non-zero rows, so the mean never saw a partial row in
anger.

**D-15 then fired at mathematical equality.**

Before any unit completes, `progressMark` is pinned to the spend at first construction, which on
a fresh `init` root is `$0`, and `lastUnitCost` is `0`. So in `assertLaunchAllowed`, with `S` the
file total, `r` the mean's row count and `n` `spend_without_progress_sessions`:

```
sinceProgress = S
perUnit       = 0 * multiple = 0
perSession    = (S / r) * n
threshold     = max(floor, 0, S·n/r)
```

`S` and the mean's numerator are the **same sum over the same rows in the same order**, so the
dollars cancel. Where the session term governs, `S > S·n/r ⟺ r > n`. Where the floor governs,
`S > floor > S·n/r ⟹ r > n` as well. The complete rule before any unit completes is therefore
**fire ⟺ `r > n` AND `S > floor`** — a COUNT, gated by one magnitude test. The design's own `>`
says twenty sessions are allowed and the twenty-first is not.

`(11.0275965 / 20) * 20` is `11.027596499999997803`. `11.0275965` is `11.027596499999999580`.
One ulp apart. `>` fired, and the operator was shown:

```
no-progress breaker (X-1⁵): $11.03 spent without completing a unit of work, past the $11.03
this run allows. Nothing has finished in that time, which is what a runaway looks like and
what working never does.
```

Two renderings of one number, presented as one being past the other — and a runaway diagnosis
for an account quota. That round trip lands one ulp low on about 3.4% of totals, exact on 93.2%
and one ulp high on 3.4%, so the boundary was a coin flip on the low bits of the money, and the
same twenty sessions at a thousand times the price reach the opposite verdict.

The self-contradiction is **not** a corollary of the float, and the tolerance alone does not fix
it. The `perUnit` term reaches it with no float subtlety at all — `$12.001` spent since a `$4`
unit at a multiple of 3 renders `$12.00 ... past the $12.00`. And on the ceilings
`tests/plugin/parity.test.ts` configures today (`floor: 0.0001`, `sessions: 0.001`), the breaker
reports its own halt as `$0.00 spent ... past the $0.00 this run allows` — a two-decimal
rendering of a sub-cent ceiling it just enforced.

Why it survived sixteen ticket cycles: **every test in the repository sets
`spend_without_progress_sessions` to `1`, or drives it to `0.001` or `0` through config. The
default of `20` — the value that shipped and the value the live run used — is never exercised.**
No test has `rows === sessions`. No test varies scale while holding the count, so the
scale-blindness of the pre-progress regime is invisible. The term is exercised; the BOUNDARY of
the term is not.

## Falsification against HEAD

`npx vitest run tests/init/reset-hour.test.ts tests/kernel/no-progress-breaker.test.ts` against
HEAD `4e88689`, before any `src/` change. **10 failed, 4 passed.** The four that passed are
declared in the files as regression guards against the FIX and are not counted as evidence here.

```
× reads the hour when the message carries no minutes
  → 13:00 Algiers to 17:00 Algiers is a time, not silence: expected null not to be null
× keeps midnight and noon apart with the minutes absent
  → midnight is stated, so it parses: expected null not to be null
× waits the stated hour rather than the ladder, and names a real number
  → the stated reset, not the ladder's first minute and not NaN:
    expected 60000 to be 14460000

× does not refuse the session that completes the count, at either scale
  → expected 'no-progress breaker (X-1⁵): $5.02 spent without completing a unit of work,
    past the $5.02 this run allows. …' to be 'allowed'
× names the term that governs, its factors, and the sessions they were observed over
  → expected '…$5.27 spent … past the $5.02 this run allows.' to contain
    'spend_without_progress_sessions = 20'
× never prints the same figure on both sides of the bound
  → expected '…$12.00 spent … past the $12.00 this run allows.' to contain
    'spend_without_progress_multiple = 3'
× prints money in a unit that can represent the ceiling it enforced
  → expected '…$0.00 spent … past the $0.00 this run allows.' not to contain '$0.00 '
× twenty-one crash rows at $0 do not halt a run three paid sessions in (the live shape)
  → expected 9.18966375 to be close to 73.51731, received difference is 64.32764625
× a partial row's money still counts as spend, and still does not set the scale
  → expected 6 to be close to 10, received difference is 4
× with no session to average the mean is 0 and the FLOOR governs — never NaN
  → expected 5.999999999999997 to be 5

Test Files  2 failed (2)
     Tests  10 failed | 4 passed (14)
```

Two of these deserve to be read twice.

`expected 60000 to be 14460000` **is** the defect: sixty seconds of patience against a window
four hours out, three times, and then the run is gone.

`$5.02 spent … past the $5.02 this run allows` is the production halt reproduced at a
thousandth of the live scale. The live message said `$11.03 … past the $11.03`. Neither figure
is wrong; they are the same number, and the sentence claims one is past the other.

The self-contradiction was NOT reached through the float in two of the four cases above. The
`perUnit` term renders `$12.00 … past the $12.00` deterministically, and the ceilings
`tests/plugin/parity.test.ts` already configures render `$0.00 … past the $0.00`. So the
tolerance does not discharge the message defect and the message change does not discharge the
tolerance — they are two repairs, and the tests keep them apart.

## What this deliberately leaves broken

- **`detent run` still burns 1/5/15 against a stated reset.** `src/kernel/driver.ts:139-140` has
  no reset parsing at all. This ticket fixes the parser `init` calls and does not carry it
  across, so after this change `init` honours `resets 5pm` and `run` honours neither `resets 5pm`
  nor `resets 10:30pm`. That widens the ARCH-2 gap rather than closing it, and it is recorded as
  the next ticket rather than pretended away.
- **`resets at 5pm`, `resets in 5 minutes`, `resets midnight`** stay unparsed. They fall to the
  ladder.
- **The two drivers do not agree on what a crash is.** `init` trusts the backend's `crashed`
  flag; the kernel derives one from `telemetryParsed`. A flag-keyed filter is exactly as good as
  the flag, and `recordOutOfBandSpend` sets none at all.
- **The perSession term is still mis-scoped on a resumed root**, where `sinceProgress` is
  `total − mark` while the mean's numerator is the lifetime total.
- **The pre-progress regime is still a count, and its doc-block now says so** rather than
  promising a dollar allowance. Whether a count is the right control is a separate argument.
- **`/detent:init` and `/detent:run` still run the Sep 2 plugin cache**, in which none of these
  three functions exists.

## What changed

`src/init/session.ts` (+7 code lines) — `(\d{1,2}):(\d{2})` becomes `(\d{1,2})(?::(\d{2}))?`
with a NON-capturing wrapper, so `m[1]`..`m[4]` keep their meanings and nothing downstream moves.
Two lines follow it, and both are load-bearing:

```ts
if (m[2] === undefined && m[3] === undefined) return null;
const minute = m[2] === undefined ? 0 : Number(m[2]);
```

The second is not optional tidiness. `noUncheckedIndexedAccess` types `m[2]` as
`string | undefined` and `Number(undefined)` is `NaN`; a regex-only change would be **strictly
worse than HEAD**, because `NaN > 59` is false, `NaN <= 0` is false, `NaN !== null` is true,
`NaN > MAX_RESET_WAIT_MS` is false and `??` does not catch it — the note would read
`waiting NaN min for the stated reset` and `setTimeout(NaN)` would burn all three attempts in
milliseconds. Mutation M2 is exactly that change and two tests catch it.

The first is why an optional colon is safe. Without it `resets 5 minutes from now` parses as
05:00 — a sixteen-hour sleep — and `resets 2026-09-17T17:00:00Z` reads the `20` of the year as
20:00. Measured: 961 and 421 minutes. It is a conjunction, not a disjunction, so `resets 17:00`
keeps parsing; M4 flips it and the `17:00` test fails.

`src/kernel/ledger.ts` (+125 code lines, 228 → 253) —

- `meanSessionCost` becomes `sessionCostEvidence`, returning `{ mean, sessions }`, and skips
  `partial` rows in numerator and denominator alike. One loop, one predicate: two readers over
  "which rows are sessions" would be this ticket's own subject one layer up. The rename is free
  — repo-wide grep found exactly two occurrences, the definition and its single consumer.
- `progressThreshold` delegates to a new private `breakerTerms`, which computes all three terms
  once and names which one governs. The floor wins ties, so an operator is never told a mean
  stopped them when the configured minimum would have on its own.
- `NoProgressError` takes a `BreakerEvidence` record instead of two bare numbers, and the bound
  prints as its DEFINITION — ceiling key, configured value, and the observation it multiplies —
  rather than as a pre-computed total. Money renders at four decimals, the resolution the ledger
  carries.
- The comparison gains `TIE_TOLERANCE = 1e-9`, RELATIVE. At the default of 20 sessions the
  nearest real decision is 5e-2 relative, so this is seven orders of magnitude below what it must
  never forgive and seven above the ulp noise it must.

All three ceiling keys remain plain property accesses in `breakerTerms`, not only inside
`breakerBound`'s template literals — `tests/oracle/budgets.test.ts` greps the `codeOnly`-masked
source for each, and PRDR-257 records that the masker can blank code inside interpolations.

**No existing test was edited.** 125 files, 1271 passed, 2 skipped.

## Mutation battery (verification protocol, item 2)

Nineteen mutations against the FIXED tree. Every one caught.

| # | AC | mutation | caught by |
|---:|---|---|---|
| M1 | D-13 #1 | restore the mandatory-colon regex | 3 failed — `reads the hour…` |
| M2 | D-13 #1 | drop the optional-minute defaulting (`Number(m[2])` → NaN) | 3 failed — `Number.isNaN`, and `waiting NaN min` |
| M3 | D-13 #2 | delete the minutes-or-meridiem guard | 1 failed — a duration parses as 05:00 |
| M4 | D-13 #3 | guard `&&` → `\|\|` | 4 failed — `resets 17:00` returns null |
| M5 | D-13 #4 | delete the `12am` → hour 0 rule | 1 failed — midnight reads 1381, not 661 |
| M6 | D-13 #5 | always use the ladder | 1 failed — 60000 not 14460000 |
| M7 | D-14 #6 | delete the partial-row filter | 3 failed — threshold 9.19 not 73.52 |
| M8 | D-14 #7 | filter the SYMPTOM (`cost === 0`) not the flag | 2 failed — the non-zero partial row |
| M9 | D-14 #7 | filter the denominator only, keep the numerator whole | 1 failed — threshold 12 not 10 |
| M10 | D-14 #8 | delete the zero-qualifying-rows fallback | 1 failed — NaN, and the breaker goes inert |
| M11 | D-14 #8 | fallback `0` → `Infinity` | 1 failed |
| M12 | D-15 #9 | restore HEAD's bare `>` (the rows == sessions tie) | 1 failed — cheap refused, dear allowed |
| M13 | D-15 #9 | `>=` instead of the tolerance | 1 failed — both scales refused |
| M14 | D-15 #10 | tolerance wide enough to forgive a session (`1e-1`) | 3 failed — the 21st is forgiven |
| M15 | D-15 #10 | relocate the default to 21 instead of fixing the boundary | 3 failed |
| M16 | D-15 #11 | restore the bare-dollar bound in the message | 3 failed — `Set.size` 1 ≠ 2 |
| M17 | D-15 #11 | render spend at two decimals | 2 failed — `$0.00 ` returns |
| M18 | D-15 #12 | check `sessions` before `unit` in the tie order | 1 failed — wrong term named |
| M19 | D-15 #12 | print a dollar total instead of the key and factors | 1 failed |

**Holes, stated rather than hidden.** Three acceptance criteria are not fully mutation-covered
and it would be dishonest to present the table as if they were:

- **D-15 #10's claim that the tolerance is RELATIVE** has no mutation. Inside the ceiling range
  this repository configures — $0.0001 up to low thousands — relative `1e-9` and absolute `1e-9`
  are numerically indistinguishable; they diverge only above ~$10⁷, and a fixture at that scale
  would be theatre. M14 covers the half that matters in practice (the epsilon must stay far below
  one session's share). The relative choice is defended by argument in the doc-block, not by a
  test.
- **D-13 #2's `resets 5` arm** is covered by M3 only jointly with the other two literals in that
  test, not independently.
- **D-14 #7's "a genuinely free C-8 reuse session must still count"** has no mutation. M8 catches
  a `cost > 0` filter through the non-zero partial row, not through a free-but-real row, and the
  repo has no natural fixture shape for one.
