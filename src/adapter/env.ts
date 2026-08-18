import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { runGate, type GateResult, type GateSpec } from "./run.js";

/**
 * T-021 — environment fingerprint (D-18 inputs).
 *
 * The failure-research cache key is `sha256(signature | lockfile_hash |
 * runtime_version)`: the same error under a different dependency set or a
 * different runtime is a different cause until proven otherwise (X-6/D-18).
 * This module produces the second and third components, plus the `version_facts`
 * snapshot a brief records so a later key hit can be contradicted.
 *
 * Stack strings live here by design — the adapter is where V-4 puts them.
 */

export const ECOSYSTEMS = ["node", "python", "go", "rust"] as const;
export type Ecosystem = (typeof ECOSYSTEMS)[number];

interface EcosystemSpec {
  readonly name: Ecosystem;
  readonly manifests: readonly string[];
  /** R-7, in preference order: the first present name wins. */
  readonly lockfiles: readonly string[];
  /** Glob forms, matched with picomatch per R-6. All matches are hashed. */
  readonly lockGlobs: readonly string[];
  readonly runtime: string;
  readonly versionCommand: string;
}

const SPECS: readonly EcosystemSpec[] = [
  {
    name: "node",
    manifests: ["package.json"],
    lockfiles: ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"],
    lockGlobs: [],
    runtime: "node",
    versionCommand: "node --version",
  },
  {
    name: "python",
    manifests: ["pyproject.toml", "setup.py", "setup.cfg"],
    lockfiles: ["uv.lock", "poetry.lock"],
    lockGlobs: ["requirements*.txt"],
    runtime: "python",
    versionCommand: "python3 --version",
  },
  {
    name: "go",
    manifests: ["go.mod"],
    lockfiles: ["go.sum"],
    lockGlobs: [],
    runtime: "go",
    versionCommand: "go version",
  },
  {
    name: "rust",
    manifests: ["Cargo.toml"],
    lockfiles: ["Cargo.lock"],
    lockGlobs: [],
    runtime: "rust",
    versionCommand: "cargo --version",
  },
];

/** Recorded verbatim when R-7's fallback fires, so a brief says so out loud. */
export const NO_LOCKFILE = "none";
export const UNKNOWN_VERSION = "unknown";

export interface EcosystemFingerprint {
  readonly ecosystem: Ecosystem;
  readonly manifests: readonly string[];
  /** The lockfile(s) hashed, comma-joined, or `none` when the fallback fired. */
  readonly lockfile: string;
  readonly lockfile_hash: string;
  readonly runtime: string;
  readonly runtime_version: string;
}

export interface EnvFingerprint {
  readonly ecosystems: readonly EcosystemFingerprint[];
  /** D-18's second component: one hash over every ecosystem present. */
  readonly lockfile_hash: string;
  /** D-18's third component. `unknown` when nothing could be probed. */
  readonly runtime_version: string;
  /** A-4's `version_facts`: what was true when a brief was written. */
  readonly version_facts: Readonly<Record<string, string>>;
}

/** Injectable so tests neither shell out nor depend on what is installed. */
export type RuntimeProbe = (command: string, cwd: string) => Promise<string>;

export interface FingerprintOptions {
  readonly probe?: RuntimeProbe;
  /** Skip probing entirely; every runtime records `unknown`. */
  readonly probeRuntimes?: boolean;
  readonly timeoutMs?: number;
}

/** Which ecosystems a repository declares, and what pins their dependencies. */
export function detectEcosystems(root: string): readonly Omit<EcosystemFingerprint, "runtime_version">[] {
  const found: Omit<EcosystemFingerprint, "runtime_version">[] = [];
  const entries = existsSync(root) ? readdirSync(root) : [];

  for (const spec of SPECS) {
    const manifests = spec.manifests.filter((m) => existsSync(path.join(root, m)));
    if (manifests.length === 0) continue;

    const locks = locksFor(root, spec, entries);
    // R-7: no lockfile means hashing the manifest instead, recorded as such —
    // a fingerprint that silently hashed nothing would collide across repos.
    const hashed = locks.length > 0 ? locks : manifests;
    found.push({
      ecosystem: spec.name,
      manifests,
      lockfile: locks.length > 0 ? locks.join(",") : NO_LOCKFILE,
      lockfile_hash: hashFiles(root, hashed),
      runtime: spec.runtime,
    });
  }
  return found;
}

function locksFor(root: string, spec: EcosystemSpec, entries: readonly string[]): string[] {
  const exact = spec.lockfiles.filter((l) => existsSync(path.join(root, l)));
  if (exact.length > 0) return [exact[0] as string];
  for (const pattern of spec.lockGlobs) {
    const isMatch = picomatch(pattern);
    const matched = entries.filter((e) => isMatch(e)).sort();
    if (matched.length > 0) return matched;
  }
  return [];
}

export async function fingerprint(root: string, opts: FingerprintOptions = {}): Promise<EnvFingerprint> {
  const detected = detectEcosystems(root);
  const probe = opts.probe ?? defaultProbe(opts.timeoutMs);
  const shouldProbe = opts.probeRuntimes ?? true;

  const ecosystems: EcosystemFingerprint[] = [];
  for (const d of detected) {
    const spec = SPECS.find((s) => s.name === d.ecosystem);
    const version =
      shouldProbe && spec !== undefined ? await probe(spec.versionCommand, root).catch(() => UNKNOWN_VERSION) : UNKNOWN_VERSION;
    ecosystems.push({ ...d, runtime_version: version === "" ? UNKNOWN_VERSION : version });
  }

  return {
    ecosystems,
    lockfile_hash: compositeLockHash(ecosystems),
    runtime_version: compositeRuntimeVersion(ecosystems),
    version_facts: versionFacts(ecosystems),
  };
}

/** One hash over every ecosystem, so a polyglot repo still has a single key. */
function compositeLockHash(ecosystems: readonly EcosystemFingerprint[]): string {
  const h = createHash("sha256");
  for (const e of [...ecosystems].sort((a, b) => a.ecosystem.localeCompare(b.ecosystem))) {
    h.update(`${e.ecosystem}\0${e.lockfile}\0${e.lockfile_hash}\n`);
  }
  return h.digest("hex");
}

function compositeRuntimeVersion(ecosystems: readonly EcosystemFingerprint[]): string {
  if (ecosystems.length === 0) return UNKNOWN_VERSION;
  return [...ecosystems]
    .sort((a, b) => a.runtime.localeCompare(b.runtime))
    .map((e) => `${e.runtime} ${e.runtime_version}`)
    .join("; ");
}

function versionFacts(ecosystems: readonly EcosystemFingerprint[]): Record<string, string> {
  const facts: Record<string, string> = {};
  for (const e of [...ecosystems].sort((a, b) => a.ecosystem.localeCompare(b.ecosystem))) {
    facts[e.runtime] = e.runtime_version;
    facts[`${e.ecosystem}.lockfile`] = e.lockfile;
    facts[`${e.ecosystem}.lockfile_hash`] = e.lockfile_hash;
  }
  return facts;
}

/** D-18 verbatim: the composite key a failure brief is filed under. */
export function cacheKey(signature: string, fp: EnvFingerprint): string {
  return createHash("sha256").update(`${signature}|${fp.lockfile_hash}|${fp.runtime_version}`).digest("hex");
}

/**
 * X-6: a key hit additionally validates the brief's `version_facts` against the
 * current environment, and any contradiction is a miss. Facts the environment
 * no longer reports are not contradictions — only disagreements are.
 */
export function contradictions(recorded: Readonly<Record<string, string>>, current: EnvFingerprint): string[] {
  const out: string[] = [];
  for (const [key, was] of Object.entries(recorded).sort(([a], [b]) => a.localeCompare(b))) {
    const now = current.version_facts[key];
    if (now !== undefined && now !== was) out.push(`${key}: brief recorded ${was}, environment reports ${now}`);
  }
  return out;
}

function hashFiles(root: string, rels: readonly string[]): string {
  const h = createHash("sha256");
  for (const rel of [...rels].sort()) {
    const body = readFileSync(path.join(root, rel));
    h.update(`${rel}\0`).update(createHash("sha256").update(body).digest("hex")).update("\n");
  }
  return h.digest("hex");
}

const VERSION_IN_OUTPUT = /\b(\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?)\b/;

function defaultProbe(timeoutMs = 10_000): RuntimeProbe {
  return async (command, cwd) => {
    const result: GateResult = await runGate({ command, cwd, timeoutMs, killGraceMs: 1_000 } satisfies GateSpec);
    if (!result.green) return UNKNOWN_VERSION;
    return VERSION_IN_OUTPUT.exec(result.output)?.[1] ?? UNKNOWN_VERSION;
  };
}
