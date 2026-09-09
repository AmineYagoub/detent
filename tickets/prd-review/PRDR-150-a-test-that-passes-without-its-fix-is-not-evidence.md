---
id: PRDR-150
title: "Four fixes shipped with a test that would have passed without them — V-6 makes the tree prove otherwise"
state: DONE
severity: major
category: design
labels: ["prd-review", "found-by-audit", "verification", "recovered"]
surface: ["src/kernel/falsify.ts", "src/kernel/referee-stage.ts", "tests/kernel/falsify.test.ts"]
prd_refs: ["V-6", "A-1⁗", "B-5"]
acceptance_criteria: ["After a green gate, when a ticket's diff touches both source and test files, the source half is reverted, the bound test gate re-runs, and the tree is restored.", "Tests that stay green are NAMED TO THE REVIEW beside A-1⁗'s contract evidence — evidence, never a gate.", "`git apply -R` refuses cleanly rather than half-applying; the restore is in a `finally`; a dirty tree reports \"could not revert\" instead of guessing.", "The test-path heuristic is wrong in the harmless direction: a file it misses means no probe, never a false accusation."]
non_goals: ["Not a hard gate. A check whose false-positive rate has not been measured must not be able to fail a ticket; the path to a gate is walked after the signal has been observed on real runs."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-143", "PRDR-149", "PRDR-192"]
depends_on: []
---

# PRDR-150 — a test that passes without its fix is not evidence

**Severity:** major · **Category:** design · **Found by:** the falsification audit (`c7de4b9`)

> **Recovered 2026-09-09 (PRDR-192).** Filed as an empty file — the filename carried the
> title and nothing else was ever written. Its reasoning survived in the commit that created
> it, and this body is that account. Fields the original never recorded are derived from
> evidence, not invented.

## The measurement

Auditing this line's fixes found more than auditing its original code did:
**~1 defect per 100 lines of original 3.1.1 code, ~1 per 44 in the fixes for those defects** —
written by an author actively hunting that class, on the same day, and landing in the code
that matters by definition.

Three of the audit's critical blockers had a passing test asserting the property they violated:

- SEC-4 asserted against a function production never called.
- The git-hooks evasion passed because the test's own policy carried the glob the product
  lacked.
- The symbol reminder was only ever tested with an input production cannot produce.

And the remediation repeated it: the SEC-5′ test passed because its fixture was already
CI-safe, so the normalization mismatch it should have caught was a no-op inside it.

**All four are one mechanical property — a test that would pass WITHOUT the change it ships
with — and Detent already owns every input needed to check it.**

## The probe

After a green gate, when a ticket's diff touches both source and test files, the source half is
reverted, the bound test gate re-runs, and the tree is restored. Tests that stay green are
named to the review beside A-1⁗'s contract evidence.

## Evidence, never a gate

That is the A-1⁗ precedent and it is deliberate. A check whose false-positive rate has not been
measured must not be able to fail a ticket, and there are honest reasons a test stays green —
it guards against over-correction rather than reproducing a defect (this line shipped three of
those, labelled as such), or the revert did not reach what it exercises. **A reviewer weighs
that in a sentence; a red build cannot.**

## Its failure mode got more attention than its success

The probe mutates the working tree. So: `git apply -R` refuses cleanly rather than
half-applying, the restore is in a `finally`, a dirty tree reports "could not revert" instead
of guessing, and a missed restore is bounded by B-5's dirty-tracked reset on the next claim.
Its own test asserts the restore across pass, fail and a throwing runner.
