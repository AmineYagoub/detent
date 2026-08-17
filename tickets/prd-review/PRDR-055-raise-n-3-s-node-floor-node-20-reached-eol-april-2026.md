---
id: PRDR-055
title: "Raise N-3's Node floor — Node 20 reached end-of-life on 30 April 2026"
state: READY
severity: major
category: gap
labels: ["prd-review"]
surface: ["foreman-prd-v2.md"]
prd_refs: ["N-3", "S-5", "M4", "SEC-2", "NG5"]
acceptance_criteria: ["N-3's Node floor names a release line that is still receiving security updates on the date the PRD is dated.", "The PRD states how the floor is re-evaluated as release lines age, so the same defect does not recur silently at the next end-of-life.", "The dependency floor and the pinned-backend discipline of S-5 are consistent — both are versions with an owner and a review trigger, not constants set once.", "M4's release gate cannot publish a package whose declared engine range includes an end-of-life runtime."]
non_goals: ["Does not change the runtime dependency set — `@anthropic-ai/claude-agent-sdk`, `zod`, `picomatch` — or N-3's minimal-and-pinned posture.", "Does not adopt a specific CI matrix; naming the supported range is sufficient.", "Does not change NG5's POSIX-first / WSL-supported stance."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-055 — Raise N-3's Node floor — Node 20 reached end-of-life on 30 April 2026

**Severity:** major · **Category:** gap · **Amends:** N-3

## Problem

N-3 sets the runtime floor at "Node ≥ 20 LTS". **Node.js 20 reached end-of-life on 30 April 2026** — nearly four months before this PRD's stated date of 2026-08-17. It receives no further security updates. Node 24 is the Active LTS line and Node 22 is in Maintenance LTS.

So the floor as written permits, and by naming "20 LTS" arguably endorses, an unsupported runtime. Three consequences follow. A contributor reading N-3 will reasonably run and test on Node 20. CI configured from N-3 will keep a green matrix entry on a runtime that no longer receives patches. And M4 would publish a package whose declared engine range advertises support for an end-of-life line — for a tool whose stated purpose is executing model-authored code against a user's repository, with SEC-2 taking supply-chain posture seriously enough to forbid runtime fetching entirely.

The underlying issue is structural rather than arithmetic. S-5 treats the session backend's version as a live concern with an owner, a pin, a `doctor` check, and a fixture-gated upgrade path. The Node floor got none of that — it was written once as a constant, and constants that name release lines expire. Raising the number fixes today's instance; naming the review trigger prevents the next one, and there will be a next one, since Node 22 leaves maintenance in April 2027.

## Evidence (verbatim from foreman-prd-v2.md)

- N-3: "**N-3 Dependencies:** minimal and pinned — `@anthropic-ai/claude-agent-sdk`, `zod`, `picomatch`; CLI via `node:util.parseArgs`; no framework. Node ≥ 20 LTS."
- Header: "| Date | 2026-08-17 |"
- S-5: "Pinning: SDK version is an **exact** dependency in Foreman's lockfile; `config.json` additionally pins the expected Claude Code CLI/runtime version surfaced by `doctor`; upgrades are PRs gated on the cross-ecosystem fixture suite."
- SEC-2: "No runtime fetching of agents/prompts/policies; vendored + hash-pinned only (S-7)."
- M4: "**M4 — Public release.** Schema freeze (`schema_version: 1`), security review against SEC fixtures, N-7 self-build green, npm publish under the chosen name, docs site."

## Proposed change

**1. Raise the floor and state the rule.** Replace N-3's final sentence with:

"**Node ≥ 22 LTS**, developed and released against the Active LTS line (Node 24 at time of writing). The floor tracks supported release lines rather than naming a fixed number: a line that has reached end-of-life is not a supported target, and the floor rises to the oldest line still receiving security updates. Node 20 reached end-of-life on 30 April 2026 and is out of support.
*AC:* the package's declared engine range excludes every end-of-life release line; CI's runtime matrix contains no end-of-life line; a release-checklist item re-evaluates the floor against the upstream release schedule."

**2. Give it a review trigger, as S-5 has.** Append: "Like the pinned backend version of S-5, the runtime floor has an owner and a scheduled review — checked at every release, and on any upstream end-of-life date falling inside the support window."

**3. Gate it at M4.** Append to M4: "…and a runtime-support check confirming the published engine range names no end-of-life release line."

## Acceptance criteria

1. N-3's Node floor names a release line that is still receiving security updates on the date the PRD is dated.
2. The PRD states how the floor is re-evaluated as release lines age, so the same defect does not recur silently at the next end-of-life.
3. The dependency floor and the pinned-backend discipline of S-5 are consistent — both are versions with an owner and a review trigger, not constants set once.
4. M4's release gate cannot publish a package whose declared engine range includes an end-of-life runtime.

## Non-goals

- Does not change the runtime dependency set — `@anthropic-ai/claude-agent-sdk`, `zod`, `picomatch` — or N-3's minimal-and-pinned posture.
- Does not adopt a specific CI matrix; naming the supported range is sufficient.
- Does not change NG5's POSIX-first / WSL-supported stance.
