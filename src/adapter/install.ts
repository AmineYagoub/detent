import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { GateResult } from "./run.js";
import type { PackageManager } from "./discover/types.js";
import { installScripts, type Approvals, type NotRun } from "./lifecycle.js";
import { ROOT_PACKAGE } from "./packages.js";

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
  /**
   * SEC-5/V-4 (PRDR-232): the package managers this row may install for.
   * Absent means any. The npm row is npm's alone: run in a pnpm or yarn
   * project it writes `package-lock.json`, which `PM_BY_LOCKFILE` reads FIRST,
   * so the referee's own install flipped the discovered package manager, moved
   * every bound command's `resolved`, and blocked a ticket that changed
   * nothing. Measured: `pnpm run test` before, `npm run test` after.
   */
  readonly pms?: readonly (PackageManager | null)[];
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
    /* Greenfield (no lockfile yet) is npm's by C-4's provisional table; a project that chose another manager is not. */
    pms: ["npm", null],
  },
];

/**
 * `notRun`: the manifest's declared lifecycle scripts the install did not run,
 * since none is approved as it stands (V-1⁷).
 */
export type InstallOutcome =
  | { readonly kind: "none"; readonly reason: string }
  | { readonly kind: "installed"; readonly ecosystem: string; readonly reason: string; readonly result: GateResult; readonly notRun: readonly NotRun[] }
  | { readonly kind: "failed"; readonly ecosystem: string; readonly reason: string; readonly result: GateResult; readonly notRun: readonly NotRun[] };

/**
 * V-1⁷ (PRDR-233): the approvals an install honours, read from the root, and
 * the package whose manifest it installs.
 */
export interface InstallLifecycle {
  readonly approvals: Approvals;
  readonly package: string;
}

/** The mark's lines: the install's timestamp, then what was approved to run with it, when anything was. */
const LIFECYCLE_LINE = "lifecycle ";

function markLines(workDir: string, eco: Ecosystem): readonly string[] | null {
  try {
    return readFileSync(path.join(workDir, eco.stamp), "utf8").trim().split("\n");
  } catch {
    return null;
  }
}

function mtime(file: string): number | null {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * The mark's content — the timestamp of the install that wrote it — or `null`
 * with no manifest or no mark. The referee reads it to put an install it did
 * not make on the record: the Stop hook installs during a session so the
 * scoped gate can run, and cannot journal.
 */
export function readMark(workDir: string, eco: Ecosystem): string | null {
  if (!existsSync(path.join(workDir, eco.manifest))) return null;
  return markLines(workDir, eco)?.[0] ?? null;
}

/**
 * Why an install is due, or `null` when the mark is fresher than everything it
 * depends on. `digest` is what is approved to run with the install (V-1⁷): an
 * approval given since the mark was written installs again, so the approved
 * script runs.
 */
export function installNeeded(workDir: string, eco: Ecosystem, digest = ""): string | null {
  const manifest = mtime(path.join(workDir, eco.manifest));
  if (manifest === null) return null;
  const stamp = mtime(path.join(workDir, eco.stamp));
  if (stamp === null) return `no ${eco.stamp}`;
  if (manifest > stamp) return `${eco.manifest} is newer than ${eco.stamp}`;
  const lock = eco.lockfile === null ? null : mtime(path.join(workDir, eco.lockfile));
  if (lock !== null && lock > stamp) return `${eco.lockfile} is newer than ${eco.stamp}`;
  const ran = markLines(workDir, eco)?.find((line) => line.startsWith(LIFECYCLE_LINE))?.slice(LIFECYCLE_LINE.length) ?? "";
  if (ran !== digest) return `the lifecycle scripts approved to run with the install changed since ${eco.stamp}`;
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
  pm: PackageManager | null = null,
  lifecycle?: InstallLifecycle,
): Promise<InstallOutcome> {
  let declined: string | null = null;
  for (const eco of ecosystems) {
    /* V-1⁷ (PRDR-233): the npm row's install runs the approved scripts of its manifest, where npm would have. */
    const scripts = lifecycle === undefined || eco.name !== "node" ? null : installScripts(workDir, lifecycle.package, lifecycle.approvals);
    const reason = installNeeded(workDir, eco, scripts?.digest ?? "");
    if (reason === null) continue;
    /* PRDR-232: a row that is not this project's package manager installs nothing and says which manager it saw. */
    if (eco.pms !== undefined && !eco.pms.includes(pm)) {
      declined = `${eco.name}: this project's package manager is ${pm ?? "undetected"}, and Detent installs only with ${eco.pms.filter((p) => p !== null).join(", ")}`;
      continue;
    }
    const notRun = scripts?.notRun ?? [];
    for (const command of scripts?.before ?? []) {
      const before = await run(command);
      if (!before.green) return { kind: "failed", ecosystem: eco.name, reason, result: before, notRun };
    }
    const result = await run(eco.install);
    if (!result.green) return { kind: "failed", ecosystem: eco.name, reason, result, notRun };
    for (const command of scripts?.after ?? []) {
      const after = await run(command);
      if (!after.green) return { kind: "failed", ecosystem: eco.name, reason, result: after, notRun };
    }
    /*
     * The mark is written last, so it is the newest thing in the tree: a mark
     * older than the lockfile the install just rewrote would install again on
     * every gate. Detent's own file, inside the install directory so it leaves
     * with it and is excluded from the change set with it.
     */
    const stamp = path.join(workDir, eco.stamp);
    mkdirSync(path.dirname(stamp), { recursive: true });
    writeFileSync(stamp, `${new Date().toISOString()}\n${scripts === null || scripts.digest === "" ? "" : `${LIFECYCLE_LINE}${scripts.digest}\n`}`);
    return { kind: "installed", ecosystem: eco.name, reason, result, notRun };
  }
  return { kind: "none", reason: declined ?? "nothing to install" };
}

/**
 * V-1⁗ (PRDR-211): what the referee installs is never part of a change set.
 * V-5′ (PRDR-295): it installs in each package's own directory, so every
 * package's install directory is one, named from the repository's root.
 */
export function installDirs(packages: readonly string[], ecosystems: readonly Ecosystem[]): string[] {
  return packages.flatMap((pkg) => ecosystems.map((e) => (pkg === ROOT_PACKAGE ? e.dir : `${pkg}/${e.dir}`)));
}
