---
id: PRDR-180
title: "In the default worktree mode the guard denied the artifact every read-only role exists to produce, and a driver policy that denies 'every path'd call' ignored the shell"
state: DONE
severity: critical
category: defect
labels: ["prd-review", "found-by-audit", "containment", "security"]
surface: ["src/sessions/guard.ts", "src/kernel/referee-session.ts", "src/plugin/hook.ts", "skills/run/SKILL.md"]
prd_refs: ["B-2″", "D-27", "SEC-3", "S-2‴"]
acceptance_criteria: ["A session may write its own artifact from inside its worktree — the default configuration — and still nothing else outside it: not another ticket's artifacts, not the operator's checkout, not the ledger.", "A driver policy denies execution, not only path-bearing calls; a shell can write with a redirect and start a billable session, and D-27 admits neither without a validator in between.", "`skills/run/SKILL.md` describes what the hook does."]
non_goals: ["Does not grant the project root. Granting it would let a session write the operator's own checkout, which is the harm B-2″ made worktrees the default to prevent.", "Does not remove the gate-command Bash rule; that fires earlier and stays."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-145b", "PRDR-170", "PRDR-178"]
depends_on: []
---

# PRDR-180 — the write the default configuration forbade, and the one it allowed

**Severity:** critical · **Category:** defect · **Found by:** the full-project audit of `90a5051`,
findings #4 and #1

## 1. The artifact was denied in the default mode

`artifactOut` is `<root>/.detent/runs/<ticket>/…`; `policy.workRoot` is the per-ticket worktree;
PRDR-145b made worktrees the default. So the artifact every review, diagnose and research session
is required to produce resolved to a SIBLING of its work root, and `guardToolUse` denied it as an
escape before any glob was consulted:

```
worktree mode      → deny
non-worktree mode  → allow
```

Every test missed it by running non-worktree, where the two paths coincide. `artifactWriteRule` in
`allowedTools` is decorative against a hook deny.

The policy now carries `artifactRoot`, judged before the containment check, lexically and then
resolved so a symlink into the area is judged on its real destination. Deliberately ONE directory
and not the project root: granting the root would let a session write the operator's own checkout,
which is what B-2″ made worktrees the default to prevent.

## 2. The driver policy ignored the shell

`if (pathOf(payload.tool_input) === null) return null;` — a `Bash` call carries no path, so a rule
whose message reads "the driver sequences, never edits" returned silence for `git status`,
`printf x > src/pwn.ts`, and `claude -p …`. A redirect writes a file; `claude -p` starts a billable
session off the ledger.

`skills/run/SKILL.md` described the hook as denying "every Bash command matching a bound
verification command", which is narrower than D-27: *"no model-issued request applies a transition,
consumes a budget, or writes outside surface without a validator or gate result in between."* The
RULE is the authority, so the skill text was corrected to match it — the opposite of PRDR-170,
where the kernel was narrowed to contradict a vendored prompt. The existing test asserting `git
status` stays silent asserted the bypass, and says the opposite now.
