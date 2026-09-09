---
id: PRDR-170
title: "The containment policy is built identically for every role, so a review, diagnose or research session can write any file in the ticket's surface"
state: DONE
severity: critical
category: defect
labels: ["prd-review", "found-by-audit", "security", "containment"]
surface: ["src/kernel/referee-session.ts"]
prd_refs: ["S-1′", "D-21", "SEC-3", "S-2‴"]
acceptance_criteria: ["A read-only role's guard policy surface contains only where its own artifact goes — never the ticket's implementation surface — so the containment layer denies a write it should never have allowed.", "The write-capable roles are unchanged: implement and the fix ladder still hold the ticket's declared surface.", "The assertion is on the spec `SessionArm.launch` actually builds, not on a policy the test composes for itself."]
non_goals: ["Does not narrow `allowedTools`; that half was already correct.", "Does not change what a read-only role WRITES — its artifact still lands under the runs directory."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-124", "PRDR-122"]
depends_on: []
---

# PRDR-170 — the narrow allowlist a wide guard makes decorative

**Severity:** critical · **Category:** defect · **Found by:** the full-project audit of `0752fef`

## Problem

`SessionArm.launch` conditions `allowedTools` on `READ_ONLY_ROLES.has(role)` and then, three lines
later, builds `policy` **identically for every role**:

```ts
allowedTools: READ_ONLY_ROLES.has(role) ? … : …          // narrowed
policy: { surface: [...ticket.surface, ".detent/runs/**"], … }   // not
```

The chain is closed by Detent's own comment. `src/sessions/sdk.ts` reads: *"an abstention omits
`permissionDecision` entirely, so the SDK carries on to its deny/ask/allow rules. A hook that
answered `allow` ended the evaluation and overrode `allowedTools`."* — and that hook emits
`permissionDecision` for every non-abstain decision, `allow` included. So `guardToolUse` returning
`allow` for an in-surface `Edit` is terminal, and the narrowed `allowedTools` is never consulted.

This is specifically the KERNEL session hook. `src/plugin/hook.ts` — the ambient plugin hook —
deliberately never emits an allow (`decision === "deny" ? denyJson(…) : null`), so it does not have
this property. The two hooks differ, and only one of them is the one worker sessions run under.
An audit that probes the plugin hook, or `guardToolUse` alone, will reach the wrong conclusion in
either direction.

Against this project's stated threat model — repository content is untrusted input — a
prompt-injected review session can rewrite the implementation it was launched to judge, defeating
the independence the review role exists to provide.

The identical bug class was found and fixed once, as **PRDR-124**, scoped to `src/init/session.ts`.

**PRDR-179 correction.** This ticket originally said PRDR-124 claims kernel worker sessions "have
always" narrowed correctly, and that this is false against the code. That mischaracterises it:
PRDR-124 says the policy moves onto the spec "as worker sessions have always done" — a claim about
where the policy is CARRIED, which is true. What PRDR-124 did not do was ask whether the surface
that policy carries is right for every role, which is this ticket's finding, and that is a gap
rather than a lie.
