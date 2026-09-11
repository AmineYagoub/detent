import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { GateResult } from "./run.js";

/**
 * V-1⁗ (PRDR-211) — the adapter installs what the manifest declares before a
 * gate runs.
 *
 * A session's Bash is two git verbs (S-3), so a greenfield bootstrap writes
 * `package.json` and cannot install it, and every gate is then `vitest: command
 * not found`. The 3.1.0 gate was green because at 3.1.0 the guard answered a
 * path-less tool call with `allow`, which was terminal and skipped the
 * allowlist — its bootstrap commit carries an npm-written lockfile. PRDR-122
 * closed that hole; gate-313 stopped at ticket one.
 *
 * Installing is a property of EXECUTING a gate (V-1: a candidate that will not
 * execute), not of implementing a ticket, so it is the adapter's: run in the
 * work directory through the same runner as the gate, recorded as its own
 * journal record, once per work directory while the mark is fresh. The session's
 * surface does not change by one verb — a session that can run a package manager
 * can run whatever a dependency's install script asks, past the hook; the
 * referee running the same command is one process the operator chose, logged.
 */

export interface Ecosystem {
  readonly name: string;
  /** The manifest whose presence means the ecosystem is in use. */
  readonly manifest: string;
  /** The lockfile, when the ecosystem has one — part of the change set, never of the mark. */
  readonly lockfile: string | null;
  /** What the install creates. Never part of a ticket's change set. */
  readonly dir: string;
  /**
   * The freshness mark, written by the ADAPTER after a successful install —
   * not by the package manager. Audit of PRDR-211: npm writes no hidden
   * lockfile for a manifest that declares nothing, so a mark borrowed from npm
   * was absent forever there and the install ran on every gate.
   */
  readonly stamp: string;
  /** The install command, run in the work directory through the gate runner. */
  readonly install: string;
}

export const ECOSYSTEMS: readonly Ecosystem[] = [
  {
    name: "node",
    manifest: "package.json",
    lockfile: "package-lock.json",
    dir: "node_modules",
    stamp: path.join("node_modules", ".detent-installed"),
    /**
     * `npm install`, not `npm ci`. `ci` refuses a lockfile out of step with the
     * manifest, and that is the ordinary case here: a ticket adds a dependency
     * by editing `package.json` and cannot touch the lockfile. `install`
     * resolves against the lockfile it has and updates it, and finalize commits
     * the result with the rest of the change set.
     */
    install: "npm install --no-audit --no-fund",
  },
];

export type InstallOutcome =
  | { readonly kind: "none"; readonly reason: string }
  | { readonly kind: "installed"; readonly ecosystem: string; readonly reason: string; readonly result: GateResult }
  | { readonly kind: "failed"; readonly ecosystem: string; readonly reason: string; readonly result: GateResult };

function mtime(file: string): number | null {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/** Why an install is due, or `null` when the mark is fresher than everything it depends on. */
export function installNeeded(workDir: string, eco: Ecosystem): string | null {
  const manifest = mtime(path.join(workDir, eco.manifest));
  if (manifest === null) return null;
  const stamp = mtime(path.join(workDir, eco.stamp));
  if (stamp === null) return `no ${eco.stamp}`;
  if (manifest > stamp) return `${eco.manifest} is newer than ${eco.stamp}`;
  const lock = eco.lockfile === null ? null : mtime(path.join(workDir, eco.lockfile));
  if (lock !== null && lock > stamp) return `${eco.lockfile} is newer than ${eco.stamp}`;
  return null;
}

/**
 * Install whatever is due, through `run` — the gate runner, so the install has
 * the gate's timeout, environment and tail. One ecosystem per directory in
 * practice; the first that needs installing is the one reported.
 */
export async function ensureDependencies(
  workDir: string,
  run: (command: string) => Promise<GateResult>,
  ecosystems: readonly Ecosystem[] = ECOSYSTEMS,
): Promise<InstallOutcome> {
  for (const eco of ecosystems) {
    const reason = installNeeded(workDir, eco);
    if (reason === null) continue;
    const result = await run(eco.install);
    if (!result.green) return { kind: "failed", ecosystem: eco.name, reason, result };
    /*
     * The mark is written last, so it is the newest thing in the tree: a mark
     * older than the lockfile the install just rewrote would install again on
     * every gate. Detent's own file, inside the install directory so it leaves
     * with it and is excluded from the change set with it.
     */
    const stamp = path.join(workDir, eco.stamp);
    mkdirSync(path.dirname(stamp), { recursive: true });
    writeFileSync(stamp, `${new Date().toISOString()}\n`);
    return { kind: "installed", ecosystem: eco.name, reason, result };
  }
  return { kind: "none", reason: "nothing to install" };
}
