---
id: PRDR-152
title: "C-9′'s approved-field projection listed a drafted ticket's field name, so it hashed a key that is always absent and ignored `blockers` and `waits_on` — a ticket's dependency edges could be rewritten after approval unnoticed"
state: DONE
severity: major
category: correctness
labels: ["prd-review", "found-by-audit", "self-inflicted"]
surface: ["src/init/machine.ts", "tests/kernel/run.test.ts"]
prd_refs: ["C-9", "C-9′"]
acceptance_criteria: ["`APPROVED_FIELDS` is typed `readonly (keyof Ticket)[]`, so a name that is not a ticket field cannot compile.", "`blockers`, `waits_on` and `links` are part of the approved projection.", "A test asserts the projection against the SCHEMA — every field on a real ticket either changes the hash or is a declared piece of run state — so a field added later cannot be silently omitted."]
non_goals: ["Does not widen the projection to run state. `state`, `generations`, `notes` and `schema_version` change during a run by design and must not invalidate an approval."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-139"]
depends_on: []
---

# PRDR-152 — the third time, and the one that changed how it is tested

**Severity:** major · **Category:** correctness · **Found by:** auditing PRDR-139, minutes after
it landed · **Introduced by:** `7b652d1`

`APPROVED_FIELDS` listed `depends_on`. That is a **drafted** ticket's field name; a `Ticket` on
disk carries `blockers` and `waits_on`. So the projection hashed a key that is always
`undefined` and omitted the two that hold the dependency graph. Reproduced: emptying
`blockers`, or adding a `waits_on`, left the hash unchanged — a ticket's edges could be
rewritten after approval and C-9's check would not notice.

This is the third instance in this line of one mistake: **reasoning about a format without
reading what writes it.** The first bricked a root (the ledger's torn-line rule, PRDR-151). The
second was the drift comparison that halted every watch-mode repo (PRDR-149). This one is the
same shape, committed in the very change whose own message said reading the writer first is
what saved it.

So the fix is two parts, and the second matters more:

- `APPROVED_FIELDS` is typed `readonly (keyof Ticket)[]`, so a name that is not a ticket field
  no longer compiles.
- The test asserts against the **schema** rather than a remembered list: it walks every field on
  a real ticket and requires each to either change the hash or be named as run state. A field
  added to a ticket later cannot be quietly left out of what a human is taken to have approved.

A remembered list is exactly the artefact this class of defect lives in. Anchoring the test to
the thing that generates the data is the general answer, and it is the same move that made the
SEC-4 test meaningful (assert on the entry point) and the symbol-reminder test meaningful (go
through `loadConfig`).
