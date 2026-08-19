import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BOUNDARY_RULES,
  COMMITTED,
  LAYOUT,
  LOCAL,
  RUN_LEVEL,
  STATE_DIR,
  boundaryViolations,
  entryFor,
  gitignoreBody,
  initLayout,
  isStamped,
  stamp,
  stateDir,
  writeArtifact,
} from "../../src/fs/layout.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { git, gitInit, removeTree, tmpTree, writeTree } from "../helpers.js";

/** T-023 — `.detent/` layout (F-1), boundary (F-2), stamping (F-3). */

const trees: string[] = [];
const tree = (files: Record<string, string> = {}): string => {
  const root = tmpTree(files);
  trees.push(root);
  return root;
};
afterEach(() => {
  for (const t of trees.splice(0)) removeTree(t);
});

describe("T-023 F-1 split", () => {
  it("fresh init produces exactly the layout, and nothing else", () => {
    const root = tree();
    initLayout(root);
    for (const entry of LAYOUT) {
      const target = path.join(stateDir(root), ...entry.rel.split("/"));
      if (entry.kind === "dir") expect(existsSync(target), entry.rel).toBe(true);
      else expect(existsSync(path.dirname(target)), entry.rel).toBe(true);
    }
    expect(existsSync(path.join(stateDir(root), ".gitignore"))).toBe(true);
  });

  it("the committed and local sets are exactly F-1's", () => {
    expect(COMMITTED.map((e) => e.rel).sort()).toEqual(
      [".gitignore", "agents", "bindings.json", "config.json", "plan", "research/failures", "research/planning"],
    );
    /** T-120/T-121 added the two D-21 hook-policy files to the local set. */
    expect(LOCAL.map((e) => e.rel).sort()).toEqual(
      ["active_surface.json", "claims", "ledger.jsonl", "logs", "runs", "stage.json", "state", "transitions.jsonl", "worktrees"],
    );
  });

  it("encodes draft.5's ownership split — journals and hook policy are run-level, single-writer", () => {
    expect(RUN_LEVEL.map((e) => e.rel).sort()).toEqual(
      ["active_surface.json", "ledger.jsonl", "logs", "stage.json", "transitions.jsonl"],
    );
    expect(LOCAL.filter((e) => e.ownership === "per-ticket").map((e) => e.rel).sort()).toEqual(
      ["claims", "runs", "state", "worktrees"],
    );
  });

  it("the Detent-written .gitignore is derived from the local set, not hand-listed", () => {
    const body = gitignoreBody();
    for (const entry of LOCAL) {
      expect(body, entry.rel).toContain(entry.kind === "dir" ? `${entry.rel}/` : entry.rel);
    }
    for (const entry of COMMITTED) {
      if (entry.rel === ".gitignore") continue;
      expect(body.split("\n")).not.toContain(entry.rel);
    }
  });

  it("git status shows only the committed set", () => {
    const root = tree();
    gitInit(root);
    initLayout(root);
    writeTree(root, {
      ".detent/config.json": "{}\n",
      ".detent/bindings.json": "{}\n",
      ".detent/plan/t-1.json": "{}\n",
      ".detent/agents/assignments.json": "{}\n",
      ".detent/research/failures/abc.json": "{}\n",
      ".detent/state/checkpoint.json": "{}\n",
      ".detent/runs/run-1/journal.json": "{}\n",
      ".detent/claims/t-1.claim": "{}\n",
      ".detent/logs/detent.log": "hi\n",
      ".detent/worktrees/t-1/.keep": "\n",
      ".detent/ledger.jsonl": "{}\n",
      ".detent/transitions.jsonl": "{}\n",
    });

    const status = git(root, "status", "--porcelain", "--untracked-files=all")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => l.slice(3))
      .sort();

    expect(status).toEqual([
      ".detent/.gitignore",
      ".detent/agents/assignments.json",
      ".detent/bindings.json",
      ".detent/config.json",
      ".detent/plan/t-1.json",
      ".detent/research/failures/abc.json",
    ]);
  });

  it("is idempotent — re-initialising an existing layout rewrites nothing else", () => {
    const root = tree();
    initLayout(root);
    writeTree(root, { ".detent/plan/t-1.json": '{"id":"t-1"}\n' });
    initLayout(root);
    expect(readFileSync(path.join(root, ".detent/plan/t-1.json"), "utf8")).toBe('{"id":"t-1"}\n');
  });
});

describe("T-023 F-2 boundary lint", () => {
  it("a clean layout has no violations", () => {
    const root = tree();
    initLayout(root);
    writeTree(root, {
      ".detent/config.json": "{}\n",
      ".detent/bindings.json": "{}\n",
      ".detent/plan/t-1.json": "{}\n",
      ".detent/plan/approval.json": "{}\n",
      ".detent/agents/assignments.json": "{}\n",
      ".detent/research/planning/q-1.json": "{}\n",
    });
    expect(boundaryViolations(root)).toEqual([]);
  });

  it.each([
    [".detent/tsconfig.json", "build, lint, test or TypeScript configuration"],
    [".detent/vitest.config.ts", "build, lint, test or TypeScript configuration"],
    [".detent/Makefile", "build, lint, test or TypeScript configuration"],
    [".detent/package.json", "project dependencies"],
    [".detent/Cargo.toml", "project dependencies"],
    [".detent/.env", "application configuration"],
    [".detent/scripts/deploy.sh", "source code"],
    [".detent/plan/helper.py", "source code"],
  ])("%s is a violation of F-2 (%s)", (file, rule) => {
    const root = tree();
    initLayout(root);
    writeTree(root, { [file]: "x\n" });
    const found = boundaryViolations(root);
    expect(found.map((v) => v.rel)).toContain(file.replace(`${STATE_DIR}/`, ""));
    expect(found.find((v) => file.endsWith(v.rel))?.rule).toBe(rule);
  });

  it("flags a dependency directory even when empty", () => {
    const root = tree();
    initLayout(root);
    writeTree(root, { ".detent/node_modules/.keep": "\n" });
    expect(boundaryViolations(root).some((v) => v.rule === "project dependencies")).toBe(true);
  });

  it("does not flag the committed set — .gitignore and JSON artifacts are Detent's own", () => {
    const root = tree();
    initLayout(root);
    /**
     * `config.json` is Detent's config, not the project's: F-2 forbids the
     * project's configuration, and a rule that caught this would be wrong.
     */
    expect(boundaryViolations(root)).toEqual([]);
    expect(BOUNDARY_RULES.length).toBe(4);
  });

  it("reports the rule that caught it, so a fixture failure names the cause", () => {
    const root = tree();
    initLayout(root);
    writeTree(root, { ".detent/eslint.config.js": "export default []\n" });
    const [first] = boundaryViolations(root);
    expect(first?.rel).toBe("eslint.config.js");
    /** Source-code and config rules both match; the first rule in order wins. */
    expect(first?.rule).toBe("build, lint, test or TypeScript configuration");
  });
});

describe("T-023 F-3 stamping", () => {
  it("stamps with the current schema version", () => {
    expect(stamp({ a: 1 })).toEqual({ schema_version: SCHEMA_VERSION, a: 1 });
    expect(isStamped({ schema_version: 1 })).toBe(true);
    expect(isStamped({})).toBe(false);
  });

  it("a caller's own schema_version wins over the default stamp", () => {
    expect(stamp({ schema_version: 7 })).toEqual({ schema_version: 7 });
  });

  it("writeArtifact stamps committed artifacts and refuses paths outside the layout", () => {
    const root = tree();
    initLayout(root);
    writeArtifact(root, "config.json", { budgets: {} });
    const written = JSON.parse(readFileSync(path.join(root, ".detent/config.json"), "utf8")) as { schema_version: number };
    expect(written.schema_version).toBe(SCHEMA_VERSION);
    expect(() => writeArtifact(root, "../escape.json", {})).toThrow(/would resolve outside/);
  });

  it("refuses a path that escapes through a layout directory", () => {
    const root = tree();
    initLayout(root);
    /**
     * `plan/` is a real layout entry, so a prefix match alone would accept this
     * and then join it straight out of `.detent/`.
     */
    expect(() => writeArtifact(root, "plan/../../../escaped.json", {})).toThrow(/would resolve outside/);
    expect(() => writeArtifact(root, "/etc/passwd", {})).toThrow(/would resolve outside/);
    expect(existsSync(path.join(root, "..", "escaped.json"))).toBe(false);
  });

  it("does not stamp the local journals — JSONL rows carry no schema_version", () => {
    expect(entryFor("ledger.jsonl")?.stamped).toBe(false);
    expect(entryFor("transitions.jsonl")?.stamped).toBe(false);
    expect(entryFor("plan/t-1.json")?.stamped).toBe(true);
  });
});

describe("T-023 the layout module owns the directory name", () => {
  it("the kernel's ticket paths resolve under the same STATE_DIR", async () => {
    const { ticketsDir, claimsDir } = await import("../../src/kernel/tickets/paths.js");
    const root = tree();
    expect(ticketsDir(root)).toBe(path.join(root, STATE_DIR, "plan"));
    expect(claimsDir(root)).toBe(path.join(root, STATE_DIR, "claims"));
  });

  it("the repository's own .detent/ is a real place, not just a constant", () => {
    const root = tree();
    initLayout(root);
    writeFileSync(path.join(root, ".detent", "config.json"), "{}\n");
    expect(existsSync(path.join(root, STATE_DIR, "config.json"))).toBe(true);
  });
});
