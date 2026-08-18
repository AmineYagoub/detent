import { afterEach, describe, expect, it } from "vitest";
import { discover, gatherFacts, plausible } from "../../src/adapter/discover/index.js";
import {
  DEFAULT_BASE_REF,
  NoticeLog,
  detectWorkspace,
  preferOrchestrator,
  workspaceCandidates,
  workspaceNotice,
} from "../../src/adapter/workspace.js";
import { removeTree, tmpTree } from "../helpers.js";

/** T-029 — monorepo detection and root candidates (V-5, D-5). */

const trees: string[] = [];
const tree = (files: Record<string, string>): string => {
  const root = tmpTree(files);
  trees.push(root);
  return root;
};
afterEach(() => {
  for (const t of trees.splice(0)) removeTree(t);
});

const NODE = {
  "package.json": JSON.stringify({ name: "root", scripts: { test: "vitest run", lint: "eslint ." } }, null, 2),
  "package-lock.json": "{}\n",
};

const FIXTURES: Record<string, Record<string, string>> = {
  turbo: { ...NODE, "turbo.json": '{"tasks":{}}\n' },
  nx: { ...NODE, "nx.json": "{}\n" },
  pnpm: {
    "package.json": JSON.stringify({ name: "root", scripts: { test: "vitest run" } }),
    "pnpm-lock.yaml": "l\n",
    "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
  },
  "npm-workspaces": {
    "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"], scripts: { test: "vitest run" } }),
    "package-lock.json": "{}\n",
  },
  lerna: { ...NODE, "lerna.json": '{"version":"independent"}\n' },
  "go-work": { "go.mod": "module x\n", "go.work": "go 1.22\n\nuse ./a\n" },
  "cargo-workspace": { "Cargo.toml": "[workspace]\nmembers = ['a']\n", "Cargo.lock": "version = 3\n" },
};

describe("T-029 workspace detection", () => {
  it.each(Object.keys(FIXTURES))("detects the %s workspace", (kind) => {
    const root = tree(FIXTURES[kind]!);
    expect(detectWorkspace(gatherFacts(root))?.kind).toBe(kind);
  });

  it("a single-package repository is not a workspace", () => {
    expect(detectWorkspace(gatherFacts(tree(NODE)))).toBeNull();
  });

  it("a plain Cargo.toml with no [workspace] table is not a workspace", () => {
    const root = tree({ "Cargo.toml": "[package]\nname = 'x'\n" });
    expect(detectWorkspace(gatherFacts(root))).toBeNull();
  });

  it("an orchestrator outranks the package manager that carries it", () => {
    const root = tree({ ...FIXTURES["pnpm"]!, "turbo.json": "{}\n" });
    expect(detectWorkspace(gatherFacts(root))?.kind).toBe("turbo");
  });
});

describe("T-029 orchestrator-native root commands are preferred (V-5)", () => {
  it.each([
    ["turbo", "turbo run test"],
    ["nx", "nx run-many -t test"],
    ["pnpm", "pnpm -r test"],
    ["npm-workspaces", "npm run test --workspaces --if-present"],
    ["lerna", "lerna run test"],
    ["cargo-workspace", "cargo test --workspace"],
  ])("%s binds `%s` for the test slot", (kind, expected) => {
    const root = tree(FIXTURES[kind]!);
    const facts = gatherFacts(root);
    const workspace = detectWorkspace(facts)!;
    const merged = preferOrchestrator(discover(root).candidates, workspace);
    expect(plausible(merged, "test").map((c) => c.resolved)).toEqual([expected]);
  });

  it("the per-package candidate is demoted, not discarded", () => {
    const root = tree(FIXTURES["turbo"]!);
    const merged = preferOrchestrator(discover(root).candidates, detectWorkspace(gatherFacts(root)));
    const npmRun = merged.find((c) => c.resolved === "npm run test");
    expect(npmRun).toBeDefined();
    expect(npmRun!.rank).toBeGreaterThan(0);
  });

  it("an identical command is not duplicated into an ambiguity", () => {
    // go.work's native root command is the same `go test ./...` the go engine
    // already proposes; two copies would read as two opinions.
    const root = tree(FIXTURES["go-work"]!);
    const merged = preferOrchestrator(discover(root).candidates, detectWorkspace(gatherFacts(root)));
    expect(merged.filter((c) => c.slot === "test" && c.resolved === "go test ./...")).toHaveLength(1);
    expect(plausible(merged, "test")).toHaveLength(1);
  });

  it("no workspace means no re-ranking at all", () => {
    const root = tree(NODE);
    const candidates = discover(root).candidates;
    expect(preferOrchestrator(candidates, null)).toEqual([...candidates]);
  });
});

describe("T-029 test_single (V-5)", () => {
  it.each([
    ["turbo", `turbo run test --filter=...[${DEFAULT_BASE_REF}]`],
    ["nx", `nx affected -t test --base=${DEFAULT_BASE_REF}`],
  ])("%s binds a deterministic affected filter", (kind, expected) => {
    const workspace = detectWorkspace(gatherFacts(tree(FIXTURES[kind]!)))!;
    const single = workspaceCandidates(workspace).find((c) => c.slot === "test_single");
    expect(single?.resolved).toBe(expected);
  });

  it("the base ref is the run's, not a hard-coded one", () => {
    const workspace = detectWorkspace(gatherFacts(tree(FIXTURES["turbo"]!)))!;
    const single = workspaceCandidates(workspace, { base: "origin/main" }).find((c) => c.slot === "test_single");
    expect(single?.resolved).toBe("turbo run test --filter=...[origin/main]");
  });

  it.each([["pnpm", "pnpm -r test"], ["lerna", "lerna run test"]])(
    "%s has no affected filter, so test_single falls back to the root command",
    (kind, expected) => {
      const workspace = detectWorkspace(gatherFacts(tree(FIXTURES[kind]!)))!;
      const single = workspaceCandidates(workspace).find((c) => c.slot === "test_single");
      expect(single?.resolved).toBe(expected);
    },
  );

  it("carries no per-workspace field — D-5's non-goal", () => {
    const workspace = detectWorkspace(gatherFacts(tree(FIXTURES["turbo"]!)))!;
    for (const candidate of workspaceCandidates(workspace)) {
      expect(Object.keys(candidate).sort()).toEqual([
        "adapter",
        "config_file",
        "config_hash",
        "config_region",
        "pm",
        "rank",
        "ref",
        "resolved",
        "slot",
      ]);
      expect(candidate.resolved).not.toMatch(/--filter=(?!\.\.\.)/);
    }
  });
});

describe("T-029 the notice is printed once (V-5)", () => {
  it("names the workspace and says gates are repository-wide", () => {
    const workspace = detectWorkspace(gatherFacts(tree(FIXTURES["turbo"]!)))!;
    const notice = workspaceNotice(workspace);
    expect(notice).toContain("turbo");
    expect(notice).toContain("root entrypoints only");
  });

  it("a notice log emits once however many gates ask", () => {
    const log = new NoticeLog();
    const emitted = ["test", "lint", "build", "typecheck"].filter(() => log.emit("workspace-wide-gates"));
    expect(emitted).toHaveLength(1);
  });

  it("distinct notices are independent", () => {
    const log = new NoticeLog();
    expect(log.emit("a")).toBe(true);
    expect(log.emit("b")).toBe(true);
    expect(log.emit("a")).toBe(false);
  });
});
