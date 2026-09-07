---
id: PRDR-159
title: "baseReflogWrites drops every reflog entry written without a message, so the guard's own restore — and a tamper via update-ref — count as zero"
state: OPEN
severity: major
category: defect
labels: ["prd-review", "found-by-audit", "metric-integrity"]
surface: ["src/kernel/git.ts", "tests/sec/pack.test.ts"]
prd_refs: ["D-14", "B-5"]
acceptance_criteria: ["A base ref that was moved and restored during a run is counted as a write by the §14 metric, which is what its docstring already promises.", "A base tamper performed with `git update-ref` alone — no commit, no checkout — is counted, rather than reporting a base that demonstrably moved as untouched.", "The regression test observes the metric go from wrong to right, and is checked against a mutant that forgives reverted writes so it cannot pass for the old reason."]
non_goals: ["Does not change what enforceBaseGuard RESTORES. The restore is correct; only its visibility to the metric is at issue.", "Does not widen the metric to non-base refs."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-153"]
depends_on: []
---

# PRDR-159 — the metric cannot see the writes it was built to count

**Severity:** major · **Category:** defect · **Found by:** the audit of `7d9526c`

## Problem

`baseReflogWrites` reads `git reflog show --format=%gs` and filters empty lines before counting.
Its docstring says the count includes reverted writes, "the guard's own restore is honest evidence
that a write happened".

`git update-ref` without `-m` writes a reflog entry whose message is EMPTY. `enforceBaseGuard`
restores with a bare `git update-ref`, so its own restore is filtered out by the very function that
claims to count it. Probed directly — two commits, then two bare `update-ref` moves:

```
total reflog entries : 4
%gs lines            : "", "", "commit: second", "commit (initial): init"
non-empty            : 2   -> the metric returns 2 - 1 = 1
```

The 1 is the second *commit*. Both `update-ref` writes are invisible.

The consequence beyond the docstring: a session that tampers with the base branch using
`update-ref` alone leaves only empty-message entries, and the metric reports **0** for a base that
moved and came back. The rewritten reflog test in `7d9526c` asserts `toBeGreaterThan(0)` and is
satisfied entirely by the hostile commit's own entry, so it passes while the property it is named
for still holds nowhere.
