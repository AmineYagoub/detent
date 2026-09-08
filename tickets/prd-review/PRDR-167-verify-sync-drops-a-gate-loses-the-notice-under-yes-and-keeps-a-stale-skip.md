---
id: PRDR-167
title: "verify sync silently drops an unbound gate, shows the vacuous-gate notice nowhere under --yes, and carries a stale skip forward for a slot it just bound"
state: OPEN
severity: critical
category: defect
labels: ["prd-review", "found-by-audit", "verification-integrity"]
surface: ["src/cli/verify.ts", "tests/adapter/drift.test.ts"]
prd_refs: ["V-1", "V-1‴", "V-3", "P2", "C-6a"]
acceptance_criteria: ["A slot that loses its candidate during `verify sync` is either refused (when it is setup-required) or recorded as an acknowledged skip — never dropped from both `bindings` and `skips`, which leaves a gate nothing runs and nothing records.", "The vacuous-gate notice reaches the operator on the `--yes` path, which is the one path with no human at a terminal. Being in the consent summary is not enough when consent is auto-granted.", "A slot that was skipped and is now bound does not remain in `skips`. `bindings` and `skips` are disjoint after a sync."]
non_goals: ["Does not make the notice a refusal. V-1‴ is evidence; the operator may accept a fast zero-exit gate deliberately.", "Does not change what `verify sync` re-derives — all six slots, exactly as now."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-165", "PRDR-163", "PRDR-135"]
depends_on: []
---

# PRDR-167 — the recovery command for verification drift, losing verification

**Severity:** critical · **Category:** defect · **Found by:** the full-project audit of `0752fef`

## 1. An unbound slot vanishes from the record entirely

`verifySync` re-derives all six `GATE_SLOTS` through `bindAll` and **never reads `report.unbound`**.
The write is `writeBindings(root, { bindings: [...report.bindings], skips: stored.skips })` — fresh
bindings, and the OLD skips carried forward untouched. A slot whose config disappears and has no
replacement candidate is in neither list.

`src/init/bind.ts` gets this exactly right two files over: `report.unbound` is filtered against
`SETUP_REQUIRED_SLOTS` into a blocking interrupt, and every remaining slot becomes an
`acknowledgeSkip`. `verify.ts` has none of that logic. Downstream, `runScopedGates` skips an
unmatched slot without consulting `skips`, and `run`'s startup check validates `test` alone — so a
`lint` that vanishes this way is gone with no record anywhere, and tickets reach DONE having never
run it.

The operator is *told to run this command*: the drift summary's own remediation text names
`detent verify sync`.

## 2. Under `--yes` the vacuous-gate notice is shown nowhere at all — and this is a regression

PRDR-165 moved the notice out of `messages` and into `SyncSummary`, so it appears in the text the
operator consents to. `main`'s non-interactive branch returns `true` **before**
`renderSyncSummary` is ever called, and nothing else prints it. So:

| commit | `--yes` behaviour |
|---|---|
| `18ea906` | notice printed to stdout, after the decision |
| `0752fef` (PRDR-165) | notice printed **nowhere** |

The fix for the TTY path made the unattended path strictly worse, on the one path where nobody is
watching a terminal. `main(["sync", root, "--yes"])` against a repo whose test script is
`echo 'no tests here'` exits 0 with stdout exactly `re-baselined 1 binding(s).` and empty stderr.

The notice belongs in both places: in the summary because that is the decision, and in `messages`
because that is the log.

## 3. A stale skip survives a slot being bound

`skips: stored.skips` is carried forward unfiltered, so a slot once acknowledged-skipped and later
given a real candidate ends up listed as bound **and** skipped. `bindingTable()` renders it twice.
Audit metadata rather than a gate, but it is a persisted contradiction in a committed artifact.
