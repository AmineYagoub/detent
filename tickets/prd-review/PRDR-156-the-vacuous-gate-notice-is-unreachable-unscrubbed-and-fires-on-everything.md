---
id: PRDR-156
title: "The vacuous-gate notice reaches no operator, carries unscrubbed command output, and its threshold sits above its own positive example"
state: OPEN
severity: critical
category: defect
labels: ["prd-review", "found-by-audit", "unreachable-feature"]
surface: ["src/init/pipeline.ts", "src/adapter/bind.ts", "src/init/bind.ts", "detent-prd-v3.md"]
prd_refs: ["V-1‴", "SEC-4", "A-1⁗"]
acceptance_criteria: ["The notice V-1‴ promises is delivered to the operator through the production entry point, proven by a test at the PIPELINE layer that asserts on what the CLI's own `note` callback receives — not at the adapter layer, which is where the dead version was already green.", "Command output embedded in any notice passes through `scrub()` before it can reach a file, a stream, or a prompt, on the same terms `referee-gate.ts` already applies to gate output it writes.", "The vacuity signal separates the population V-1‴ names as vacuous from the population it names as legitimate, demonstrated on measurements of both taken on the same machine. A signal that flags every bound slot of an ordinary project is not a signal.", "The phase output shape does not depend on which branch produced it: greenfield and brownfield emit the same keys."]
non_goals: ["Does not make the notice a refusal. A-1⁗ and V-6 both stand: this is evidence handed to a person.", "Does not attempt to detect semantic vacuity — a suite that passes because it has no assertions, or `jest --passWithNoTests`. Those are undecidable here and V-6 is the mechanism that catches them, at review time, with a diff to revert.", "Does not backfill the other 20 empty ticket files. PRDR-155 and PRDR-144 are written because they are the tickets for the commit under audit."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-155", "PRDR-148", "PRDR-150"]
depends_on: []
---

# PRDR-156 — a notice nobody receives, about a measurement that does not discriminate

**Severity:** critical · **Category:** defect · **Found by:** the audit of `19d68f7`, the commit
that shipped V-1‴

## Problem

Three defects in one feature, in descending order of how badly they falsify the claim made for it.

### 1. It is unreachable

`src/init/bind.ts` emits the notice through `deps.note?.(notice)`. The only production caller,
`determinePhase` in `src/init/pipeline.ts`, is the one phase handler in that file that does not
forward `note`. The other five all carry
`...(deps.note === undefined ? {} : { note: deps.note })`. The plumbing is complete on both sides
— `PipelineDeps.note` is declared, and `src/cli/init.ts` supplies a writer to stdout — and it is
dropped at the last hop. Nothing reads the `gate_notices` phase output back either: `present.ts`
reads six named keys and this is not one of them.

So the operator is told nothing, by either path. The PRD sentence "the notice carries the
command's own output so a person settles it in a second" describes something that has never
happened.

This is the same defect class as `ccdc501` — "five features that were implemented, tested,
documented and unreachable" — and the test written for it could not catch it, because it asserts
on `report.notices` at the adapter layer, one level below the hop that drops it.

### 2. It embeds unscrubbed command output

`src/adapter/bind.ts` puts `outcome.result.output` into the notice verbatim. `src/kernel/scrub.ts`
exists for exactly this shape and has one caller — `referee-gate.ts`, whose comment reads "SEC-4:
scrubbed BEFORE write — a secret echoed by a failing gate". A project whose test script echoes a
token gets that token written to `.detent/state/DETERMINE_VERIFICATION.json` in plaintext.

Bounded today only by defect 1: `state/` is gitignored and nothing reads the field. Both of those
stop being true the moment the notice is wired, which is the fix for defect 1.

### 3. The threshold is above its own positive example

The PRD records the measurement as "a vacuous `echo` probes in 96 ms and a script doing real work
in 344 ms". The code then sets the cut at 500 ms and flags everything below it — so the 344 ms
script the rule names as REAL WORK is flagged as vacuous. By its own evidence the discriminator
does not discriminate.

Measured against an ordinary small TypeScript project (esbuild, eslint, `tsc --noEmit`, vitest):

```
BOUND test       285ms  -> notice
BOUND lint       217ms  -> notice
BOUND typecheck  308ms  -> notice
BOUND build      101ms  -> notice
```

Four bound slots, four notices, each asserting "a gate that always passes verifies nothing". A
warning that fires on every slot every time is a warning nobody reads.

The deeper problem is that the two populations overlap and no absolute duration separates them.
A no-op `make` measures 12 ms and is legitimate; an `echo` through npm measures 96 ms and is not.
Most of that 96 ms is npm's own startup floor (~94 ms on the machine where it was taken), so the
headline figure is mostly process overhead, and the threshold is pinned to one machine's cost.

Detent's own repo is the unrepresentative case — test 31.7 s, lint 1.7 s — which is why this
looked quiet while it was being written.

## Direction

Duration is the wrong signal and should stop being the trigger. The command text is the right one
and is already carried: `Candidate.config_region` records the value an engine read, so the npm
engine holds `scripts.test=echo no tests here` and the make and just engines hold the recipe
block. A command whose every statement is a no-op — `echo …`, `true`, `:`, `exit 0`, empty — is
vacuous by inspection, decidably, without measuring anything.

That is narrower than the duration heuristic pretended to be. It fires on exactly the case V-1‴
names and not on `go build ./...`, `tsc --noEmit`, or a 12 ms `make`. Narrow and true beats broad
and wrong, and the miss direction is the harmless one: an undetected vacuous gate is the status
quo, whereas a false accusation on every gate is a new harm. Duration stays in the notice as
reported context, because it is free and a person can use it.
