---
id: PRDR-178
title: "PRDR-170 denied the repro-test write prompts/diagnose.md grants, its surface request was left for the next implement session, and PRDR-172's floor reached one site of three"
state: DONE
severity: critical
category: defect
labels: ["prd-review", "found-by-audit", "security", "containment"]
surface: ["src/schemas/roles.ts", "src/kernel/referee-session.ts", "src/cli/init.ts", "tests/sec/pack.test.ts"]
prd_refs: ["S-1′", "SEC-3", "D-21"]
acceptance_criteria: ["A read-only role may write exactly what its vendored prompt grants: `diagnose` its artifact AND a reproduction test inside the ticket surface; `review` and `research` their artifact alone.", "A surface request written by a read-only role is discarded, never left on disk for the next implement session to consume as its own.", "Every production GuardPolicy carries the SEC-3 structural floor, asserted across the sites rather than at one of them."]
non_goals: ["Does not re-pin the prompts. The kernel was wrong, not the prompt.", "Does not remove `diagnose` from READ_ONLY_ROLES — its tool allowlist is unchanged; only the guard surface is."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-170", "PRDR-172", "PRDR-124"]
depends_on: []
---

# PRDR-178 — a narrowing that denied a promise, and a floor applied once

**Severity:** critical · **Category:** defect · **Found by:** the audit of `0752fef..4f25d31`

## 1. The narrowing denied a write the prompt grants

`prompts/diagnose.md` opens: *"read-only analysis; you may write ONLY your artifact **and a
reproduction test inside the ticket surface**"*. PRDR-170 narrowed every `READ_ONLY_ROLES` member
to `.detent/runs/**`, so that write became a deny — while PRDR-170's own non-goals asserted it
"does not change what a read-only role WRITES". False for `diagnose`. The prompt is hash-pinned, so
`prompts:check` stayed green while prompt and kernel disagreed.

`ARTIFACT_ONLY_ROLES` is now the narrower set — `review` and `research` — and `diagnose` keeps the
surface its contract promises. `READ_ONLY_ROLES` is unchanged, so the tool allowlist is unchanged.

## 2. And its surface request was left for someone else

The hook's deny text names `surface_request.json`, and `handleSurfaceRequest` was skipped for
read-only roles — so the file survived and the NEXT implement session on that ticket consumed it,
widening the implementer's surface from a request it never made, with a grant note reading as
though it had. A read-only role has no surface to widen; the request is discarded now.

## 3. The floor reached one site of three

PRDR-172 added `STRUCTURAL_PROTECTED` to `publishClaimPolicy` and its commit asserted the floor is
what "every other GuardPolicy construction site in production spreads in". `src/cli/init.ts`
carried **three of the fourteen** globs — no `.git/**`, no `.git`, no `node_modules/**`, no
`.detent/ledger.jsonl`, no `.detent/state/**` — under a surface of `**`. Inert for the same reason
PRDR-172's site was inert, which is the reason that fix existed.

PRDR-172's own change also had no test: reverting it left the suite green. The property is now
asserted across all three sites, so the next site that forgets is named by a failing test rather
than by an audit.
