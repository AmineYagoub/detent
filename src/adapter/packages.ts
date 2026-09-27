import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { discover } from "./discover/index.js";
import type { Candidate, Discovery, PackageManager } from "./discover/types.js";

/**
 * V-5′ (PRDR-295) — a repository's packages, and which of them a path lies in.
 *
 * D-5 bound the root alone, so a ticket writing another package had no gate
 * that could fail: 69 of ksar-cloud's tickets wrote `dashboard/`, a Node
 * package, while its gates ran Go at the root. A package is a directory
 * holding a manifest an engine binds from, and the root is one whether or not
 * it holds one. A path lies in the deepest package holding it, which is how
 * each ecosystem reads a nested manifest: a `go.mod` below the root is a
 * module of its own, and a `package.json` below it a package of its own.
 */

/** The manifests an engine reads a package from. A Makefile, a justfile or a tsconfig runs tasks in a package; it does not make one. */
export const PACKAGE_MANIFESTS: readonly string[] = ["package.json", "pyproject.toml", "setup.py", "setup.cfg", "go.mod", "Cargo.toml"];

/**
 * A manifest under one of these is a dependency's or a test's, never a package
 * of the repository's own: an install, a vendored module, and test data, which
 * Go's own tooling skips as `testdata`. Hidden directories are skipped too.
 */
export const NOT_PACKAGES: ReadonlySet<string> = new Set(["node_modules", "vendor", "testdata", "fixtures", "__fixtures__"]);

export const ROOT_PACKAGE = ".";

const skipped = (segment: string): boolean => segment.startsWith(".") || NOT_PACKAGES.has(segment);

/** The root first, then by path, so every list of packages reads the same way. */
export function comparePackages(a: string, b: string): number {
  if (a === b) return 0;
  if (a === ROOT_PACKAGE) return -1;
  if (b === ROOT_PACKAGE) return 1;
  return a < b ? -1 : 1;
}

/** A package's directory under `root`, which may be the repository or a worktree of it. */
export function packageDir(root: string, pkg: string): string {
  return pkg === ROOT_PACKAGE ? root : path.join(root, ...pkg.split("/"));
}

/** How a gate is named where it is not the root's: `web:test`. The root's keeps its slot alone, as before packages. */
export function gateLabel(gate: { readonly package: string; readonly slot: string }): string {
  return gate.package === ROOT_PACKAGE ? gate.slot : `${gate.package}:${gate.slot}`;
}

/** Every file git would track here: what it tracks and what it does not ignore. Walked by hand where git cannot say. */
function repositoryFiles(root: string): string[] {
  try {
    const listed = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return listed.split("\0").filter((f) => f !== "");
  } catch {
    return walk(root, "");
  }
}

function walk(root: string, rel: string): string[] {
  let entries;
  try {
    entries = readdirSync(rel === "" ? root : path.join(root, ...rel.split("/")), { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory() && !skipped(entry.name)) out.push(...walk(root, child));
    else if (entry.isFile()) out.push(child);
  }
  return out;
}

/** V-5′: the root, and every directory holding a package manifest. */
export function findPackages(root: string): string[] {
  const found = new Set<string>([ROOT_PACKAGE]);
  for (const file of repositoryFiles(root)) {
    const dir = path.posix.dirname(file);
    if (dir === "." || !PACKAGE_MANIFESTS.includes(path.posix.basename(file))) continue;
    if (dir.split("/").some(skipped)) continue;
    found.add(dir);
  }
  return [...found].sort(comparePackages);
}

/** The deepest package holding `file`, by whole segments; the root holds what no other package does. */
export function ownerOf(file: string, packages: readonly string[]): string {
  let owner = ROOT_PACKAGE;
  for (const pkg of packages) {
    if (pkg === ROOT_PACKAGE || !(file === pkg || file.startsWith(`${pkg}/`))) continue;
    if (owner === ROOT_PACKAGE || pkg.length > owner.length) owner = pkg;
  }
  return owner;
}

/**
 * Whether a glob, read from its base, can match a path below `below`, a
 * directory under that base: segment by segment, until a `**` or the
 * directory's own segments are passed with the glob still going. A brace
 * holding a slash is not split: it is read as reaching everything.
 */
function reaches(glob: string, below: string): boolean {
  if (/\{[^}]*\/[^}]*\}/u.test(glob)) return true;
  const segments = glob.split("/").filter((s) => s !== "" && s !== ".");
  const dirs = below.split("/");
  for (const [i, dir] of dirs.entries()) {
    const segment = segments[i];
    if (segment === undefined) return false;
    if (segment.includes("**")) return true;
    if (!picomatch.isMatch(dir, segment, { dot: true })) return false;
  }
  return segments.length > dirs.length;
}

/**
 * V-5′: the packages a ticket's surface touches. A path touches the package it
 * lies in and, read as the kernel reads a surface entry, every package below
 * it; a glob touches the package its base lies in and every package below the
 * base it can reach. An exclusion (`!…`) touches nothing.
 */
export function touchedPackages(surface: readonly string[], packages: readonly string[]): string[] {
  const touched = new Set<string>();
  for (const raw of surface) {
    const trimmed = raw.replace(/^\.\//u, "").replace(/\/+$/u, "");
    if (trimmed.startsWith("!")) continue;
    /* The repository named as a directory is every path in it. */
    const entry = trimmed === "" || trimmed === "." ? "**" : trimmed;
    const scan = picomatch.scan(entry);
    const base = scan.isGlob ? scan.base.replace(/\/+$/u, "") : entry;
    touched.add(ownerOf(base, packages));
    for (const pkg of packages) {
      if (pkg === ROOT_PACKAGE || pkg === base || !(base === "" || pkg.startsWith(`${base}/`))) continue;
      const below = base === "" ? pkg : pkg.slice(base.length + 1);
      if (!scan.isGlob || reaches(scan.glob, below)) touched.add(pkg);
    }
  }
  return [...touched].sort(comparePackages);
}

/**
 * Each package discovered in its own directory (V-5′). A package with no
 * lockfile of its own takes the package manager of the package holding it:
 * a workspace's members share the lockfile at its root.
 */
export function discoverPackages(root: string, packages: readonly string[]): Map<string, Discovery> {
  const found = new Map<string, Discovery>();
  const pms = new Map<string, PackageManager | null>();
  for (const pkg of [...packages].sort(comparePackages)) {
    const holder = pkg === ROOT_PACKAGE ? null : ownerOf(path.posix.dirname(pkg), [...pms.keys()]);
    const discovery = discover(packageDir(root, pkg), holder === null ? null : (pms.get(holder) ?? null));
    pms.set(pkg, discovery.stack.pm);
    found.set(pkg, discovery);
  }
  return found;
}

/** Every package's candidates, each carrying the package it was found in (V-5′). */
export function packageCandidates(root: string, packages: readonly string[]): (Candidate & { readonly package: string })[] {
  return [...discoverPackages(root, packages)].flatMap(([pkg, found]) => found.candidates.map((c) => ({ ...c, package: pkg })));
}
