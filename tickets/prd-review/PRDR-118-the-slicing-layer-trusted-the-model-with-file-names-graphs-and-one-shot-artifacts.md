---
id: PRDR-118
title: "An audit of the slicing layer before its first paid run: a drafted ticket id could write outside the repository, a dependency cycle deadlocked the pool silently, one edge erased a slice's ordering, a plain re-init destroyed in-flight work, and one stray key aborted hours of planning"
state: DONE
severity: major
category: correctness
labels: ["prd-review", "found-by-audit"]
surface: ["src/schemas/common.ts", "src/schemas/ticket.ts", "src/kernel/tickets/paths.ts", "src/kernel/tickets/mutations.ts", "src/init/plan-write.ts", "src/init/plan-slices.ts", "src/init/plan-whole.ts", "src/init/plan.ts", "src/init/slice.ts", "src/init/retry.ts", "src/init/machine.ts", "src/init/pipeline.ts", "src/init/session.ts", "src/cli/init.ts", "detent-prd-v3.md"]
prd_refs: ["C-2‴", "C-4", "C-8", "F-1", "A-1", "S-4", "R-9", "D-24"]
acceptance_criteria: ["A ticket id is constrained to a safe file name at the schema and at the path builder; a drafted id that would escape the plan directory, collide by case, or take an artifact's name is renamed, and nothing outside `.detent/plan/` is written.", "A dependency cycle in a drafted slice is broken at the edge that closes it and reported as a `dependency` finding; every written plan is executable, and something is always claimable.", "A ticket that names one earlier-slice ticket is still gated by that slice's remaining capstones.", "Re-planning refuses while any ticket is claimed or mid-ladder, whether or not `--replan` was passed, and refuses before any model spend.", "`writePlan` decides and validates the whole plan in memory before it writes or deletes anything; a DONE bootstrap is preserved rather than re-created; a preserved ticket's blocker that the new plan does not name is dropped in both the file and the artifact; a DONE id the new plan reuses for different work is kept and flagged.", "The SLICE artifact and the PLAN draft each get one relaunch carrying the validator's own words, and a failure names the slice and says the finished slices are cached.", "A slice's cache key holds what determines that slice, not the whole analysis or every earlier ticket id; the cache is schema-validated on read; a cached slice whose external dependencies are gone re-plans; a slice cached without a review verdict says so at approval.", "Deleting `.detent/plan/` re-runs PLAN from the slice caches instead of reporting READY over an empty directory.", "An init session with no telemetry trips the S-4 breaker instead of being reported as a missing artifact, and a config that cannot be read fails init instead of silently defaulting."]
non_goals: ["Does not add a timeout or a turn ceiling to init sessions. X-1″ removed the turns ceiling deliberately; a hung session remains an operator concern and is recorded as a known risk.", "Does not bound the number of slices. Size stays planning judgement (A-1); SLICE now reports the count and the session range before PLAN spends.", "Does not cache the whole-plan review or its revisions. That stage still re-runs after any failure downstream of it.", "Does not change the interrupt set, the phase list, or any artifact schema version."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-084", "PRDR-085", "PRDR-101", "PRDR-116", "PRDR-117"]
depends_on: ["PRDR-117"]
---

# PRDR-118 — the slicing layer trusted the model with file names, graphs, and one-shot artifacts

**Severity:** major · **Category:** correctness · **Found by:** an audit of PRDR-117 requested
before its first paid run against a large product, 3 September 2026

## What happened

PRDR-117 built the layer that plans a whole product slice by slice. Before pointing it at a
real repository — a run of roughly forty to a hundred and fifty model sessions over several
hours — the user asked for it to be audited and confirmed bug free. It was not.

The defects share one root: the layer multiplied the number of places a model's output is
taken at face value, and the checks around those places had been written when there was one
draft, not sixty.

**Ids.** `nonEmptyString` accepted anything. A drafted id of `../../package` was joined onto
the plan directory and written through, outside the repository. Two ids differing only in
case are one file on macOS: the plan claimed three tickets, the disk held two, and the pool
deadlocked on a ticket the plan insisted existed. `plan` and `approval` overwrote the plan
artifact and the approval record.

**Graphs.** Nothing anywhere looked for a dependency cycle — not the draft validator, not
`planSchema`. Two tickets naming each other reached disk intact, and `ready()` then never
offered them, with nothing reporting why.

**Ordering.** `capstoneBlockers` treated a ticket's own edge into an earlier slice as
satisfying that slice's order. The planner is explicitly told to name the specific ticket it
needs, so this is the commonest shape a plan takes — and it silently removed the ordering
guarantee that is the point of slicing.

**Destruction.** The refusal to re-plan under a claimed or mid-ladder ticket ran only for
`--replan`. Every other route was unguarded, including the one PRESENT itself recommends:
answer a question in a planning document while a run executes, re-run `detent init`, and PLAN
resets the ticket a session is working in.

**Fragility.** `planDraftSchema` is strict and had no retry. A twenty-slice product asks for
thirty to sixty independent strict artifacts; at a one-percent chance of one stray key,
better than a third of runs abort hours in, with an error naming neither the slice nor the
fact that the finished slices were cached.

**Silence.** A whole-plan review that produced no verdict was one line on stdout and a
successful init. A slice cached without a review verdict was reused forever. A session that
died in transport returned success with $0 recorded. A corrupt config silently widened
planning scope to the whole repository.

## Evidence

C-2‴ states the ordering guarantee this had removed:

> Order is enforced in the written plan: a ticket with no edge of its own into the slice it
> thickens is blocked on that slice's capstones — the tickets nothing else in it depends on —
> so a slice cannot start before the ones it builds on are DONE.

And PRDR-116 had already established the retry principle, one level too low:

> An absent or unusable review artifact buys one relaunch carrying the validator's own words,
> exactly as a code review does (A-5′).

## Resolution

Eight amendments: F-1′ (a ticket id is a file name), A-1″ (the drafted graph is repaired —
renames, dropped edges, broken cycles — each repair a finding), C-2⁵ (an own edge does not
stand in for slice order), C-8″ (the in-flight refusal belongs to re-planning, not the flag),
C-8‴ (a phase may declare its output intact; slice keys narrowed to what determines the
slice; the cache validated on read), C-4⁗′ (one relaunch for every strict planning artifact),
S-4′ (init applies the telemetry breaker), R-9′ (init refuses a config it cannot read).

C-2‴'s own claim about incremental re-planning was corrected: it was false as written,
because the whole ANALYZE artifact sat in every slice's cache key and ANALYZE re-runs, and
differs, on any document edit.

Exercised by `tests/init/plan-write.test.ts` (nine cases over the previously untested write
half), additions to `tests/init/slicing.test.ts`, and `tests/init/slicing-scale.test.ts`,
which plans five hundred tickets across twenty-five slices and asserts the written graph is
acyclic, fully resolved, and executable.
