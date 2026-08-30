---
id: PRDR-093
title: "Remove vendored role variants — two controlled experiments measured no effect, and the capability ships inert and undocumented"
state: DONE
severity: minor
category: decision
labels: ["prd-review", "user-decision", "found-by-execution"]
surface: ["prompts/implement.go.md", "prompts/implement.typescript.md", "prompts/manifest.json", "src/sessions/prompts.ts", "src/sessions/backend.ts", "src/kernel/worstcase.ts", "src/kernel/referee-session.ts", "scripts/hash-prompts.ts", "tests/kernel/prompt-routing.test.ts", "tests/sessions/prompts.test.ts"]
prd_refs: ["S-6", "S-7", "SEC-2", "D-9", "P3", "F-1"]
acceptance_criteria: ["`prompts/implement.go.md` and `prompts/implement.typescript.md` are deleted and the `variants` map is gone from `prompts/manifest.json`.", "`config.prompt_routing` is removed from the config schema; a config still carrying the key is rejected by the schema rather than silently ignored, so an operator who set it learns it no longer exists.", "`loadPromptSet` returns the eight-role set with no variant loading path, and `SessionBackend` no longer carries `variants` / `variantHashes`.", "S-6's prefix pin returns to being keyed on the role: with one prompt per role the two keys are equivalent, and the guarantee S-6 states is unchanged.", "The journal records `role@hash` for every session, with no `role.variant@hash` form remaining.", "`tests/kernel/prompt-routing.test.ts` is deleted and the full suite is green with no skipped tests standing in for removed behaviour."]
non_goals: ["Does not touch S-7 for roles: the eight role prompts stay vendored, hashed in the manifest, and fail-closed at load. Only the variant layer goes.", "Does not change `ROLE_IDS` — PRDR-089 never added a role id, so this removal is not an F-3 schema event either.", "Does not delete PRDR-089. It stays on record with its amendment and its A/B result; this ticket is the outcome of that experiment, not a retraction of it.", "Does not preclude reintroducing surface-routed prompts later. It requires that a reintroduction arrive with evidence, which is exactly what this one lacked."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-089", "PRDR-092"]
depends_on: []
---

# PRDR-093 — remove vendored role variants

**Severity:** minor · **Category:** decision · **Raised by:** the user, after reading the
second experiment · **Supersedes the capability added by:** PRDR-089

## Problem

PRDR-089 added variants explicitly without claiming they helped: *"Whether specialization
actually improves outcomes is unmeasured, and deliberately so: two variants exist to make
the experiment possible, not because the gain is assumed."* The experiment has now run
twice. It measured nothing, and the capability has no other argument for existing.

**First experiment** — 6 arms, two benchmarks, ~$72 — was unusable. A backend outage hit
the arms unevenly (2, 4, 4, 7, 1, 1 crashed sessions), operator intervention was
asymmetric, and matched by ticket only two Go tickets were crash-free across all four Go
arms, splitting one apiece.

**Second experiment** — 8 arms, 4 control and 4 variant, one benchmark, identical approved
plan (`plan_hash 9ce43c37…`), $90 — was built to fix every one of those defects, and did.
Routing was verified firing on every variant session (`implement.go@9687bc66…` in the
journal, against `implement@978d8a50…` in control). The outage that occurred hit both
conditions symmetrically at exactly three crashes per arm. Every operator action was an
identical command with no per-arm judgement.

The result:

| metric | control | variant |
|---|---|---|
| generations to DONE, per clean paired ticket | **1.00** | **1.00** |
| pooled cost per clean paired ticket | $1.41 | $1.28 (0.90×) |
| tickets DONE | 17 | 17 |
| within-condition spread, identical arms | 1.31× | 1.37× |

The primary metric is flat. Not weakly positive, not noisy — identical, on every clean
paired ticket. Every ticket that completed cleanly did so in one generation under both
prompts. The 10% cost difference sits inside a 1.37× spread measured between arms running
the *same* prompt against the *same* plan, so it is smaller than the noise floor it would
have to clear.

## What the experiment found instead

Of 56 blocked tickets across both conditions, **45 were `scope` findings** — the reviewer
rejecting work as out of scope until the ladder exhausted — distributed evenly between
control and variant. That is a planner/reviewer disagreement about sibling tickets sharing
a surface glob (`internal/cli/**` is declared by five tickets in this plan), and it
dominated the run's cost in both conditions. It is a real defect and it has nothing to do
with which Implementer prompt ran. It belongs in its own ticket.

## Why removal rather than keeping the seam inert

The seam's defence was that it is the extension point letting someone add a stack without
forking the kernel. That argument survives the null result, but it does not survive the
rest of the picture: the capability ships **inert** (`prompt_routing` defaults to `{}`)
and **undocumented** (the key appears nowhere in the README or `docs/`), so no user can
discover it, and the only two prompts it routes to are the ones just measured at zero. A
public plugin carrying dormant, undiscoverable machinery for an unproven idea is worse
than one that does not, and the code is cheap to restore from history if evidence ever
arrives.

S-6's amendment goes back with it. Keying the prefix pin on the prompt rather than the
role was a faithful reading of the invariant, but it exists only because one role could
have several prompts. With the variant layer gone role and prompt are 1:1 again, the two
keys are equivalent, and the simpler one is right.
