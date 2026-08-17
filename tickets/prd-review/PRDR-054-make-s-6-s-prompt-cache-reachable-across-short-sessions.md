---
id: PRDR-054
title: "Make S-6's prompt cache reachable — the default TTL expires between Foreman's sessions"
state: READY
severity: minor
category: gap
labels: ["prd-review"]
surface: ["detent-prd-v2.md"]
prd_refs: ["S-6", "SEC-4", "X-1", "§14", "N-4"]
acceptance_criteria: ["S-6 states that a stable prefix alone does not produce cache hits across sessions, and names the mechanism that extends cache lifetime past the gap between them.", "Any environment variable the backend needs for this is reconciled with SEC-4's allowlisted-env rule, so the mechanism is not silently stripped.", "The PRD gives S-6 a measurable AC — cache-read tokens observed across consecutive same-role sessions — rather than only asserting prefix-hash equality.", "The cost tradeoff is stated: longer-lived cache writes are billed at a higher rate than the default."]
non_goals: ["Does not change S-6's prefix construction (role prompt + rules + bindings preamble) or its byte-identity requirement.", "Does not require Foreman to manage cache breakpoints; the backend handles caching automatically.", "Does not make cache hit rate a gated metric — reporting it is sufficient."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: []
depends_on: []
---

# PRDR-054 — Make S-6's prompt cache reachable — the default TTL expires between Foreman's sessions

**Severity:** minor · **Category:** gap · **Amends:** S-6, SEC-4

## Problem

S-6 requires a stable per-role prefix, byte-identical within a run, and states its purpose plainly: "for prompt-cache efficiency." The requirement is well-formed and its AC — prefix-hash equality per role — is checkable. But prefix stability is necessary and not sufficient, and the gap is exactly Foreman's shape.

The Agent SDK caches automatically, with cache entries written at a **five-minute** TTL by default. Its documentation describes the failure case in terms that read as a description of Foreman: *"If your workload runs many short sessions against the same system prompt and context with gaps longer than 5 minutes between them, the cache expires between sessions and each new session pays full input price."*

Foreman is many short sessions against a deliberately identical prefix, separated by gate execution — and N-4 states that gates dominate wall time by design. A test suite, a lint pass, and a typecheck between two sessions of the same role will routinely exceed five minutes on a real repository. So S-6 can pass its AC on every run while delivering close to zero cache reads: the prefix is byte-identical, and the entry it would have hit has already expired.

The documented remedy is an environment variable that requests a one-hour TTL, passed through the session's environment. That collides with SEC-4, which restricts sessions to an allowlisted env — so the variable must be on the allowlist deliberately, or it is stripped and S-6's purpose stays unmet with nothing to indicate why. The tradeoff is real and worth recording: longer-lived cache writes bill at a higher rate than five-minute writes, so this trades write cost for read hits and pays off only because the prefix is shared across many sessions, which is precisely what S-6 guarantees.

§14 already reports a research cache hit rate. Nothing reports the prompt cache hit rate, which is the one S-6 exists to produce.

## Evidence (verbatim from foreman-prd-v2.md)

- S-6: "Prompt assembly: stable per-role prefix (role prompt + rules + bindings preamble, byte-identical within a run) + per-ticket variable suffix, for prompt-cache efficiency."
- S-6 AC: "prefix-hash uniqueness-per-role test ports."
- SEC-4: "Secrets: sessions inherit only an allowlisted env; ledger/logs are scrubbed by pattern before write."
- N-4: "Gates dominate wall time by design and are excluded from this figure."
- §14: "| Research cache hit rate | reported, not gated | research/failures/ + ledger.jsonl | RESEARCH stage entries | per run |"

## Proposed change

**1. Complete S-6.** Append: "A stable prefix earns nothing if the cache entry expires before the next session reaches it. The backend writes cache entries with a five-minute lifetime by default, and Foreman's sessions are separated by gate execution, which N-4 expects to dominate wall time — so consecutive same-role sessions routinely fall outside that window. Foreman therefore requests the backend's **extended cache lifetime** for its sessions, accepting that longer-lived cache writes are billed above the default rate; the tradeoff is favorable precisely because S-6 guarantees the prefix is shared across every session of that role.
*AC:* prefix-hash uniqueness-per-role test ports; and two consecutive sessions of the same role, separated by a gate run exceeding the default cache lifetime, report non-zero cache-read tokens on the second."

**2. Reconcile with SEC-4.** Append: "The allowlist is a policy surface, not only a secret filter: variables the backend requires for sanctioned behavior — including the prompt-cache lifetime setting of S-6 — are allowlisted explicitly. A variable Foreman itself sets and needs is listed, not left to inheritance."

**3. Report it.** Add a §14 row: "| Prompt cache read rate: cache-read tokens ÷ total input tokens | reported, not gated | ledger.jsonl | sessions in the run | per run |" — S-6's effect becomes observable rather than assumed.

## Acceptance criteria

1. S-6 states that a stable prefix alone does not produce cache hits across sessions, and names the mechanism that extends cache lifetime past the gap between them.
2. Any environment variable the backend needs for this is reconciled with SEC-4's allowlisted-env rule, so the mechanism is not silently stripped.
3. The PRD gives S-6 a measurable AC — cache-read tokens observed across consecutive same-role sessions — rather than only asserting prefix-hash equality.
4. The cost tradeoff is stated: longer-lived cache writes are billed at a higher rate than the default.

## Non-goals

- Does not change S-6's prefix construction (role prompt + rules + bindings preamble) or its byte-identity requirement.
- Does not require Foreman to manage cache breakpoints; the backend handles caching automatically.
- Does not make cache hit rate a gated metric — reporting it is sufficient.
