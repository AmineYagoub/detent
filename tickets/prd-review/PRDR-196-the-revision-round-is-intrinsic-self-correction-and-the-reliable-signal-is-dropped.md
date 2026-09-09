---
id: PRDR-196
title: "The per-slice revision round is intrinsic self-correction — the configuration the literature says fails — and the deterministic checker's findings, the reliable ones, never reach the operator"
state: OPEN
severity: major
category: design
labels: ["prd-review", "found-by-live-run", "planning", "cost", "research-backed"]
surface: ["src/init/plan.ts", "src/init/plan-slices.ts", "src/init/present.ts", "src/init/contracts.ts", "detent-prd-v3.md"]
prd_refs: ["PRDR-084", "PRDR-117", "PRDR-120", "PRDR-193", "A-1‴", "C-4", "D-24"]
acceptance_criteria: ["`contracts.findings` reaches PRESENT. The deterministic checker's findings are the reliable ones and are currently the only ones an operator never sees — the log carries them and the plan output does not.", "The mechanical checker is widened where a thing is EXACTLY decidable: duplicate file ownership already is; ticket-size proxies (module count, criteria count, surface breadth) largely are. That is where the sizing findings and several coherence findings live.", "Feedback quality is measured directly — finding IDENTITY across rounds, not counts. Whether the revision fixes the findings it was given is unknown today, and no fix can be chosen without it.", "Only then is it decided whether the intrinsic revision round earns its cost, or whether that budget belongs in the deterministic checks."]
non_goals: ["Does NOT add revision rounds. Convergence takes 3-5 rounds where it happens at all, but more rounds of INTRINSIC critique is the thing the evidence says does not work — the missing ingredient is an external signal, not more passes.", "Does not remove the whole-plan review. Sixteen coherence findings on this run were genuine cross-ticket contradictions no code decides.", "Does not touch D-24: the review advises and never blocks. That was right and stays."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-084", "PRDR-120", "PRDR-193"]
depends_on: []
---

# PRDR-196 — a loop built in the shape that does not work

**Severity:** major · **Category:** design · **Found by:** counting the gate-312 log, then
checking the counting against the literature

## The measurement

Every slice runs plan → review → **revise** → re-review. The revision session is handed the
specific findings and asked to fix them. Across the 19 rounds this run logged:

| | |
|---|---|
| revision made it **worse** | **11 slices** |
| no change | 6 |
| better | **2** |

```
s01   2 →  7        s05   3 →  5        s11   2 →  4
s14   2 →  4        s10   6 →  5        s03   5 →  4
```

## What the literature says about exactly this shape

Detent's loop is LLM-plan → LLM-review → LLM-revise → LLM-review with **no external signal at
any step**. That is *intrinsic self-correction*, and the TACL survey of the field
([Kamoi et al.](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00713/125177/)) states
that "no prior work demonstrates successful self-correction with feedback from prompted LLMs,
except for studies in tasks that are exceptionally suited for self-correction". ICLR 2024's
["LLMs Cannot Self-Correct Reasoning Yet"](https://arxiv.org/abs/2310.01798) reports
degradation, not improvement, across plan generation among other tasks.

**The bottleneck is the critic, not the reviser.** The survey names it: "the bottleneck is in
the feedback generation", and critics hallucinate errors and produce false positives. That
explains the table above better than "the revision breaks things" — a fresh review of freshly
rewritten text finds fresh things, some of them spurious. The revision may be doing its job
while the count still rises. **Which of those two it is, is not currently knowable**, and that
is the point of criterion 3.

Where these loops converge at all it takes 3–5 rounds. Detent does one. But the answer is not
more rounds: more intrinsic critique is the failing ingredient.

## What works, and Detent already has one

Self-correction succeeds when an EXTERNAL verifier supplies the feedback — code with an
interpreter, math with a symbolic checker. Current practitioner guidance is the same shape:
deterministic verifiers are interpretable, executable and highly accurate where applicable
though narrow, so use them for what is exactly decidable and reserve the model for judgement.

`applyContracts` is precisely that verifier, and PRDR-193 already moved it ahead of the paid
review — 7 findings proved for free on this run's first pass. That was the right direction,
reached without knowing the literature agreed.

## The inversion

```
plan.json:  findings (mechanical):   0
            review_findings (paid): 74
```

[`plan.ts`](../../src/init/plan.ts) notes `contracts.findings` to the log and **never carries it
into the phase outputs**; the outputs block carries `review_findings` and `derived_edges` and
not the contract findings. So the reliable signal is the one an operator never sees at PRESENT,
while all 74 model findings are surfaced. It is exactly inverted from what the evidence
supports, and it is why a review of this plan shows 74 judgement calls and zero mechanical ones.

## Cost

Roughly half the planning spend — about $150 of this run's $330 — buys the revision sessions and
their re-reviews, for a step whose measurable effect on finding counts is neutral-to-negative
and whose effect on finding IDENTITY nobody has measured.
