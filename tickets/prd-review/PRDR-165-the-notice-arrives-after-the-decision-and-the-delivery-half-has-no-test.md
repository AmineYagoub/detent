---
id: PRDR-165
title: "verify sync reports the vacuous gate after the operator has consented and after the baseline is written, and no test fails when the delivery hop is deleted"
state: DONE
severity: critical
category: defect
labels: ["prd-review", "found-by-audit", "delivery-gap"]
surface: ["src/cli/verify.ts", "src/adapter/bind.ts", "src/init/present.ts", "tests/init/vacuous-gate.test.ts"]
prd_refs: ["V-1‴", "V-3", "C-6a", "V-6"]
acceptance_criteria: ["A bound gate that verifies nothing appears in the text the operator is shown BEFORE they consent to a re-baseline, and before `bindings.json` is rewritten — not in output printed after both.", "Every delivery hop for this notice has a test that fails when the hop is removed: the PRESENT pipeline spread, the `verify sync` summary, and the `redact: scrub` beside it. A hop asserted one layer below itself is the defect this feature has now shipped three times.", "The whitelist lookup cannot succeed for a name nobody enumerated."]
non_goals: ["Does not make the notice a refusal. V-3 already requires consent; this is about what the consent is informed by."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-163", "PRDR-156", "PRDR-164"]
depends_on: []
---

# PRDR-165 — delivered, after the decision it was for

**Severity:** critical · **Category:** defect · **Found by:** the audit of `18ea906`

## Problem

PRDR-163 fixed the PRESENT half of this with the justification, written into
`src/init/present.ts`: the operator "saw the warning on the first `init` and never again,
**including in the summary they actually approve**". Two files over, in the same commit and under
the same ticket, the `verify sync` half puts the notice somewhere the operator cannot see it until
the decision is already made:

```
src/cli/verify.ts:72   for (const notice of report.notices) messages.push(notice);
src/cli/verify.ts:91   if (!(await deps.consent(summary))) { … }      <- the human decides here
src/cli/verify.ts:97   writeBindings(root, …)                          <- the baseline is rewritten here
src/cli/verify.ts:177  for (const message of result.messages) …        <- the notice is printed here
```

The text the human actually approves is `renderSyncSummary(summary)`, which carries drift rows and
proposed bindings and nothing else. Measured on a repo whose `test` script was swapped from a real
command to `echo no-tests-here`: the consent prompt contains no notice; the notice appears after
`rebaselined: true`.

`sync` is the one path whose entire purpose is accepting a **changed** verification binding, which
is exactly where a real gate can be replaced by a vacuous one. PRDR-163's own acceptance criterion
reads "reports a bound gate that verifies nothing **rather than silently re-baselining it**". It
re-baselines, then reports.

## The second half: no hop has a test

Three hunks in `18ea906` can be deleted with the suite still green — the PRESENT pipeline spread
(`src/init/pipeline.ts`), the `redact: scrub` in `verify.ts`, and the body-length cap. The PRESENT
test composes `renderPresentation(presentInputsFromOutputs(…))` by hand and never goes through
`presentPhase.run`, which is the hop that carries it. That is verbatim the critique `18ea906`'s own
message levels at PRDR-156: *"asserted on `report.notices` at the ADAPTER layer, one level below
the hop that dropped it"*. Third consecutive round in which this exact class is the defect.

## Third: the whitelist is not quite one

`COMMAND_REGION[candidate.adapter]` is a plain object, so bracket access consults the prototype
chain: an adapter named `constructor`, `toString`, `valueOf`, `hasOwnProperty` or `__proto__`
yields a non-`undefined` `shape`, skips the guard and takes the recipe branch. No engine emits such
a name, so it is latent — but a lookup that silently succeeds for eight names nobody enumerated is
a blacklist wearing a whitelist's clothes, which is the thing the ticket said it was replacing.
