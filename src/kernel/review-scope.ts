import picomatch from "picomatch";
import { commitPatch, git, ticketCommits } from "./git.js";

/**
 * PRDR-113 — the review basis, scoped by Detent's own matcher.
 *
 * A surface is a Detent glob: picomatch syntax, braces included, the same
 * matcher containment (D-21) and the risk gate (B-4) use. The basis used to
 * hand each entry to git as a `:(glob)` pathspec, and git's glob has no
 * braces — so a granted surface like `src/cli{.ts,/init.ts}` was written to
 * under the hook's approval, gated green, and invisible to the reviewer, who
 * rejected the exact commit every review had asked for. The file lists now
 * come from git unscoped, Detent filters them, and git is asked to diff
 * concrete paths only.
 */

export type SurfaceMatch = (name: string) => boolean;

/** `null` means unscoped — the whole tree, as the unscoped callers expect. */
export function surfaceMatcher(surface: readonly string[]): SurfaceMatch | null {
  if (surface.length === 0) return null;
  const isMatch = picomatch([...surface], { dot: true });
  return (name) => isMatch(name);
}

function names(cwd: string, ...args: string[]): string[] {
  try {
    return git(cwd, ...args)
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "");
  } catch {
    return [];
  }
}

/** Files a commit changed; a root commit has no parent, so `show` answers for it. */
export function commitNames(cwd: string, sha: string): string[] {
  const viaParent = names(cwd, "diff", "--name-only", `${sha}^`, sha);
  return viaParent.length > 0 ? viaParent : names(cwd, "show", "--name-only", "--format=", sha);
}

export function worktreeNames(cwd: string, from: string): string[] {
  return names(cwd, "diff", "--name-only", from);
}

export function untrackedNames(cwd: string): string[] {
  return names(cwd, "ls-files", "--others", "--exclude-standard");
}

function safe(fn: () => string): string {
  try {
    return fn();
  } catch {
    return "";
  }
}

function scopedDiff(workDir: string, from: string, match: SurfaceMatch | null): string {
  if (match === null) return safe(() => git(workDir, "diff", from));
  const files = worktreeNames(workDir, from).filter(match);
  return files.length === 0 ? "" : safe(() => git(workDir, "diff", from, "--", ...files));
}

export interface ReviewBasis {
  /** PRDR-094: the ticket's own commits, oldest first, then the uncommitted tree. */
  readonly body: string;
  /** PRDR-070: untracked files in scope, for the caller to render as pseudo-diffs. */
  readonly untracked: readonly string[];
}

export function reviewBasis(workDir: string, base: string | null, ticketId: string | undefined, surface: readonly string[]): ReviewBasis {
  const match = surfaceMatcher(surface);
  const all = untrackedNames(workDir);
  const untracked = match === null ? all : all.filter(match);
  if (ticketId === undefined || base === null) {
    return { body: scopedDiff(workDir, base ?? "HEAD", match), untracked };
  }
  const committed = ticketCommits(workDir, ticketId, base)
    .map((sha) => {
      if (match === null) return commitPatch(workDir, sha, []);
      const files = commitNames(workDir, sha).filter(match);
      return files.length === 0 ? "" : commitPatch(workDir, sha, ["--", ...files]);
    })
    .join("");
  return { body: committed + scopedDiff(workDir, "HEAD", match), untracked };
}
