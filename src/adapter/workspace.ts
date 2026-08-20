import { readFileSync } from "node:fs";
import path from "node:path";
import { findTable, parseTables } from "./discover/toml.js";
import { candidate, type Candidate, type StackFacts } from "./discover/types.js";
import type { GateSlot } from "./run.js";

/**
 * T-029 — monorepo detection and root candidates (V-5, D-5).
 *
 * v1 binds root entrypoints only. Where an orchestrator exists, its own
 * root-level command is preferred over a per-package one, because that is the
 * command the repository's authors made responsible for the whole tree.
 *
 * Non-goal (V-5, D-5): any per-workspace schema field. Nothing here is stored
 * per workspace; a detected workspace changes which *root* command is proposed
 * and nothing else. Workspace scoping is a named v2 migration.
 */

type WorkspaceKind =
  | "turbo"
  | "nx"
  | "pnpm"
  | "npm-workspaces"
  | "lerna"
  | "go-work"
  | "cargo-workspace";

export interface Workspace {
  readonly kind: WorkspaceKind;
  /** The marker files that identified it, sorted. */
  readonly markers: readonly string[];
}

/**
 * Detection order is preference order: an nx or turbo repository usually also
 * carries pnpm or npm workspaces, and the orchestrator is the better answer.
 */
export function detectWorkspace(facts: StackFacts): Workspace | null {
  const has = (m: string): boolean => facts.markers.includes(m);

  if (has("turbo.json")) return { kind: "turbo", markers: ["turbo.json"] };
  if (has("nx.json")) return { kind: "nx", markers: ["nx.json"] };
  if (has("pnpm-workspace.yaml")) return { kind: "pnpm", markers: ["pnpm-workspace.yaml"] };
  if (has("lerna.json")) return { kind: "lerna", markers: ["lerna.json"] };
  if (has("package.json") && hasNpmWorkspaces(facts.root)) {
    return { kind: "npm-workspaces", markers: ["package.json"] };
  }
  if (has("go.work")) return { kind: "go-work", markers: ["go.work"] };
  if (has("Cargo.toml") && hasCargoWorkspace(facts.root)) {
    return { kind: "cargo-workspace", markers: ["Cargo.toml"] };
  }
  return null;
}

function hasNpmWorkspaces(root: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      workspaces?: unknown;
    };
    return Array.isArray(parsed.workspaces) || (typeof parsed.workspaces === "object" && parsed.workspaces !== null);
  } catch {
    return false;
  }
}

function hasCargoWorkspace(root: string): boolean {
  try {
    return findTable(parseTables(readFileSync(path.join(root, "Cargo.toml"), "utf8")), "workspace") !== undefined;
  } catch {
    return false;
  }
}

interface RootCommands {
  /** Slot ⇒ the orchestrator's own root command. */
  readonly gates: Partial<Record<GateSlot, string>>;
  /**
   * V-5: `test_single` may bind to a deterministic affected filter. `BASE` is
   * substituted with the run's base ref. Absent where the orchestrator has no
   * affected-filter, in which case the root test command is the fallback.
   */
  readonly affected?: string;
}

const ROOT_COMMANDS: Record<WorkspaceKind, RootCommands> = {
  turbo: {
    gates: {
      test: "turbo run test",
      lint: "turbo run lint",
      typecheck: "turbo run typecheck",
      build: "turbo run build",
    },
    affected: "turbo run test --filter=...[BASE]",
  },
  nx: {
    gates: {
      test: "nx run-many -t test",
      lint: "nx run-many -t lint",
      typecheck: "nx run-many -t typecheck",
      build: "nx run-many -t build",
    },
    affected: "nx affected -t test --base=BASE",
  },
  pnpm: {
    gates: { test: "pnpm -r test", lint: "pnpm -r lint", typecheck: "pnpm -r typecheck", build: "pnpm -r build" },
  },
  "npm-workspaces": {
    gates: {
      test: "npm run test --workspaces --if-present",
      lint: "npm run lint --workspaces --if-present",
      build: "npm run build --workspaces --if-present",
    },
  },
  lerna: { gates: { test: "lerna run test", lint: "lerna run lint", build: "lerna run build" } },
  "go-work": { gates: { test: "go test ./...", lint: "go vet ./...", build: "go build ./..." } },
  "cargo-workspace": {
    gates: {
      test: "cargo test --workspace",
      typecheck: "cargo check --workspace",
      build: "cargo build --workspace",
    },
  },
};

/** Orchestrator-native root candidates, at rank 0 so they outrank per-package ones. */
export function workspaceCandidates(workspace: Workspace): Candidate[] {
  const spec = ROOT_COMMANDS[workspace.kind];
  const marker = workspace.markers[0] as string;
  const region = `workspace:${workspace.kind}:${marker}`;
  const out: Candidate[] = [];

  for (const [slot, resolved] of Object.entries(spec.gates) as [GateSlot, string][]) {
    out.push(
      candidate({
        slot,
        adapter: `workspace:${workspace.kind}`,
        ref: resolved,
        resolved,
        pm: null,
        config_file: marker,
        config_region: region,
        rank: 0,
      }),
    );
  }

  /**
   * V-5: an affected filter where the orchestrator has one — stored as the
   * template with the `BASE` placeholder intact, substituted at invocation
   * time against the run's merge-base (PRDR-060; normalize.ts). Otherwise the
   * root test command is the fallback, because D-5 forbids per-ticket
   * arguments and a wrong single-test binding is worse than a slow correct one.
   */
  const single = spec.affected ?? spec.gates.test;
  if (single !== undefined) {
    out.push(
      candidate({
        slot: "test_single",
        adapter: `workspace:${workspace.kind}`,
        ref: single,
        resolved: single,
        pm: null,
        config_file: marker,
        config_region: region,
        rank: 0,
      }),
    );
  }
  return out;
}

/**
 * Merge orchestrator candidates in front of the per-package ones. Existing
 * candidates are demoted rather than dropped: if the human rejects the
 * orchestrator command, the package-level one is still on the table.
 * Identical commands are not duplicated — a duplicate would read as ambiguity
 * and trigger an interrupt V-5 does not want.
 */
export function preferOrchestrator(
  candidates: readonly Candidate[],
  workspace: Workspace | null,
): Candidate[] {
  if (workspace === null) return [...candidates];
  const native = workspaceCandidates(workspace);
  const nativeCommands = new Set(native.map((c) => `${c.slot}\0${c.resolved}`));
  const demoted = candidates
    .filter((c) => !nativeCommands.has(`${c.slot}\0${c.resolved}`))
    .map((c) => ({ ...c, rank: c.rank + 10 }));
  return [...native, ...demoted];
}

export function workspaceNotice(workspace: Workspace): string {
  return (
    `Workspace detected (${workspace.kind}). Detent binds root entrypoints only in v1 (D-5), so gates run ` +
    `workspace-wide rather than per package. Per-workspace scoping is a named v2 migration.`
  );
}

/** V-5: the notice is printed once, not once per gate. */
export class NoticeLog {
  private readonly seen = new Set<string>();

  /** True the first time a key is offered, false every time after. */
  emit(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}
