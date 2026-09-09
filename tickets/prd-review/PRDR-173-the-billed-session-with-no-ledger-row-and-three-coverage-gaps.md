---
id: PRDR-173
title: "doctor's smoke session leaves no ledger row, and three load-bearing behaviours had no test that fails when they are deleted"
state: DONE
severity: major
category: coverage
labels: ["prd-review", "found-by-audit", "coverage", "spend"]
surface: ["src/cli/doctor.ts", "src/kernel/ledger.ts", "tests/adapter/drift.test.ts", "tests/cli/report.test.ts", "tests/kernel/session-policy.test.ts"]
prd_refs: ["X-1", "C-6a", "V-1‴", "PRDR-114", "PRDR-123"]
acceptance_criteria: ["A billed session leaves a ledger row, whichever command launched it.", "`verify sync`'s CLI entry point — the TTY refusal and the `--yes` path — is exercised, because a mutation disabling the refusal left the whole suite green and that gap is why the `--yes` notice hole survived.", "`crash_resume_correctness` is asserted with a real denominator: inverting its clean-resume predicate must fail a test.", "The kernel wiring that tells an operator their session ran on the wrong model, or without its configured MCP tools, fails when deleted."]
non_goals: ["Does not open a RunJournal in `doctor`. It is a diagnostic, not a run; the row goes through the same schema to the same file via a standalone appender."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-154", "PRDR-167", "PRDR-114", "PRDR-123"]
depends_on: []
---

# PRDR-173 — a billed session nothing recorded, and three mutations the suite slept through

**Severity:** major · **Category:** coverage · **Found by:** the full-project audit of `0752fef`

## The ledger gap

`doctor --smoke`'s `backend.run()` was the only one of the repo's three call sites with no
`SpendLedger` wrapping. A real, consented, billed session — doctor prints its own cost estimate —
left `.detent/ledger.jsonl` untouched; the file was not even created. PRDR-154's ticket names "no
consent, no cap and no ledger row" as the problem, closes consent and cap, and never closes the row.
Bounded (opt-in flag, auth-gated, `maxTurns: 1`) but it is an accounting hole in the one file meant
to be the complete record of Detent's spend on a root.

## Three mutations that survived the whole suite

- **`verify sync`'s entry point.** Every test called the pure `verifySync(root, deps)` with a
  hand-supplied consent callback; nothing drove `main()` through `sync --yes` or the interactive
  refusal. `if (false && !interactive …)` left 906 tests green. This gap is the direct reason the
  `--yes` notice hole (PRDR-167) could exist unnoticed.
- **`crash_resume_correctness`.** Its only assertion was the `.toBeNull()` no-crash branch, so
  inverting `blindStarts <= 1` — turning a 100%-correct signal into 0% — failed nothing anywhere.
  The one test that produces a real `skipped_after_crash` event never calls `buildReport`.
- **The degraded-session wiring.** `isModelUnavailable` and `mcpFailures` parsing are tested at the
  session layer; the translation into `appendNote` + `appendTicketEvent` — the only place an
  operator learns their session ran on the wrong model or without its configured tools — was not.
  Deleting the whole 18-line block changed no test result.
