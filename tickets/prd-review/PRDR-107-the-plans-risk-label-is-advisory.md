---
id: PRDR-107
title: "B-4 on the plan's own risk_label has stopped eleven times across every gate and field test, been approved eleven times, and declined never"
state: READY
severity: major
category: decision
labels: ["prd-review", "user-raised", "found-by-execution"]
surface: ["src/kernel/referee-gate.ts", "src/kernel/events.ts", "detent-prd-v3.md"]
prd_refs: ["B-4", "P6", "C-10"]
acceptance_criteria: ["A DONE-candidate carrying `risk_label` finalises without a human stop; the label is recorded once as a kernel note so the report still shows it.", "A DONE-candidate whose diff touches a configured `risk` glob still stops, exactly as before — the operator's own list is the operator's decision.", "`RISK_LABEL_REQUIRED` is minted only by the glob trigger; the label mints no event."]
non_goals: ["Does not remove `risk_label` from the ticket schema or the planner prompt. The label is useful information for the reviewer and the report; it is only no longer a stop.", "Does not change what approval does when the glob trigger fires: re-entry to APPROVED and kernel re-verification stay as B-4 wrote them."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-106", "PRDR-108", "PRDR-109", "PRDR-110"]
depends_on: []
---

# PRDR-107 — the plan's risk label is advisory

**Severity:** major · **Category:** decision · **Raised by:** the user — "remove all four
of them now" · **Found by:** counting every human stop on the certification gate

## The measurement

B-4 has two triggers: the diff touching the operator's `risk` globs, or the ticket carrying
the planner's `risk_label`. Every gate and field test so far ran with `risk: []`, so every
B-4 stop came from the label:

```
run                 label stops   approved   declined
n7 (3.0.0)               6            5          0
n7-301 (3.0.1)           3            3          0
n7-310 (3.1.0)           7            7          0
field-1 slugify          1            1          0
field-4 p-queue          1            1          0
```

Eleven stops, eleven approvals, no declines, no guidance. The human act B-4 asks for has
never once changed an outcome, and each stop is an exit-10 that ends an unattended run.

## The decision

The label becomes advisory: recorded once as a kernel note, visible in the report, never a
stop. The glob trigger stays untouched — `risk` is the operator's own list, empty unless
they write it, and a stop they configured is a stop they want.

## Resolution

`closeCheckRisk` records the label and continues to the glob check instead of returning;
`riskRequired` loses its `"label"` cause. One test inverts: the label case now expects
`DONE` and a note that does not say "requires human approval".
