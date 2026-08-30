---
id: PRDR-092
title: "A run silently discards uncommitted .detent/config.json edits — the setting stops applying and nothing says so"
state: READY
severity: major
category: correctness
labels: ["prd-review", "found-by-execution"]
surface: ["src/kernel/run.ts", "src/kernel/git.ts", "src/cli/run.ts", "detent-prd-v3.md"]
prd_refs: ["F-1", "B-5", "V-3", "P7", "P8", "C-8"]
acceptance_criteria: ["The mechanism that reverts `.detent/config.json` to HEAD mid-run is identified by name in the resolution — the three obvious candidates are already excluded (see Problem), so the resolution must not restate them.", "A run either preserves an uncommitted `.detent/config.json` edit for its whole duration, or refuses to start while one exists and names the file — silence is not an admissible third option.", "A regression test reproduces the loss end-to-end: a config key added uncommitted, a run spanning at least three tickets, and an assertion that the key is still in effect at the last ticket, not merely present in the file at the start.", "If the resolution is that config must be committed, `detent run` says so at launch and F-1 states it, so the requirement is discoverable before a run rather than inferable after one."]
non_goals: ["Does not revisit whether `.detent/config.json` is tracked at all — F-1's committed/local split is settled and this ticket assumes it.", "Does not change `prompt_routing` specifically: that key is incidental, and every config key is equally exposed.", "Does not widen B-5's reset scope; `resetDirtyTracked` already excludes `.detent/` deliberately and correctly.", "Does not treat this as a drift-halt (V-3) event — V-3 governs verification bindings, and reusing its machinery is a resolution choice, not a requirement."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-089"]
depends_on: []
---

# PRDR-092 — a run silently discards uncommitted `.detent/config.json` edits

**Severity:** major · **Category:** correctness · **Found by:** execution, during the
PRDR-089 A/B

## Problem

A configuration key written into `.detent/config.json` but not committed stops
applying partway through a run. The run does not halt, does not warn, and does not
journal the change. It simply proceeds as though the setting had never been written.

The evidence is four-for-four across a controlled experiment. Each variant arm had
`prompt_routing` added to `.detent/config.json` as a working-tree edit against a
template whose committed copy lacked the key. Every arm routed correctly for exactly
two tickets and then stopped:

```
ab2-v1: implement.go implement.go implement implement implement implement implement
ab2-v2: implement.go implement.go implement implement implement
ab2-v3: implement.go implement.go
ab2-v4: implement.go implement.go
```

Afterwards each worktree's `config.json` was byte-identical to HEAD — the key was gone
from the file, not merely ignored. `git status` reported the tree clean, so nothing
remained to show an edit had ever been made.

Three plausible mechanisms are already excluded:

- **B-5 crash recovery is not it.** `resetDirtyTracked` filters `.detent/` out of the
  paths it checks out (`src/kernel/git.ts`), deliberately, so ticket JSON survives resume.
- **`detent approve` is not it.** Tested directly against a fixture carrying the key: the
  key survives the command unchanged.
- **The resume path is not it.** `ab2-v3` and `ab2-v4` were never gated, never approved,
  and never resumed, and they lost the key on their first and only run.

What does revert it is unidentified, and that is the point of filing rather than fixing.

## Why it matters more than the key it ate

Detent's posture everywhere else is that a changed input stops the run. V-3 halts when a
verification command drifts. S-6 kills a run when a prompt prefix moves. C-8 re-derives a
phase when its digest changes. Configuration is the one input that can change underneath
a run and produce nothing at all — no halt, no note, no journal line.

The failure is also invisible in exactly the way that matters most. The run still
completes, the tickets still reach DONE, and the artifacts still look right. What changed
is *which prompt ran*, which no exit code encodes. It was caught only because PRDR-089
journals the prompt that actually ran as `role.variant@hash` — without that line the A/B
would have reported a clean null result for a manipulation that stopped firing after two
tickets. A user tuning `model_routing`, `risk`, or `protected` between runs has no such
tripwire and would see only that their setting "didn't seem to do anything".

`protected` makes the security case concrete: a user who widens the protected globs
uncommitted, and whose edit is silently reverted, gets a run whose write containment is
narrower than the one they configured, with nothing in the journal to show it.

## Investigation (still open — cause not found)

Six mechanisms are now excluded, each checked rather than reasoned about:

- **B-5 crash recovery.** `resetDirtyTracked` filters `.detent/` out of the paths it
  checks out, deliberately.
- **`detent approve`.** Tested against a fixture carrying the key; it survives untouched.
- **The resume path.** Two arms lost the key on a first-and-only run, never approved,
  never resumed.
- **Session writes.** `.detent/config.json` is in the referee's STRUCTURAL protected
  floor, above whatever the project declares, so the D-21 hook denies it even to the
  bootstrap ticket's `**` surface.
- **Layout stamping / `ensureConfig`.** `run` invokes neither, and `ensureConfig` returns
  early when the file exists.
- **The kernel run path.** `tests/kernel/config-survives-run.test.ts` drives two tickets
  to DONE against a tracked config carrying an uncommitted edit; the edit survives.

What is established: the file's mtime moves DURING a live run, early, in every affected
arm — and the config is loaded ONCE per run, so a mid-run change cannot affect the run
that writes it. It affects the NEXT one. That matches the field evidence exactly: routing
applied for run #1's two tickets, then run #2 loaded a file that no longer had it.

## Partial resolution — detection, not preservation

The run now journals the configuration it actually loaded (`event: "config"` on the `run`
journal: budgets, `model_routing`, `protected`, `risk`, run branch). A setting that stops
applying between runs is now a visible diff between two journal lines instead of silence,
which is what made this cost an entire A/B before anyone noticed.

This does NOT satisfy acceptance criterion 2, which requires the run to preserve the edit
or refuse to start and name the file. The ticket stays open on that criterion. Detection
is what could be built honestly without a reproduction; preservation needs the cause.
