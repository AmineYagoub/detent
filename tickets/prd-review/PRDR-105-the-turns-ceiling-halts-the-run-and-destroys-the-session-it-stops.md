---
id: PRDR-105
title: "The turns ceiling has fired four times, caught zero runaways, and cost a run halt and ~$51 of unrecorded spend each time it stopped legitimate work"
state: READY
severity: major
category: correctness
labels: ["prd-review", "user-raised", "found-by-execution"]
surface: ["src/kernel/referee-session.ts", "src/sessions/sdk.ts", "src/kernel/ledger.ts", "prompts/implement.md", "detent-prd-v3.md"]
prd_refs: ["X-1", "B-5", "S-4", "D-25", "P6"]
acceptance_criteria: ["A turns breach is a TICKET consequence, not a RUN consequence: the breached ticket leaves the pool (parked, or to NEEDS_HUMAN with its dossier) and the run continues on tickets that do not depend on it.", "A breached session's spend is recorded as a flagged estimate — observed turns times the run's measured cost per turn — never as $0, so the launch gate and the report see a lower bound instead of a hole.", "Before the hard ceiling there is a soft one: the session is told, in-band, that it is near its budget and must commit what is coherent and write down what remains, so a breach resumes from committed work rather than from a cold prompt.", "A breached ticket whose session committed work is resumed automatically once, without an operator, because the measured outcome of every such resume so far is completion in 46-63 turns.", "The hard ceiling stays. A session that commits nothing and breaches again is the runaway or the oversize case, and it stops."]
non_goals: ["Does not remove the per-session bound. `run_spend_usd` is a launch gate (D-25) and bounds overshoot to one session — without a turns ceiling that one session is unbounded.", "Does not decide the sizing question. PRDR-102 owns the signal a session should emit at turn 40; this ticket owns what the kernel does at turn 200 when no such signal came.", "Does not change the default value. PRDR-098's 80 and the gate's 200 and 400 are operator choices for a model; the defect here is the consequence, and it is the same at every value."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-097", "PRDR-098", "PRDR-102", "PRDR-094", "PRDR-100"]
depends_on: []
---

# PRDR-105 — the turns ceiling stops the run and destroys the session it stops

**Severity:** major · **Category:** correctness · **Raised by:** the user, asking whether the
limiter is a guard or a blocker · **Found by:** the certification gate, four times

## The measurement

Every turns breach on Detent's own plan, and what happened to the ticket afterwards:

```
ticket   breached at   ceiling   resumed, finished in   recorded for the breach
t-116        103          80            63                      $0
t-106        145         200            47                      $0
t-146        307         200            46                      $0
t-154        222         200            (pending)               $0
```

Completed implement sessions across the same run: 87 of them, maximum 118 turns, $0.0662
per turn.

Three of three resumed breaches finished, each in fewer turns than the breach, each in
under half of the ceiling that cut them. That is not the profile of a runaway. It is the
profile of a session that was most of the way through legitimate work when the kernel
killed it, lost the context, and had to be restarted by a person.

The ceiling has caught zero runaways. It has caught four sessions doing the ticket.

## What one firing costs

1. **The run halts.** Not the ticket — the run. After t-154's breach seven READY tickets sat
   idle until an operator restarted the driver. On the CLI path there is no one to restart
   it; the machine slept and the gate lost a night.
2. **The spend vanishes.** The SDK's max-turns path throws, and the throw zeroes telemetry
   (PRDR-097 made this halt by name rather than masquerade as an outage, which was right, but
   the figure stays $0). Four breaches, 777 turns, about **$51** the ledger has never seen. The
   spend cap is a launch gate reading that ledger, so the cap is now wrong by that much.
3. **The work is stranded.** A hard kill leaves no chance to commit. t-154 wrote five files in
   222 turns and committed none; t-146 committed once, late. The resume gets a cold prompt and
   whatever happens to be on disk — and it is B-5's same-ticket resume that saves it, not
   anything the ceiling did.

The halt is justified in the code by the second point: "its cost is unrecoverable and recorded
as $0, so continuing would spend untracked." The justification is real and the conclusion
does not follow from it. The cost is not unrecoverable — turns are known, and the run's cost
per turn is measured — and a bounded, flagged estimate removes the reason to stop everything.

## Why it should exist anyway

`run_spend_usd` bounds the run, but only at launch (D-25): overshoot is one session. Without
a per-session bound that one session is unbounded, and a session that genuinely spins —
re-reading, looping on a red test — would run to the money cap. That case has not occurred
in 87 sessions. It is still the case the ceiling exists for, and the hard stop stays.

## Direction (not a decision)

The ceiling is fine. The consequence is the defect, in three parts:

- **Scope.** X-1 gives `turns_per_stage` session scope. Its breach should land on the
  ticket — park it, or hand it to a human with its dossier — and the run should carry on
  with everything that does not depend on it. The dependency graph already exists.
- **Accounting.** Record `turns × measured $/turn` with the same `partial` flag PRDR-053 gave
  crashes. The report already distinguishes flagged rows; the launch gate then sees a lower
  bound instead of nothing.
- **Grace.** A soft ceiling before the hard one — the session is told it has N turns left
  and must commit what is coherent and write what remains. The Agent SDK's streaming input
  can deliver it mid-session; failing that, the implement prompt's commit discipline is the
  fallback and has demonstrably not landed (222 turns, zero commits). Then a first breach
  with committed work resumes itself once, because that resume has finished every time.

The soft ceiling is PRDR-102's proposal from the kernel's side: 102 asks the session to
notice it is oversized; this asks the kernel to tell it when it is out of room. They meet at
the same artifact — a commit and a note of what is left.

## Operator action taken on the gate

Raised the gate's `turns_per_stage` to 400 and committed it (PRDR-092). 400 is above every
breach observed and 3.4× the largest completed session; a runaway now costs at most ~$26
before the hard stop, with `run_spend_usd` behind it. This is a remedy for one run, not a
default, and PRDR-098's default is untouched.
