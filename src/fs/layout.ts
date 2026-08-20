import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { SCHEMA_VERSION } from "../schemas/common.js";

/**
 * T-023 — the `.detent/` layout (F-1), its boundary (F-2), and F-3 stamping.
 *
 * F-1's split is not a convention: the committed set is the repository's shared
 * memory (plans, bindings, research — P8), and the local set is one machine's
 * run state, which must never travel. Detent writes the `.gitignore` that
 * enforces it rather than asking the user to.
 */

/** The state directory, at the git root only (F-1). */
export const STATE_DIR = ".detent";

export const stateDir = (root: string): string => path.join(root, STATE_DIR);

type Tracking = "committed" | "local";

/**
 * Draft.5's ownership split. `per-ticket` entries are serialized by the C-9
 * claim; `run-level` entries are single-writer for the lifetime of a run and a
 * claim does not serialize them — a claim scopes a ticket, not the journal.
 * T-041 discharges F-1's single-writer AC, since no writer exists until then.
 */
type Ownership = "repository" | "per-ticket" | "run-level";

export interface LayoutEntry {
  /** Relative to `.detent/`, POSIX. */
  readonly rel: string;
  readonly kind: "dir" | "file";
  readonly tracking: Tracking;
  readonly ownership: Ownership;
  /** F-3: committed artifacts carry `schema_version`. JSONL rows do not. */
  readonly stamped: boolean;
}

/**
 * T-120/T-121 — the D-21 hook policy files, run-level local state: the
 * referee writes them per claim (surface) and per pool refresh (stage/
 * re-feed); the plugin hook reads them at the session cwd. Their names live
 * in the dependency-free `hook-files.ts` so the hook bundle can share the
 * spelling without pulling this module's schema imports; re-exported here as
 * the kernel-side import surface.
 */
export { HOOK_STAGE_FILE, HOOK_SURFACE_FILE } from "./hook-files.js";
import { HOOK_STAGE_FILE, HOOK_SURFACE_FILE } from "./hook-files.js";

export const LAYOUT: readonly LayoutEntry[] = [
  { rel: "config.json", kind: "file", tracking: "committed", ownership: "repository", stamped: true },
  { rel: "bindings.json", kind: "file", tracking: "committed", ownership: "repository", stamped: true },
  { rel: "plan", kind: "dir", tracking: "committed", ownership: "repository", stamped: true },
  { rel: "research/failures", kind: "dir", tracking: "committed", ownership: "repository", stamped: true },
  { rel: "research/planning", kind: "dir", tracking: "committed", ownership: "repository", stamped: true },
  { rel: "agents", kind: "dir", tracking: "committed", ownership: "repository", stamped: true },
  { rel: ".gitignore", kind: "file", tracking: "committed", ownership: "repository", stamped: false },

  { rel: "state", kind: "dir", tracking: "local", ownership: "per-ticket", stamped: true },
  { rel: "runs", kind: "dir", tracking: "local", ownership: "per-ticket", stamped: false },
  { rel: "claims", kind: "dir", tracking: "local", ownership: "per-ticket", stamped: false },
  { rel: "worktrees", kind: "dir", tracking: "local", ownership: "per-ticket", stamped: false },
  { rel: "logs", kind: "dir", tracking: "local", ownership: "run-level", stamped: false },
  { rel: "ledger.jsonl", kind: "file", tracking: "local", ownership: "run-level", stamped: false },
  { rel: "transitions.jsonl", kind: "file", tracking: "local", ownership: "run-level", stamped: false },
  { rel: HOOK_SURFACE_FILE, kind: "file", tracking: "local", ownership: "run-level", stamped: true },
  { rel: HOOK_STAGE_FILE, kind: "file", tracking: "local", ownership: "run-level", stamped: true },
];

export const COMMITTED = LAYOUT.filter((e) => e.tracking === "committed");
export const LOCAL = LAYOUT.filter((e) => e.tracking === "local");
/** F-1: exactly one process appends to each of these for a run's lifetime. */
export const RUN_LEVEL = LAYOUT.filter((e) => e.ownership === "run-level");

/**
 * The `.gitignore` Detent writes into `.detent/`. Derived from LAYOUT, so a
 * new local entry cannot be added without becoming ignored.
 */
export function gitignoreBody(): string {
  const lines = LOCAL.map((e) => (e.kind === "dir" ? `${e.rel}/` : e.rel)).sort();
  return [
    "# Written by Detent (F-1). Do not edit.",
    "# Local run state: checkpoints, journals, claims and worktrees never travel",
    "# between machines. Everything not listed here is committed on purpose.",
    ...lines,
    "",
  ].join("\n");
}

/** Fresh init: create the split and write the ignore file. Idempotent. */
export function initLayout(root: string): void {
  mkdirSync(stateDir(root), { recursive: true });
  for (const entry of LAYOUT) {
    const target = path.join(stateDir(root), ...entry.rel.split("/"));
    if (entry.kind === "dir") mkdirSync(target, { recursive: true });
    else mkdirSync(path.dirname(target), { recursive: true });
  }
  writeFileSync(path.join(stateDir(root), ".gitignore"), gitignoreBody());
}

/*
 * ---------------------------------------------------------------------------
 * F-2 boundary
 */

export interface BoundaryRule {
  readonly name: string;
  readonly patterns: readonly string[];
}

/**
 * F-2's never-list, as data. `.detent/` never contains project dependencies,
 * build/lint/test/TypeScript configuration, application configuration, or
 * source code — because the moment it does, Detent owns the project's tooling
 * rather than binding to it (P3/D-4).
 */
export const BOUNDARY_RULES: readonly BoundaryRule[] = [
  {
    name: "project dependencies",
    patterns: [
      "**/node_modules/**",
      "**/node_modules/",
      "**/vendor/",
      "**/package.json",
      "**/package-lock.json",
      "**/pnpm-lock.yaml",
      "**/yarn.lock",
      "**/bun.lockb",
      "**/pyproject.toml",
      "**/poetry.lock",
      "**/uv.lock",
      "**/requirements*.txt",
      "**/Cargo.toml",
      "**/Cargo.lock",
      "**/go.mod",
      "**/go.sum",
      "**/Gemfile*",
    ],
  },
  {
    name: "build, lint, test or TypeScript configuration",
    patterns: [
      "**/tsconfig*.json",
      "**/jsconfig.json",
      "**/*.config.{js,cjs,mjs,ts,mts,cts,json,toml,yaml,yml}",
      "**/.eslintrc*",
      "**/.prettierrc*",
      "**/.babelrc*",
      "**/.swcrc",
      "**/Makefile",
      "**/makefile",
      "**/justfile",
      "**/*.mk",
      "**/pytest.ini",
      "**/tox.ini",
      "**/setup.cfg",
      "**/setup.py",
      "**/Dockerfile*",
      "**/docker-compose*.{yml,yaml}",
    ],
  },
  {
    name: "application configuration",
    patterns: ["**/.env", "**/.env.*", "**/*.env", "**/application*.{yml,yaml,properties}", "**/settings.py"],
  },
  {
    name: "source code",
    patterns: [
      "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,py,go,rs,rb,java,kt,kts,c,h,cc,cpp,hpp,cs,php,swift,scala,ex,exs,sh,bash,zsh}",
    ],
  },
];

export interface BoundaryViolation {
  /** Relative to `.detent/`, POSIX. */
  readonly rel: string;
  readonly rule: string;
}

/**
 * The F-2 lint. Runs over the real contents of `.detent/`, so a session that
 * writes a `tsconfig.json` there fails CI rather than quietly redefining the
 * project's build.
 */
export function boundaryViolations(root: string): BoundaryViolation[] {
  const dir = stateDir(root);
  if (!existsSync(dir)) return [];
  const matchers = BOUNDARY_RULES.map((rule) => ({ rule, isMatch: picomatch([...rule.patterns], { dot: true }) }));
  const violations: BoundaryViolation[] = [];

  for (const rel of walk(dir)) {
    for (const { rule, isMatch } of matchers) {
      if (isMatch(rel)) {
        violations.push({ rel, rule: rule.name });
        break;
      }
    }
  }
  return violations.sort((a, b) => a.rel.localeCompare(b.rel));
}

function walk(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    const rel = prefix === "" ? name : `${prefix}/${name}`;
    if (statSync(abs).isDirectory()) {
      /* A directory can itself be a violation (an empty `node_modules/`). */
      out.push(`${rel}/`);
      out.push(...walk(abs, rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

/*
 * ---------------------------------------------------------------------------
 * F-3 stamping
 */

class UnstampedArtifactError extends Error {
  constructor(readonly rel: string) {
    super(`${rel} is a committed artifact and must carry schema_version (F-3)`);
    this.name = "UnstampedArtifactError";
  }
}

/** F-3: every committed file carries `schema_version`. */
export function stamp<T extends object>(value: T): T & { schema_version: number } {
  return { schema_version: SCHEMA_VERSION, ...value };
}

export function isStamped(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { schema_version?: unknown }).schema_version === "number"
  );
}

/** Which layout entry a `.detent/`-relative path belongs to, if any. */
export function entryFor(rel: string): LayoutEntry | undefined {
  return LAYOUT.find((e) => (e.kind === "file" ? e.rel === rel : rel === e.rel || rel.startsWith(`${e.rel}/`)));
}

/**
 * Reject anything that could resolve outside `.detent/`. `entryFor` alone is
 * not enough: `plan/../../etc/passwd` matches the `plan/` entry by prefix and
 * would then be joined straight out of the state directory.
 */
function assertContained(rel: string): void {
  if (rel.startsWith("/") || rel.split("/").includes("..")) {
    throw new Error(`${rel} would resolve outside ${STATE_DIR}`);
  }
}

/**
 * Write an artifact into the layout, stamped and position-checked. F-2 and F-3
 * are enforced on the way in rather than by a later audit.
 */
export function writeArtifact(root: string, rel: string, value: object): void {
  assertContained(rel);
  const entry = entryFor(rel);
  if (entry === undefined) throw new Error(`${rel} is not part of the F-1 layout`);
  const body = entry.stamped ? stamp(value) : value;
  if (entry.stamped && !isStamped(body)) throw new UnstampedArtifactError(rel);
  const target = path.join(stateDir(root), ...rel.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(body, null, 2)}\n`);
}
