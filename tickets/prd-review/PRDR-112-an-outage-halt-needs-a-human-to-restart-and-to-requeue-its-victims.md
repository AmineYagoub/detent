---
id: PRDR-112
title: "An outage halt is right to detect and wrong to leave: the run exits, and the tickets the outage crashed sit in NEEDS_HUMAN until a person requeues them with 'not a finding'"
state: READY
severity: major
category: gap
labels: ["prd-review", "found-by-execution"]
surface: ["src/kernel/referee-session.ts", "src/kernel/driver.ts", "src/kernel/referee.ts", "detent-prd-v3.md"]
prd_refs: ["S-4", "X-8", "C-9", "C-11", "P6"]
acceptance_criteria: ["On an outage streak the run backs off and retries — 1, 5, 15 minutes — before it exits; an outage that clears inside that window costs no operator action.", "A ticket whose generation ended because its sessions crashed at $0 during an outage — not because of anything it built — is re-queued automatically when the run resumes, with the reason recorded, rather than parked in NEEDS_HUMAN behind a requeue nobody typed.", "A genuine per-ticket failure that merely coincided with an outage is not laundered: only $0, zero-or-near-zero-turn crashes inside the streak window qualify.", "The report still shows the outage: streak, window, and the tickets it touched."]
non_goals: ["Does not weaken PRDR-090's detection or PRDR-072's refusal halt; both were right every time they fired.", "Does not retry forever. After the backoff ladder the run exits as today — an outage that outlasts twenty minutes is a person's problem."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-090", "PRDR-072", "PRDR-109", "PRDR-111"]
depends_on: []
---

# PRDR-112 — an outage halt needs a human to restart and to requeue its victims

**Severity:** major · **Category:** gap · **Found by:** the certification gate, 10:44 on
2026-09-02

## What happened

Three sessions crashed at $0 inside four seconds — t-160's review, its A-5′ relaunch, and
t-163's implement. PRDR-090's streak halt fired exactly as designed and the run exited 1.
Eighty minutes later nobody had restarted it, because the only watcher was a person
between other tasks. When the person looked:

- the driver was gone;
- t-160, whose implement had finished and committed ($10.05, 124 turns), sat in
  NEEDS_HUMAN with the dossier reason `review produced no artifact (after one relaunch)` —
  the relaunch that PRDR-109 added had been eaten by the same outage;
- t-163 sat IN_PROGRESS with a one-turn crashed session, fine to resume;
- the fix was two operator actions that carried no information: restart the driver, and
  requeue t-160 with the words "not a finding against this ticket".

This is the fifth stop shape on the gate. The other four (PRDR-107–110) were removed
because the human added nothing; this one is the same, with the twist that the halt itself
is correct and only its aftermath is a person's job.

## Direction (not a decision)

Detection stays. Two consequences change:

1. **Back off, then retry, then exit.** A streak halt waits 1, 5, then 15 minutes and
   probes the backend (the doctor's one-turn smoke session exists for this) before it
   gives up. Most outages seen on this project cleared in minutes.
2. **The outage's victims re-queue themselves.** A generation whose last sessions were
   $0 crashes inside the streak window is not a finding against the ticket — the operator
   has typed exactly that sentence into eleven requeues across three gates. On resume the
   referee re-queues such tickets with that reason recorded, and the report names them.

The discriminator is what already distinguishes an outage from work: zero cost, zero or
near-zero turns, consecutiveness. A ticket that actually failed does not match it.
