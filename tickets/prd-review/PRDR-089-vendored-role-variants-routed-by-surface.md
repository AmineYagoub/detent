---
id: PRDR-089
title: "Vendored role variants, routed by the ticket's surface"
state: DONE
severity: minor
category: capability
labels: ["prd-review", "user-raised"]
surface: ["prompts/", "src/sessions/prompts.ts", "src/kernel/referee-session.ts", "src/kernel/worstcase.ts"]
prd_refs: ["S-7", "S-6", "SEC-2", "D-9", "P3"]
acceptance_criteria:
  - "A variant is a vendored `role.variant.md` prompt, hashed into the manifest and verified at load exactly as a role prompt is; an edited variant fails closed."
  - "`config.prompt_routing` maps role → variant → surface globs; a ticket whose declared surface matches runs that variant."
  - "Configuring nothing leaves every project on the eight-role set, byte-identical to before."
  - "Routing to a variant that does not exist is ignored, never fatal — a typo must not stop a run mid-ticket."
  - "The session journal records the prompt that actually ran, as `role.variant@hash`."
non_goals:
  - "No new role ids: `ROLE_IDS` stays eight, so this is not an F-3 schema event and `role@hash` assignments are untouched."
  - "No runtime fetching (SEC-2/NG6): variants are vendored files, hashed and diffable like everything else."
  - "Does not claim specialization improves outcomes — that is what the A/B measures."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-044"]
depends_on: []
---

# PRDR-089 — vendored role variants, routed by the ticket's surface

**Severity:** minor · **Category:** capability · **Raised by:** the user, asking whether
a public collection of specialized subagents could improve output quality.

## Problem

Detent ships eight role prompts, one per role, identical for every repository. A Go
service and a React dashboard get the same Implementer. The obvious answer — adopt a
community subagent collection — fails on two counts: SEC-2/NG6 forbids fetching agents
at runtime, and those prompts return prose where Detent's roles must emit validated
artifacts. But the underlying idea survives both objections if the prompts are written
to Detent's contract and vendored like every other prompt.

The constraint that shapes the design is that role ids are a wire format: adding one is
an F-3 schema event with a migration for `role@hash` assignments. Specialization must
therefore live INSIDE a role, not beside it.

## Resolution

A **variant** is a vendored `role.variant.md` prompt — `implement.go.md`,
`implement.typescript.md` — hashed into `prompts/manifest.json` under `variants` and
verified at load under the same fail-closed rule as a role prompt. `ROLE_IDS` is
untouched; `agents/assignments.json` still references `role@hash`.

Selection is configuration: `prompt_routing` maps role → variant → surface globs, and a
ticket whose DECLARED surface matches runs that variant. Surface is the right key
because it is the same disjoint ownership the D-21 hook already enforces, so routing is
deterministic and reviewable before a run starts. Empty routing — the default — leaves
every project exactly where it was. An unknown variant is ignored rather than fatal: a
typo in configuration must not stop a run mid-ticket. The journal records the prompt
that actually ran, so the audit trail names the specialized prompt, not just the role.

Both shipped variants defer explicitly to the repository: *"the conventions below are
craft defaults, not law: where the repository's own code, its rules file, or its linter
says otherwise, the repository wins."* That sentence is the design's safety catch. The
failure mode of a confident specialist is imposing idioms a codebase does not use, which
would cut against P3 — the project owns its tooling — and be worse than the generic
prompt it replaced.

Whether specialization actually improves outcomes is unmeasured, and deliberately so:
two variants exist to make the experiment possible, not because the gain is assumed.
