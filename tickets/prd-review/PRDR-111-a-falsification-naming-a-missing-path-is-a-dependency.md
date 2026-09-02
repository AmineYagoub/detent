---
id: PRDR-111
title: "A falsification that names code another ticket will build is a dependency the plan missed — today it is a human stop that a person has to remember to clear"
state: READY
severity: major
category: gap
labels: ["prd-review", "user-raised", "found-by-execution"]
surface: ["src/kernel/dependency.ts", "src/kernel/referee.ts", "src/kernel/referee-session.ts", "src/kernel/machine.ts", "src/kernel/driver.ts", "src/kernel/tickets/readers.ts", "src/schemas/ticket.ts", "src/schemas/states.ts", "prompts/implement.md", "skills/run/SKILL.md", "detent-prd-v3.md"]
prd_refs: ["X-4", "X-3", "X-8", "C-9", "SEC-3", "D-21"]
acceptance_criteria: ["The falsified signal may carry `missing`: concrete repo-relative paths the ticket needs that do not exist. The implement prompt says so.", "When every named path is owned by the surface of at least one other ticket that is not DONE and does not itself depend on this ticket, the ticket records those owners in `waits_on`, closes its generation as blocked, opens the next with the reason, and returns to READY — no human, no escalation.", "The pool waits on `waits_on` exactly as it waits on `blockers`; a released ticket runs once its owners reach DONE.", "When no such owner exists — nobody builds the path, or the only owner would deadlock — the falsification routes to a human as X-4 always did, and the note says which.", "At most three dependency releases per ticket; the fourth falsification is a human stop.", "The worst-case session figure is unchanged: the re-queue opens a new generation, like a human requeue, and the walk does not traverse it."]
non_goals: ["Does not widen the ticket's surface. Building on the dependency once it exists may still need a SEC-3 surface request; that lever is unchanged.", "Does not touch PRDR-103's plan-side fix. The planner should still declare the dependency; this is what the run does when it did not.", "Does not infer paths from prose. The session names them, concretely, or the signal is an ordinary falsification."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-103", "PRDR-107", "PRDR-108", "PRDR-109", "PRDR-110"]
depends_on: []
---

# PRDR-111 — a falsification naming a missing path is a dependency

**Severity:** major · **Category:** gap · **Raised by:** the user — "when the plugin works
in production, who will take this action?" · **Found by:** t-112 on the certification gate

## The case

t-112's AC2 needs a status display that t-154 builds. The planner declared no dependency
(PRDR-103). The implement session hit the missing code, correctly falsified (X-4), and the
referee routed the ticket to a human — because a falsification is free text, and the kernel
had no idea what was missing, who would build it, or when to try again.

The action that clears it is: notice t-154 finished, remember t-112 was waiting on it, run
`detent requeue t-112`. In production that is a person holding a dependency in their head
across a run — on the plugin path they answered "skip" hours earlier and have to come back;
on the CLI path the run exited 10 and nobody comes back at all.

## Why the kernel can do it

The session knows exactly what it needs: a path. The plan knows who owns every path: every
ticket declares a surface. Resolving one against the other is a glob match, and the pool
already knows how to wait — `ready()` holds a ticket until its `blockers` are DONE.

## Resolution

- `falsified.json` gains `missing: string[]` — concrete paths, one per entry.
- `resolveMissing` (`src/kernel/dependency.ts`) finds the owners: tickets other than this
  one, not DONE, whose surface matches a named path, excluding any ticket that transitively
  depends on this one — a dependency that would deadlock is not a dependency.
- With owners: `waits_on` gains them, the generation closes as `blocked`, the next opens
  with the reason, and `DEPENDENCY_DISCOVERED` takes the ticket to READY. `ready()` and
  `claimRefusal` wait on `waits_on` like `blockers`. Capped at three releases per ticket.
- Without owners: `PREMISE_FALSIFIED` as before, the note naming the paths and why nobody
  can own them.
- Both drivers stop driving a ticket whose transition lands on READY; the referee has
  already done the bookkeeping, and the claim release returns it to the pool.
