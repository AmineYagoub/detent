---
id: PRDR-245
title: "A case variant of a protected path whose directory does not exist yet is allowed, and on a case-insensitive filesystem it writes the protected file"
state: DONE
severity: critical
category: security
labels: ["prd-review", "found-by-audit", "containment", "SEC-3", "case-folding"]
surface: ["src/sessions/guard.ts", "tests/sec/case-fold.test.ts"]
prd_refs: ["SEC-3", "SEC-3′", "S-2⁗", "D-21"]
acceptance_criteria: ["A path matching a protected glob under ASCII case folding is denied for mutation, whether or not any part of it exists on disk.", "The comparison is case-insensitive for `protectedGlobs` and stays case-sensitive for `surface`: folding the protected side can only deny more, folding the surface side would grant more.", "The refusal does not depend on the host filesystem being case-insensitive, so the behaviour CI exercises on Linux is the behaviour macOS gets.", "A test drives the production resolver — no injected identity resolver — against a root shaped like a fresh per-ticket worktree, where `.detent/` and `node_modules/` do not exist, and fails on today's tree."]
non_goals: ["Does not make `surface` matching case-insensitive; a case variant of an in-surface path stays denied as out-of-surface, which is the harmless direction.", "Does not attempt Unicode case folding or normalisation; the protected floor is ASCII and the fold is ASCII.", "Does not change `realpathNearest`, which is correct for what it promises — it canonicalises the EXISTING prefix and says so.", "Does not detect the host filesystem's case sensitivity; a branch that only runs off-CI is how this class survives."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-127", "PRDR-132", "PRDR-145b", "PRDR-149"]
depends_on: []
---

# PRDR-245 — the protected floor has a case-shaped hole

## Problem

`guardToolUse` judges the RESOLVED destination (S-2⁗, PRDR-127), and `realpathNearest`
resolves it by walking up to the nearest ancestor that exists, canonicalising THAT with
`realpathSync.native`, and rejoining the remaining segments lexically. Its doc-block says
exactly this and is honest.

The consequence it does not draw: `realpathSync.native` case-folds only what exists. When no
part of a protected path is on disk, nothing is canonicalised, the typed case survives into
`matchAny`, and `matchAny` is case-sensitive picomatch. So a case variant of a protected
path is not protected.

Observed with the production resolver, `surface: ["**"]`, `protectedGlobs:
STRUCTURAL_PROTECTED`, against a root containing `.git/` but not `.detent/` or
`node_modules/`:

```
deny     node_modules/lodash/index.js
allow    NODE_MODULES/lodash/index.js
deny     .git/hooks/pre-commit
deny     .GIT/hooks/pre-commit
deny     .detent/config.json
allow    .DETENT/config.json
```

`.git` is denied both ways only because that directory exists in the probe root and is
therefore canonicalised. The two that slip are exactly the two that do not exist.

On a case-insensitive filesystem — macOS by default, which is where this project is
developed — the allowed write then lands on the protected file. `node_modules/**` is
protected because "writing a dependency is writing an executable the gate will run"
(PRDR-149), so this is an execution hole, not a tidiness one.

A fresh per-ticket worktree is precisely the state where `.detent/` and `node_modules/` are
absent, and PRDR-145b made per-ticket worktrees the default.

## Why the earlier retraction missed it

`docs/plan-audit-remediation.md` §5 withdrew a reported case-folding bypass: *"With the
production resolver, `realpathSync.native` canonicalises case for existing paths and every
variant is correctly denied."* The qualifier "for existing paths" is the hole, and the
conclusion was drawn without probing the non-existent case.

## Design decision this records

The fold is applied to `protectedGlobs` and NOT to `surface`. Protected is the deny
direction, so folding it can only refuse more; surface is the grant direction, and folding
it would let `SRC/evil.ts` in under a `src/**` surface on a case-sensitive filesystem.

It is unconditional rather than gated on the host filesystem's case sensitivity. A
conditional guard would put the branch that matters on macOS and never execute it in CI,
which runs `ubuntu-latest` only — that is the shape of defect this repository keeps finding,
and it would also make the test platform-dependent. Unconditional folding costs a real
over-denial only for a path that case-varies a member of a small fixed floor
(`.git`, `.detent/**`, `node_modules/**`, ticket criteria), which nothing legitimately does.

## Falsification (verification protocol, item 1)

`tests/sec/case-fold.test.ts`, written before the fix and run against `356db69`:

```
× SEC-3 a case variant of a protected path is protected > denies a case variant of a
  protected path whose directory does not exist
  → writing a dependency is writing an executable the gate will run (PRDR-149):
    expected 'allow' to be 'deny'
```

Both control cases passed unchanged at that commit: `.GIT/hooks/pre-commit` was already
denied, because `.git/` exists in the fixture and `realpathSync.native` folds it, and that
is exactly what made the hole look closed to the retraction in §5 of the remediation plan.

The test's third case was rewritten before the fix. It first asserted that
`SRC/evil.ts` is DENIED under a `src/**` surface through `guardToolUse`, and that failed —
correctly. On a case-insensitive filesystem `SRC/evil.ts` IS `src/evil.ts` once `src/`
exists, `realpathSync.native` folds it, and ALLOWING it is right: the session is writing
inside its surface. The guard's answer there is legitimately platform-dependent and must not
be pinned, so the no-folding-on-the-grant-side property is asserted on `matchAny` directly,
where it holds on every platform.

## What changed

`matchAny` takes `{ nocase }`, defaulting off, and only the `protectedGlobs` call site
passes it. The fold is ASCII rather than `toLowerCase`, which is locale-sensitive, and it
reaches the literal `clean === bare` comparison only — the glob matches take picomatch's own
`nocase`, so a character class in an operator-supplied `config.protected` pattern is not
rewritten underneath them. `realpathNearest` is untouched.

`hooks/dist/detent-hook.cjs` was rebuilt: the ambient Stop hook bundles this guard, so the
fix ships to it too. The staleness test at `tests/plugin/hook.test.ts` caught the forgotten
rebuild, which is the second time this session a gate outside CI has caught a real mistake.
