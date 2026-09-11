---
id: PRDR-214
title: "A requeued generation inherits what the falsified one staged: the claim settles untracked files and leaves the index alone"
state: DONE
severity: major
category: defect
labels: ["prd-review", "claim", "worktree", "B-5", "X-8", "PRDR-100", "gate-313"]
surface: ["src/kernel/worktree-park.ts", "src/kernel/referee.ts", "src/kernel/git.ts", "tests/kernel/parked-debris.test.ts", "tests/kernel/requeue-index.test.ts", "detent-prd-v3.md"]
prd_refs: ["B-5", "B-5′", "B-2″", "X-4", "X-8", "D-21", "P3", "V-6", "N-6", "PRDR-100", "PRDR-131", "PRDR-145b"]
acceptance_criteria: ["At claim, BEFORE parking, every path staged as an addition and absent from HEAD is unstaged (`git rm --cached`, the file stays on disk) and then judged as the untracked file it is: parked when foreign, kept when the claimant owns it (B-5's partial work). The `worktree` journal event names what was unstaged. Observed FIRST (V-6): a fixture stages a foreign file, a different ticket claims — today `parkForeignUntracked` lists only `ls-files --others` and the staged path stays in the index; on gate-313 the reviewer flagged that path three times.", "`resetDirtyTracked` (B-5 resume) never throws on a staged-new path. Observed FIRST: `git diff --name-only HEAD` lists such a path and `git checkout -q HEAD -- <it>` exits 1 with `pathspec did not match any file(s) known to git` (reproduced in a scratch repository).", "After the claim settles, a session's own `git add <its file> && git commit` carries nothing the previous generation staged: an E2E fixture (mock backend) requeues a ticket whose generation 0 staged a foreign path and shows generation 1's commit does not track it.", "Parking works in a linked worktree — the default B-2″ mode. Observed FIRST (V-6): `.git` is a FILE in a linked worktree, so the park root `<worktree>/.git/detent-parked` cannot be created, the rename throws, the catch leaves the file alone, and `parkForeignUntracked` returns `[]` for a foreign untracked file that is still there afterwards. The park root becomes the worktree's own git directory (`git rev-parse --absolute-git-dir`), and a foreign file parked from a worktree comes back to it on restore."]
non_goals: ["Deletes nothing: parking, never removal (PRDR-100's reason stands — B-5 needs a crashed session's partial work to survive).", "Does not change the B-5 semantics of MODIFIED tracked files (reset to HEAD on resume) or of untracked ones (left in place).", "Does not change `finalizeDone`'s `git add -A`.", "Does not make `git rm` available to sessions — that is PRDR-213."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-213", "PRDR-100", "PRDR-131"]
depends_on: []
---

# PRDR-214 — the index is part of the tree

**Severity:** major · **Category:** defect · **Found by:** gate-313's walking skeleton, take 2 —
the origin of the `tmp_check/probe.txt` that PRDR-213's sessions could not remove

## Problem

Generation 0 of `t-001-bootstrap` probed its tools (PRDR-212), staged `tmp_check/probe.txt`
with one of the two verbs it had, wrote a falsified signal and ended. The kernel admitted
PREMISE_FALSIFIED; the operator requeued; generation 1 claimed the same worktree.

PRDR-100's claim-time settle moves aside untracked files the claimant does not own and brings
back parked ones it does. It reads `git ls-files --others --exclude-standard`. A path in the
index is not "others". It stayed staged. Generation 1's implementer saw it at session start,
could not unstage it (no verb), and excluded it from its two commits with `git commit --only` —
its own report says so:

> Pre-existing untracked debris at tmp_check/probe.txt was found already staged in this
> worktree at session start … git rm/restore/reset are outside the implementer's allowed git
> subset (add/commit only), so it could not be removed.

The reviewer, judging the tree, flagged it as `scope` on every round (D-6 is right: a staged
file is on the change surface). Three review-fix sessions could not remove it (PRDR-213); the
third committed it by accident with a pathspec-less `git commit`. Exit 10.

The B-5 resume path has the same blind spot with a sharper edge: `resetDirtyTracked` lists
`git diff --name-only HEAD` — which DOES include a staged addition — and then runs
`git checkout -q HEAD -- <paths>`, which cannot restore a path HEAD does not have. It exits 1.
Reproduced in a scratch repository; a resume of a generation that staged a new file would throw
where the READY claim merely inherits.

## The shape

The claim settles the index before it settles the tree. Whatever is staged as an addition and
absent from HEAD is unstaged — `git rm --cached`, the file stays on disk — so it becomes what
it is, an untracked file, and takes the path PRDR-100 already built: foreign ones are parked,
owned ones stay for B-5's resume. The journal's `worktree` event says what was unstaged. With
the index clean, `resetDirtyTracked` sees only modifications, which `checkout HEAD --` can
restore, and a session's pathspec-less `git commit` carries only what that session staged.

## What implementation changed

**The index first.** `unstageAdditions(cwd)` in `worktree-park.ts` lists `git diff --cached
--name-only --diff-filter=A` (never `.detent/`, the kernel's own) and runs `git rm --cached -q
--` on it: the files stay on disk, the index forgets them. `settleWorktree` calls it BEFORE
restore and park, returns `{ restored, parked, unstaged }`, and is null only when all three are
empty — so the claim's `worktree` journal event now names what was unstaged, and a foreign path
a previous generation staged is parked by the code that already existed for untracked debris,
while an owned one stays in place as B-5's partial work.

**The reset lists only what HEAD has.** `resetDirtyTracked` asks `git diff --name-only
--diff-filter=MDT HEAD` — modified, deleted, type-changed — because `checkout HEAD --` cannot
restore an addition and threw on one. Staged additions are the settle's, which runs first.

**Parking under a linked worktree.** Found while building the E2E: `parkRoot` was
`<cwd>/.git/detent-parked`, and in a linked worktree `.git` is a file, so `mkdirSync` threw,
the catch left every file alone, and `parkForeignUntracked` returned `[]` — a silent no-op in
B-2″'s default mode. The park root is now `git rev-parse --absolute-git-dir` + `detent-parked`
(the worktree's own `.git/worktrees/<id>`), with the lexical `.git` as the fallback for a
directory git cannot answer for. `restoreParked` reads the same root.

**V-6, in order.** Observed on the tree as it was: `unstageAdditions` did not exist; settle
returned no `unstaged`; `resetDirtyTracked` threw `Command failed: git checkout -q HEAD --
README.md src/kernel/fs/partial.ts tmp_check/probe.txt`; parking in a linked worktree returned
`[]` with the file still there; and end to end, generation 0 staged a probe and falsified,
generation 1 ran to DONE with the probe in the run branch's tree. Then the change; then the
five unit cases and the E2E green (the E2E asserts the run branch's tree has the feature and not
the probe, and the journal's `worktree` event carries `"unstaged":["tmp_check/probe.txt"]` and
`"parked":["tmp_check/probe.txt"]`), and the full suite green.


## Audit

Cold re-read of the two git readings. Both ran with rename detection on — git's default — so a
staged RENAME (`git mv`, or a delete-and-add git pairs up) read as one `R`: not an `A` for the
settle to unstage, not a `D` for the resume reset to restore. The new path stayed staged and the
old path stayed missing, the very shape the ticket exists to end. Both diffs now pass
`--no-renames`, so the pair is read raw: the settle unstages the new path, the reset restores the
old one. Observed first on a fixture that stages a rename: `unstageAdditions` returned `[]`; then
the change; then green. Also checked and left alone: `finalizeDone`'s `git add -A` commits an
owned file the settle kept, which is what the index would have carried before — B-5's partial
work, by definition; and a park under a linked worktree's git directory is removed with the
worktree at merge, which is right, since nothing outside that worktree can own it.
