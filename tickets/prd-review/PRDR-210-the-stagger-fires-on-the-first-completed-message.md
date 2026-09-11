---
id: PRDR-210
title: "C-4⁗‴'s wait fires on the first COMPLETED assistant message, and the cache it waits for is readable once the first response BEGINS: three of gate-313's fourteen slices waited the full 60 s and launched their other draws cold"
state: OPEN
severity: minor
category: defect
labels: ["prd-review", "review-sampling", "prompt-cache", "sdk", "cost"]
surface: ["src/sessions/sdk.ts", "src/sessions/backend.ts", "tests/sessions/sdk.test.ts", "scripts/null-review.ts"]
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
