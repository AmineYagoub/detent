import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { SCHEMA_VERSION } from "../../schemas/common.js";
import { goEngine } from "./go.js";
import { justEngine } from "./just.js";
import { makeEngine } from "./make.js";
import { nodeEngine } from "./node.js";
import { pythonEngine } from "./python.js";
import { rustEngine } from "./rust.js";
import { tscEngine } from "./tsc.js";
import {
  compareCandidates,
  type Candidate,
  type Discovery,
  type Engine,
  type PackageManager,
  type StackFacts,
} from "./types.js";

export * from "./types.js";
export { parseRecipes } from "./recipes.js";
export { parseTables, findTable } from "./toml.js";

/**
 * T-025 — discovery (C-2, V-1, N-2).
 *
 * Deterministic and token-free. The engine list is fixed and ordered, the
 * marker scan is sorted, and the emitted JSON has sorted keys, so repeated runs
 * on the same tree are byte-identical (N-2's serialization-determinism half).
 */

export const ENGINES: readonly Engine[] = [
  nodeEngine,
  tscEngine,
  makeEngine,
  justEngine,
  pythonEngine,
  goEngine,
  rustEngine,
];

/** Files whose presence is a stack fact (C-2). Scanned at the root only (D-5). */
const MARKERS: readonly string[] = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "tsconfig.json",
  "Makefile",
  "makefile",
  "GNUmakefile",
  "justfile",
  "Justfile",
  ".justfile",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "uv.lock",
  "poetry.lock",
  "go.mod",
  "go.sum",
  "go.work",
  "Cargo.toml",
  "Cargo.lock",
  "pnpm-workspace.yaml",
  "turbo.json",
  "nx.json",
  "lerna.json",
];

/** Lockfile ⇒ package manager (V-4). Order is R-7's. */
const PM_BY_LOCKFILE: readonly (readonly [string, PackageManager])[] = [
  ["package-lock.json", "npm"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
];

export function gatherFacts(root: string): StackFacts {
  const present = new Set(existsSync(root) ? readdirSync(root) : []);
  const markers = MARKERS.filter((m) => present.has(m)).sort();
  const pm = PM_BY_LOCKFILE.find(([file]) => present.has(file))?.[1] ?? null;
  return { root, markers, pm };
}

export function discover(root: string): Discovery {
  const facts = gatherFacts(root);
  const candidates: Candidate[] = [];
  for (const engine of ENGINES) candidates.push(...engine.discover(facts));
  candidates.sort(compareCandidates);
  /**
   * PRDR-154: `preferOrchestrator` is deliberately NOT wired here, and this
   * comment is the record of why rather than a silence.
   *
   * PRDR-141 wired it, and the audit of that commit found two ways it breaks a
   * repository, both invisible to the suite:
   *
   * 1. It DEDUPS by command string and DROPS the collider. `go-work`'s root
   *    gates are byte-identical to what `discover/go.ts` emits, so the
   *    `adapter: "go"` candidate vanished from discovery — and `currentFor`
   *    matches on slot+adapter+ref, so an existing `bindings.json` reported
   *    `vanished`, which halts. Every ticket on a `go.work` repo bricked at
   *    exit 2 against a binding that was valid the day before.
   * 2. Its npm-workspaces root gate is `npm run test --workspaces --if-present`,
   *    which exits 0 having run NOTHING when the packages carry no `test`
   *    script and the root config covers them — the commonest monorepo layout.
   *    `bindSlot` probes it, sees green, and binds a gate that can never fail.
   *    That is the "greened on nothing" class V-1″ closed once already.
   *
   * The module needs its command table and its dedup reconsidered before it is
   * connected — demote the collider rather than dropping it, and never prefer a
   * sweep that can pass vacuously. That is a design change with its own
   * evidence, not a wiring line.
   */
  return {
    schema_version: SCHEMA_VERSION,
    stack: { markers: facts.markers, pm: facts.pm },
    candidates,
  };
}

/** C-2's artifact lives with the checkpoints: it is derived, not committed. */
export function discoveryPath(root: string): string {
  return path.join(root, ".detent", "state", "discovery.json");
}
