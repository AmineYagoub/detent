---
id: PRDR-120
title: "Coupling between tickets lives at the symbol level, but the plan expresses it only as ticket ids and file globs, so every interface disagreement waits for a reviewer to notice it"
state: DONE
severity: major
category: gap
labels: ["prd-review", "found-by-execution"]
surface: ["src/schemas/init.ts", "src/schemas/ticket.ts", "src/init/contracts.ts", "src/init/plan.ts", "src/init/plan-write.ts", "src/kernel/referee-context.ts", "prompts/planner.md", "detent-prd-v3.md"]
prd_refs: ["A-1", "A-2", "C-4", "C-2‴", "D-6", "X-4′"]
acceptance_criteria: ["A ticket declares `provides` (names it brings into existence, each with the meaning a consumer needs) and `consumes` (names it depends on), over a closed kind set.", "Detent checks the declarations mechanically, with no model session: a consumed name nothing provides, a name two tickets provide, and a shared file several tickets provide each become a finding naming the tickets at fault.", "A provider that is not the consumer itself nor reachable through the blocker graph yields a derived dependency edge, applied to the plan and reported, unless the edge would close a cycle — in which case it is a finding instead.", "An implement or review session receives the ticket's own `provides` and, for each `consumes`, the provider's note — the meaning of the name, written by the ticket that owns it."]
non_goals: ["Does not check semantics. Whether two rules over one value agree stays the reviewer's judgement; contracts make the coupling explicit so the reviewer is looking at the right pair.", "Does not add an artifact. The contract is the union of the tickets' own declarations and cannot drift from them.", "Does not replace `surface` or `depends_on`. Surfaces remain the containment boundary; declared edges remain, and derived ones join them.", "Does not require symbol intelligence. The checks are internal consistency and run with no external tooling (PRDR-121 verifies them against real code)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-101", "PRDR-103", "PRDR-117", "PRDR-121"]
depends_on: []
---

# PRDR-120 — a ticket declares what it provides and consumes

**Severity:** major · **Category:** gap · **Found by:** the first full-product `init` on
ksar-cloud, 5 September 2026

## What happened

The walking-skeleton slice produced 41 tickets. Its review found eight defects that survived a
revision round. Read together they are one defect wearing five costumes — two tickets
disagreeing about a named thing neither of them owns:

- `t-s01-016` contradicts the terminal-state contract `t-s01-002` fixes (`v1.TerminalStates()`).
- `t-s01-011`'s criterion needs terminate semantics its description only half-defines (`ErrTerminate`).
- `t-s01-023` derives an image name `t-s01-022`'s validator would reject (`BuildSpec.Validate`).
- `t-s01-027` wires a pipeline from the composition `t-s01-017` builds (`Deps`).
- `t-s01-024` adds a module requirement to `controlplane/go.mod`, which three other tickets also edit.

Detent models coupling two ways today: `depends_on`, which the planner guesses, and `surface`,
a file glob. Neither can express *"`t-002` defines `TerminalStates()` and `t-016` depends on
what it means"*. So nothing mechanical can check it, the job falls to a reviewer noticing, and
the same class reappears in every slice.

It is the same defect the operator meets at run time, one level down: a ticket claimed before
the work it needs exists, or a session rewriting what an earlier ticket established.

## Evidence

A-1 fixes what a ticket carries, and coupling is not among it:

> A ticket is one implement session's work, with non-empty testable acceptance criteria, an
> explicit surface, and dependency edges via `depends_on`.

X-4′ exists precisely because the plan's edges are unreliable — it recovers a missing
dependency at run time, after a generation has been spent discovering it:

> A falsification that names the code it is missing is a dependency the plan did not declare.

## Proposed resolution

`provides` / `consumes` on the ticket, over a closed kind set (`symbol`, `config`, `file`,
`route`, `table`, `event`). Four mechanical checks — unowned, duplicated, out-of-order,
contended — turn the structural half of `coherence` and `dependency` from a reviewer's
judgement into a validator's output, and derive the missing edges rather than guessing them.
The consumer session receives the provider's note, so the interface reaches the work.

Full design: `docs/plan-contracts-and-symbols.md`.
