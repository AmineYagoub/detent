---
id: PRDR-163
title: "The required redactor is defeated by an optional option one frame up, there is a second bindAll caller that does not pass it, and verify sync discards every notice"
state: OPEN
severity: major
category: defect
labels: ["prd-review", "found-by-audit", "unreachable-feature"]
surface: ["src/adapter/bind.ts", "src/cli/verify.ts", "src/init/present.ts", "src/init/pipeline.ts"]
prd_refs: ["V-1‴", "SEC-4"]
acceptance_criteria: ["No caller of `bindAll` can omit the redactor and get an identity default. The type system names every caller that would.", "`detent verify sync` — the one path whose purpose is accepting a CHANGED verification binding — reports a bound gate that verifies nothing rather than silently re-baselining it.", "The notice survives a resumed `init`. A phase output written once and read by nothing is not delivery: `init` interrupts at AWAIT_APPROVAL and almost always resumes, and a reused phase never calls `run`."]
non_goals: ["Does not make the notice a refusal."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-156"]
depends_on: []
---

# PRDR-163 — required, except where it is called

**Severity:** major · **Category:** defect · **Found by:** the audit of `bdafdb5`

## Problem

Three faults, one theme: a guarantee asserted at the layer that cannot enforce it.

**1. The requirement is void one frame up.** `vacuousGateNotices` takes `redact` as a required
parameter, and its docstring says "REQUIRED, not defaulted to identity: … a default that does
nothing is a default that leaks." `BindOptions.redact` is then optional and `bindAll` supplies
`opts.redact ?? ((t) => t)` — so at the only entry point production uses, the default is exactly
the one the docstring forbids.

**2. The comment naming the sole caller is false.** `src/adapter/bind.ts` says
"`src/init/bind.ts` — the only production caller". `src/cli/verify.ts` is the second, routed from
`src/cli/index.ts`, and it does not pass `scrub`. Reproduced with the option object `verify.ts`
builds: the notice comes back carrying a raw `ghp_…` token.

**3. And `verifySync` discards `report.notices` entirely** — `SyncResult` has no such field. So
`detent verify sync` will re-baseline a gate whose entire body is `echo …` and say nothing, on the
one path that exists to accept a changed binding, which is exactly where a real gate could be
swapped for a vacuous one. The obvious repair — surface the notices — prints an unscrubbed secret,
because fault 1 makes the omission silent.

**4. And on the `init` path the notice is delivered exactly once, ever.** `gate_notices` is written
and read by nothing; `presentPhase` does not render it. A reused phase never calls `run`, and
`init` interrupts at AWAIT_APPROVAL, so every resume shows the operator a PRESENT summary with no
notice in it. PRDR-156 fixed the `note` hop and left the half its own commit message named.
