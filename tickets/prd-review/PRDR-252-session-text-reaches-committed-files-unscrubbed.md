---
id: PRDR-252
title: "Session- and gate-authored text reaches `tracking: \"committed\"` files unscrubbed, because PRDR-169 put the SEC-4 seam on `appendNote` and every later writer used a different one"
state: DONE
severity: critical
category: gap
labels: ["prd-review", "found-by-audit", "SEC-4", "F-1", "security"]
surface: ["src/kernel/tickets/mutations.ts", "src/kernel/journal.ts", "src/kernel/scrub.ts", "src/kernel/flake.ts", "src/kernel/stages/research.ts", "src/init/plan-research.ts", "src/init/plan-write.ts", "src/init/session.ts", "tests/sec/ticket-scrub.test.ts"]
prd_refs: ["SEC-4", "F-1", "ARCH-1", "N-1", "X-5", "X-6"]
acceptance_criteria: ["A secret in a failing gate's output does not reach `.detent/plan/<id>.json` when that gate is quarantined (X-5), and the surrounding evidence still does.", "The scrub is on `writeTicket`, so every ticket field inherits it — not `description` alone — and what `writeTicket` RETURNS equals what it wrote.", "`appendTicketEvent` scrubs, closing the half of its own doc-block's recorded gap that is a leak; the line stays parseable JSON.", "A research brief cached to `.detent/research/failures/` is scrubbed, and the planning brief and `plan.json` go through the same F-1 seam rather than a raw `writeFileSync`.", "A failing init session's thrown message carries its reason without the credential in it, on the terms `referee-session.ts` already applies to the identical value.", "Ordinary prose is unchanged: PRDR-177's two named cases survive a ticket round-trip byte for byte.", "Every one of the above fails on the tree before its fix, with the output recorded here."]
non_goals: ["Does NOT add a gate over the 15 `.detent/` writers that mention neither `scrub` nor `writeArtifact` — see \"The gate I did not build\".", "Does not give `appendTicketEvent` a schema; the other half of its recorded gap stays open and its doc-block now says so plainly (N-6: a ticket event schema is a design change).", "Does not scrub inside `writeArtifact`: ARCH-1/N-1 forbids `fs/` importing kernel policy, which is why `adapter/bind.ts` takes `redact` as a parameter.", "Does not change `scrub`'s rules. PRDR-177's deliberate trade — a purely numeric value still redacts — is asserted as-is, not re-litigated.", "Does not address `doctor --smoke` spending behind a pin check it records but does not gate; noted below, unfixed."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-169", "PRDR-177", "PRDR-188", "PRDR-251"]
depends_on: []
---

# PRDR-252 — the seam was chosen, and then not used

## Problem

PRDR-169 put SEC-4 scrubbing on `appendNote` and wrote down why:

> Here rather than at today's four call sites because the next site that appends
> session text should inherit it rather than remember it — the rule this audit
> chain has now forgotten four times.

The reasoning is right. The seam is wrong, or rather it is one of three, and
every writer since used one of the other two. It was forgotten a fifth time
three lines away in the same file.

`quarantineTicket` interpolates a failing gate's raw output into a new ticket's
`description` and writes it with `createTicket` → `writeTicket`. `referee-gate.ts`
scrubs that **same** `GateResult.output` on its own path — and writes it to
`.detent/state/`, which F-1 marks LOCAL. The unscrubbed copy went to
`.detent/plan/`, which `fs/layout.ts` marks `tracking: "committed"` and
`stageAll` sweeps with `git add -A -- . :!<LOCAL>`.

**The local artifact was protected and the committed one was not.**

## Scope, measured rather than assumed

A four-angle sweep of the tree produced 23 candidates; 15 survived adversarial
verification. They fall into three groups, and the grouping is what decided the
fix:

| group | sites | covered by |
| --- | --- | --- |
| ticket fields | `flake.ts` quarantine, `referee-stage.ts` `linkUpstream`, `plan-write.ts` every planned ticket, `dependency.ts` wait reason, `referee-session.ts` granted surface | the `writeTicket` seam |
| journal events | `init/session.ts` `tail` | the `appendTicketEvent` seam |
| artifact writes | `stages/research.ts` brief cache, `init/plan-research.ts` planning brief, `plan-write.ts` `plan.json` | routed through `writeArtifact`, scrubbed at the composing layer |

Five of the six in the first group were closed by ONE change, and four of them
without being named in it — which is the property PRDR-169 was reaching for and
the reason the seam is `writeTicket` rather than `quarantineTicket`.

The research brief is the one the sweep rated critical, and it is the worst of
them: the research session reads the repository with Read, Grep and WebSearch
and quotes what it finds into six free-string fields, and the cache is keyed on
the environment — so an unscrubbed brief is served again to every later run with
the same failure signature.

## Falsification (verification protocol, item 1)

`tests/sec/ticket-scrub.test.ts` against `e43fdef`, four of five failing and the
control passing:

```
× a quarantine ticket's evidence is scrubbed — gate output goes to a COMMITTED path
  → expected '{\n "schema_version": 1, "id": "t1-flake-1", ...
     "description": "... Failing output:\nError: auth failed\n
      ANTHROPIC_API_KEY=sk-ant-api03-Zx9QmT4vL8nR2wY6bK1cJ7hF3dG5sP0aE ..."'
    not to contain 'sk-ant-api03-…'
× the seam is `writeTicket`, so every field inherits it — not `description` alone
× what `writeTicket` returns is what it wrote — no unscrubbed copy is handed back
× `appendTicketEvent` scrubs, which is the gap its own doc-block records
✓ ordinary prose is untouched (PRDR-177)
```

and, added after the sweep, each falsified against the fix beside it:

```
× the cached brief is scrubbed, and the brief the stage returns agrees with it
× the thrown message carries the reason without the credential in it
  → without the credential: expected 'planner session failed: refused:
     ANTHROPIC_API_KEY=sk-ant-api03-…' not to contain 'sk-ant-api03-…'
× keeps the last 4000 characters, the bound `recordFailure` already used
  → bounded on the same terms as the local failure record: expected 81018 to be 4000
```

That last one is a second defect at the quarantine site and not a secrets one:
`adapter/run.ts` caps a gate's captured output at `DEFAULT_TAIL_BYTES` (64 KiB)
and no lower, so the LOCAL failure record kept 4 KB and the COMMITTED ticket kept
up to sixteen times that, per flake. Fixed on `recordFailure`'s own terms.

## My own correction, recorded

The first version of that doc-block said one verbose gate could put "megabytes
of build log" into git history. It could not: the 64 KiB cap is real and I had
not read it. Corrected before commit — an overstated claim in a doc-block is the
defect this branch exists to fix, and writing one while fixing them would be
worse than the leak.

## The control is the point

`scrub` is a regex redactor, and PRDR-177 exists because an earlier version of
it ate `dist/assets/task-BX9kL2mQ…` and `Unexpected token: identifier`. Putting
it on the ticket write means EVERY ticket in the repository now passes through
it, so the control is not optional — it is the assertion that this change did
not quietly start mangling plans.

It also caught me: my first control asserted `tokens: 128374 in` survived.
PRDR-177 says plainly that it does not — "a purely numeric value still redacts,
so telemetry prose reads `tokens: [REDACTED] in, 4211 out`" — and calls the
trade cosmetic and safe. The test was wrong, not the scrubber. It now asserts
the promise that was made.

## ARCH-1 refused the seam I wanted, correctly

`writeArtifact` in `fs/layout.ts` is the declared F-1 write seam, and scrubbing
there would have covered all seven committed entries at once. `tests/adapter/e2e.test.ts`
refused it: `src/fs/**` and `src/adapter/**` may not import `src/kernel/**`.
That is the same rule `adapter/bind.ts` already records — "N-1 keeps `scrub` out
of the adapter, so the layer that composes them passes it in" as a required
`redact` parameter.

So `writeArtifact` stays a primitive, `kernel/scrub.ts` grows `scrubJson`, and
the three artifact writers scrub at the composing layer and re-validate through
their own schema — which also proves the redaction left a valid artifact.
Routing them through `writeArtifact` at all is a second gain the sweep surfaced:
all three were raw `writeFileSync` calls bypassing F-2/F-3 containment and
stamping as well as the redaction.

## The gate I did not build

The obvious follow-through is an oracle: every module that writes into
`.detent/` must scrub. Derived from the tree, that set is 18 modules and 15 of
them mention neither `scrub` nor `writeArtifact` — `run-lock`, `checkpoints`,
`hook-policy`, `drift-base`, `consent`, `agents`, `present`, and the rest.

Most of those write kernel-authored data and are fine. But "fine" there is a
judgement, and the gate would need 15 of them written down as exemptions, each
an unverified claim about text nobody has traced. PRDR-150's V-6 is explicit:
*a check whose false-positive rate has not been measured must not be able to
fail a ticket.* Fifteen guesses is not a measurement, and a gate that is mostly
exemptions teaches readers to add another one.

The same reasoning killed a check I proposed earlier on this branch after its
false-positive rate measured 67%. It is recorded here so the absence is a
decision rather than an oversight.

## Recorded, not fixed

`cli/doctor.ts` performs the S-5 pin check and records the result, then runs its
`--smoke` session — which spends real tokens and writes a permanent ledger row
via `recordOutOfBandSpend` — without gating on it. The check is reported, not
enforced, on the one doctor path that costs money. Out of scope here; it is the
S-5 family, not SEC-4.

## What changed

`writeTicket` scrubs before validating, so the object returned is the object on
disk. `appendTicketEvent` scrubs the serialized line. `kernel/scrub.ts` exports
`scrubJson`. `stages/research.ts`, `init/plan-research.ts` and `plan-write.ts`
write through `writeArtifact` with a scrubbed, re-validated value.
`init/session.ts` scrubs the `rawTail` it throws. `flake.ts` bounds the
quarantine evidence at 4000 characters. `journal.ts`'s doc-block now says which
half of its recorded gap is closed and which is not.
