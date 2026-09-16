---
id: PRDR-247
title: "`rules:check` and `tickets:check` are the only npm gates no workflow runs, so the conventions they enforce were enforced by memory"
state: DONE
severity: major
category: process
labels: ["prd-review", "ci", "release", "N-6", "found-in-use"]
surface: [".github/workflows/ci.yml", ".github/workflows/release.yml", "docs/release-checklist.md"]
prd_refs: ["N-6", "V-6", "C-14′"]
acceptance_criteria: ["`npm run rules:check` and `npm run tickets:check` run in `ci.yml` on every pull request and every push to main, on both Node lines.", "Both run in `release.yml`'s \"No green, no release\" step, before any tag is pushed.", "`docs/release-checklist.md` item 1 names every command the two workflows run, so the documented gate and the enforced gate are the same list."]
non_goals: ["Does not change what either checker checks, or its UNCHECKED list.", "Does not add the remaining release-checklist items (plugin:validate, install smoke, N-7 self-build) to CI; those need credentials or a human and are separately gated.", "Does not make the ticket gate decide whether a `DONE` is honest — `check-tickets.ts` disclaims that itself."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-176", "PRDR-192", "PRDR-239", "PRDR-243"]
depends_on: []
---

# PRDR-247 — a gate nobody runs is a convention, not a gate

## Problem

`package.json` has seven check scripts. `ci.yml` ran five of them and `release.yml`'s
"No green, no release" step ran the same five. `rules:check` (PRDR-176) and
`tickets:check` (PRDR-192) ran in neither, and in no other workflow — they were the only
two npm gates in the repository that no pipeline invoked.

So every rule they enforce was enforced by someone remembering to type the command:
AGENTS.md's grab-bag filenames, TODO markers without a ticket, `console.*` in `src/`,
empty catches with no stated why, `.only`/`.skip`, `node:` prefixes and `.js` specifiers;
and on the ticket side the thirteen required frontmatter keys, the state vocabulary, and
the stale-open rule.

## What made it visible

One afternoon's work on `fix/doc-claim-drift`, where `tickets:check` caught four real
mistakes in a row that nothing else would have:

- a `PRDR-242` citation written into `src/sessions/sdk.ts` while that ticket was `OPEN`
  — naming a ticket in shipped code is one of the ways a claim comes to read as
  delivered, which is the exact defect class that branch was correcting;
- the same for `PRDR-244`, `PRDR-245` and `PRDR-246` before each was closed.

Every one of those would have merged. The rule is sound and the checker works; it simply
was not wired to anything.

## Scope

Both checkers already pass on a clean tree, so this is wiring, not a fix: the commit that
adds them is green on the commit before it. That is also why it is worth doing now rather
than after the gate — it costs nothing and closes the window in which a convention drifts
because the only thing enforcing it is habit.

The remaining release-checklist items stay out of CI deliberately: `plugin:validate` is
covered by the suite's staleness test, and the install smoke and the N-7 self-build need
credentials and a human (R-10).
