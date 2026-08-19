---
id: PRDR-064
title: "Name the A-2 plan artifact's home in F-1 — readers of plan/ maintain a growing exclusion list"
state: DONE
severity: minor
category: gap
labels: ["prd-review"]
surface: ["detent-prd-v2.md"]
prd_refs: ["F-1", "A-2", "C-7", "C-8"]
acceptance_criteria: ["F-1 names every file `plan/` contains, or states the rule by which a reader distinguishes a ticket file from a non-ticket file.", "A-2's plan artifact — ordered refs, dependency edges, per-ticket assignment, input-doc hashes — has a stated location.", "Adding a committed artifact to `plan/` does not silently break a reader that enumerates the directory.", "The rule holds for the two non-ticket files that already exist (`approval.json` and the plan artifact)."]
non_goals: ["Does not change what A-2 contains, nor split it across files.", "Does not move tickets out of `plan/`.", "Does not require a manifest file; a naming rule (e.g. a prefix, or an explicit enumeration) is sufficient."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-064 — Name the A-2 plan artifact's home in F-1

**Severity:** minor · **Category:** gap · **Amends:** F-1

## Problem

F-1 describes the committed plan directory as "`plan/` (tickets `*.json`, `approval.json`)". A reader enumerating that directory therefore treats every `*.json` as a ticket, minus the one exception the PRD names.

A-2 defines a plan artifact — "ordered ticket refs + dependency edges + per-ticket agent assignment + input-doc hashes" — and F-1 gives it no location. Its fields have nowhere else to live: `input_doc_hashes` is what C-8 replays against, and per-ticket assignments are what S-7 pins, so neither is derivable from the ticket files alone.

The practical consequence is an exclusion list that grows by accident. The ticket reader was written to skip `approval.json` because F-1 named it; writing the plan artifact to `plan/plan.json` broke that reader immediately, because the second non-ticket file was not on a list nobody knew was load-bearing. That is two accidents from one unstated rule, and the next committed artifact in `plan/` will be a third.

The fix is not to enumerate harder. It is for F-1 to state how a reader tells a ticket from a non-ticket — a naming rule, or an explicit complete enumeration that a reader can assert against and fail loudly when it drifts.

## Evidence (verbatim from detent-prd-v2.md)

- F-1: "**Committed:** `config.json` (schema_version, budgets, protected/risk globs, model routing, pinned SDK/CLI versions), `bindings.json` (§6), `plan/` (tickets `*.json`, `approval.json`), `research/` (`failures/` env-composite-keyed briefs per X-6/D-18; `planning/` question-keyed briefs), `agents/assignments.json`."
- A-2: "**A-2 Plan:** ordered ticket refs + dependency edges + per-ticket agent assignment + input-doc hashes; `approval.json` {approved_by, at, plan_hash}."
- C-8: "Re-running `init`: replays from the first checkpoint whose inputs drifted (F-4)."

## Proposed change

**1. Name the artifact.** Amend F-1's plan entry to: "`plan/` (tickets `<ticket-id>.json`, plus the plan artifact `plan.json` and the approval record `approval.json`)".

**2. State the rule readers use.** Append to F-1: "A file in `plan/` is a ticket if and only if its name is not one of the reserved names `plan.json` and `approval.json`. The reserved set is closed; adding a committed artifact to `plan/` requires adding it here, and a reader that enumerates the directory asserts against this set rather than carrying its own."

## Acceptance criteria

1. F-1 names every file `plan/` contains, or states the rule by which a reader distinguishes a ticket file from a non-ticket file.
2. A-2's plan artifact — ordered refs, dependency edges, per-ticket assignment, input-doc hashes — has a stated location.
3. Adding a committed artifact to `plan/` does not silently break a reader that enumerates the directory.
4. The rule holds for the two non-ticket files that already exist (`approval.json` and the plan artifact).

## Non-goals

- Does not change what A-2 contains, nor split it across files.
- Does not move tickets out of `plan/`.
- Does not require a manifest file; a naming rule (e.g. a prefix, or an explicit enumeration) is sufficient.

## Resolution (applied)

Applied to the v3 PRD as part of **F-1′ (3.0-draft.4)**: `plan/plan.json` named as A-2's home,
the reserved-name rule stated, the set closed. The code's `NON_TICKET_FILES` already implemented
the rule; the PRD text now owns it. Raised back to the surface — verbatim — by the N-7 analyst
reading the PRD during T-140's fifth firing, which is the dogfooding working as designed.
