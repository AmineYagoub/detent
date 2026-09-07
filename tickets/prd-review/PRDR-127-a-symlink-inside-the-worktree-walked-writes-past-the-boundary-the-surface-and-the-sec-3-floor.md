---
id: PRDR-127
title: "The containment guard judged the path a session typed, not the path the write lands on: a symbolic link inside the worktree walked past the boundary, the declared surface and the SEC-3 immutability floor alike"
state: DONE
severity: major
category: security
labels: ["prd-review", "found-by-audit", "user-raised"]
surface: ["src/sessions/guard.ts", "src/sessions/sdk.ts", "src/plugin/hook.ts", "tests/sessions/guard.test.ts", "tests/sec/pack.test.ts", "detent-prd-v3.md"]
prd_refs: ["S-2′", "S-2″", "S-2‴", "SEC-3", "D-21", "P7"]
acceptance_criteria: ["Containment is judged against the RESOLVED destination of a path, not its lexical form: the worktree bound, the protected globs and the declared surface all match on the path the write actually lands on.", "A symbolic link whose destination is still inside the worktree is allowed — the destination is judged, never the mechanism — so `node_modules/.bin` and monorepo workspace links keep working.", "Resolution handles a path that does not exist yet, which is the ordinary case for a `Write`: the nearest existing ancestor is resolved and the remaining segments rejoined, and a path with no existing ancestor falls back to its lexical form.", "BOTH sides are resolved. Comparing a resolved target against an unresolved root would call every macOS temp worktree an escape, because `/tmp` is itself a link to `/private/tmp`.", "The resolver is injected with a filesystem-backed default, so the oracle hook tests stay hermetic and a resolver that throws denies rather than falls through.", "A regression test covers each of the three escapes — worktree, surface, protected — against real symbolic links on disk, and each fails without the fix."]
non_goals: ["Does not close the TOCTOU window. A component can become a symbolic link between the decision and the write; that is inherent to a check-then-act hook and is bounded by the kernel re-running verification (P2), not by this.", "Does not deny symbolic links as a class. That would break `node_modules/.bin` and workspace links in every monorepo Detent is meant to work in.", "Does not resolve paths for tool calls that name none. A call with no path still abstains (S-2‴) — this changes where a path points, not which calls the guard governs."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-122", "PRDR-124", "PRDR-126"]
depends_on: []
---

# PRDR-127 — the guard judged the path typed, not the path written

**Severity:** major · **Category:** security · **Found by:** the PRDR-126 audit, named there as a
deliberate non-goal and fixed here, 7 September 2026

## What happened

`guardToolUse` bounded every tool call to the worktree with

```ts
const rel = path.relative(path.resolve(policy.workRoot), path.resolve(policy.workRoot, target));
if (rel.startsWith("..") || path.isAbsolute(rel)) return deny;
```

`path.resolve` normalises `..` segments **lexically**. It does not follow symbolic links. So a
link that lives inside the worktree and points elsewhere produced a `rel` that still looked
inside, and every check downstream was performed against a path the write would never touch.

The audit expected this to be a worktree-boundary problem. Measured against real links on disk,
it is three problems, and the boundary is the least of them:

| via | lands at | verdict before |
|---|---|---|
| `src/escape/target.txt` | outside the worktree entirely | `allow` |
| `src/inward/x.txt` | `forbidden/x.txt`, inside the tree but outside `surface[]` | `allow` |
| `src/cfg/config.json` | `.detent/config.json`, a PROTECTED glob | `allow` |

The third is a straight SEC-3 bypass. The immutability floor is the one guarantee that holds
regardless of what a ticket declares, and a single symbolic link walked through it.

The evasion pack has ten cases and one of them is named **"symlinky nested traversal"**. It is
`/wt/src/a/../../AGENTS.md` — lexical `..` segments, no link anywhere. The pack asserted the
thing it was named for and never tested it, which is the same shape as the invented Serena flag
in PRDR-121 and the reminder's `undefined`-only test in PRDR-126.

## The semantics, decided rather than assumed

**Judge the destination, never the mechanism.** A symbolic link whose target is still inside the
worktree, inside the surface and outside the protected globs is fine and stays fine — otherwise
`node_modules/.bin` and every monorepo workspace link become a denial. What is refused is a link
whose *destination* is somewhere the session may not write.

**Resolve for a path that does not exist yet.** `realpath` throws on a missing path, and a
`Write` creating a new file is the ordinary case. Resolution therefore walks up to the nearest
ancestor that exists, resolves that, and rejoins the remaining segments — so `src/escape/new.txt`
resolves through `src/escape` even though `new.txt` does not exist. A path with no existing
ancestor at all resolves to its lexical form, which is what keeps the oracle tests working
against their fictional `/wt` root.

**Resolve both sides.** On macOS `/tmp` is a link to `/private/tmp`. Comparing a resolved target
against an unresolved `workRoot` would report every temp-directory worktree as an escape — the
fix would have been noisier than the bug.

**Match the globs on the resolved path.** This is what makes the surface and protected repairs
work at all. Had only the boundary been resolved, rows two and three of the table above would
still say `allow`.

## Purity

`guardToolUse` was a pure function, and that is what lets the seven oracle hook tests run with no
session and no filesystem. The resolver is therefore a parameter with a filesystem-backed
default: production call sites pass nothing, tests inject identity or a fake map, and the
existing tests are unchanged because a fictional root has no ancestor to resolve. A resolver that
throws denies — an unestablishable containment is not a passed one.

## What is left open

The TOCTOU window. A path component can become a symbolic link between this decision and the
write it authorises. A check-then-act hook cannot close that, and the honest bound is that the
kernel re-runs verification on the resulting diff (P2) rather than trusting the hook alone.
