---
id: PRDR-056
title: "Resolve OQ-1: rename Foreman to Detent across every surface, including the wire formats"
state: DONE
severity: major
category: scope
labels: ["prd-review"]
surface: ["detent-prd-v2.md"]
prd_refs: ["OQ-1", "OQ-2", "C-14", "C-12", "F-1", "F-3", "B-1", "N-7", "M4", "D-2"]
acceptance_criteria: ["OQ-1 is removed from §16 and the chosen name is recorded as a decision-log entry with its rationale, so the resolution is traceable rather than implicit in a find-and-replace.", "Every persisted identifier that carries the old name — the state directory, the commit trailer, the run-branch prefix — is renamed, and each is accounted for as a schema or history concern rather than as prose.", "The porcelain rename is recorded against C-14's major-version rule rather than made silently, since C-14 governs the exact command strings being changed.", "N-7's self-build gate and the PRD filename it depends on stay consistent with each other after the rename.", "Historical `prd-review` evidence is governed by a stated rule, so the audit trail is not falsified by the rename."]
non_goals: ["Does not resolve OQ-2 (license); the two travel together at T-083 but are independent decisions.", "Does not change any requirement's semantics — this is an identifier rename plus the migration machinery it implies.", "Does not rename the Python reference implementation or its release artifacts; the oracle is a historical artifact and keeps its name."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-056 — Resolve OQ-1: rename Foreman to Detent across every surface, including the wire formats

**Severity:** major · **Category:** scope · **Amends:** OQ-1, C-14, F-1, F-3, B-1, N-7, M4, Decision Log

**Applied in 2.0-draft.6.** Evidence below quotes the pre-rename document and is preserved verbatim per the N-6 rule this ticket adds.

## Problem

OQ-1 asks whether to take a scoped npm name or rename, and frames the question as registry availability. Two things make that framing insufficient.

**The collision is threefold and not a squat.** `foreman` on npm is `node-foreman` (strongloop), "Node Implementation of Foreman", last modified 2026-04-14 — actively maintained. `foreman` on RubyGems is the original Procfile process manager it ports. And theforeman.org is a mature, Red Hat-sponsored infrastructure lifecycle management platform, upstream of Red Hat Satellite. All three are developer or operations CLI tooling. A scoped package name answers none of this: the project would still be called Foreman, in the same neighborhood as an established trademark holder.

**The binary name is where users actually collide, and OQ-1 does not mention it.** A package name and its `bin` name are independent — `@scope/anything` may declare `"bin": {"foreman": …}`. But both the Ruby gem and node-foreman install a `foreman` executable on PATH. C-14 freezes the golden path as `foreman init` and `foreman run`. So under the scoped-name option, a user who installs the package and types `foreman run` executes whichever binary won the PATH race, silently, as the wrong tool — not as an error. Scoping relocates the problem to the one place it cannot be worked around.

**`detent` is available and fits better than the name it replaces.** A detent is the click-stop that holds a mechanism in exactly one defined position and resists leaving it without deliberate force. That is X-3: the machine occupies one state, every `(state, event)` pair outside the table raises, and movement happens only through a defined event. "Foreman" named the role a session plays; "detent" names the invariant the kernel enforces — which is the thing this document is actually about. It is unregistered on npm and free of collision on PATH, so it resolves both halves of OQ-1 at once.

**The rename is not a find-and-replace, and that is the substance of this ticket.** The old name appears in five kinds of place, and only the first is cosmetic:

| Surface | Nature | Consequence |
|---|---|---|
| Product name, prose | Cosmetic | Safe |
| `.foreman/` (F-1) | **Persisted layout** | Every initialized repository's state directory moves — an F-3 migration, not a rename |
| `Foreman-Ticket:` trailer (B-1) | **Immutable history** | Trailers already written stay written; readers must accept both forms permanently |
| `foreman/run-<id>` branch prefix (B-1) | Persisted ref namespace | Existing run branches keep the old prefix |
| `foreman init` / `foreman run` (C-14) | **Frozen porcelain** | C-14 makes adding a porcelain command a major-version decision requiring a PRD amendment; renaming both is larger than adding one |
| `foreman-prd-v2.md` (N-7) | Gate input | N-7 specifies a folder containing "only this PRD"; the filename is load-bearing for the self-build gate |

Left unstated, each of these becomes a defect discovered during M4 rather than a decision made now — and T-083, which OQ-1 blocks, sits two hops from the terminal node of the critical path.

## Evidence (verbatim from foreman-prd-v2.md)

- OQ-1: "npm name (`foreman` is taken): scoped `@<org>/foreman` vs rename. Blocks M4 only."
- C-14: "The golden path is exactly two commands and the five C-5 interrupts. Adding a porcelain command or an interrupt class is a **major-version** decision requiring a PRD amendment"
- F-1: "Layout under `.foreman/` (git root only):"
- B-1: "every commit carries a `Foreman-Ticket: <id>` trailer"
- B-1: "`run` creates `foreman/run-<id>` off the base branch and commits directly to it"
- F-3: "Every committed file carries `schema_version`; migrations are explicit, versioned, and tested"
- N-7: "`foreman init && foreman run` on a folder containing only this PRD must read the PRD, generate its own tickets, select its own agents, build, test, and review its way to DONE on the walking skeleton."
- D-2: "Public open source, npm-distributed | Stated product goal"

## Proposed change

**1. Record the decision.** Add to the Decision Log:

"| D-20 | Product name is **Detent**; `foreman` is unavailable on npm and RubyGems and collides on PATH with two established tools, and theforeman.org holds the name in adjacent territory | PRD review 2026-08-17; a scoped package name would not have resolved the binary collision, which is where users encounter it. *Detent* — the click-stop holding a mechanism in one defined position — names X-3's invariant rather than a session's role |"

**2. Remove OQ-1** from §16, leaving OQ-2 (license) as the sole M4 blocker.

**3. Rename identifiers**, case-preserving, throughout: product name, `.detent/`, `Detent-Ticket:`, `detent/run-<id>`, `detent init` / `detent run` / `detent verify sync` / `detent doctor`, and this document to `detent-prd-v2.md`.

**4. Give the persisted renames their migration.** Append to F-3: "The v0→v1 migration additionally relocates the state directory from `.foreman/` to `.detent/`, and is the only sanctioned path — a repository initialized before the rename is migrated, never dual-read." Append to B-1: "Commit trailers written before the rename remain `Foreman-Ticket:`; history is immutable, so any reader of trailers accepts both forms permanently while only the current form is written. The same holds for run branches carrying the old prefix."

**5. Record the porcelain change against C-14.** Append: "The rename of both porcelain verbs at draft.6 is such a major-version decision, taken here deliberately and before any release; C-14's freeze binds from v1 onward."

**6. State the evidence rule for existing tickets.** Append to N-6: "`prd-review` tickets quote the document as it stood when the finding was filed. Evidence blocks predating a rename are preserved verbatim and are not retro-edited — they record what the document said, not what it says."

## Acceptance criteria

1. OQ-1 is removed from §16 and the chosen name is recorded as a decision-log entry with its rationale, so the resolution is traceable rather than implicit in a find-and-replace.
2. Every persisted identifier that carries the old name — the state directory, the commit trailer, the run-branch prefix — is renamed, and each is accounted for as a schema or history concern rather than as prose.
3. The porcelain rename is recorded against C-14's major-version rule rather than made silently, since C-14 governs the exact command strings being changed.
4. N-7's self-build gate and the PRD filename it depends on stay consistent with each other after the rename.
5. Historical `prd-review` evidence is governed by a stated rule, so the audit trail is not falsified by the rename.

## Non-goals

- Does not resolve OQ-2 (license); the two travel together at T-083 but are independent decisions.
- Does not change any requirement's semantics — this is an identifier rename plus the migration machinery it implies.
- Does not rename the Python reference implementation or its release artifacts; the oracle is a historical artifact and keeps its name.
