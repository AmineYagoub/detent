---
id: PRDR-189
title: "PRDR-185's 1/5/15 ladder exhausted in 21 minutes against a usage limit that reset hours later, while the message said exactly when it would come back"
state: OPEN
severity: major
category: gap
labels: ["prd-review", "found-by-live-run", "reliability"]
surface: ["src/init/session.ts", "src/init/pipeline.ts", "tests/init/stages.test.ts"]
prd_refs: ["PRDR-185", "PRDR-112", "ARCH-2"]
acceptance_criteria: ["When a limit states its reset time, the wait is until that time rather than a fixed ladder step — and the operator is told which of the two is happening.", "The stated ZONE is honoured, so an operator in a different zone waits the right amount rather than an hour early.", "A reset further away than the tool will wait hands the decision back with the remaining time named, instead of sleeping until tomorrow.", "The clock is an injectable seam, as AGENTS.md requires of any decision that reads the time."]
non_goals: ["Does not remove the ladder. It is right for an outage that states nothing — an overload, a 429 — and those keep it."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-185", "PRDR-112"]
depends_on: []
---

# PRDR-189 — the answer was in the message

**Severity:** major · **Category:** gap · **Found by:** the live gate run, where PRDR-185 worked and lost anyway

## Problem

PRDR-185 fired exactly as designed, and it is worth recording that it did:

```
backend outage during planner — waiting 1 min before retrying (1/3): … session limit …
backend outage during planner — waiting 5 min before retrying (2/3): … session limit …
backend outage during planner — waiting 15 min before retrying (3/3): … session limit …
init failed: planner session failed: … session limit · resets 10:30pm (Africa/Algiers)
```

Three retries, the 1/5/15 ladder PRDR-112 specifies, the operator told each time — and then the run
died. The ladder totals 21 minutes and a usage window is not a transient outage; that one reset
about three hours later. The message says so, in the same line that failed, and PRDR-185's own
acceptance criteria said the operator should be told "until when". The code never read it.

## The zone is not decoration

`resets 10:30pm (Africa/Algiers)` names a zone because the answer depends on it. Reading the time
against the runner's own clock is right only by coincidence — and the machine that found this
defect **is** on `Africa/Algiers`, which is exactly the coincidence that would make a naive
implementation look correct and fail for everyone else. The current time is taken IN the named
zone; the test uses two explicitly different zones so it cannot pass by accident on this machine.

## What is deliberately not changed

The ladder stays for outages that state nothing — an overload, a 429 — which is what it was built
for. And a reset further away than `MAX_RESET_WAIT_MS` hands the decision back with the remaining
minutes named, rather than sleeping until tomorrow: a wait that long is more likely a misparse than
a real reset, and every finished slice is checkpointed, so re-running is cheap.
