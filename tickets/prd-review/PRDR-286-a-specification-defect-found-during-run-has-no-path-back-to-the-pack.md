---
id: PRDR-286
title: "A session that proves the specification wrong can only falsify its own ticket. Nothing carries the fix back to the pack, the tickets built on the same requirement keep being drawn, and re-planning an approved plan means `--replan`, which re-derives every slice and is refused while the falsified ticket sits in NEEDS_HUMAN. An amendment rides X-4 to the operator, holds the affected tickets, and ends in a re-plan scoped to the slices it changed"
state: OPEN
severity: major
category: capability
labels: ["prd-review", "specification-phase", "operator-decision", "X-4", "C-8", "C-10", "replan"]
surface: ["src/schemas/records.ts", "src/kernel/falsify.ts", "src/kernel/referee.ts", "src/kernel/dependency.ts", "src/kernel/run.ts", "src/init/machine.ts", "src/cli/init.ts", "prompts/implement.md", "tests/kernel/amendment.test.ts", "tests/init/scoped-replan.test.ts"]
prd_refs: ["X-3", "X-4", "X-4′", "C-7′", "C-8", "C-8′", "C-8″", "C-8‴", "C-10", "N-6", "PRDR-085", "PRDR-118", "PRDR-277", "PRDR-278", "PRDR-280", "PRDR-284", "PRDR-289"]
acceptance_criteria: ["An implement or fix session that proves a specification defect writes `falsified.json` with an amendment. It names the affected requirement ids and the defect class, carries the evidence (a failing test, or two passages of the pack that contradict each other, quoted), and proposes the new text. The referee admits PREMISE_FALSIFIED from every state X-3 allows it in (PRDR-289); no state or event is added.", "Until the amendment is decided, the pool draws no READY ticket whose `requirement_ids` include an amended requirement, and the run goes on with the rest.", "The operator approves, edits or rejects it through C-10's escalation: on a TTY inside `run`, and with exit 10 off one. A rejection returns the held tickets to the pool and leaves the filing ticket in NEEDS_HUMAN, with the rejection as its note.", "On approval the pack is edited, the checker gates it (PRDR-280), and VALIDATE re-validates the change (PRDR-284).", "The scoped re-plan: only the slices whose requirement ids changed are re-planned, and every other slice's cache is reused (C-8‴), because slices are keyed by their requirement ids (PRDR-291). A DONE ticket is never redrafted, so a change to built code becomes a new ticket (C-8′). C-8″'s in-flight refusal covers the re-planned slices' tickets only, and the filing ticket's own NEEDS_HUMAN does not refuse the re-plan it asked for. The changed plan is presented for approval again (C-7′).", "The filing ticket and the held tickets return to the queue through HUMAN_REQUEUE, as PRDR-277 returns the tickets an install frees, or are superseded by the re-plan.", "Falsifying test: a two-slice plan, approved, and a NEEDS_HUMAN ticket in its second slice. Against HEAD, `detent init` reports the approved plan and re-plans nothing (C-8), and `detent init --replan` is refused while that ticket is NEEDS_HUMAN (C-8″). Fixed, the amendment's re-plan re-plans the second slice only and reuses the first slice's cache."]
non_goals: ["Does NOT let review or diagnose sessions file an amendment. Decision 12 settled which roles may: implement and the three fix roles (X-3′, PRDR-278).", "Does NOT apply an amendment without the operator. The pack is the founder's record, and an amendment changes it.", "Does NOT change `--replan`. It still re-derives every slice (C-8′), for an operator who wants that."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-085", "PRDR-118", "PRDR-277", "PRDR-289", "PRDR-291"]
depends_on: ["PRDR-280", "PRDR-284", "PRDR-289", "PRDR-291"]
---

# PRDR-286 — amendments during `run`, and the scoped re-plan

## Where this came from

ksar-cloud's run 7 exercised X-4 end to end. A session proved its premise false, the ticket went
to NEEDS_HUMAN, and every ticket behind it waited (PRDR-277). With a specification pack, some
falsifications mean the pack itself is wrong, and the session that proves it has the fix in hand.
The operator's decision 8 gives that a path back to the pack.

## Problem

Today a session can falsify its ticket (X-4) and do nothing else. The pack stays wrong, and the
tickets citing the same requirement keep being drawn and built on the wrong rule.

Re-planning after the fix has no fitting path either:
- On an approved plan, `init` returns before any replay and asks for `--replan` (C-8,
  `src/init/machine.ts:385`).
- `--replan` removes every slice's cache and re-derives them all (C-8′).
- Both routes pass through the in-flight guard (C-8″). `inFlightTickets` counts every ticket that
  is neither READY nor DONE, so the filing ticket's own NEEDS_HUMAN refuses the re-plan it needs.

## Design

The plan's §8. No state or event is added: v3 inherits §7's machine unchanged, and an amendment
is a falsification that names its fix. The hold is a pool filter, like a dependency. The
decision is C-10's escalation. The re-plan is C-8‴'s slice cache, scoped by the amended
requirement ids, with C-8′'s reconciliation and C-8″'s guard narrowed to the slices it touches.

## From PRDR-284

VALIDATE is built (C-2¹⁴), and an approved amendment's edit to the pack reaches it through the
path every edit takes. The next `init` finds the record's documents moved and starts a new
validation. That validation runs the checker first, then rounds scoped to the changed documents,
to what the last validation left open, and to whatever cites either. Three things in it are this
ticket's to take up:

- **Two asks of the in-flight guard.** C-8″'s second ask is now made before VALIDATE runs
  (`replansAt` in `src/init/replan-guard.ts`), and `inFlightTickets` counts the filing ticket's
  own NEEDS_HUMAN. As built, an amendment's re-validation is refused before any reviewer runs,
  and the first ask refuses it too. Narrowing both to the re-planned slices' tickets (C-8⁵) is
  this ticket's.
- **Stopping at the ceiling.** VALIDATE stops at its ceiling on a blocker with AWAIT_INFO. During
  `run`, that is an `init` interrupt reached from an amendment, and whether `run` surfaces it
  through C-10's escalation or leaves it to the next `detent init` is this ticket's to decide.
- **Scope.** A changed decision log or facts file reaches every document that cites any entry of
  it, since the record keeps no earlier copy to say which entry moved. An amendment that touches
  the log therefore re-validates widely. Holding an earlier copy of the log, or scoping by the
  amendment's own requirement ids, would narrow it.
