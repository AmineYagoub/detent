---
id: PRDR-285
title: "ksarjs's money verifier found a rounding defect by running a randomized ledger simulation (a chargeback share that stranded a cent in 956 of 8,000 sequences), and confirmed two later majors with a 40,000-sequence run. `init` sessions are read-only and cannot run one. VALIDATE's reviewers get a sandboxed scratch directory outside the repository, where they may write and run throwaway scripts that report and never edit"
state: OPEN
severity: major
category: capability
labels: ["prd-review", "specification-phase", "operator-decision", "S-1′", "containment", "sandbox"]
surface: ["src/init/session.ts", "src/sessions/guard.ts", "src/init/allowlist.ts", "src/schemas/roles.ts", "src/init/validate.ts", "tests/init/scratch-containment.test.ts", "tests/plugin/hostile.test.ts"]
prd_refs: ["S-1′", "D-22", "SEC-3", "SEC-5", "PRDR-067", "PRDR-278", "PRDR-284"]
acceptance_criteria: ["A reviewer that simulates, a `spec_review` session (decision 15), gets a scratch directory outside the repository and outside `.detent/`, created for the round and removed after it. It may write there and run what it wrote, and nothing else.", "Execution is sandboxed below the hook. A script the reviewer runs cannot write outside the scratch directory or reach the network, whatever it contains, and a hostile-fixture test runs a script that tries both. Where the platform offers no such sandbox, simulation is off and the round says so.", "The simulation reports and never edits. Its results are findings, each with the sequence that broke an invariant, and only VALIDATE's writer changes the pack.", "Scripts run under a time limit and an output limit. A script that exceeds either is a finding, not a hang.", "Nothing in the scratch directory is committed, or read by a later phase, except the round's findings.", "The sandbox belongs to the `spec_review` role's tools and to no other role's."]
non_goals: ["Does NOT give AUDIT, DECIDE or WRITE execution; only VALIDATE's reviewers get it.", "Does NOT let a simulation install packages or fetch dependencies. It uses the interpreter the machine has, and says which.", "Does NOT keep simulation code as a pack artifact. A property a simulation checks belongs in the pack as a requirement with a criterion, and the build then tests it."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-067", "PRDR-284"]
depends_on: ["PRDR-284"]
---

# PRDR-285 — sandboxed scratch execution for VALIDATE's reviewers

## Where this came from

In ksarjs, the money reviewer ran randomized simulations of the ledger rules.
- **Round 2:** 956 of 8,000 random sequences hit a rounding collision, so the planned property
  test could never have passed.
- **Round 6:** 40,000 sequences confirmed two money majors, and showed that the proposed fixes
  removed them.
- **Round 7:** 40,000 sequences cleared the main properties.

Each simulation ran as throwaway Python inside the reviewer's session. None was saved.

## Problem

S-1′ (PRDR-067) gives `init` sessions a read-only surface plus exactly one write rule. A reviewer
that can only read can state an invariant but not test it, and in ksarjs the simulations were
what found or confirmed the money defects.

## Design

The plan's §7, step 6. Running code is a containment change, so it is sandboxed below the hook
rather than trusted to it: the hook sees the command, not what the script then does. The
sandbox's scope is the scratch directory and no network. The reviewer reports, and the writer
edits.
