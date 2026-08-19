---
id: PRDR-066
title: "N-7's named PRD filename (detent-prd-v3.md) is outside C-2's discovery pattern families — the self-build gate cannot discover its own document"
state: DONE
severity: normal
category: consistency
labels: ["prd-review", "found-by-execution"]
surface: ["detent-prd-v3.md", "detent-prd-v2.md"]
prd_refs: ["C-2", "N-7", "D-16", "D-20"]
acceptance_criteria:
  - "C-2's heuristic families include a pattern that matches the PRD filename N-7 names (`detent-prd-v3.md`), so the self-build's precondition is discoverable by the pipeline the gate runs."
  - "The addition is generic (any `*prd*` document), not a Detent-only special case hard-coded to one filename."
  - "The AWAIT_DOCS message continues to list exactly what was searched, including the new family."
non_goals:
  - "Does not rename the PRD document — D-20/PRDR-056 fixed its name and N-7's text names it; the discovery heuristics move toward the contract, not the reverse."
  - "Does not touch DISCOVER's determinism (C-2/N-2) or the AWAIT_DOCS interrupt semantics."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-066 — N-7's named filename is outside C-2's discovery families

**Severity:** normal · **Category:** consistency · **Found by:** the FIRST live firing of the
N-7 self-build gate (T-140), which red-ed out at `AWAIT_DOCS` before spending a cent.

## Problem

Two normative claims are internally inconsistent:

- **N-7 (D-16)**, as amended by PRDR-056/draft.6: the self-build gate runs on "a folder
  containing only this PRD", and the rename decision recorded that the gate **names this
  document's filename** — `detent-prd-v2.md` then, `detent-prd-v3.md` now.
- **C-2**: "planning docs (`PRD*`, `SRS*`, `README*`, `docs/**` heuristics …). No docs →
  AWAIT_DOCS with an exact list of what was looked for."

`detent-prd-v3.md` matches none of C-2's families — `PRD*` is a **prefix** family, and the
document's name carries `prd` as an infix. The gate therefore asks DISCOVER to find a file
DISCOVER is specified not to see. The inconsistency was invisible for the whole v2 line
because the self-build (T-070) never ran; T-140's first firing surfaced it immediately:

```
[AWAIT_DOCS]
No planning documents found in <n7 folder>.
Detent looked for:
  PRD*.md
  …
```

## Evidence (verbatim)

- N-7 (v2 §12, inherited by v3 with the v3 document named): "the ultimate integration test
  is Detent building itself — `detent init && detent run` on a folder containing only this
  PRD".
- PRDR-056 note (draft.6 header): "this document's filename, which N-7's self-build gate
  names".
- C-2 (v2 §4): "planning docs (`PRD*`, `SRS*`, `README*`, `docs/**` heuristics, current
  folder scope per user flow)".

## Resolution

Amend C-2's heuristic families with an **infix** prd family — `*prd*.md` / `*prd*.txt`
(case-insensitive on the `prd` token via the pattern set) — so any `<product>-prd*.md`
document is a planning document. This is the generic form of the fix: it makes N-7's own
document discoverable AND serves every user whose PRD carries a product prefix, which is a
common naming convention. The document is not renamed: D-20 fixed the name and N-7's text
names it; heuristics move toward the contract.

Applied to the v3 PRD as **C-2′** (3.0-draft.2). The v2 document stays frozen; v3 carries
the delta, consistent with the inheritance mechanism.
