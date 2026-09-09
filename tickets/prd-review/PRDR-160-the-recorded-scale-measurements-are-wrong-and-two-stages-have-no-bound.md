---
id: PRDR-160
title: "The recorded whole-plan scale measurements are wrong, contradict each other, and two of the five stages carry no bound at all"
state: DONE
severity: minor
category: defect
labels: ["prd-review", "found-by-audit", "recorded-fact"]
surface: ["tests/init/slicing-scale.test.ts"]
prd_refs: ["C-2‴", "X-1⁗"]
acceptance_criteria: ["Every size recorded in the file is a number measured through the file's own instrumentation, and the file does not state two different values for the same measurement.", "The stage whose payload grew 52% in the same commit that re-baselined its neighbour carries a bound, so the file's self-description as \"the tripwire\" is true of more than one stage.", "Any bound whose headroom moved materially in that commit is re-derived and its new margin recorded, rather than left at a number nobody checked."]
non_goals: ["Does not reduce any payload. This is about the honesty of the tripwire, not the size of the prompt — the 484 KB whole-plan review remains an open product limit with its own record."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-143"]
depends_on: []
---

# PRDR-160 — a tripwire whose recorded calibration is fiction

**Severity:** minor · **Category:** defect · **Found by:** the audit of `7d9526c`

## Problem

The commit's stated rationale is that the number is "recorded rather than merely raised, because it
is a PRODUCT limit and not a test parameter". That makes the recorded numbers load-bearing. Measured
through the test's own instrumentation:

| stage | measured | bound | % of bound |
|---|---|---|---|
| ANALYZE | 1.51 KB | — | — |
| SLICE | 8.00 KB | `< 50` | 16% |
| PLAN | 106.64 KB | `< 150` | **71.1%** |
| REVIEW:slice | 125.39 KB | **none** | — |
| REVIEW:whole | 484.11 KB | `< 600` | **80.7%** |

Three problems.

1. The file states the empty-shape whole-plan figure as **171.9 KB**, twice. It matches neither the
   pretty form the test measures nor the compact form.
2. The file states the realistic figure as **465 KB** in one comment and **~484 KB** in another,
   for the same measurement in the same file. The measured value is 484.11.
3. `PLAN` went from roughly half its unchanged `< 150` bound to **71.1%** of it in this commit,
   and `REVIEW:slice` — the second-largest payload, and the one that grew 52% — is asserted by
   nothing at all, in the file that calls itself the tripwire.
