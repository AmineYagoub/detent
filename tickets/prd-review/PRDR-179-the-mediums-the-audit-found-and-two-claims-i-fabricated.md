---
id: PRDR-179
title: "Nine medium findings from the audit of 0752fef..4f25d31, including a commit-body byte that silently dropped a commit and two claims I fabricated in my own tickets"
state: DONE
severity: major
category: defect
labels: ["prd-review", "found-by-audit", "false-claim"]
surface: ["src/cli/verify.ts", "src/kernel/git.ts", "src/kernel/ledger.ts", "src/cli/doctor.ts", "src/cli/run.ts", "src/kernel/budgets.ts", "scripts/check-rules.ts"]
prd_refs: ["V-1‴", "X-1", "C-1", "C-14″", "P6", "SEC-4", "A-5"]
acceptance_criteria: ["A commit body cannot drop its own commit from the review basis, whatever bytes it contains.", "Every `verify sync` exit reports a vacuous gate, and the operator sees the skips they are consenting to.", "A billed out-of-band session is recorded in the same shape as every other ledger row, on a root that already exists, and says what recording it costs.", "The P6 enforcement map names the site that READS each ceiling, and the test proving it cannot be satisfied by a comment OR a log string.", "A fixture run announces itself based on the backend that ran, not the flag that was passed."]
non_goals: ["Does not revisit the ledger torn-line undercount. That is PRDR-151's recorded trade-off, not an unnoticed defect."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-167", "PRDR-171", "PRDR-172", "PRDR-173", "PRDR-174", "PRDR-175"]
depends_on: []
---

# PRDR-179 — nine mediums, and the two sentences I made up

**Severity:** major · **Category:** defect · **Found by:** the audit of `0752fef..4f25d31`

## The defects

- **A commit body could drop its own commit.** `ticketCommits` used `%x01` as a record separator
  under a comment saying it was chosen "because a commit body may contain anything" — which is
  precisely why it was wrong. A body containing a literal SOH split its own record and the commit
  vanished from the review basis, silently: the harm PRDR-171 exists to remove. Git refuses NUL in
  a commit message, so NUL is the one byte a body provably cannot carry; `-z` with a paired read.
- **`verify sync` reported a vacuous gate on two of three exits.** PRDR-167 closed the hole for the
  normal path and its own new `SETUP_REQUIRED_SLOTS` refusal returned above the notice loop. That
  refusal also had no test at all.
- **`SyncSummary.skips` was decision material rendered nowhere.** Adding a field to the decision
  object is not adding it to the decision.
- **`recordOutOfBandSpend` wrote a different shape from every other row** — the flat estimate
  rather than the per-model breakdown `SpendLedger.record` calls "the token source of record", and
  an unsorted `models`. It also created `.detent/` on a root that had none, so a diagnostic
  initialised a directory. And it counts against `run_spend_usd` **forever**, which PRDR-173 never
  said; doctor says it now.
- **`init` created `.detent/state/` on a refusal path** whose own comment promises it does not —
  the lock mkdirs and `release()` removes only the file. The existing test for that rule passed
  because it exercises the no-repo path, which returns above the lock.
- **The P6 map named a site that does not read its ceiling.** Stripping comments from the parity
  test swapped "a comment vouches for code" for "a log string vouches for code":
  `planning_research_tool_calls` survived only in a template literal while enforcement read a
  handed-in number. The test now masks both, sharing the rules gate's scanner, and the map points
  at `init/pipeline`.
- **The fixture banner followed the flag, not the backend.** PRDR-174's injectable builder let a
  fixture run silently while the flag said live, and the test asserted that as correct.
- **The four extraction-site scrubs were untested** because the `appendNote` seam masked them. What
  they uniquely protect is the JOURNAL, which does not pass through that seam.

## And two claims I fabricated

PRDR-175 put in quotation marks a sentence PRDR-174 does not contain — in the ticket whose thesis
is that recording an unchecked reason is how a false claim survives. PRDR-170 said PRDR-124 claims
worker sessions "have always" narrowed correctly and that this is false; PRDR-124 actually says the
policy moves onto the spec "as worker sessions have always done", which is true. Both tickets now
carry the correction rather than the invention.
