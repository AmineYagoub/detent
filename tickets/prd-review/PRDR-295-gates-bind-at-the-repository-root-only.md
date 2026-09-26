---
id: PRDR-295
title: "Gates bind at the repository root only, a deliberate v1 limit (D-5, V-5, NG2), so a ticket whose surface lies in another package has no gate that can fail: 69 of ksar-cloud's tickets wrote `dashboard/`, 41 wrote nothing else, and its gates ran Go at the root. The operator's decision settles OQ-4: DETERMINE_VERIFICATION binds every package's gates, a pack may declare them, and a ticket that no bound gate covers cannot be approved"
state: OPEN
severity: major
category: capability
labels: ["prd-review", "planning-redesign", "operator-decision", "D-5", "V-5", "OQ-4", "F-3", "gates"]
surface: ["src/adapter/discover/index.ts", "src/adapter/discover/node.ts", "src/adapter/discover/go.ts", "src/adapter/workspace.ts", "src/adapter/run.ts", "src/init/bind.ts", "src/kernel/referee-gate.ts", "src/kernel/run-toolchain.ts", "src/schemas/gates.ts", "detent-prd-v3.md", "tests/init/bind-packages.test.ts"]
prd_refs: ["D-5", "V-5", "NG2", "OQ-4", "V-1", "C-3b", "F-3", "PRDR-115", "PRDR-211", "PRDR-276", "PRDR-278"]
acceptance_criteria: ["DETERMINE_VERIFICATION finds a manifest in every package directory, not only the root, for each ecosystem an adapter supports. It binds each package's gates with that package as their working directory, and records the bindings in the persisted shape D-5 anticipated, under F-3.", "A pack may declare packages and their gate commands (PRDR-279). Declared commands are the bindings, as documented commands are today (PRDR-115).", "A ticket's gates are those of the packages its surface touches, and `run` runs exactly those. A test with a two-package repository asserts that a ticket touching one package runs only that package's gates, and a ticket touching both runs both.", "A ticket whose surface falls under no bound gate fails the gate-coverage check (PRDR-293), which blocks approval.", "`run`'s toolchain check (PRDR-276) covers the toolchain of every package.", "The PRD amendment (PRDR-278) records the change to D-5, V-5 and NG2, and closes OQ-4."]
non_goals: ["Does NOT invent gates for a package that has none. That package's tickets block approval until the pack declares its gates or the operator binds them.", "Does NOT weaken V-1's execute-before-approve rule."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-115", "PRDR-211", "PRDR-276"]
depends_on: ["PRDR-278"]
---

# PRDR-295 — gates per package

## Where this came from

The ksar-cloud plan (the planning audit of 2026-09-26, §8). 69 tickets write `dashboard/`, a Node
package, and 41 of them write nothing else. The repository's gates were bound at the root, to Go.
No gate could fail for those tickets. The planner saw the gap and wrote it into the notes of
t-s13-001, and nothing acted on it.

## Problem

Root-only binding is deliberate. D-5 says "root-only in v1; workspace scoping is a named v2
migration", NG2 lists per-workspace gates as a non-goal, V-5 binds root entrypoints only, and OQ-4
left the design open. `src/adapter/workspace.ts` keeps that promise: a detected workspace changes
which ROOT command is proposed, and nothing else.

A product with more than one package, which ksar-cloud and ksarjs both are, therefore has tickets
that are verified by nothing.

## Design

The redesign plan's §8. This is the migration D-5 named, with `schema_version` carrying the
upgrade, as D-5 said it would.
