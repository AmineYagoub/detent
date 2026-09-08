---
id: PRDR-172
title: "Four tests that passed for the wrong reason, a driver policy missing the structural floor, and an S-6 doc comment describing a detector the architecture cannot support"
state: OPEN
severity: major
category: weak-test
labels: ["prd-review", "found-by-audit", "vacuous-test"]
surface: ["tests/oracle/budgets.test.ts", "tests/perf/transition-overhead.bench.ts", "tests/kernel/flake.test.ts", "tests/docs/golden-path.test.ts", "src/kernel/budgets.ts", "src/kernel/referee-context.ts", "src/kernel/referee-session.ts"]
prd_refs: ["P6", "SEC-3", "S-6", "N-4", "C-11"]
acceptance_criteria: ["Each of the four assertions fails against the mutation the audit used to prove it weak.", "Every GuardPolicy built in production carries the SEC-3 structural floor, including the driver policy that is inert only by coincidence.", "No doc comment claims a behaviour the architecture cannot produce."]
non_goals: ["Does not make `quarantineTicket` validate its decision at runtime. The guarantee there is the type; the test now says so instead of pretending otherwise."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-142", "PRDR-150"]
depends_on: []
---

# PRDR-172 — the mutations that proved them weak, turned into the assertions

**Severity:** major · **Category:** weak-test · **Found by:** the full-project audit of `0752fef`

## The four tests

**`budgets.test.ts` — prose vouching for code.** "Every ceiling's named enforcement site actually
reads it" was `expect(source).toContain(key)` over the whole file, comments included. Replacing the
real read with a hardcoded value while leaving the adjacent JSDoc — which happens to name the key —
kept it green. Comments are stripped now, and that immediately surfaced a real mismatch:
`ENFORCEMENT_SITES` named `kernel/ledger` for `run_spend_usd`, but `SpendLedger` is HANDED a number
and the only occurrence of the key in that file is prose. `kernel/referee-context` is where
`budgets.run_spend_usd` is actually read.

**`transition-overhead.bench.ts` — a tautology.** `covered` was built by re-mapping the same `rows`
array through `transitionKey`, a lossless round trip, so `covered.size === TABLE.size` held by
construction. Gutting the timed loop into a no-op left the "sanity" check passing. It counts what
the loop recorded now.

**`flake.test.ts` — a call that never ran.**
`expect(() => quarantineTicket(…)).toBeTypeOf("function")` is true of any arrow expression, so the
call inside never executed; making `quarantineTicket` throw unconditionally left it green. It read
as a runtime refusal and is not one — a laddered decision produces a ticket with `undefined` fields
rather than an error. The guarantee is the TYPE, so the `@ts-expect-error` is now the assertion and
the real quarantine route is asserted beside it.

**`golden-path.test.ts` — digits, not pairs.** The README exit-code check asserted four
backtick-wrapped digits appeared somewhere in the file. Scrambling all four rows so every code
named the wrong outcome left it green, under the title "the README documents C-11's exit codes as
public API". Each row is matched to its constant now.

## And two claims that were false

`RefereeContext.publishHookPolicy` omitted `STRUCTURAL_PROTECTED`, which every other GuardPolicy
construction site spreads in. Inert today only because the ambient hook's `driver: true` branch
denies every path'd call before `protectedGlobs` is consulted — so relaxing that branch would leave
`.git/**` and `node_modules/**` unprotected for this policy alone.

`rememberPrefix`'s comment called it "the check that catches a prompt file edited mid-flight".
`prefixFor`'s three inputs are all `readonly`, assigned once in a constructor that runs once per
run, so the mismatch branch is unreachable by construction; editing `AGENTS.md` mid-run was
observed to neither throw nor be noticed. S-6 in the PRD is a prompt-CACHE-efficiency invariant,
not a file-edit detector. The comment now describes what the assertion is: a tripwire on that
assumption.
