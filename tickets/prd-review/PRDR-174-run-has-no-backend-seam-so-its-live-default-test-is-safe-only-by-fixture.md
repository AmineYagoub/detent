---
id: PRDR-174
title: "detent run has no injectable backend, so the test asserting its live-by-default is kept safe only by a fixture that happens to seed no tickets"
state: OPEN
severity: major
category: weak-test
labels: ["prd-review", "found-by-audit", "spend", "vacuous-test"]
surface: ["src/cli/run.ts", "tests/cli/run-backend.test.ts", "tests/plugin/parity.test.ts"]
prd_refs: ["C-14″", "X-1", "ARCH-2"]
acceptance_criteria: ["`npm test` cannot reach a real billed session through `detent run`, and the thing preventing it is a dependency rather than a property of a shared fixture.", "The C-14″ property — with no flag, `main` builds the LIVE backend — is asserted directly rather than inferred from a journal string that only holds when nothing is injected.", "Cross-driver parity's actual coverage is stated in the file that claims it."]
non_goals: ["Does not close the cross-driver failure-path gap. That needs the skill driver to execute its ladder rows against a failing gate — a harness build, recorded rather than half-done."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-158", "PRDR-162", "PRDR-129", "PRDR-140"]
depends_on: []
---

# PRDR-174 — live by default, safe by coincidence

**Severity:** major · **Category:** weak-test · **Found by:** the full-project audit of `0752fef`

## Problem

`tests/cli/run-backend.test.ts` calls the real CLI with no `--backend`, so the live backend is the
default (C-14″, correct). The only thing standing between that call and real billed sessions is
that `makeRunRepo()` seeds **zero tickets**. Adding one — `addTicket(root, {id: 't-1'})` — makes
the identical `runMain([root])` reach `ClaudeCodeBackend.prototype.run` three times. There is no
global `DETENT_NO_LIVE` enforcement anywhere in the suite: no `vitest.config.ts` setupFiles, no
globalSetup, no CI env var.

`doctor` was given an injectable seam for exactly this hazard by PRDR-158/162. `run`'s `main()` had
none, so the same structural hardening was impossible without a source change first — which is why
the audit could only name it rather than propose a fix in the test alone.

The test now runs **with** a ticket, deliberately, so the pool is genuinely exercised, and the
builder is injected so it can never spend however the fixture evolves. The C-14″ property is
asserted directly (`built === 1`) rather than inferred from the journal's `"claude-code"` string,
which only ever held because nothing was injected.

## Recorded, not fixed

Cross-driver parity (`tests/plugin/parity.test.ts`) drives two tickets that both complete cleanly,
so ARCH-2 is proven on the all-green path only. The model driver's BREACH/DRIFT_HALT/resume code is
exercised by no test: planting a divergent BREACH-handler reason string — the shape of the
historical PRDR-140 divergence — leaves the suite green. Closing it needs the skill driver to run
its ladder rows against a failing gate, which is a harness build. The gap is now stated in the file
that claims the property.
