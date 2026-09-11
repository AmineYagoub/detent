---
id: PRDR-213
title: "A write session cannot delete a file, so a scope finding that names one is unfixable and burns the whole review-fix ladder"
state: DONE
severity: major
category: defect
labels: ["prd-review", "containment", "S-3", "review-fix", "tools", "gate-313"]
surface: ["src/sessions/git-rm.ts", "src/sessions/guard.ts", "hooks/dist/detent-hook.cjs", "tests/sessions/sdk.test.ts", "tests/plugin/hook.test.ts", "tests/kernel/install-run.test.ts", "prompts/implement.md", "prompts/review_fix.md", "prompts/blind_fix.md", "prompts/informed_fix.md", "prompts/manifest.json", "agents/implement.md", "tests/sessions/guard.test.ts", "tests/sessions/prompts.test.ts", "detent-prd-v3.md"]
prd_refs: ["S-3", "S-2″", "S-2‴", "SEC-3", "D-6", "X-1", "V-6", "N-6", "PRDR-068", "PRDR-122", "PRDR-212"]
acceptance_criteria: ["The write roles (implement, blind_fix, informed_fix, review_fix) have `git rm` as a third verb: `toolsForRole` returns `Bash(git rm:*)` next to add and commit, and the regenerated `agents/implement.md` carries it. Observed FIRST on the current tree (V-6): `toolsForRole(\"review_fix\")` names no `git rm`, and every `git rm` gate-313's three review-fix sessions issued was refused with `This command requires approval`.", "Containment judges a `git rm` per pathspec exactly as it judges a Write to that path: each named path is resolved against the work root and denied outside the worktree, denied on a protected glob (SEC-3), denied outside the surface. A `git rm` whose pathspecs the guard cannot read with confidence — no pathspec, a directory or `-r`, a glob, an option it does not know, any shell metacharacter — is DENIED, never abstained; the known options are `-f`, `-q`, `--cached` and `--`.", "The four write-role prompts state three verbs, and say how a file the session itself left untracked goes: `git add` it, then `git rm -f` it. `prompts:check` hash updated.", "A guard-level test proves the three verdicts on one policy: `git rm -f <inside surface>` allowed, `git rm -f <outside surface>` denied with the surface reason, `git rm -r src` denied as unreadable.", "The reviewer is unchanged: a scope finding that names a file is now something the next session can act on, which is what the review-fix ladder assumes."]
non_goals: ["Does not grant `rm`, `git clean`, `git reset`, `git restore` or any history rewrite: the branch stays append-only under a session; the referee owns it.", "Does not teach the reviewer about tool limits, and does not make a scope finding softer.", "Does not change `finalizeDone`'s `git add -A`.", "Does not add a Detent-owned delete tool (considered below and not taken)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-212", "PRDR-214", "PRDR-215"]
depends_on: []
---

# PRDR-213 — a finding the fixer cannot act on

**Severity:** major · **Category:** defect · **Found by:** gate-313's walking skeleton, take 2 —
`t-001-bootstrap` generation 1, NEEDS_HUMAN after three review-fix rounds, run exit 10

## Problem

The write roles' Bash is `git add` and `git commit` (S-3). Write and Edit create and change files.
Nothing a session has removes one. PRDR-212 already admitted it in passing — *"since it cannot
delete a file"* — and gave the falsification signal a retraction instead of a deletion. The
gate found the general case.

Generation 1 of the bootstrap inherited a staged `tmp_check/probe.txt` from the falsified
generation 0 (that inheritance is PRDR-214). The reviewer flagged it as `scope`, correctly:
not traceable to any criterion. Then:

- review-fix #1 added `tmp_check/` to `.gitignore` — which does nothing to a staged path — and
  wrote `remove_probe.patch`, a deletion it could not apply;
- review-fix #2 spawned a sub-agent to try the same deletions (PRDR-215) and reported blocked;
- review-fix #3 tried `git rm`, `git rm --cached`, `git restore --staged`, `git reset`,
  `git clean`, `git apply`, `rm`, `python3 os.remove` and `node fs.unlinkSync` — 53 Bash calls,
  every deletion `This command requires approval` — then ran `git commit --allow-empty` to test
  whether commit itself was refused, and committed the whole index: `f22712a "connectivity test
  - DO NOT KEEP"` now tracks `tmp_check/probe.txt` and `_scratch_test.txt`.

The last review flagged the commit. `review_fix_attempts` (3) was spent; NEEDS_HUMAN. Of the
run's $12.85, $7.56 went to three fix sessions and three re-reviews of a file nobody could
remove. The review-fix session's own artifact says it plainly:

> Could not apply the review's scope fix. Every filesystem-delete and git-history-rewrite
> operation available in this session … returned 'This command requires approval'.

The ladder assumes a finding is something the next session can act on. `scope` findings "mean
removing work not traceable to a criterion" (`prompts/review_fix.md`). Removing a file is the
one removal the session has no verb for.

## The shape

A third verb. `git rm` joins `git add` and `git commit` on the write roles, and the guard judges
it the way it judges a Write: per pathspec, resolved, inside the worktree, not protected, inside
the surface. The SDK already splits a compound command and refuses any part outside the
allowlist, so the guard's job is containment, not parsing shell: a `git rm` it cannot read with
confidence is denied, not abstained (S-2‴ abstains on calls that name no path — this one names
paths, and the guard must read them). Known options only: `-f`, `-q`, `--cached`, `--`. No `-r`,
no globs, no directories.

An untracked file the session itself created goes the same way: `git add` it, `git rm -f` it.
The prompts say so.

**Considered and not taken:** a Detent-owned path'd delete tool (an in-process MCP tool on the
headless driver, the referee server's on the plugin). It would ride the existing path guard
with no parsing at all, but it is two drivers, a parity rule and a new tool name to teach, for
what one git verb and one guard branch give under both drivers alike.

## What implementation changed

**The third verb, read before it is judged.** `src/sessions/git-rm.ts` is a leaf module with one
reading: `readGitRm(command)` returns the paths a `git rm` names, or why it cannot be read, or
`null` for a command that is not a `git rm` at all. It takes ownership of any command where
`git rm` starts a command — at the start, or after `;`, `&&`, `|`, `(`, a backtick or a newline
— so a deletion cannot ride behind an allowed verb (`git add x && git rm -f ../../etc/passwd` is
read, and refused as compound); a mention inside a quoted commit message is left alone. Tokens
are plain paths (`[A-Za-z0-9._/@+,=-]`, so no quotes, no shell, no glob, no pathspec magic);
the options read are `-f`/`--force`, `-q`/`--quiet`, `--cached` and `--`; anything else, and a
`git rm` naming no path, is unreadable.

**Judged like a Write.** `guardToolUse` now begins with the Bash branch: a `git rm` that cannot
be read is DENIED with the detail and the rule; one that can is judged by calling the guard
itself on a `Write` to each path — the same boundary, artifact area, protection and surface —
and one refused path refuses the call with that path's own reason (surface-expansion hint
included). Every other Bash call abstains exactly as before. Because the plugin hook is the same
`guardToolUse` in a third skin, both drivers share the verdict; the bundle is regenerated.

**Three verbs on the surface.** `toolsForRole` grants `Bash(git rm:*)` between add and commit
for the write roles and nothing new to the read-only ones; `agents/implement.md` regenerates
with it. The four write-role prompts say it: the implementer's tool sentence names the verb and
its rule (one plain path per token, no `-r`, no globs; an untracked file of its own is `git add`
then `git rm -f`); review-fix says a file that has to go is `git rm -f <path>`; blind-fix and
informed-fix state the implementer's tools and that a refused shell command is containment.
Manifest hashes updated.

**V-6, in order.** Observed on the tree as it was: `toolsForRole("implement")` had no `git rm`;
`git rm -f src/calc.py` abstained where `allow` was expected and `git rm -f README.md` /
`git rm -r src` abstained where `deny` was; the SDK hook and the plugin bundle abstained the
same way; four prompt-marker tests failed on the missing verb. Then the change; then the guard,
SDK, plugin and prompt suites green, the V-1⁗ verb pin updated to three, and the full suite
1,104 green.


## Audit

Cold re-read of the reading against what the SDK's prefix rule accepts. Two commands the rule
reads past were "not a `git rm`" to the guard, which abstained and handed them to that rule:
`  git rm -f AGENTS.md` (leading whitespace — the pattern anchored `git` to the start of the
string) and `{ git rm -f x; }` (a brace group — `{` was not among the separators that start a
command). Both are now read: whitespace before the verb is skipped after any separator and at
the start, and `{` joins `;`, `&&`, `|`, `(`, the backtick, `\r` and `\n`. An unreadable token
is now quoted with `JSON.stringify` in the reason, so a CRLF split reads as `"\r\n"` rather than
a line break inside the denial. Pinned by two tests; the bundle regenerated.
