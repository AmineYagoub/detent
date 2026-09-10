---
id: PRDR-203
title: "Two init sessions cannot be in flight on one root: the journal refuses the second launch, the review artifact is one path, and D-28's overshoot bound counts one session"
state: DONE
severity: normal
category: gap
labels: ["prd-review", "concurrency", "init", "journal", "ledger", "review-sampling"]
surface: ["src/init/session.ts", "src/init/launch-batch.ts", "src/init/session-deps.ts", "src/init/pipeline.ts", "src/init/plan.ts", "src/init/plan-review.ts", "scripts/null-review.ts", "tests/init/session-in-flight.test.ts", "tests/init/plan-critic-sampling.test.ts", "detent-prd-v3.md"]
prd_refs: ["D-25", "D-28", "F-1", "S-1″", "X-1‴", "X-1⁵", "C-4⁗″", "ARCH-2", "N-6", "V-6"]
acceptance_criteria: ["Two `launchInitSession` calls in flight on one root, in one process, both complete and both record a ledger row — through the production entry point, with `MockBackend` holding each session at an `await` so both are genuinely in flight. Observed FIRST to throw `JournalContendedError` (V-6).", "A root still has one writer (F-1, X-1‴). The init driver opens the journal once and hands it to every launch, as `kernel/run.ts` opens it once per run (ARCH-2); `launchOnce` neither opens nor closes one. The root lock `init` already takes remains what declines a second PROCESS; nothing about NG4 changes.", "Each review draw writes its own artifact and its S-1″ surface names that file alone. Three draws in flight yield three artifacts, none removed or overwritten by a sibling's `rmSync`; the mock yields between launch and write so the three sequences interleave. Observed FIRST to lose a read (V-6). The `plan-review.json` suffix is kept, so the eight fixtures that match on it stand.", "The launch gate is evaluated once per batch, and a batch it refuses launches none of its sessions. D-28's bound is RESTATED in the PRD — one in-flight batch of `PLAN_REVIEW_SAMPLES` sessions, with the figure — rather than widened silently by the first `Promise.all`.", "MOVED to C-4⁗″'s amendment, not met here: draws collected in launch order whatever order they complete in. Unfalsifiable while the loop is sequential — completion order IS launch order, so the test passes without the change (V-6) — and it belongs with the `Promise.all` that makes the two orders differ."]
non_goals: ["Does not parallelise anything. `sampleReviewPlan`'s `for` stays serial; the concurrent draw is an amendment to C-4⁗″ and its own ticket, as is the critic role that would let the ledger tell a draw from a draft. This ticket makes a concurrent launch POSSIBLE and BOUNDED.", "Does not make spend accounting atomic. It already is, in the sense that matters: `record` appends one row, `assertLaunchAllowed` re-reads the file, and two sessions ending together lose nothing. The name this work was first given is retired here, with the receipt.", "Does not make concurrent RUNS or concurrent PROCESSES safe. NG4 stands: X-1‴ declines a second run, and `init` takes the same lock (PRDR-179). One process, one journal, k sessions.", "Does not add a ceiling key. Bounding a batch is a statement about D-28, not a knob; an F-3 schema event was declined by C-4″ and again by C-4⁗″ for this same loop.", "Does not touch the progress mark's plain `writeFileSync`. Torn across processes it is the lock's problem, and the lock already declines; within one process a synchronous write cannot interleave."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-200", "PRDR-136", "PRDR-179", "PRDR-191"]
depends_on: []
---

# PRDR-203 — one root, one writer, k sessions

**Severity:** normal · **Category:** gap · **Found by:** asking what a `Promise.all` over the
three review draws would actually hit, and finding it was not the thing first named

## Problem

C-4⁗″ draws a slice's review three times. The draws are independent by construction — three
reads of byte-identical tickets, no ordering between them — and they run one after another:

```ts
for (let i = 0; i < k; i += 1) {
  const review = await reviewPlan(deps, tickets, scope);   // plan-review.ts:94
```

On smoke-1's s04 the three landed at 10:55, 10:59 and 11:04. Run together they would take
about as long as the slowest one — roughly nine minutes a slice, on the order of two hours
across a fifteen-slice gate — and cost exactly what they cost now. That is the one place in the
pipeline where concurrency buys wall-clock without touching plan quality: slice planning is
sequential because the cumulative `plan_index` is how cross-slice edges form, and the whole-plan
redrafts are sequential because each sees the running plan.

The prerequisite for it was first named "atomic spend". That is wrong, and the name should not
survive into the tree. What a concurrent launch actually hits is three things, none of them the
ledger's arithmetic.

## What is NOT the defect

Spend is recorded by appending one row per session and read back by summing the file:

```ts
this.journal.appendLedger(row);            // ledger.ts:329 → appendFileSync (journal.ts:63)
this.accumulated += row.cost_estimate_usd;
```

and the launch gate does not trust the in-memory figure:

```ts
const spent = Math.max(this.accumulated, readRecordedSpend(this.root));   // ledger.ts:295
```

That is X-1‴ (PRDR-136): *the run ceiling is enforced against the FILE*. Two sessions ending
together each append their own row, and the next gate sums both. Nothing is lost, nothing needs
a lock, and the $16-against-$10 case PRDR-136 cites was two PROCESSES each seeding a total once
and counting in memory — fixed by the re-read above and by the root lock, which `init` now
takes too (PRDR-179). The accounting is already as atomic as an append-only file is.

## What IS

**1. The journal refuses the second launch.** `launchOnce` opens a journal per launch and
closes it on the way out:

```ts
const journal = RunJournal.open(deps.root);   // session.ts:278
…
} finally { journal.close(); }               // session.ts:300
```

and `open` keeps an in-process set of roots:

```ts
if (OPEN_ROOTS.has(key)) throw new JournalContendedError(root);   // journal.ts:40
```

whose message reads *"ledger.jsonl and transitions.jsonl are single-writer for the lifetime of
a run (F-1)"*. The rule is right and the implementation of it is at the wrong scope. A root's
one writer is a PROCESS — the lock decides that — and the run loop honours it by opening the
journal once per run (`run.ts:220`) and threading it through. `init` opens one per LAUNCH, which
is the same thing for as long as launches never overlap, and a refusal the moment two do. A
`Promise.all` over `reviewPlan` dies on its second element, before any session starts.

**2. The review artifact is one path.** Every draw deletes and rewrites the same file:

```ts
const file = planReviewPath(deps.root);   // .detent/state/plan-review.json
rmSync(file, { force: true });            // plan-review.ts:277–278
await deps.launch({ … }, file);
```

Three draws in flight are three sessions told to write one file, each preceded by an `rmSync`
that can remove a sibling's finished artifact before it is parsed. S-1″ already scopes the write
surface to the artifact path per SESSION, so per-draw paths need no policy change; they need to
exist.

**3. D-28's bound counts one session.** D-25 evaluates the gate at launch, never mid-flight, and
D-28 states the consequence: *"overshoot is bounded at one in-flight session (inherits D-25)."*
X-1⁵ repeats it: *"a run overshoots by a whole session's cost."* Three sessions launched together
all pass `assertLaunchAllowed` at the same figure, so the no-progress breaker — the only gate
that still refuses since X-1⁵ — can be passed by up to k sessions' cost rather than one. Bounded
and small: smoke-1's sessions averaged $2.08 and peaked at $5.18 over 45 rows, so two extra
in-flight sessions are $4–10 against a threshold whose floor is $5 and whose unit-scaled term is
three times a slice's cost (about $13 there). Not a danger; but a stated bound that the first
concurrent launch would falsify without anyone deciding to.

## Checked and harmless

- **The first-launch progress mark.** `ledger.ts:211` writes the mark when none exists; two
  launches seeing none write the same value twice.
- **The refused-model map.** `sdk.ts:293` learns a refusal from the first result; k launches of a
  model the runtime refuses pay k $0 attempts instead of one, then all fall back and say so.
- **Start/end events interleave.** Three `start` rows then three `end` rows in the init ticket's
  journal. The only reader, `report.ts:168`, counts starts; nothing pairs them.

## The shape

Three small changes and one sentence in the PRD, all deterministic under `MockBackend`:

- The init driver opens the journal once per phase and hands it to `launchInitSession`, as the
  run loop does (ARCH-2: a control on one driver belongs on both). `launchOnce` owns no handle.
- `reviewOnce` writes draw *i* to its own file. Keep the `plan-review.json` suffix — eight test
  fixtures dispatch on `endsWith("plan-review.json")` and should not have to change.
- `sampleReviewPlan` gates ONCE for the batch, before any draw, and collects `reads` in launch
  order regardless of completion order, so the cached `churn` is reproducible.
- D-28 says "one in-flight batch of `PLAN_REVIEW_SAMPLES` sessions", with the figure above.

Then the `for` becomes a `Promise.all` — in C-4⁗″'s own ticket, which also owns the prompt-cache
stagger: three requests fired at once can all miss the prefix cache the serial version hit
twice, and the ledger's `cache_read_input_tokens` column is how that is checked.

## How it is tested

V-6 order. A `MockBackend` whose planner awaits a deferred before writing, so two launches are
genuinely in flight on one root; the test is observed to throw `JournalContendedError` before
the journal moves. Then the same mock over three draws, yielding between launch and write; the
test is observed to lose a read before the paths split. The bound is asserted on the gate's
call count per batch, not on dollars, because dollars under a mock are whatever the fixture says.

## What implementation changed

**The journal is the phase's.** `InitSessionDeps.journal` is required, `sessionDeps(deps, journal)`
takes it, and ANALYZE, SLICE and PLAN each open one in `withInitJournal` around the whole phase
body — the shape `kernel/run.ts` has always had per run. `launchOnce` neither opens nor closes
one. `scripts/null-review.ts` holds one for its sweep the same way.

**Each draw has its own file.** `planReviewPath(root, draw)` puts draw *n* at
`state/draws/<n>/plan-review.json` — suffix kept, so the eight fixtures dispatching on it stand
— and `reviewPlan` takes a `ReviewDraw`. The whole-plan review and the harness pass none and
write where they always did.

**The batch is gated once.** `LaunchBatch` is a flag `launchOnce` sets only AFTER the gate let a
launch through, so a refused first draw leaves the next to be refused the same way. `sampleReviewPlan`
makes one per call and hands it to each draw's first attempt; the C-4⁗ relaunch is gated on its
own, because it happens after the figure moved.

**V-6, in order.** All three tests were written in their final form and run against the tree as it
was — esbuild strips the type errors, so the production path is what ran:

- two launches in flight → `JournalContendedError: a run journal is already open … (F-1)`;
- with the journal fixed and nothing else, three draws in flight → every read was the third
  draw's: `expected ['t-3','t-3','t-3'] to equal ['t-1','t-2','t-3']`;
- with both fixed and no batch, a breaker allowing one mean session → `expected 2 to have length
  3`: the third draw refused by its own gate.

Then the changes, then seven of seven.

**Criterion 5 is not met here, on purpose.** Launch-order collection cannot be falsified while
the loop is sequential — completion order is launch order — so a test for it would pass without
the change. It moves to C-4⁗″'s amendment with the `Promise.all` that gives the two orders a way
to differ. The frontmatter says so.

**One module the ticket did not name.** `newLaunchBatch` first lived in `session.ts`, and
`plan-review.ts` importing it at runtime closed a cycle — `kernel/referee.ts` → `init/plan.ts` →
`plan-review.ts` → `session.ts` → `kernel/driver.ts` → back through the referee — that
`z.enum(...)` in `referee/registry.ts` met as `undefined` at load, taking eight unrelated test
files down before a single test ran. `LaunchBatch` and its factory are `launch-batch.ts` now, a
leaf both sides import; `session.ts` imports only the type. A cycle that presents as
`Cannot convert undefined or null to object` from zod is worth knowing the shape of.

**One repair found in passing, then its cause.** `tests/init/plan-critic-sampling.test.ts` had
three NUL bytes where spaces were meant — the separator in `RECUR` and `keyOf` — which made git
treat the file as binary and hid its diffs since PRDR-200. Scanning every tracked file for the
same byte found the fourth: `findingKey` itself, in `plan-review.ts`, joined ticket and tag with
`\x00`, so the production source was binary to git too and every diff of it since PRDR-200 —
this ticket's included — showed as `Bin`. All four are spaces now. Runtime behaviour is unchanged
(the key is only ever compared with itself, across reads, and never displayed or persisted), and
`keyOf` in the test now produces the same key `findingKey` does.
