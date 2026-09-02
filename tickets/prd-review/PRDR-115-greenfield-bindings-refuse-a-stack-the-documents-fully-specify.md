---
id: PRDR-115
title: "Greenfield init refused a Go project whose documents named all three canonical gates, because the stack lookup wanted the exact word 'go' and got a sentence"
state: DONE
severity: major
category: correctness
labels: ["prd-review", "found-by-execution"]
surface: ["src/init/bind.ts", "src/init/analyze.ts", "src/schemas/init.ts", "prompts/planner.md", "detent-prd-v3.md"]
prd_refs: ["V-1", "C-4", "C-3", "D-10"]
acceptance_criteria: ["`stack.language` written as prose that names a known language still resolves to that language's table row; an exact name still wins.", "Verification commands the documents name reach ANALYZE's output as `stack.verification` and become the provisional bindings ahead of any table.", "A stack with no known language and no documented commands still interrupts as before, naming what to add to the documents.", "The planner is told both rules at ANALYZE."]
non_goals: ["Does not execute anything at init in greenfield — the bindings stay provisional and bootstrap #1 still proves them (C-4).", "Does not grow the table beyond the five languages it has; the documents are the general answer."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-076", "PRDR-114"]
depends_on: []
---

# PRDR-115 — greenfield bindings refuse a stack the documents fully specify

**Severity:** major · **Category:** correctness · **Found by:** `detent init` on ksar-cloud,
second pass, 2 September 2026

## What happened

The first ANALYZE wrote `stack.language: "Go"`. After the founder answered two questions in
the slice document and init replayed, the second ANALYZE — better informed — wrote:

> `Go 1.27 (multi-module monorepo: controlplane/, agent/, cli/, contract/ under a
> committed root go.work; PostgreSQL via goose migrations; NATS JetStream; …)`

`provisionalBindingsFor` lowercased that and looked it up in the five-row table. Nothing
matched, and init stopped at `AWAIT_SETUP_CONSENT`:

> No conventional verification commands are known for the chosen stack, so Detent cannot
> propose even provisional bindings. Name the stack's test command in the planning documents.

The documents had named them. D44 pins `go test ./...`, `go vet ./...`, `go build ./...` as
the canonical gates; the README repeats them; the same analysis quoted all three in its own
`test_framework` field. Init asked the founder for information it was holding.

## Resolution

Two rules, both told to the planner. The language key is the first known language named
as a word in `stack.language` (exact match first). And the documents win: ANALYZE copies
the commands the documents name into `stack.verification`, exactly as written, and those
are the provisional bindings — the table is the fallback for documents that name none. A
stack with neither still interrupts, naming what to add.
