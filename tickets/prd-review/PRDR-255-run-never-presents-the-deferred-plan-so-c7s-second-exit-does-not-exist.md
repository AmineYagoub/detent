---
id: PRDR-255
title: "C-7's dual exit has one exit: `init` tells the operator that `detent run` will present the deferred plan, and `run` refuses with a string pointing back at `init`"
state: DONE
severity: major
category: gap
labels: ["prd-review", "found-by-audit", "doc-claim-drift", "C-7", "approval"]
surface: ["src/init/present.ts", "src/kernel/run.ts", "src/cli/run.ts", "src/cli/referee.ts", "src/cli/approve.ts", "src/init/pipeline.ts", "src/cli/init.ts", "src/schemas/records.ts", "tests/cli/run-approval.test.ts", "tests/init/backhalf.test.ts", "tests/plugin/approval.test.ts"]
prd_refs: ["C-7", "C-9", "C-10", "C-11", "ARCH-2", "F-1", "N-6"]
acceptance_criteria: ["`detent run` against a plan with no approval PRESENTS the plan before refusing: the rendered summary reaches stdout, and it is the SAME text `init` rendered, byte for byte.", "On a TTY, `run` offers the C-7 decision. A yes records `.detent/plan/approval.json` with who, when and the plan hash, and the run proceeds; a no or a later leaves the plan READY-unapproved and exits 2 (C-11).", "Without the ask seam — every non-TTY invocation — `run` presents and refuses. No approval is ever synthesized from the environment, and `presentStage`'s `ask === undefined` default stays `deferred`, never `approved`.", "The refusal still emits C-10's machine-readable summary on stdout: the new leg returns a `RunOutcome` and `src/cli/run.ts` remains the only writer of that envelope.", "A plan carrying blocking questions is NOT approvable at `run` — the second exit does not become the way around the first one's C-3′ gate.", "The referee's unapproved-plan refusal carries the same rendered presentation, so the model-driven driver shows the human what `init` showed (ARCH-2, presentation half).", "Every doc-block and operator-visible string that asserts the second exit is true after the fix, and the two tests whose NAMES assert it drive the real entry point.", "A test drives `src/cli/run.ts` main() against an unapproved plan and fails on today's tree."]
non_goals: ["Does NOT handle a STALE approval at `run`. C-7′ (PRDR-087) made staleness an init-side PRESENT replay, and `src/kernel/run.ts:164-171` already refuses it by name. The new leg triggers on `approved === false` and lets the stale branch fall through untouched; widening it would re-open a closed ticket's decision (N-6).", "Does NOT give the referee an approval DECISION channel. It gets the presentation half only — see 'What this does not do'. The decide half is a new `record` tool kind on the R-1 registry, which is a design change to the tool surface and needs its own ticket.", "Does NOT add `--approve/--decline/--defer` to `run`. Those are `init`'s C-8 re-invocation relay (T-131); on `run` they would be a headless approve-and-execute with no human in the loop. A test asserts their absence.", "Does not extend `planHash`, change `approvalSchema`, or touch what `init` writes beyond adding the persisted presentation.", "Does NOT refuse to approve during a `--backend mock` run. This guard was designed and dropped: the backend decides whether SESSIONS are real, not whether the PLAN is — the rendering a human approves is the same either way, so the guard would have protected nothing while blocking a legitimate dry run and forcing the approve-path test to contort around `isFixture`. Recorded as a decision, not an omission.", "Does not rebuild the presentation from `.detent/state/` checkpoints. F-4 forbids consuming a digest-mismatched checkpoint, and a run-time rebuild from phase outputs is how C-7′'s defect was produced."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-087", "PRDR-139", "PRDR-153", "PRDR-181", "PRDR-246", "PRDR-251", "PRDR-252"]
depends_on: []
---

# PRDR-255 — the exit that was described, printed, named in two test titles, and never built

## Problem

C-7 is a dual exit. `detent-prd-v2.md:109`, inherited unchanged into v3 (`detent-prd-v3.md:1457`):

> **C-7** Approval is dual-exit: offered inline at the end of `init` (TTY), and, if deferred or
> non-TTY, presented by the first `detent run`. Approval is recorded (who/when/plan-hash) in
> `.detent/plan/approval.json`.
> *AC:* unapproved plan → `run` presents it before executing; declining leaves state
> READY-unapproved, exit 2.

Only the `init` half exists. With `ask` undefined, `presentStage` returns `{kind:"deferred"}` and an
AWAIT_APPROVAL interrupt (`src/init/present.ts:339`). `detent run` then does none of what it was
promised to do: `runWithConfig` calls `readApproval(root)` first (`src/kernel/run.ts:128`), and with
no `approval.json` that returns

> no approved plan — `run` executes only an approved plan (C-9); approve it via `init` (C-7)

which becomes `notReady` → exit 2 before the lock, the journal, or any rendering. `renderPresentation`
(`src/init/present.ts:186`) has exactly one production caller — `presentStage`, one line away in the
same file, reachable only from the init pipeline. `run` renders it zero times. The deferred exit
loops back to `init`; it does not lead forward to `run`.

This is the branch's own defect class, and it is the largest instance found so far: **sixteen sites**
assert the mechanism, including two strings an operator reads at the terminal.

## The operator-visible half

`src/init/present.ts:357` is what a non-TTY `init` prints **by default** — every CI run, every piped
run, every plugin init that does not relay a flag:

> Approval deferred — `detent run` will present this plan before executing (C-7).

`src/init/present.ts:356`, the declined branch:

> Approval declined — the plan is ready but unapproved. Re-run `detent init` after editing, or
> approve at the start of `detent run`.

Both are unconditional future-tense promises, cited to C-7, printed by `src/cli/init.ts:290` and
relayed verbatim to the human by the plugin skill. Neither is true. The operator follows the
instruction and gets exit 2 telling them to go back to `init`.

The remaining fourteen are doc-blocks and test titles: `src/cli/approve.ts:6`, `src/init/present.ts`
at :25, :185, :304 and :349, `src/init/pipeline.ts:64`, `src/cli/init.ts:257`, and — the reason
nobody looked — `tests/init/backhalf.test.ts:561` and `:620` and `tests/plugin/approval.test.ts:54`
and `:65`, whose NAMES assert the second exit while their bodies test only the first.

`tests/init/backhalf.test.ts:620` is the sharpest of them. It is named *"a non-TTY init defers to
`run`, which presents the SAME summary (C-7's dual exit)"*, it imports neither `kernel/run` nor
`cli/run`, and it calls `renderPresentation` **inside the test process** and compares init's own
interrupt message to init's own first line, under the doc-block *"The renderer is shared, so `run`
shows exactly what `init` showed."* The renderer is not shared. The test proves the renderer is
deterministic and nothing about `run`.

## Design

**The seam is `RunOptions.approve`, beside `escalate`.** C-10 already solved this exact problem —
a decision that must be made by a human, inside `run`, on a TTY, and refused otherwise. The kernel
declares `escalate?: (input: EscalationInput) => Promise<EscalationAction>` (`src/kernel/run.ts:64`)
and never constructs one; `src/cli/run.ts:128` supplies `makeTtyEscalation` under
`process.stdout.isTTY === true && process.stdin.isTTY === true`. C-7 gets the identical shape:
`approve?: (presentation: string) => Promise<ApprovalDecision>`, wired from the same TTY gate with
the `makeTtyApproval` that already exists. The precondition lives in the driver, so it is not one
CLI verb's private behaviour; only the transport of the human's answer is injected.

**The presentation is persisted, not reconstructed.** `presentStage` writes
`.detent/plan/presentation.json` — the exact rendered text, the plan hash it was rendered from, and
the count of blocking questions — on every branch, through `writeArtifact` (F-1 committed; scrubbed
on the PRDR-252 seam). `run` replays that text verbatim.

Rebuilding it at run time was the obvious design and it is wrong three ways. It cannot be
byte-identical, so `src/init/present.ts:185` would stay a half-truth. It would have to read
`.detent/state/<PHASE>.json`, and F-4 forbids consuming a digest-mismatched checkpoint — a run-time
rebuild from phase outputs is precisely how C-7′'s defect was produced (PRDR-087: ANALYZE and PLAN
re-ran, *a different plan reached approval*, eleven reviewed tickets became fourteen approved). And
it would drop the blocking-question gate at `present.ts:322`, so `run` could approve a plan `init`
refused to present for approval. Persisting the rendered text closes all three at once and makes the
doc-block's claim literally rather than approximately true.

**The refusal keeps its envelope.** The leg returns a `RunOutcome`, so `src/cli/run.ts:132` stays the
single writer of the `{schema_version, exit, pending, reason}` summary that C-10 requires on a
non-TTY and C-11 pins to exit 2. A second exit path writing a different shape would trade one
requirement for another.

**The kernel's own refusal is untouched.** `readApproval` still refuses an unapproved plan. The new
leg runs before it and may satisfy it; it never weakens it. C-9's invariant is the kernel's.

## Guards

C-5 and C-7 require a recorded human. The seam is constructed only where one is provably present,
its absence refuses, and nothing on this path invents a `by`:

- no seam ⇒ `notReady`, never a synthesized approval; `presentStage`'s `ask === undefined ⇒ deferred`
  default is preserved verbatim
- `by` comes from the `ApprovalDecision` alone — no `process.env["USER"] ?? "operator"` fallback on
  the approval path, unlike the escalation path where the actor is not granting consent
- blocking questions ⇒ refuse; the fixture backend ⇒ refuse (C-14″: a fixture run must never be
  mistaken for a real one, and approving one would record a real approval from a fake presentation)
- `recordApproval` stays the sole writer of `approval.json` and pins the hash it rendered from
- no decision flags on `run`, asserted by a test in the `tests/oracle/pin-parity.test.ts` style
  rather than merely intended

## What this does not do, and why

The referee gets the **presentation** half of parity, not the decision half.

ARCH-2 is the rule this repository has now forgotten four times (PRDR-140, 153, 181, 185), and
`src/cli/referee.ts:66` states it against its own missing approval check. So the referee's refusal at
`src/cli/referee.ts:76` will carry the same persisted presentation: the human in chat sees exactly
what `init` showed, which is C-7's first verb.

It will not gain C-7's second verb here. The referee has no readline and must not acquire one —
`tests/docs/golden-path.test.ts:87` sanctions `readline` in exactly three modules and `cli/referee.ts`
is not among them, on the grounds that a fourth prompt would be "a sixth interrupt class in
disguise". The parity-faithful decision channel is a plan-level kind on the existing R-1 `record`
tool (`src/referee/registry.ts:74`), which is a change to the tool surface both drivers reach
through — a design change, and N-6 gives it its own ticket rather than smuggling it in here.

Recording this as a named non-goal rather than a silent one is the whole point of the branch: C-7
will be true on one driver and half-true on the other, and the half is stated.

## Falsification (verification protocol, item 1)

`tests/cli/run-approval.test.ts` against `c861286`, with the `RunOptions.approve`
seam declared and nothing wired to it — PRDR-251's sequence, so the test fails on the
absent behaviour rather than on a compile error (`npx tsc --noEmit` is clean at this point):

```
FAIL  prints the presentation `init` rendered, byte for byte, before refusing
  → C-7: the deferred plan is presented by the first `run`:
    expected '{\n  "schema_version": 1,\n  "exit": …' to contain 'Plan ready for approval.\n\nVerificat…'

FAIL  a yes at the prompt records who approved it, and the run proceeds
  → the human is asked exactly once: expected +0 to be 1

FAIL  a no leaves the plan READY-unapproved and exits 2, having spent nothing
  → the operator still saw what they declined: expected '{…"exit": 2…}' to contain 'Plan ready for approval.…'

FAIL  with no asker — every non-TTY invocation — it presents and refuses, and synthesizes nothing
  → the plan is shown even where it cannot be approved

Tests  4 failed | 2 passed (6)
```

The received value is the whole of what `run` produced: C-10's JSON envelope carrying
`"reason": "no approved plan — \`run\` executes only an approved plan (C-9); approve it via
\`init\` (C-7)"`. The plan was never rendered.

The two that passed are the controls and they pass unchanged afterwards: the C-10 envelope
is still emitted on the same refusal, and an already-approved plan is neither presented nor
asked about. Without the second, the refusal could have been bought by presenting on every
run.

The C-3′ guard was falsified separately, by caller-removed mutation (PRDR-240's shape) —
`if (false && shown.blocking > 0)`:

```
× a plan with a blocking question is presented but not approvable
  → `run` does not offer what `init` refused to offer: expected 1 to be +0
```

## What changed

`presentStage` persists `plan/presentation.json` — the rendered text, the plan hash, and the
count of blocking questions — on every branch, through `writeArtifact` (F-1 committed, scrubbed
on the PRDR-252 seam). `RunOptions.approve` joins `escalate` as a declared seam; `cli/run.ts`
supplies `makeTtyApproval` under the same `interactive` expression that already gates C-10's
escalation. `offerDeferredApproval` runs at the top of `runWithConfig`, before the lock and the
journal: it replays the rendering, refuses on a blocking question, refuses without an asker, and
on a yes calls the now-exported `recordApproval` — still the one writer of `approval.json`.
`cli/referee.ts`'s refusal carries the same rendering.

Sixteen claim sites are now true, including the two an operator reads. Two test names that
asserted the second exit while their bodies tested the first were re-pointed:
`tests/init/backhalf.test.ts` now asserts what `init` can honestly own — the rendering is on
disk and it is the text init showed — and the far end is driven through the real entry point in
the new file.

## Two things this turned up

**`NON_TICKET_FILES` grew a third time, and the first run said so.** `allTickets` maps every
`*.json` in `plan/` as a ticket, so `presentation.json` was parsed as one and `run` exited 1 with
`Unrecognized keys: "presentation", "plan_hash", "blocking"`. PRDR-153's doc-block on that set
predicts this exactly — it is why the set is one list rather than three, and why this was a
one-line fix. F-1 still owes the positive definition PRDR-064 asked for.

**`tests/docs/golden-path.test.ts:93` greps raw source for `readline`, comments included.** A
doc-block in `cli/run.ts` explaining why the asker is injectable tripped the C-5 prompt lint,
though the file raises no prompt and imports a sanctioned factory. That is PRDR-172's defect in a
different checker — `codeOnly` exists for it and this check does not use it. The prose was
reworded to land this ticket; the checker is a separate fix and takes its own ticket (N-6).
