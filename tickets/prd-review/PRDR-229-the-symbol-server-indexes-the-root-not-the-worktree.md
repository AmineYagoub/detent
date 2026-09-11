---
id: PRDR-229
title: "The symbol server is pointed at the root, not at the session's worktree, so under B-2″ every symbol answer describes the run branch and never the tree the session is changing"
state: DONE
severity: major
category: defect
labels: ["prd-review", "symbols", "S-3′", "B-2″", "serena", "gate-313"]
surface: ["src/kernel/referee-context.ts", "src/kernel/referee-session.ts", "src/kernel/git.ts", "tests/kernel/session-policy.test.ts", "tests/kernel/git.test.ts", "detent-prd-v3.md"]
prd_refs: ["S-3′", "S-3⁷", "S-3⁷″", "B-2″", "V-6", "N-6", "PRDR-121", "PRDR-145b", "PRDR-223"]
acceptance_criteria: ["The symbol server a session receives is started on the session's WORK DIRECTORY: `symbolServerConfig` is given `workDir`, so under worktrees `--project` names the ticket's worktree and `find_symbol`, `find_referencing_symbols` and `get_symbols_overview` answer for the tree the session is editing, uncommitted work included. Observed FIRST (V-6): the launched spec's server args carry `--project <root>` — gate-313's every Serena process was started on `/Users/workstation/detent-gate-313`, the run branch checkout, while the session worked in `.detent/worktrees/<ticket>`.", "Non-worktree mode is unchanged: the work directory is the root.", "Detent's context file stays under the ROOT's local state — it is Detent's, not the tree's — and Serena's own project directory (`.serena/`) lands in the worktree, where finalize must not stage it: it joins the excluded set beside F-1's local entries (PRDR-228), and a test proves a run's merge carries no `.serena/`."]
non_goals: ["Does not change the tool set, the allowlist or the prompts (S-3⁷″).", "Does not make Serena's memories or project config Detent's concern beyond keeping them out of the change set."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-223", "PRDR-228", "PRDR-145b"]
depends_on: ["PRDR-228"]
---

# PRDR-229 — the right tool on the wrong tree

**Severity:** major · **Category:** defect · **Found by:** the gate root's `git status`, showing
an untracked `.serena/` the sessions' servers had written there

## Problem

`RefereeContext.symbolServer()` builds the server config from `this.root`. Before B-2″ the root
was the tree; since PRDR-145b the session works in a per-ticket worktree, and its symbol server
has been started on the root all along: `--project /Users/workstation/detent-gate-313` in every
Serena process gate-313 launched. A session asking where a symbol it just added is defined gets
the run branch's answer — the symbol is not there — and a session asking who references a
function it is changing sees the callers as of the last merge, not its own edits. Serena's
project configuration was written to the root, which is why `.serena/` sits untracked there.

Now that sessions call the tools (S-3⁷″), the answers must be about their tree.

## The shape

Give the server the work directory. Detent's context file stays under the root's local state,
since it is Detent's; Serena's own `.serena/` then lands in the worktree and joins the paths
finalize never stages, beside F-1's local set.

## What implementation changed

**The work directory, not the root.** `RefereeContext.symbolServer(workDir)` builds the server
config for the directory it is given, and `SessionArm.launch` passes the session's — the
worktree under B-2″, the root otherwise. Detent's context file still lives under the root's
local state. **Never staged.** `stageAll` excludes `.serena` beside F-1's local entries, asked
of git first like the rest, so the project directory Serena writes where it is started cannot
join a change set.

**V-6, in order.** Observed on the tree as it was: a worktree-mode launch with a ready probe
carried `--project <root>` while the session's cwd was the worktree; an untracked `.serena/`
beside a feature was staged. Then the change; then both green.

