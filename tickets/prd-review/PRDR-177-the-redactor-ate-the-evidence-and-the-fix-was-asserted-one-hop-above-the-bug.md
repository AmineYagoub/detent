---
id: PRDR-177
title: "scrub at the appendNote seam corrupted compiler errors, operator guidance and hashed paths; and PRDR-167's regression tests passed with its own defect restored"
state: DONE
severity: critical
category: defect
labels: ["prd-review", "found-by-audit", "security", "vacuous-test"]
surface: ["src/kernel/scrub.ts", "tests/sec/pack.test.ts", "tests/adapter/drift.test.ts"]
prd_refs: ["SEC-4", "V-1", "V-6"]
acceptance_criteria: ["`scrub` redacts every shape it is there for and leaves ordinary diagnostic text intact, asserted in BOTH directions.", "The key name a redaction names survives the redaction, plural included.", "PRDR-167's regression tests read the file the defect writes, so restoring the defect fails them."]
non_goals: ["Does not revert the seam. The security property is real; the redactor's rules were what was wrong.", "Does not loosen the rule a third time for purely numeric values — recorded instead, because that failure is cosmetic and safe."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-169", "PRDR-167"]
depends_on: []
---

# PRDR-177 — a redactor whose output nobody could trust, and a test one hop above its bug

**Severity:** critical · **Category:** defect · **Found by:** the audit of `0752fef..4f25d31`

## 1. The redactor ate the evidence

PRDR-169 put `scrub` on the `appendNote` seam under a comment reading "Scrubbing kernel-authored
text too is harmless, and `scrub` is idempotent." The second half is true. The first is false, and
two defects in `scrub` itself caused it:

- `openai-key` was `/sk-[A-Za-z0-9]{20,}/` with **no word boundary**, so it matched inside words:
  `dist/assets/task-BX9kL2mQz8vN4pR7tY1wS3dF5gH6.js` became `dist/assets/ta[REDACTED].js`, and
  `infra/risk-0123456789abcdef01234567.tf` became `infra/ri[REDACTED].tf`.
- `assignment` matched any six non-space characters after a key word, and its plural `s?` sat
  OUTSIDE the capture group. So `Unexpected token: identifier` and a human's own
  `the token: refresh path` were redacted as credentials, and `tokens: 128374 in` came back
  `token: [REDACTED] in` — redacted *and* silently singularised.

Both defects predate the seam and affected `referee-gate.ts`'s gate output all along. What the seam
changed is that they now reach ticket notes, which `stages/review.ts` feeds back to the review
session as `operator_record` — so a reviewer was judging mangled evidence.

The value must now look like a credential: quoted, containing a digit, or 16+ characters. That is a
deliberate loosening, stated where it is made.

## 2. PRDR-167's own regression tests passed with its defect restored

Putting `skips: stored.skips` back at the `writeBindings` call left **all 23 tests green**,
including all three written for PRDR-167. They passed `write: false` and asserted on
`result.summary.skips` — computed correctly — while the defect lives in what reaches
`bindings.json`.

That is the fifth consecutive round in which a fix was asserted one hop away from the hop that
drops it, in the commit whose message names that exact lesson. The tests read the file now.
