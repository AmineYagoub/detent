---
id: PRDR-042
title: "Give §14 metrics measurement specs, define human intervention and scope canary, and state the generation basis"
state: DONE
severity: major
category: testability
labels: ["prd-review"]
surface: ["foreman-prd-v2.md"]
prd_refs: ["§14", "X-8", "C-10", "B-4", "SEC-3", "A-1", "N-7"]
acceptance_criteria: ["§14 is a table with columns `Metric | Target | Source artifact | Denominator | Window & population`, every cell non-empty, checkable by a markdown table lint.", "The PRD defines \"human intervention\" in one place, naming which of C-10's four outcomes and B-4's risk approval count and which do not, and §14's ≥70% row is consistent with that definition.", "\"Scope canary\" is defined as a normative term with enough precision to build the corpus — naming the ticket property that makes one a canary and the observable that counts as blocked — and the definition states whether the SEC-* evasion pack and the canary corpus are the same set.", "The sessions-per-ticket row states whether it is per-generation or cumulative across generations, and X-8's cumulative-reporting sentence and §14's row cannot be read as contradicting each other.", "Every §14 row names a source artifact that F-1 already requires, so no row implies a new persisted artifact."]
non_goals: ["Does not change any numeric target — 70%, 2.5, 100%, 0 stay as written.", "Does not add a pilot milestone or change §13; v1 measures on the fixture matrix as §14 already states.", "Does not require the kernel to compute these metrics inline — an out-of-band script over F-1 artifacts satisfies every row."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-042 — Give §14 metrics measurement specs, define human intervention and scope canary, and state the generation basis

**Severity:** major · **Category:** testability · **Amends:** §14, X-8, SEC-3

**Applied in 2.0-draft.5.** See the PRD's draft.5 amendment note for where this ticket was reconciled against another.

## Problem

§14 is the v1 success bar and is written as a prose list of targets with no source artifact, denominator, or measurement window on any row. Three specific ambiguities make rows ungradeable rather than merely underspecified.

*"Without human intervention" is undefined against the PRD's own human gates.* C-10 gives an escalation four outcomes — approve, requeue-with-guidance, skip, quit — and B-4 requires human approval for any risk-glob diff. A ticket that reached DONE only after a B-4 risk approval has had a human in the loop but never entered the ladder's failure path; a ticket that a human skipped never reached DONE at all. Whether either counts against the ≥70% changes the measured figure substantially, and both readings are defensible from the current text.

*The sessions-per-ticket row predates X-8 and is now ambiguous.* X-8 introduced attempt generations, in which every X-1 counter restarts at zero and prior generations remain as immutable history, and it explicitly requires cumulative display. A ticket requeued twice, taking two sessions per generation, is either 2 (per-generation median) or 6 (cumulative) — a factor of three on a metric whose target is 2.5. §14 does not say which, and X-8's "dossiers and `status` display **cumulative** totals" pulls toward the second reading while X-1's "per ticket" header pulls toward the first.

*"Scope canary" is used once and defined nowhere.* §14 gates it at 100%, which makes it a release-blocking criterion for a term with no normative definition anywhere in the document. The SEC-* AC mandates a "red-team fixture pack (10 evasion tickets)", which is a related but distinct corpus — evasion tickets attempt protected writes and base-branch writes, whereas a scope canary tests the `surface[]` boundary of A-1 and the S-2 `canUseTool` deny path. Whether these are one corpus or two is unstated, so an implementer can satisfy §14 by pointing at the SEC pack without ever testing surface containment.

This is the same class of defect PRDR-028 corrected in the prior PRD lineage; §14 was rewritten between lineages and did not inherit the fix.

## Evidence (verbatim from foreman-prd-v2.md)

- §14: "≥70% of tickets reach DONE without human intervention on the fixture matrix; median ≤2.5 sessions per completed ticket; 100% of scope-canary tickets blocked; 0 base-branch writes across all fixtures; research cache hit rate reported per run; resume correctness: 100% of injected crashes recover without duplicate blind fixes; the N-7 self-build gate passes on every release."
- X-8: "every X-1 counter restarts at zero for the new generation, while prior generations remain immutable history on the ticket"
- X-8: "dossiers and `status` display **cumulative** totals across generations"
- X-1 header: "**X-1 Budgets** (per ticket, hard)"
- C-10: "dossier summary, then approve / requeue-with-guidance / skip / quit"
- B-4: "a DONE-candidate whose diff touches `risk[]` globs (or carries `risk_label`) requires human approval before finalize"
- SEC-\* AC: "red-team fixture pack (10 evasion tickets) — 0 protected writes, 0 base-branch writes, 0 unlogged consents"
- A-1: "surface[] (globs)"

## Proposed change

**1. Re-cast §14 as a measurement table.**

```
| Metric | Target (v1) | Source artifact | Denominator | Window & population |
|---|---|---|---|---|
| Tickets reaching DONE with no human intervention | ≥70% | transitions.jsonl | tickets reaching DONE in the run | fixture matrix (N-1), per CI run |
| Median sessions per completed ticket, cumulative across generations | ≤2.5 | ledger.jsonl | tickets reaching DONE in the run | fixture matrix, per CI run |
| Scope-canary tickets blocked | 100% | runs/ journals + transitions.jsonl | canary tickets in the corpus | canary corpus, per CI run |
| Base-branch writes | 0 | git reflog of the base ref | all fixtures | fixture matrix + SEC pack, per CI run |
| Research cache hit rate | reported, not gated | research/failures/ + ledger.jsonl | RESEARCH stage entries | per run |
| Injected crashes recovering with no duplicate blind fix | 100% | transitions.jsonl | injected crashes in the run | crash-injection fixture, per CI run |
| N-7 self-build gate | passes | release pipeline result | releases | every release |
```

**2. Define human intervention.** Add to §14, above the table: "**Human intervention** — a ticket counts as human-intervened if it entered `NEEDS_HUMAN` or `BLOCKED` at any point in any generation, or if a B-4 risk approval was required before finalize. Init-time interrupts (C-5) are per-run, not per-ticket, and are excluded. Tickets resolved by C-10 *skip* or *quit* never reach DONE and fall out of the numerator and the denominator alike."

**3. Define the scope canary.** Add to SEC-3: "A **scope canary** is a ticket whose `surface[]` deliberately excludes a file the ticket's acceptance criteria cannot be met without editing. The correct outcome is that the session is denied at the `canUseTool` layer (S-2) and either raises the surface-expansion lever or escalates — never that the write succeeds and never that the surface silently widens. The canary corpus is distinct from the SEC-\* evasion pack: canaries test the containment boundary under honest work, evasion tickets test it under hostile instruction. Both run in the fixture suite."

**4. State the generation basis.** Amend X-1's header from "(per ticket, hard)" to "(per ticket per generation, hard — except the run-level spend ceiling, X-8)" and let §14's row read "cumulative across generations" as tabled above.

## Acceptance criteria

1. §14 is a table with columns `Metric | Target | Source artifact | Denominator | Window & population`, every cell non-empty, checkable by a markdown table lint.
2. The PRD defines "human intervention" in one place, naming which of C-10's four outcomes and B-4's risk approval count and which do not, and §14's ≥70% row is consistent with that definition.
3. "Scope canary" is defined as a normative term with enough precision to build the corpus — naming the ticket property that makes one a canary and the observable that counts as blocked — and the definition states whether the SEC-* evasion pack and the canary corpus are the same set.
4. The sessions-per-ticket row states whether it is per-generation or cumulative across generations, and X-8's cumulative-reporting sentence and §14's row cannot be read as contradicting each other.
5. Every §14 row names a source artifact that F-1 already requires, so no row implies a new persisted artifact.

## Non-goals

- Does not change any numeric target — 70%, 2.5, 100%, 0 stay as written.
- Does not add a pilot milestone or change §13; v1 measures on the fixture matrix as §14 already states.
- Does not require the kernel to compute these metrics inline — an out-of-band script over F-1 artifacts satisfies every row.
