---
id: PRDR-153
title: "The audit of phase 3: a corrupt `plan.json` disabled the C-9 check entirely, the plugin path got neither guard the phase added, and a run's own discovered tickets refused the next resume"
state: DONE
severity: major
category: correctness
labels: ["prd-review", "found-by-audit", "self-inflicted"]
surface: ["src/kernel/run.ts", "src/init/machine.ts", "src/init/plan-write.ts", "src/cli/referee.ts", "src/kernel/tickets/mutations.ts", "src/kernel/tickets/readers.ts", "src/kernel/referee.ts", "tests/kernel/run.test.ts"]
prd_refs: ["C-9′", "X-1⁗", "B-2″", "PRDR-118", "PRDR-064"]
acceptance_criteria: ["One definition of `NON_TICKET_FILES`, exported and used by `planHash` and `run`; there were three, and two were wrong.", "An unreadable `plan.json` REFUSES rather than disabling the approval comparison; an unreadable TICKET still yields `readTicket`'s named error.", "`planHash` covers only the ids `plan.json` names, so a ticket the RUN files — X-5 quarantine, X-6 discovery — does not invalidate the approval.", "`waits_on` and `links` are run state and leave the approved projection; `blockers` stays.", "The live-claim refusal runs BEFORE any ticket is written, and covers retained tickets as well as orphans.", "`detent referee` — the MCP path the plugin drives — takes the approval check and the worktree default.", "Claim time and the wall-clock check read the SAME injectable clock.", "The resume test no longer re-approves between the run and the resume."]
non_goals: ["Does not add a worktree flag beyond `--no-worktree` on the referee path.", "Does not address the escalation think-time counting against the ticket wall clock (M-2), or the stale ENFORCEMENT_SITES entry (L-2) — both recorded for phase 4."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-139", "PRDR-140", "PRDR-145b", "PRDR-152"]
depends_on: []
---

# PRDR-153 — the phase that fixed a one-driver ceiling shipped two one-driver guards

**Severity:** major · **Category:** correctness · **Found by:** the audit of phase 3 ·
**Introduced by:** `7b652d1` and `fbe1587`

**A corrupt `plan.json` turned the C-9 check off.** `planFilesReadable` excluded only
`approval.json`, while `readers.ts` has held the correct answer all along —
`NON_TICKET_FILES = {approval.json, plan.json}`. So a conflicted `plan.json`, the most
merge-prone file in a committed directory, made the guard return false, the comparison was
skipped, and **nothing downstream noticed**, because `allTickets` skips that file by name. The
commit's own safety argument — *"`readTicket` refuses it by name a moment later"* — is true of
ticket files and false of this one. That was a third divergent definition of "ticket file in
`plan/`" in a codebase whose PRDR-064 exists about exactly that.

**The plugin path got neither guard.** `cli/referee.ts` is the MCP server `skills/run/SKILL.md`
drives, and it had no approval check anywhere in its path and never passed `worktree` — so
`RefereeContext` defaulted it to false and the model-driven driver ran an unapproved plan in the
operator's own checkout. X-1⁗ moved the wall clock to the launch seam *precisely* so a ceiling
would not live on one driver only; C-9′ and B-2″ were then left on one driver, in the same
commit.

**A run's own tickets refused its next resume.** `ticketsDir` IS the directory `planHash`
scans, and `linkDiscovered` writes there mid-run for X-5 quarantine and X-6 discovery. A new
file changed the hash regardless of which fields were projected, so any discovery meant the next
`detent run` refused and demanded a human re-approval — for a ticket Detent itself filed. The
hash now covers only the ids `plan.json` names, which is exactly what a human was shown.

**And PRDR-152 over-corrected.** Adding `waits_on` and `links` to the approved projection fixed
nothing and broke resumes: `dependency.ts` writes `waits_on` on an X-4′ discovery and
`linkDiscovered` writes `links` on both sides of an X-6 one. `blockers` was the field that
mattered and is plan-time only.

Also fixed: the live-claim refusal fired *after* every ticket had been rewritten — leaving the
directory reset, the orphans present and `plan.json` stale, which is the half-written state
PRDR-118 restructured this function to prevent — and it guarded only orphans, so a claimed
ticket the plan RETAINED was still rewound under a live session. Both now happen in the decide
phase, before anything is written.

And the wall-clock check subtracted two different clocks: `ctx.iso()` is injectable, `claim()`'s
`at` was always real. Under the canonical frozen-clock fixture the elapsed time came out hugely
negative, so **the new enforcement site never fired in the test that covers it** — the headless
driver's own self-consistent check was producing that green. A subtraction across two clocks is
not a duration.

## The test that was masked

`addTicket` re-approves on every call, so the resume test's `addTicket(t2)` between run 1 and
the resume re-stamped the hash from disk — meaning it would have passed even if `planHash` still
covered whole ticket files, which is the one thing it exists to prove. It now takes the approval
before run 1 and asserts it is unchanged afterwards.
