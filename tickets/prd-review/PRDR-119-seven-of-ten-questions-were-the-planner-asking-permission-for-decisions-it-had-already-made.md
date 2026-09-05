---
id: PRDR-119
title: "Seven of the first slice's ten questions were the planner seeking confirmation of decisions it had already justified from the documents, and two of them shared an id"
state: DONE
severity: major
category: usability
labels: ["prd-review", "found-by-execution"]
surface: ["prompts/planner.md", "src/init/plan.ts", "src/init/plan-slices.ts", "src/init/present.ts", "detent-prd-v3.md"]
prd_refs: ["C-3", "C-3′", "C-2‴", "D-24"]
acceptance_criteria: ["The planner raises a question only for a fact outside the documents and outside engineering judgement; anything a competent engineer could settle from the documents is settled, and the decision with its reason is recorded in the ticket description, the slice rationale, or the analysis assumptions.", "The plan draft's `expected_output` shows the question shape, so a planner emitting one does not have to infer it.", "Question ids are unique within a slice across its first and revised drafts, and unique across every stage in the batch presented at approval."]
non_goals: ["Does not change C-3′'s batching, the interrupt set, or when questions are asked. Only what earns a place in the batch.", "Does not cap or truncate questions. A run that genuinely needs forty asks forty.", "Does not add a schema field for recorded decisions — the ticket description, slice rationale and analysis assumptions already exist."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-117", "PRDR-118"]
depends_on: ["PRDR-117"]
---

# PRDR-119 — seven of ten questions were the planner asking permission

**Severity:** major · **Category:** usability · **Found by:** the first full-product `detent
init` on ksar-cloud, 4 September 2026

## What happened

C-3′ made planning run to the end without stopping, batching every question for one
conversation at approval. The mechanism worked. What it batched did not survive contact with
a nineteen-slice product.

Slice one raised ten questions. Seven were the planner asking to have a decision confirmed
that it had already made, justified from the documents, and written a defensible assumption
for:

> *Is host networking acceptable in slice 01?* — "Host networking, stated as a slice-01
> simplification. One trusted node. Port allocation, network namespaces and nftables arrive
> with the tenant-isolation slice (ADR-007)."

> *How do the control plane and agent authenticate to NATS in slice 01?* — "One NATS
> user/password from the bootstrap script, plaintext on loopback; per-node credentials, TLS
> and accounts arrive with the WireGuard-mesh slice."

One asked whether it was acceptable for every component to share a single Linux host — which
the slice document itself requires.

Three were real: a conflict between the production baseline's dependency audit (PB-004) and
D44's network-free canonical gates, and two facts only the founder holds.

At ten per slice across nineteen slices that is roughly two hundred questions at approval,
against perhaps twenty-five that a human must actually decide. The batch C-3′ built to make
approval a single sitting becomes a document nobody can act on, and the real questions are
buried in it.

Separately, the same slice presented two questions with the id `s01-q1`, two with `s01-q2`,
and so on: a slice's first draft and its revision each number their questions from one, and
the merge deduplicated on question text rather than on id.

## Evidence

C-3′ as written says what the batch is for, and the rule it needed was there but too weak to
bind:

> Every question a stage cannot answer — ANALYZE's, SLICE's, each slice's PLAN — carries the
> assumption the plan proceeds on, and the batch is asked ONCE, with the whole plan, at
> PRESENT: the human answers and approves in the same sitting.

The prompt's only guard was one sentence — "A decision the documents already make is never a
question" — which a planner reads as permission to ask about anything the documents do not
state outright.

## Resolution

C-3″: a question is only for a fact outside the documents AND outside engineering judgement.
Everything else is settled, and the decision plus its reason is recorded where the work is —
the ticket's `description`, the slice's `rationale`, the analysis's `assumptions`. The prompt
now says so at length and says the quiet part: asking to have a defensible decision confirmed
buries the decisions that matter.

The draft skeleton gained the question shape, which it had never shown even though the
instruction demanded the field. Ids are assigned over a slice's merged draft-and-revision set,
and the presented batch enforces uniqueness across stages.

Exercised by `tests/init/slicing.test.ts`, which drives three stages and two drafts of one
slice through the pipeline and asserts every presented id is distinct and no question was lost
to another's id.
