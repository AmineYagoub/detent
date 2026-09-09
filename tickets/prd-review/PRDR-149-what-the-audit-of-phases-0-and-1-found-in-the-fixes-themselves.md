---
id: PRDR-149
title: "Eight defects in the fixes themselves, several reproducing the exact harm their own commit message claimed to remove"
state: DONE
severity: critical
category: bug
labels: ["prd-review", "found-by-audit", "security", "recovered"]
surface: ["src/adapter/drift.ts", "src/schemas/common.ts", "src/sessions/env.ts", "src/sessions/live.ts", "src/cli/referee.ts", "src/plugin/hook.ts", "src/kernel/referee-session.ts"]
prd_refs: ["SEC-5′", "SEC-3", "SEC-4", "D-27″"]
acceptance_criteria: ["The drift check compares like with like — normalized against normalized — so a default `\"test\": \"vitest\"` does not halt an untouched repository on its first gate.", "A `provisional` status does not exempt a binding from having the command discovery found.", "`isConcreteRepoPath` is a WHITELIST, and `coversProtected` asks the question the other way round.", "The structural floor reaches all four policies, including the `live.ts` and `referee.ts` construction fallbacks.", "The env allowlist carries the git identity, so an implement session holding `Bash(git commit:*)` can commit.", "The Stop path emits Detent's own constant, pinned to the referee's by a test; an absent expiry is expired on BOTH paths; policy reads are bounded to a regular file of bounded size."]
non_goals: ["Treating an unparseable policy file as absent was proposed and REVERTED after weighing it — see below. Fail-closed stays."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-132", "PRDR-134", "PRDR-148", "PRDR-150", "PRDR-192"]
depends_on: []
---

# PRDR-149 — auditing the fixes found more than auditing the code

**Severity:** critical · **Category:** bug · **Found by:** the audit of phases 0 and 1 (`5489234`)

> **Recovered 2026-09-09 (PRDR-192).** Filed as an empty file — the filename carried the
> title and nothing else was ever written. Its reasoning survived in the commit that created
> it, and this body is that account. Fields the original never recorded are derived from
> evidence, not invented.

## Premise

All eight were written the same day, and **several reproduce the exact harm their own commit
message claimed to remove.**

## The two critical ones

**The SEC-5′ drift check compared unlike things.** It compared `binding.resolved` — the
NORMALIZED command `bind.ts` stores — against `Candidate.resolved`, which `discover/types.ts`
documents as the literal command *before* normalization. So `"test": "vitest"`, the default
from `npm create vite`, binds as `npm run test -- --run`, discovers as `npm run test`, and
**halts an untouched repository on its first gate.** `verify sync` cannot clear it: it
re-binds through the same normalizer.

The test written for PRDR-134 passed because its fixture is `"vitest run"`, already CI-safe,
which makes normalization a no-op — **the fixture-chosen-so-the-test-passes pattern, committed
by the session auditing for exactly that.**

**`status: "provisional"` returned exempt before any comparison**, exempt is not in the halting
filter, and `runScopedGates` never reads status. One extra field in a committed
`bindings.json` bypassed the fix whole. The exemption is right in its own terms — a provisional
binding has no baseline to have drifted from — but that does not mean its command need not be
the one discovery found. **One answer was serving two questions.**

## The surface lever, three ways

`isConcreteRepoPath` was a blacklist of `*`, `?`, `[`, `]` — and `"."` contains none of them
while permitting every path in the tree, the exact bypass `**` was blocked for. Extglob and
brace forms walked the same gap. `"./"` made `matchAny` compute an empty pattern and throw on
every later call, persisted onto the ticket. And `.detent` was granted as the floor's parent,
then permitted the run's own spend ledger, **because PRDR-132 unified the list and left the
matchers apart.**

## The rest

- The floor reached two policies and not the other two: `sessions/live.ts` and
  `cli/referee.ts`, the construction fallbacks, had neither `.git` nor the structural set.
- **The env allowlist could not commit.** Implement sessions hold `Bash(git commit:*)`, and
  `GIT_AUTHOR_*`, `GIT_COMMITTER_*` and `GIT_CONFIG_GLOBAL` were stripped, so on the
  subscription-CI path PRDR-148 was written for, every commit fails with "Please tell me who
  you are". PRDR-148 fixed the transport and left the identity.
- **The ambient hook was still steerable by repository content.** The re-feed string was echoed
  verbatim and unbounded into a block reason landing in every session of every plugin user who
  opened the directory. An absent expiry was expired on the Stop path only, one function away
  from PreToolUse. And a committed symlink to `/dev/zero` — git stores mode 120000 quite
  happily — hung every tool call against a 900-second timeout.

## One change reverted after weighing it

Treating an unparseable policy file as absent would remove a repo-plantable denial of service.
But **that DoS is loud and self-describing, while a corrupted policy read as absent stops
containing silently.** Fail-closed stays, and the reasoning is in the code.
