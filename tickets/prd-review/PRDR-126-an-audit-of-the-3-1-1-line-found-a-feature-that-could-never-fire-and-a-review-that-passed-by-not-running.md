---
id: PRDR-126
title: "An audit of the unreleased 3.1.1 line: a rename map rewired edges away from the ticket that kept the name, the symbol reminder could never fire in any real project, and a whole-plan re-review that never ran printed approve"
state: DONE
severity: major
category: correctness
labels: ["prd-review", "found-by-audit", "user-raised"]
surface: ["src/init/plan-slices.ts", "src/init/plan-whole.ts", "src/init/symbol-reminder.ts", "src/adapter/symbols.ts", "src/kernel/worstcase.ts", "vitest.config.ts", "tests/init/slicing.test.ts", "tests/sessions/symbols.test.ts"]
prd_refs: ["C-2‴", "C-8‴", "S-3″", "PRDR-119", "PRDR-121", "N-4"]
acceptance_criteria: ["A `depends_on` naming an id that a ticket in the same slice still holds resolves to THAT ticket; `renamed` is consulted only for names nothing answers to, and a duplicated id inside one slice raises a `coherence` finding.", "`symbols.enabled` is tri-state — absent means nobody has decided, `false` means a person declined — and the reminder fires for a config that has never mentioned symbols, proven through `loadConfig` rather than a hand-built input.", "The slice cache's `external_deps` and `reviewed` are REQUIRED; a cache written before they existed misses and re-plans rather than defaulting to the answer that always passes.", "A whole-plan re-review that produces no verdict is reported as unreviewed and reaches PRESENT as a finding; it is never rendered as `approve`.", "Questions raised by whole-plan redrafts carry unique ids, as PRDR-119 already required of slice questions.", "`vitest` runs with a 20s test timeout, and the suite is green on a loaded machine."]
non_goals: ["Does not claim the 3.1.1 line is now free of defects. Roughly 3,100 lines changed across 45 files; this audited the newest and least-exercised of them and the paths a gate run had already touched.", "Does not resolve the symlink gap in the containment guard: `path.resolve` does not follow links, so a symlink inside the worktree pointing outside still passes the boundary check. Filed separately rather than fixed here.", "Does not change what the symbol adapter does when enabled. Serena is still discovered, never installed, and read-only."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-117", "PRDR-118", "PRDR-119", "PRDR-120", "PRDR-121"]
depends_on: []
---

# PRDR-126 — what the audit of the 3.1.1 line found

**Severity:** major · **Category:** correctness · **Found by:** an audit requested after the
gate run was stopped, 7 September 2026

Six defects, in the order they matter. Two of them made a shipped feature do nothing, and one
of those had a passing test.

## 1. A reference was rewired away from the ticket that kept the name

`normaliseDraft` renames a drafted ticket whose id collides, and rewrites the slice's own
references through a `renamed` map. When the planner drafted ONE id twice inside a slice — which
it does — the first ticket kept the id and the second was renamed, but the map then pointed the
name at the SECOND, renamed copy. Every edge naming that id was redirected away from the ticket
still holding it.

The plan stayed well-formed. Nothing failed. It simply meant something else.

The fix inverts the precedence: `renamed` is the LAST resort, consulted only for names that no
surviving ticket answers to. A name held by an earlier slice's ticket, or by a ticket in this
one, means that ticket. A duplicated id is now also a `coherence` finding, because two tickets
claiming one name is exactly the ambiguity a human should see.

## 2. The symbol reminder could never fire in any real project

S-3″ (PRDR-121) promised Detent would mention symbol intelligence only when the finished run
contained evidence it would have helped. The evidence detection works. The message is never
printed.

`symbols.enabled` defaulted to `false` in the config schema, and the reminder treats `false` as
"a person declined once, never ask again". But `init` WRITES a config before it reads one, so
`config.symbols` always parsed to the default object — and every project on earth looked like it
had already declined. The only input that could produce the message was `undefined`, which the
production path never produces.

Its test passed, because `undefined` is the only value the test ever passed in. That is the same
failure as the invented Serena flag in PRDR-121: a claim verified against its own assumption.

`enabled` is now tri-state. Absent means nobody has decided; `false` means a person said no.
Only the second silences. The regression test goes through `loadConfig`, the way `init` does.

## 3. The slice cache defaulted to the answers that always pass

`external_deps` defaulted to `[]` and `reviewed` defaulted to `true`. `sliceKey` hashes what a
slice READ, not the code that read it, so a cache written before either field existed still
matches its key — and was then read as reaching into nothing and having been reviewed.

`reviewed` exists precisely so that an unreviewed slice must say so, and its default said the
opposite. Both are now required; an older cache misses and re-plans one slice.

## 4. A whole-plan re-review that never ran printed "approve"

`wholePlanReview` guards the FIRST review's absence carefully — the comment there explains that
a human approving the plan could not otherwise know it never ran. Thirty lines later, the SECOND
review reads `second !== null && second.verdict === "changes" ? second.findings : []`, so a null
verdict produced an empty finding list and the note "whole-plan review after revision: approve".

A plan redrafted for coherence findings and then never re-checked reached the human as approved.
The same hole, in the same function, in the half that was written later.

## 5. Whole-plan questions skipped the PRDR-119 numbering

PRDR-119 gave every question a unique id because a slice presented two different `q1`s. Slice
questions are numbered; the questions raised by whole-plan redrafts were passed through with
whatever the model wrote, so several redrafted slices could each contribute a `q1`.

## 6. The suite flaked on its own default timeout

Four git-heavy tests failed as 5s timeouts on a loaded machine and passed on the next run. Those
tests take 0.3–1.2s idle; the suite runs files in parallel and shells out to real `git`. A suite
that gates a self-build must not be green one run and red the next, so `testTimeout` is 20s —
about 16x the slowest observed test, still short enough that a genuine hang fails.

## What this does not claim

The 3.1.1 line changed roughly 3,100 lines across 45 files. This audit covered the newest and
least-exercised of them, plus the paths the gate run had already exercised. It is not a proof
that the rest is correct.

One known gap is deliberately left open rather than quietly fixed: the containment guard
resolves paths with `path.resolve`, which does not follow symlinks, so a symlink inside the
worktree pointing outside passes the boundary check. That is a security surface and deserves its
own ticket and its own decision, not a line in an audit sweep.
