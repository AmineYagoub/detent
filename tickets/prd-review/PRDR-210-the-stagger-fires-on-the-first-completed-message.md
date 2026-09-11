---
id: PRDR-210
title: "C-4⁗‴'s wait fires on the first COMPLETED assistant message, and the cache it waits for is readable once the first response BEGINS: three of gate-313's fourteen slices waited the full 60 s and launched their other draws cold"
state: DONE
severity: minor
category: defect
labels: ["prd-review", "review-sampling", "prompt-cache", "sdk", "cost"]
surface: ["src/sessions/sdk.ts", "src/sessions/backend.ts", "src/init/launch-batch.ts", "src/init/plan-sample.ts", "tests/sessions/sdk.test.ts", "tests/init/plan-critic-sampling.test.ts", "detent-prd-v3.md"]
prd_refs: ["C-4⁗‴", "S-6", "S-6′", "V-6", "N-6", "PRDR-204", "PRDR-205"]
acceptance_criteria: ["The SDK backend requests partial messages and fires `onFirstResponse` on the first `stream_event` carrying `message_start` — the response has begun — falling back to the first complete `assistant` message for a stream that carries no events. A scripted stream `[system, stream_event(message_start), …, assistant, result]` is observed FIRST to fire at the `assistant` frame (V-6), then at the event.", "Telemetry is unchanged with partial messages present: `observedTurns`, the result parse and the S-3‴ init check read the same values from a stream with `stream_event` frames interleaved as from one without — pinned on the existing parsing fixtures.", "Measured on one never-cached slice through the null harness (`--together`): the sampler reports the first answered in single-digit seconds and the two warm draws create what PRDR-205's run D showed (10.6k and 24.1k against a cold 46.4k), on a slice whose reviewer opens with a long first turn. The numbers go in this ticket."]
non_goals: ["Does not change the wait's ceiling or make it a knob.", "Does not touch how the whole-plan review or the redrafts run — single sessions, no batch."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-204", "PRDR-205"]
depends_on: ["PRDR-205"]
---

# PRDR-210 — waiting for the end of a turn that only needed to start

**Severity:** minor · **Category:** defect · **Found by:** gate-313's init notes, fourteen slices

## Problem

C-4⁗‴ launches the second and third draws when the first has answered, so they read the first
turn it wrote (S-6′). The signal is the stream's first `assistant` message (`sdk.ts`):

```ts
if ((message as { type?: string }).type === "assistant") {
  observedTurns += 1;
  if (observedTurns === 1) spec.onFirstResponse?.();
```

An `assistant` message is a COMPLETED turn. The cache is readable earlier — once the first response
begins — and on the null harness's slices the two coincided, because the reviewer's first turn was a
three-second tool call. On gate-313's plan it often was not:

| slice | first answered after |
|---|---|
| s03 s04 s05 s06 s07 s08 s13 | 3 s |
| s11 | 5 s |
| s10 · s12 · s14 | 27 s · 34 s · 50 s |
| **s01 · s02 · s09** | **did not answer in 60 s — launched anyway** |

On s01 the three draws created 76k, 77k and 41k cache tokens: two wrote the block, one read it —
the miss PRDR-204 priced at about a dollar a slice, paid on three of fourteen here and nearly on
three more. The wait was doing its job; it was listening for the wrong moment.

## The shape

The SDK emits `stream_event` frames when asked (`includePartialMessages`), each one a Messages API
streaming event. `message_start` is the response beginning. Fire on that; keep the `assistant`
frame as the fallback for a stream without events; leave telemetry reading exactly what it reads
now, and prove that on the parsing fixtures before trusting it.

## What implementation changed

**The signal.** `buildOptions` requests `includePartialMessages` for a session that carries an
`onFirstResponse` — and only then, so a session nobody waits on gets the stream it always had.
`runOnce` fires the callback once, on the first `stream_event` whose `event.type` is
`message_start`, with the completed `assistant` frame kept as the signal for a stream that
carries no events. `respond()` is idempotent; PRDR-114's fallback re-run of `runOnce` cannot fire
it twice into the batch.

**Telemetry untouched.** Turns are `assistant` frames, never events: pinned on a stream with
events interleaved (same turns, cost and parse as without) and on the crash path, where the wrap
reports the observed count (two assistant frames, six events → two turns).

**The sampler's note** now says what the signal is — *the first began its answer after N s* /
*did not begin answering in time* — since "answered" was the old contract.

**V-6, in order.** Four tests written in final form, run against the tree as it was:
`expected 3 to be 1` (fired on the completed `assistant` frame at index 3, not the
`message_start` at 1), `includePartialMessages` undefined, and one assertion of mine that was
wrong — I had asserted `result.turns` counts observed frames; it reads the result message's
`num_turns`, and the observed count is only the crash wrap's. Replaced with the crash-path test.
Then the change; then green.

## What the measurement found

Never-cached s01 of the smoke-1 copy, three draws launched together, through the production
sampler:

| | first draw | draws 2 and 3 |
|---|---|---|
| signal | *the first began its answer after 2 s* | launched at 2 s |
| cache_creation | 54.0k (cold) | **9.4k · 12.5k** (warm) |
| wall-clock · spend | 1.0 min · $1.94 | |

This slice's reviewer happened to open with a short first turn, so the run does not by itself
reproduce gate-313's 60 s case; what it shows is the property the fix has by construction — the
wait now ends at the response's start, whatever the turn's length — and that the warm draws read
what the cold one wrote. The next gate init is where the three 60 s slices would have recurred,
and cannot.

## Audit

Re-read cold after the close, with the diff and the live rows in front of me.

- **Turn accounting under partial messages, live.** The three s01 draws recorded `turns` of 3,
  10 and 10 in the ledger — completed turns, not the hundreds of stream events they carried. The
  scripted tests said so; the ledger agrees.
- **PRDR-114's fallback re-run fires the batch early.** A routed model the runtime refuses costs a
  $0 attempt whose stream may still carry a `message_start` before the refusal is known; the batch
  would launch its other draws on that, then the first draw re-runs on the fallback model. The
  draws would still be correct, the cache would be missed once, and the case is one $0 attempt per
  model per run. Accepted and recorded rather than coded around.
- **The note said "answered".** Fixed at the close: *the first began its answer after N s* / *did
  not begin answering in time*, and the test regex with it. A note that names the old signal
  would have mis-described every log from here on.
- **The live slice opened with a short first turn.** So the run shows the property (2 s, warm
  draws) rather than reproducing the 60 s case. Nothing in the fix depends on the turn's length
  any more, which is the point; the next gate init is the reproduction.
- **Nothing unreachable.** `includePartialMessages` is set in the one options builder every live
  session passes through, and the live run's 2 s is the proof it reached the SDK.
