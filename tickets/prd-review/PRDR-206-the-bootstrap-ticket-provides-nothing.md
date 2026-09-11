---
id: PRDR-206
title: "The bootstrap ticket provides nothing, so a ticket that consumes a scaffold file the bootstrap creates is reported — and handed to the review as proved — as consuming a file no ticket creates"
state: DONE
severity: minor
category: defect
labels: ["prd-review", "contracts", "bootstrap", "init", "false-positive"]
surface: ["src/schemas/init.ts", "src/init/analyze.ts", "src/init/contracts.ts", "src/init/plan.ts", "src/init/plan-write.ts", "tests/init/contracts.test.ts", "tests/init/plan-write.test.ts", "detent-prd-v3.md"]
prd_refs: ["C-4", "A-1‴", "A-1⁵", "F-3", "V-6", "N-6", "PRDR-193", "PRDR-201"]
acceptance_criteria: ["The ANALYZE artifact's `stack` names the files the chosen stack's scaffold creates — `scaffold_files`, additive and defaulted to `[]` so every analysis written before it still reads (F-3) — and the analyst is asked for them in the skeleton, beside the stack it already chooses.", "The bootstrap ticket PROVIDES `file:<each scaffold file>`, with a note saying the bootstrap creates it, so `applyContracts` resolves a slice ticket's `consumes: file:package.json` to `t-001-bootstrap` and derives the edge instead of reporting a file no ticket creates. Observed FIRST as the finding (V-6): a fixture ticket consuming `file:package.json` under an analysis naming it produces the `dependency` finding today.", "A consumed file NOT among the scaffold files is still reported exactly as before — the fix narrows one false positive, it does not widen what counts as provided.", "Nothing is guessed from file names: an analysis with an empty `scaffold_files` yields the same findings as today."]
non_goals: ["Does not touch the symbol case (`t-s07-009` consumes `presentTicket` that no ticket provides) or the test-file case (`t-s12-012`) — those are the plan's gaps and were correctly reported.", "Does not let the checker infer scaffold files from the stack name. `package.json` is universal for Node; what else a scaffold creates is the analyst's decision, made once, at ANALYZE.", "Does not change what the bootstrap ticket DOES — its criteria and surface stand."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-193", "PRDR-201"]
depends_on: []
---

# PRDR-206 — the bootstrap creates the ground and declares none of it

**Severity:** minor · **Category:** defect · **Found by:** reading gate-313's four contract findings

## Problem

C-4 has Detent construct the bootstrap ticket itself in greenfield — scaffolding plus the native
verification tooling — and block every other ticket on it. `bootstrapTicket` (`plan-write.ts:229`)
builds it with a title, criteria per bound slot, `surface: ["**"]` and `priority: 100`. It declares
no `provides`.

Every ticket that leans on the scaffold therefore leans on nothing the plan can see. On gate-313
the contract check reported four findings, "proved by code from the tickets' own
`provides`/`consumes`, no session and no judgement":

```
t-s12-010  consumes the file `package.json`, which no ticket creates
t-s12-013  consumes the file `package.json`, which no ticket creates
t-s12-012  consumes the file `tests/docs/readme-golden-path.test.ts`, which no ticket creates
t-s07-009  consumes the symbol `src/cli/presentation.presentTicket`, and no ticket provides it
```

The last two are the plan's. The first two are Detent's: the bootstrap creates `package.json` — its
own description names the stack, the runtime and the test framework, and a Node scaffold without a
`package.json` is not one — and the checker has no way to know, so it reports a defect that is not
there and PRESENT prints it under the heading that says it was PROVED.

That is worse than a missed finding. PRDR-193 hands proved findings to the whole-plan review as
`already_found`, with the instruction not to restate them; a false proof reaches the review as
settled fact. And at approval a human reads "consumes a file no ticket creates" about a file that
every ticket in the plan will find on disk.

## The shape

The analyst already chooses the stack at ANALYZE (D-10: nothing binds until the stack exists). It
can name the files that stack's scaffold creates in the same breath — `package.json`,
`tsconfig.json`, the test and lint configuration, `.gitignore` — as `stack.scaffold_files`, an
additive field defaulted to `[]`. The bootstrap ticket then provides each as `file:<path>` with a
note, and `applyContracts` does what it already does with a provided name: resolves the consumer,
derives the edge (which every ticket carries to the bootstrap anyway), and reports nothing.

No inference. An analysis that names no scaffold files produces today's findings unchanged, so the
fix cannot make a real gap disappear by guessing.

## How it is tested

V-6 order: a fixture analysis with `scaffold_files: ["package.json"]` and a slice ticket that
consumes `file:package.json`. Observed first: the `dependency` finding. Then the field, the
provides, and the resolution — and a second fixture consuming `file:src/never-made.ts` still
reports.

## What implementation changed

**`stack.scaffold_files`** on the ANALYZE artifact — `z.array(nonEmptyString).default([])`, so
every analysis written before it reads with none (F-3). The greenfield skeleton carries the
field with its instruction in the placeholder, and ANALYZE's instruction string names it; the
planner PROMPT is untouched, so no root's PLAN checkpoints are invalidated by this ticket (the
skeleton and instruction are inputs, not the S-6 prefix, and ANALYZE's digest reads neither).

**`bootstrapScaffold(greenfield, analysis)`** in `plan-write.ts` — the bootstrap's home — says
what the bootstrap will provide, for a check that runs over drafted tickets before the bootstrap
exists; `bootstrapTicket` provides each file as a `file` contract with a note. `applyContracts`
gained a fifth parameter and one rule: a `file` consume the scaffold names is neither a finding
nor an edge worth deriving. Both call sites in `plan.ts` pass it. `plan.ts` sat at its line
ceiling, which is why the helper lives where it does.

**V-6, in order.** Observed on the tree as it was: the scaffold parameter ignored and the
finding produced (`expected [ { tag: 'dependency', … } ] to deeply equal []`); the schema
refusing the field (`Unrecognized key: "scaffold_files"`); the parsed default `undefined`. Then
the change; then 40 of 40 across the contract and plan-write tests, including the end-to-end one
through `runInit` in which the bootstrap on disk provides `file:package.json` and PRESENT no
longer prints the false proof.

**Not touched, on purpose.** `t-s07-009 → symbol presentTicket` and `t-s12-012 → file
tests/docs/readme-golden-path.test.ts` on gate-313 were the plan's gaps and stay findings.

## Audit

Read cold after the close.

- **Brownfield is untouched.** `stack` is `null` there, `bootstrapScaffold` returns undefined,
  the check ignores the parameter, and no bootstrap exists to provide anything. The
  contract-check tests without a scaffold argument are that path.
- **An existing root does not re-plan for this.** ANALYZE's digest is the documents, the stack
  markers and the planner prompt hash; the skeleton and the instruction are inputs the digest
  never reads. A resumed root replays its old analysis — no `scaffold_files`, today's findings —
  and only a fresh ANALYZE writes the field. The planner prompt was deliberately not edited.
- **The placeholder can be copied verbatim.** An analyst that leaves the skeleton's
  `"<each file … >"` in place produces a bootstrap providing a file no ticket will ever consume
  — harmless, and the same property every other skeleton placeholder has. The instruction says
  to replace it; the validator cannot tell a placeholder from a path, and should not try.
- **Both call sites, one helper.** `bootstrapScaffold` is the single source for what the
  bootstrap provides, used by the two contract checks and by the bootstrap's own construction;
  the end-to-end test drives all three through `runInit`.
- **The two real findings survive.** The symbol and the test-file consumes on gate-313 are not
  scaffold files and are reported exactly as before; the scaffold test's second case pins that
  a file that merely sounds like one is not excused.
