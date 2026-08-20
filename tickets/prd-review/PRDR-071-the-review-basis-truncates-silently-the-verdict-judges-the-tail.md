---
id: PRDR-071
title: "The review basis truncates silently — the verdict judges an 8KB tail"
state: DONE
severity: major
category: consistency
labels: ["prd-review", "found-by-execution"]
surface: ["src/kernel/referee-context.ts"]
prd_refs: ["SEC-3", "D-6", "P2", "S-2"]
acceptance_criteria:
  - "A review span under the cap arrives whole, with no banner."
  - "An over-cap span opens with an explicit truncation banner naming total size and clip size."
  - "The complete changed-file list (tracked stat plus untracked names) always arrives, even when bodies are clipped."
  - "The banner tells the reviewer to read worktree files for full content — actionable because review roles are reads-open (S-2″)."
non_goals:
  - "Does not remove the cap: unbounded diffs into a session prompt trade one dishonesty for a context blowout."
  - "Does not touch the review prompt (hash-locked); the banner is input data, not prompt text."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-069", "PRDR-070"]
depends_on: []
---

# PRDR-071 — the review basis truncates silently; the verdict judges an 8KB tail

**Severity:** major · **Category:** consistency · **Found by:** T-140's live run — the
third input-honesty flaw in the review basis, surfaced by the fix to the first two.

## Problem

`diff()` ended with a bare `.slice(-8000)`. t-103's scoped span was ~25KB across six
files; the reviewer received only the tail — `property.test.ts` and `resolveRed.test.ts`
— and honestly reported the criterion-3 caller-set test "entirely absent" while
`callers.test.ts` (generation 0) and `callers-source.test.ts` (generation 1) sat
truncated off the front. Four verdicts across two generations, every one of them
"the two test files", judged a mangled input carrying no indication it was mangled.
P2's artifacts-only rule cuts both ways: an artifact silently altered in transit is no
longer the artifact.

## Resolution

Truncation must be loud and navigable. The basis now carries: an explicit banner
(total size, clip size), the complete changed-file list — tracked `--stat` plus
untracked names — regardless of size, then bodies clipped to a 32KB cap (8KB dated
from the uncommitted-only era). The reviewer is reads-open in the worktree (S-2″), so
"read the files for full content" is an instruction it can follow. The trilogy closes:
PRDR-069 scoped the span, PRDR-070 completed it, PRDR-071 makes its limits honest.
