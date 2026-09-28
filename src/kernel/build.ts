import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * N-5″ (PRDR-297) — which Detent build is running.
 *
 * A version names a release, and every build of an unreleased line shares it:
 * at least four builds assembled ksar-cloud's plan, on one version, and one
 * slice of it came from an experiment run against the live tree. So a build is
 * named by its version and a digest of what it runs: the source under `src/`,
 * the prompts its sessions are given, and `package.json`, which pins the SDK
 * whose binary runs them (S-5). A tree with an uncommitted edit is a build of
 * its own, which is what an experiment is.
 *
 * It is in no checkpoint's key. A build that changes nothing a phase reads
 * reuses its checkpoint, as C-8 says; what the checkpoint records is who wrote
 * it, and PRESENT names each build that made the plan (C-7″).
 */

/** What a checkpoint written before builds were recorded counts as: a build of its own, unknown. */
export const UNRECORDED_BUILD = "unrecorded";

const TREE = fileURLToPath(new URL("../..", import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((entry) => {
      const abs = path.join(dir, entry.name);
      return entry.isDirectory() ? files(abs) : entry.isFile() ? [abs] : [];
    });
}

/** The build a Detent tree at `tree` is: `<version>+<12 hex>`. */
export function buildOf(tree: string): string {
  const manifest = path.join(tree, "package.json");
  const hash = createHash("sha256");
  for (const file of [...files(path.join(tree, "src")), ...files(path.join(tree, "prompts")), manifest]) {
    hash.update(`${path.relative(tree, file).split(path.sep).join("/")}\0`);
    hash.update(createHash("sha256").update(readFileSync(file)).digest("hex"));
    hash.update("\n");
  }
  const version = (JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown }).version;
  return `${typeof version === "string" ? version : "unversioned"}+${hash.digest("hex").slice(0, 12)}`;
}

/**
 * N-5‴ (PRDR-311): digested when this module is first imported, which is
 * while the process loads: the CLI and the referee reach it by static imports
 * through the init machine. A digest taken at the first stamp named the tree as
 * it stood then, and tabachir's `init` wrote its first checkpoint an hour after
 * loading, from a checkout that had moved on, so its checkpoints named a build
 * that never ran.
 */
const running = buildOf(TREE);

/** The running build, the same for every call in a process. */
export function detentBuild(): string {
  return running;
}

/**
 * Whether more than one build made what `builds` lists. One that recorded
 * nothing may have been several, so it is never taken for a single build.
 */
export function isMixed(builds: readonly string[]): boolean {
  return new Set(builds).size > 1 || builds.includes(UNRECORDED_BUILD);
}
