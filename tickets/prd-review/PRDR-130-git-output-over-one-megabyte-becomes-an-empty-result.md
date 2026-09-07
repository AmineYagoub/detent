---
id: PRDR-130
title: "Git output above 1 MB throws ENOBUFS and every wrapper converts it into an empty result: the reviewer judges an empty diff, the risk gate goes vacuous, and the base-branch guard deletes every local branch"
state: DONE
severity: major
category: correctness
labels: ["prd-review", "found-by-audit", "user-raised"]
surface: ["src/kernel/git.ts", "src/kernel/review-scope.ts", "src/kernel/referee-context.ts", "tests/kernel/git.test.ts", "detent-prd-v3.md"]
prd_refs: ["P7", "B-4", "A-5", "P2"]
acceptance_criteria: ["`git()` passes an explicit `maxBuffer` large enough that an ordinary diff is never truncated by a default nobody chose.", "A git call that COULD NOT COMPLETE is distinguishable from one that produced no output; `tryGit`'s single `null` no longer means both.", "`changedFiles` and `snapshotRefs` raise rather than returning empty on a failed call — an empty answer from them is a claim about the repository, not an absence of information.", "`enforceBaseGuard` refuses to act on an empty snapshot: a guard with no baseline cannot tell a new branch from every branch, and must not delete refs on that basis.", "A fixture with a diff over 1 MB reaches the reviewer non-empty, and a test asserts local branches survive a failed `snapshotRefs`."]
non_goals: ["Does not change `DIFF_BODY_CAP` or the truncation banner. The banner is correct; the defect is that an empty string never reaches it.", "Does not make every swallowed git error fatal. `tryGit`'s tolerant callers that genuinely mean 'absent is fine' keep that behaviour, explicitly."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-071", "PRDR-091"]
depends_on: []
---

# PRDR-130 — a call that could not run is not a call that found nothing

**Severity:** major · **Category:** correctness · **Found by:** the production-readiness audit
of 7 September 2026 · **Reproduced:** yes

## What happens

`src/kernel/git.ts:21-23`:

```ts
export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
```

Node's `execFileSync` defaults `maxBuffer` to 1 MB and throws `ENOBUFS` above it — confirmed
empirically on the pinned Node v22.23.2. `tryGit` (`:25-31`) catches and returns `null`, and
the wrappers turn that into a benign-looking empty value: `review-scope.ts:26` → `[]`,
`review-scope.ts:51` → `""`, `referee-context.ts:298-300` → `""`.

One default nobody chose, three failures.

## 1. The reviewer judges an empty diff

`""` is under `DIFF_BODY_CAP`, so `referee-context.ts:284` returns it directly and the
"never truncate silently" banner added by PRDR-071 (`:286-297`) never fires. The reviewer is
handed an empty string and asked to judge the ticket against its acceptance criteria.
`contractEvidence` short-circuits too (`contract-verify.ts:32`), so the A-1⁗ evidence
disappears with it.

This is reachable on the very first ticket of any greenfield project: the C-4 bootstrap
ticket has `surface: ["**"]` and commits the project's scaffolding, `package-lock.json`
included — routinely 0.5–3 MB.

`referee-context.ts:230-237` records this exact failure happening live once before —
*"the live reviewer judged 1200 lines of real work as an empty diff, accurately, off the wrong
input"*. The fix then corrected the basis. This is the same outcome reached by a second,
unguarded path.

## 2. The B-4 risk gate goes vacuous

`changedFiles` (`git.ts:231-235`) is the sole input to `closeCheckRisk`
(`referee-gate.ts:86-95`). Two `tryGit` calls, both `?? ""`. If either fails, the changed-file
list is empty, `touched.length > 0` is false, no `RISK_LABEL_REQUIRED` is minted, and a diff
touching the operator's declared risk globs is finalized to DONE without the human approval
B-4 exists to require.

## 3. The base-branch guard deletes every local branch

`snapshotRefs` (`git.ts:135-145`) returns an **empty map** when its single `for-each-ref` call
fails, and `RefereeContext` snapshots once at construction (`referee-context.ts:143`).
`enforceBaseGuard`'s second loop (`git.ts:178-195`) — *"a brand-new non-run branch created by
a session is also a write"* — then matches `!snapshot.has(ref)` for **every** existing branch,
`main` included, and runs `git update-ref -d` on each.

A swallowed git error at construction time turns the guard that protects the base branch into
the thing that deletes it. This is the only unrecoverable path in the set, and it is the one
to write a test for first.

## The shape of the fix

`maxBuffer` is the easy half and does not, on its own, fix anything: the wrappers would still
convert a *spawn* failure, a locked index or a permissions error into the same empty answer.
The load-bearing half is that `tryGit` stops using one `null` for two different facts. Each
caller then decides, in the open, which one it meant.
