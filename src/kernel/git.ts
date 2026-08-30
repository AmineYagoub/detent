import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * T-042 — the branch & merge contract (B-1…B-5, D-8, P7).
 *
 * Everything git-shaped the kernel does lives here: the run branch, commit
 * trailers, worktree mode, the base-write guard, and crash recovery. The rest
 * of the kernel calls these helpers and never spells `git` itself.
 */

const RUN_BRANCH_PREFIX = "detent/run-";
const TICKET_BRANCH_PREFIX = "ticket/";

/** B-1: the current trailer form. Never written in the legacy form. */
const TICKET_TRAILER = "Detent-Ticket";
/** B-1/D-20: history written before the rename keeps its trailer; readers accept both, permanently. */
const LEGACY_TICKET_TRAILER = "Foreman-Ticket";

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function tryGit(cwd: string, ...args: string[]): string | null {
  try {
    return git(cwd, ...args);
  } catch {
    return null;
  }
}

/*
 * ---------------------------------------------------------------------------
 * Run branch (B-1)
 */

export interface RunBranch {
  readonly branch: string;
  /** The branch the run branch was created from — P7's protected ground. */
  readonly base: string;
}

/**
 * B-1: `run` creates `detent/run-<id>` off the base branch and commits
 * directly to it. Re-entering an existing run branch resumes it; the base is
 * then recovered from the reflog-free fact that a run branch has exactly one
 * upstream fork point in v1 — recorded at creation in git config, which
 * travels with the repository clone the run owns.
 */
export function ensureRunBranch(root: string, runId: string): RunBranch {
  const current = git(root, "rev-parse", "--abbrev-ref", "HEAD").trim();
  if (current.startsWith(RUN_BRANCH_PREFIX)) {
    const recorded = tryGit(root, "config", "--local", `branch.${current}.detentBase`);
    return { branch: current, base: recorded?.trim() ?? "main" };
  }
  const branch = `${RUN_BRANCH_PREFIX}${runId}`;
  git(root, "checkout", "-q", "-b", branch);
  git(root, "config", "--local", `branch.${branch}.detentBase`, current);
  return { branch, base: current };
}

/*
 * ---------------------------------------------------------------------------
 * Trailers (B-1)
 */

/**
 * Sessions commit; the kernel cannot rewrite their history (and must not).
 * The enforcement point is a repo-local `prepare-commit-msg` hook that appends
 * the claimed ticket's trailer to every commit made while a claim is held.
 * The current ticket is recorded inside `.git/` — run state, never the
 * project tree (F-2).
 */
export function installTrailerHook(root: string): void {
  const gitDir = git(root, "rev-parse", "--git-common-dir").trim();
  const hooksDir = path.resolve(root, gitDir, "hooks");
  mkdirSync(hooksDir, { recursive: true });
  const hook = path.join(hooksDir, "prepare-commit-msg");
  writeFileSync(
    hook,
    `#!/bin/sh
# Written by Detent (B-1). Appends the claimed ticket's trailer.
marker="$(git rev-parse --git-common-dir)/DETENT_TICKET"
[ -f "$marker" ] || exit 0
tid="$(cat "$marker")"
[ -n "$tid" ] || exit 0
grep -q "^${TICKET_TRAILER}: $tid$" "$1" || printf '\\n${TICKET_TRAILER}: %s\\n' "$tid" >> "$1"
`,
  );
  chmodSync(hook, 0o755);
}

export function markCurrentTicket(root: string, ticketId: string): void {
  const gitDir = git(root, "rev-parse", "--git-common-dir").trim();
  writeFileSync(path.join(path.resolve(root, gitDir), "DETENT_TICKET"), ticketId);
}

export function clearCurrentTicket(root: string): void {
  const gitDir = git(root, "rev-parse", "--git-common-dir").trim();
  rmSync(path.join(path.resolve(root, gitDir), "DETENT_TICKET"), { force: true });
}

/**
 * B-1 dual-read: history written before the D-20 rename carries
 * `Foreman-Ticket:` and is parsed forever; only the current form is written.
 */
export function parseTicketTrailers(message: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`^(?:${TICKET_TRAILER}|${LEGACY_TICKET_TRAILER}): (.+)$`, "gm");
  for (const match of message.matchAll(re)) out.push((match[1] as string).trim());
  return out;
}

export function commitsOn(root: string, branch: string, since: string): readonly { sha: string; message: string }[] {
  const raw = tryGit(root, "log", "--format=%H%x00%B%x01", `${since}..${branch}`);
  if (raw === null || raw.trim() === "") return [];
  return raw
    .split("\x01")
    .filter((c) => c.trim() !== "")
    .map((c) => {
      const [sha, message] = c.trim().split("\x00");
      return { sha: sha as string, message: message ?? "" };
    });
}

/*
 * ---------------------------------------------------------------------------
 * Base-write guard (B-3, P7)
 */

export type RefSnapshot = ReadonlyMap<string, string>;

/** Every local branch tip. The guard compares against this after each session. */
export function snapshotRefs(root: string): RefSnapshot {
  const out = new Map<string, string>();
  const raw = tryGit(root, "for-each-ref", "--format=%(refname:short)%00%(objectname)", "refs/heads");
  if (raw === null) return out;
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    const [name, sha] = line.split("\x00");
    if (name !== undefined && sha !== undefined) out.set(name, sha);
  }
  return out;
}

export interface BaseWriteViolation {
  readonly ref: string;
  readonly was: string;
  readonly became: string | null;
}

/**
 * P7: Detent never writes to the base branch — in any mode, and a session is
 * Detent's act. Any non-run-branch ref that moved is a violation; the guard
 * restores it (`update-ref` back to the snapshot) and reports, so the base is
 * byte-identical even against a hostile ticket. Prevention-before-the-fact is
 * the S-2 hook (T-046); this is the kernel's own independent line (P2).
 */
/** The short ref HEAD points at, or null when detached or unreadable. */
function headRef(root: string): string | null {
  const raw = tryGit(root, "symbolic-ref", "--quiet", "--short", "HEAD");
  return raw === null || raw.trim() === "" ? null : raw.trim();
}

export function enforceBaseGuard(root: string, snapshot: RefSnapshot, runBranch: string): BaseWriteViolation[] {
  const now = snapshotRefs(root);
  const violations: BaseWriteViolation[] = [];

  for (const [ref, was] of snapshot) {
    if (ref === runBranch || ref.startsWith(TICKET_BRANCH_PREFIX)) continue;
    const became = now.get(ref) ?? null;
    if (became !== was) {
      violations.push({ ref, was, became });
      git(root, "update-ref", `refs/heads/${ref}`, was);
    }
  }
  /** A brand-new non-run branch created by a session is also a write. */
  for (const [ref] of now) {
    if (snapshot.has(ref) || ref === runBranch || ref.startsWith(TICKET_BRANCH_PREFIX)) continue;
    violations.push({ ref, was: "(absent)", became: now.get(ref) ?? null });
    /**
     * PRDR-091: a session that CHECKED OUT the branch it created leaves HEAD
     * pointing at the ref about to be deleted. Deleting it strands HEAD on an
     * unborn branch: every later git call fails with "ambiguous argument
     * 'HEAD'", so the run dies on an unreadable error instead of escalating
     * the breach it just caught. Found live — a routed session ran
     * `checkout -b t-102` and bricked the repository. Re-point HEAD at the run
     * branch BEFORE deleting, so the guard leaves a working tree behind.
     */
    if (headRef(root) === ref) {
      git(root, "symbolic-ref", "HEAD", `refs/heads/${runBranch}`);
    }
    git(root, "update-ref", "-d", `refs/heads/${ref}`);
  }
  return violations;
}

/*
 * ---------------------------------------------------------------------------
 * Worktree mode (B-2)
 */

export function worktreePath(root: string, ticketId: string): string {
  return path.join(root, ".detent", "worktrees", ticketId);
}

/** B-2: per-ticket worktree + branch; the ticket's work is isolated there. */
export function ensureWorktree(root: string, ticketId: string): string {
  const wt = worktreePath(root, ticketId);
  if (existsSync(wt)) return wt;
  mkdirSync(path.dirname(wt), { recursive: true });
  git(root, "worktree", "add", "-q", wt, "-b", `${TICKET_BRANCH_PREFIX}${ticketId}`);
  return wt;
}

/** B-2: merged `--no-ff` into the RUN branch on DONE — never the base (P7). */
export function mergeWorktree(root: string, ticketId: string): void {
  const wt = worktreePath(root, ticketId);
  git(root, "merge", "--no-ff", "-q", "-m", `merge ${ticketId}`, `${TICKET_BRANCH_PREFIX}${ticketId}`);
  git(root, "worktree", "remove", "--force", wt);
  tryGit(root, "branch", "-q", "-D", `${TICKET_BRANCH_PREFIX}${ticketId}`);
}

/**
 * B-4's risk surface: everything the run has changed relative to its base —
 * committed diff plus untracked files, exactly the oracle's definition. Works
 * against any base branch name (main, master, …), since the name comes from
 * the recorded run branch, never a constant.
 */
export function changedFiles(root: string, baseRef: string): string[] {
  const diff = tryGit(root, "diff", "--name-only", baseRef) ?? "";
  const untracked = tryGit(root, "ls-files", "--others", "--exclude-standard") ?? "";
  return [...new Set(`${diff}\n${untracked}`.split("\n").map((l) => l.trim()).filter((l) => l !== ""))];
}

/**
 * §14's base-branch-writes metric source: the base ref's reflog. Creation is
 * one entry; anything beyond it during a run is a write (even a reverted one
 * — the guard's own restore is honest evidence that a write happened).
 */
export function baseReflogWrites(root: string, base: string): number {
  const raw = tryGit(root, "reflog", "show", "--format=%gs", base);
  if (raw === null) return 0;
  const entries = raw.split("\n").filter((l) => l.trim() !== "");
  return Math.max(0, entries.length - 1);
}

/**
 * PRDR-094: the commits on the run branch that THIS ticket authored, oldest
 * first.
 *
 * The claim base is pinned at first acquire (PRDR-069) so later generations
 * judge the whole ticket rather than the last patch — correct, but it makes
 * `base..HEAD` a span that other tickets commit into. The old code relied on
 * the surface pathspec to filter that span back down, on the stated assumption
 * that surfaces are "disjoint across tickets by the plan's own contract". They
 * are not: nothing enforces disjointness, and a plan where five tickets declare
 * `internal/cli/**` showed each of them the others' work.
 *
 * Every Detent commit subject is `<ticket-id>: …`, so the ticket's own work is
 * identifiable without new bookkeeping. Empty when there is no base, no
 * history, or the ticket has not committed yet — all of which fall back to the
 * worktree diff.
 */
export function ticketCommits(cwd: string, ticketId: string, base: string | null): string[] {
  if (base === null) return [];
  const raw = tryGit(cwd, "log", "--reverse", "--format=%H%x1f%s", `${base}..HEAD`);
  if (raw === null) return [];
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    const [sha, subject] = line.split("\x1f");
    if (sha === undefined || subject === undefined || sha.trim() === "") continue;
    if (subject.startsWith(`${ticketId}:`)) out.push(sha.trim());
  }
  return out;
}

/**
 * One commit's own patch, scoped. `sha^..sha` is used rather than `git show`
 * so a B-2 worktree merge reports the whole merged change against its first
 * parent; a root commit has no parent, and falls back to `show`.
 */
export function commitPatch(cwd: string, sha: string, spec: readonly string[]): string {
  return tryGit(cwd, "diff", `${sha}^`, sha, ...spec) ?? tryGit(cwd, "show", "--format=", "--patch", sha, ...spec) ?? "";
}

/*
 * ---------------------------------------------------------------------------
 * Crash recovery (B-5)
 */

/**
 * B-5: uncommitted worktree changes at resume are reset to the last ticket
 * commit. Scoped to the PROJECT tree — `.detent/` is run state the kernel
 * itself mutates between commits, and clobbering ticket JSON would destroy
 * the very record resume depends on. Untracked files are left in place: the
 * gate judges the tree as-is.
 */
export function resetDirtyTracked(cwd: string): string[] {
  const raw = tryGit(cwd, "diff", "--name-only", "HEAD");
  if (raw === null || raw.trim() === "") return [];
  const dirty = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith(".detent/"));
  if (dirty.length > 0) git(cwd, "checkout", "-q", "HEAD", "--", ...dirty);
  return dirty;
}

/*
 * ---------------------------------------------------------------------------
 * V-5 [BASE] resolution (draft.7, T-042's half)
 */

/**
 * `[BASE]` is the merge-base of the run branch and its base branch, resolved
 * once per run. Unresolvable (shallow clone, deleted base) ⇒ null, and the
 * caller falls back to the root command with the reason recorded — a filter
 * against an unresolvable baseline is not a narrower gate (V-5).
 */
export function resolveBaseRef(root: string, runBranch: RunBranch): string | null {
  const mergeBase = tryGit(root, "merge-base", runBranch.branch, runBranch.base);
  if (mergeBase === null) return null;
  const trimmed = mergeBase.trim();
  return trimmed === "" ? null : trimmed;
}
