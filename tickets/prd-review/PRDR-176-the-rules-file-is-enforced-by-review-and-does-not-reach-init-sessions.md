---
id: PRDR-176
title: "Seven AGENTS.md rules are enforced by nothing, and the file's own claim that it reaches every session is false for init"
state: DONE
severity: major
category: gap
labels: ["prd-review", "found-by-audit", "rules"]
surface: ["scripts/check-rules.ts", "package.json", "src/init/pipeline.ts", "AGENTS.md"]
prd_refs: ["N-7", "S-6"]
acceptance_criteria: ["Every AGENTS.md rule that is mechanically decidable is enforced by a gate, not by review — and the gate names the rule it is enforcing so a failure is self-explaining.", "AGENTS.md actually reaches init sessions. Its own header says `readRules()` feeds it to every session Detent launches, and `src/init/pipeline.ts` never supplies `rulesText`, so init sessions are prompted with `(no rules file)`.", "The checker states what it does NOT check, so nobody reads a green gate as full compliance."]
non_goals: ["Does not attempt to mechanize the judgement rules — \"no narration\", \"one module one job\", \"readonly public shapes\", determinism seams. A checker that guesses at those would produce noise and train people to ignore it.", "Does not duplicate anything eslint already enforces."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-121"]
depends_on: []
---

# PRDR-176 — a rules file that half the sessions never see, and rules nothing checks

**Severity:** major · **Category:** gap · **Found by:** the full-project audit of `90a5051`,
extended while adding the checker

## 1. The rules do not reach init sessions

AGENTS.md's own header states the file is fed "to every session Detent launches". `src/init/session.ts`
declares `rulesText` and uses it — `stablePrefix(prompt, deps.rulesText ?? "(no rules file)", preamble)`
— and `src/init/pipeline.ts`, the only production caller, never supplies it. So ANALYZE, SLICE, PLAN
and every review session in the planning pipeline are prompted with the literal string
`(no rules file)`.

This is the dead-parameter shape this codebase keeps producing: a declared seam, a consumer, and no
supplier.

## 2. Seven rules are enforced by nothing

`npm run lint` covers the rules AGENTS.md marks `[lint]` — enums, default exports, line comments,
`eqeqeq`, `max-lines`, type-only imports, `prefer-const`/`prefer-template`/`object-shorthand`, and
`no-explicit-any` via the recommended set. The rest say "enforced by review". Seven of those are
mechanically decidable and enforced nowhere:

| rule | section |
|---|---|
| no `helpers.ts`/`utils.ts` grab-bags in `src/` | Files |
| `TODO` requires a ticket id | Comments |
| no `console.*` in `src/` | Errors |
| an empty `catch` carries a block comment | Errors |
| `.only`/`.skip` never merge (a kept skip cites its ticket) | Tests |
| `node:`-prefixed builtins | Language |
| explicit `.js` specifiers on relative imports | Language |

The codebase currently satisfies all seven, so this gate is a REGRESSION guard rather than a
cleanup. That is worth stating: adding it fixes nothing today and prevents drift tomorrow, and a
ticket that implied otherwise would be the kind of false claim this chain keeps producing.
