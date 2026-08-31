import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { git } from "./git.js";

/**
 * PRDR-100: park untracked files this ticket does not own, restore the ones it
 * does.
 *
 * The gate is whole-tree by design (P3), but a surface is not — so a session
 * terminated mid-work leaves untracked output that fails EVERY later ticket's
 * gate, on paths D-21 forbids that ticket from touching. Observed live: a
 * 103-turn breach left 21 files under `src/verification/**`, and the next
 * ticket burned its whole ladder on a lint failure it could not reach.
 *
 * Deleting the residue would fix the gate and forfeit B-5, whose whole point is
 * that a ticket resuming its OWN crashed session still finds its partial work.
 * Parking keeps both: what the claimant owns stays, what it does not is moved
 * aside and comes back when its owner claims.
 *
 * The park lives under `.git/` deliberately. Anywhere in the worktree would be
 * linted or tested, and `.detent/` in particular is governed by the F-2
 * boundary lint, which fails when project sources appear under it — parking
 * there would trade one gate failure for another.
 */
const PARK_DIR = "detent-parked";

function parkRoot(cwd: string): string {
  return path.join(cwd, ".git", PARK_DIR);
}

function untracked(cwd: string): string[] {
  try {
    return git(cwd, "ls-files", "--others", "--exclude-standard")
      .split("\n").map((l) => l.trim()).filter((l) => l !== "");
  } catch {
    return [];
  }
}

function owns(surface: readonly string[], rel: string): boolean {
  return surface.some((g) => rel === g || picomatch.isMatch(rel, g, { dot: true }));
}

/** Move aside every untracked file outside `surface`. Returns what was parked. */
export function parkForeignUntracked(cwd: string, surface: readonly string[]): string[] {
  const moved: string[] = [];
  for (const rel of untracked(cwd)) {
    if (rel.startsWith(".detent/") || owns(surface, rel)) continue;
    const from = path.join(cwd, rel);
    const to = path.join(parkRoot(cwd), rel);
    try {
      mkdirSync(path.dirname(to), { recursive: true });
      renameSync(from, to);
      moved.push(rel);
    } catch {
      /* A file that cannot be moved is left alone: the gate judging it is the
         status quo, and failing the claim over housekeeping would be worse. */
    }
  }
  return moved;
}

/** Bring back parked files this ticket DOES own (B-5's resume, preserved). */
export function restoreParked(cwd: string, surface: readonly string[]): string[] {
  const root = parkRoot(cwd);
  if (!existsSync(root)) return [];
  const back: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      const rel = path.relative(root, abs);
      if (!owns(surface, rel)) continue;
      try {
        mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
        renameSync(abs, path.join(cwd, rel));
        back.push(rel);
      } catch {
        /* Leave it parked rather than fail the claim. */
      }
    }
  };
  walk(root);
  return back;
}


/**
 * PRDR-100's claim-time settle: give the ticket back what it owns, move aside
 * what it does not. Null when the tree needed neither, so the caller journals
 * only real movement.
 */
export function settleWorktree(
  cwd: string,
  surface: readonly string[],
): { readonly restored: readonly string[]; readonly parked: readonly string[] } | null {
  const restored = restoreParked(cwd, surface);
  const parked = parkForeignUntracked(cwd, surface);
  return restored.length === 0 && parked.length === 0 ? null : { restored, parked };
}
