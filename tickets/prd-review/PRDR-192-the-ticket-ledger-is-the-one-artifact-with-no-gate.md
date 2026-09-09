---
id: PRDR-192
title: "Every artifact in this repository has a gate except the tickets, and the record of WHY the code is the way it is has drifted in five directions"
state: OPEN
severity: minor
category: consistency
labels: ["prd-review", "found-by-audit", "observability", "process"]
surface: ["scripts/check-tickets.ts", "package.json", "tickets/prd-review/**", "AGENTS.md"]
prd_refs: ["N-6", "V-1‴"]
acceptance_criteria: ["`npm run tickets:check` validates every file in `tickets/prd-review/`: frontmatter present, the required keys present, `id` agreeing with the filename, `state` drawn from a closed set.", "The suffix convention (`PRDR-131a`, `PRDR-145a`/`145b`) is documented and validated, or removed. A counting script must not have to guess whether `PRDR-145` names one ticket, two, or none.", "`state` becomes trustworthy in BOTH directions, or it goes. Today `DONE` can be believed and `OPEN` cannot; a field that is right half the time is worse than an absent one, because it invites the reader to trust it.", "The 19 files carrying no frontmatter at all either get it, or the gate exempts them by name with the reason written down.", "Observed to FAIL first against the tree as it stands: 19 files with no frontmatter, 34 saying OPEN of which only three are, two acceptance-criteria encodings."]
non_goals: ["Does not introduce a workflow or state machine for PRDR tickets. This is validation of a record, not process for maintaining one.", "Does not touch `.detent/tickets/**`. The runtime ticket schema (A-2) is strict, validated and not the subject here.", "Does not require backfilling accurate `state` on 150 tickets by hand. Deriving status from evidence and deleting the field is an acceptable way to satisfy criterion 3 — arguably the better one."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-190", "PRDR-191"]
depends_on: []
---

# PRDR-192 — the record nothing checks

**Severity:** minor · **Category:** consistency · **Found by:** trying to answer "how many
tickets are still unimplemented" and getting three different numbers

## Problem

This repository gates everything it ships. `lint`, `typecheck`, `parity:check`,
`prompts:check` and `rules:check` all run, and PRDR-176 added the last of them precisely
because "enforced by review" means "enforced by someone remembering". The tickets are the
record of *why* the code is the way it is — 150 files, cited from source comments, quoted
in commit messages, and read by anyone who wants to know what a requirement cost. **Nothing
reads them.** `grep -rln "prd-review" scripts/ tests/ package.json` returns nothing at all.

Unsurprisingly, the record has drifted, in five separate directions:

| drift | count |
|---|---|
| files with **no frontmatter whatsoever** — a contiguous run, PRDR-132 → PRDR-150 | 19 |
| `state: OPEN` on work that demonstrably landed | 31 of 34 |
| two encodings of `acceptance_criteria` (inline array vs block list) | 104 / 27 |
| an undocumented id-suffix convention (`131a`, `145a`, `145b`) | 3 files |
| `id:` disagreeing with the filename it lives in | 1 |

## What the drift actually cost, today

Asked how many tickets were still unimplemented, three answers came out in sequence:

- **15**, from commit trailers and code citations — wrong, because it only searched
  `src/`, `tests/` and `scripts/`, and twelve tickets have surfaces in `prompts/`,
  `LICENSE`, or the v2 PRD.
- **3**, after cross-checking each against its own `state` field and spot-verifying two of
  them against the tree.
- The `state` field alone would have said **45** (34 OPEN + 11 READY).

The true answer is 3. Every route to it required re-deriving status from commits and
source rather than reading the ledger, because the ledger cannot be trusted — and the
suffix convention made a naïve script report `PRDR-131` and `PRDR-145` as duplicate ids
when they are neither duplicates nor, in 145's case, an id that exists.

That is a small cost paid repeatedly and silently. It is also exactly the failure class
PRDR-176 was filed for, one directory over.

## Why `state` is the interesting half

`DONE` is reliable — 86 tickets say it and the two spot-checked (PRDR-074's MIT licence,
PRDR-073's lever documented in `prompts/implement.md`) hold. `OPEN` is not: 34 say it and
3 are. Nobody marks done what is not done; everybody forgets to close what is.

A field that is right in one direction and wrong in the other is worse than no field,
because its correctness in the reliable direction is what persuades a reader to trust it in
the unreliable one. **Deleting `state` and deriving status from evidence is a legitimate
resolution of criterion 3, and probably the better one** — the evidence exists, it is what
this ticket's own investigation used, and unlike a hand-maintained field it cannot go
stale.

## Scope

`.detent/tickets/**` is untouched. Detent's runtime tickets already have the A-2 schema, a
strict validator, and a kernel that refuses malformed ones — which is the point: the
product holds its own tickets to a standard the project does not hold its own to.
