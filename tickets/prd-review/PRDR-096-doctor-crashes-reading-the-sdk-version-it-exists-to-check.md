---
id: PRDR-096
title: "doctor crashes reading the SDK version it exists to check, so the S-5 pin check has never run"
state: DONE
severity: major
category: correctness
labels: ["prd-review", "user-raised", "found-by-execution"]
surface: ["src/cli/doctor.ts", "tests/cli/doctor.test.ts"]
prd_refs: ["S-5", "SEC-2"]
acceptance_criteria: ["`detent doctor` reports the installed agent-SDK version without throwing, on a normal install where the SDK's `exports` map does not expose `./package.json`.", "An unreadable manifest yields \"unknown\" rather than an exception — the honest value `init` already records for an unreadable CLI, and something the pin check can report on.", "A test exercises the REAL probe with no `installedSdkVersion` injection, so the path that shipped broken is covered."]
non_goals: ["Does not change what S-5 pins or how the pin is compared.", "Does not add a runtime dependency to read the manifest (SEC-2): resolution stays local to node_modules."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-096 — doctor crashes reading the SDK version it exists to check

**Severity:** major · **Category:** correctness · **Raised by:** the user, reporting the
crash · **Found by:** execution

## Problem

```
Package subpath './package.json' is not defined by "exports" in
node_modules/@anthropic-ai/claude-agent-sdk/package.json
```

`installedSdk()` called `require("@anthropic-ai/claude-agent-sdk/package.json")`. Modern
packages gate subpaths behind an `exports` map, and this one does not list
`./package.json`, so Node refuses the resolution and throws. `detent doctor` — the command
whose entire job is to report on the environment — died reporting on it.

The severity is not the crash. It is that **the S-5 pin check has never once executed on a
real install.** Every test in `tests/cli/doctor.test.ts` injects `installedSdkVersion`,
so the suite was green against a probe that could not run, and the one check standing
between a silently-upgraded backend and a release had no coverage of its own input.

## Resolution

Resolve the package's entry point with `require.resolve` and walk up to the nearest
`package.json` whose `name` matches, reading it with `fs`. That needs no `exports` entry.
An unreadable manifest returns `"unknown"` rather than throwing — the same honest value
`init` records for an unreadable CLI, and a value the pin check can report on instead of
crash on.

`tests/cli/doctor.test.ts` gains a case that omits the injection, so the real probe is
exercised. It now reports `pinned 0.3.191 == installed 0.3.191` — the first time that
comparison has actually been made.
