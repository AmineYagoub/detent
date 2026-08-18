import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  discover,
  gatherFacts,
  plausible,
  serializeDiscovery,
  type Candidate,
} from "../../src/adapter/discover/index.js";
import { parseRecipes } from "../../src/adapter/discover/recipes.js";
import { parseTables } from "../../src/adapter/discover/toml.js";
import { removeTree, tmpTree, writeTree } from "../helpers.js";

/** T-025 — discovery engines (V-1 candidate proposal, C-2 stack facts, N-2). */

const trees: string[] = [];
const tree = (files: Record<string, string>): string => {
  const root = tmpTree(files);
  trees.push(root);
  return root;
};
afterEach(() => {
  for (const t of trees.splice(0)) removeTree(t);
});

const forSlot = (cs: readonly Candidate[], slot: string): Candidate[] => cs.filter((c) => c.slot === slot);
const resolvedFor = (cs: readonly Candidate[], slot: string): string[] => forSlot(cs, slot).map((c) => c.resolved);

/* --- the fixture matrix ----------------------------------------------------- */

const NODE_FIXTURE = {
  "package.json": JSON.stringify(
    { name: "svc", scripts: { test: "vitest run", lint: "eslint .", typecheck: "tsc --noEmit", build: "tsup" } },
    null,
    2,
  ),
  "package-lock.json": "{}\n",
};

const MAKE_FIXTURE = {
  Makefile: ".PHONY: test lint\n\ntest:\n\tgo test ./...\n\nlint:\n\tgolangci-lint run\n\nbuild:\n\tgo build ./...\n",
};

const JUST_FIXTURE = { justfile: "test:\n    cargo test\n\nlint:\n    cargo clippy\n" };

const PY_FIXTURE = {
  "pyproject.toml":
    "[project]\nname = 'svc'\n\n[tool.pytest.ini_options]\ntestpaths = ['tests']\n\n[tool.ruff]\nline-length = 100\n\n[tool.mypy]\nstrict = true\n",
  "uv.lock": "version = 1\n",
};

const GO_FIXTURE = { "go.mod": "module example.com/svc\n\ngo 1.22\n", "go.sum": "h1:abc\n" };

const RUST_FIXTURE = { "Cargo.toml": "[package]\nname = 'svc'\n", "Cargo.lock": "version = 3\n" };

const TSC_FIXTURE = {
  "package.json": JSON.stringify({ name: "lib", scripts: { test: "vitest run" } }, null, 2),
  "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }, null, 2),
  "package-lock.json": "{}\n",
};

describe("T-025 per-ecosystem candidates (V-1)", () => {
  it("node: scripts plus lockfile ⇒ package manager", () => {
    const { candidates, stack } = discover(tree(NODE_FIXTURE));
    expect(stack.pm).toBe("npm");
    expect(resolvedFor(candidates, "test")).toEqual(["npm run test"]);
    expect(resolvedFor(candidates, "lint")).toEqual(["npm run lint"]);
    expect(resolvedFor(candidates, "typecheck")).toEqual(["npm run typecheck"]);
    expect(resolvedFor(candidates, "build")).toEqual(["npm run build"]);
  });

  it.each([
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
  ])("node: %s selects %s at discovery time", (lock, pm) => {
    const root = tree({ "package.json": JSON.stringify({ scripts: { test: "vitest run" } }), [lock]: "x\n" });
    const { candidates, stack } = discover(root);
    expect(stack.pm).toBe(pm);
    expect(resolvedFor(candidates, "test")).toEqual([`${pm} run test`]);
  });

  it("node: no lockfile still proposes, defaulting the manager to npm", () => {
    const root = tree({ "package.json": JSON.stringify({ scripts: { test: "vitest run" } }) });
    expect(discover(root).stack.pm).toBeNull();
    expect(resolvedFor(discover(root).candidates, "test")).toEqual(["npm run test"]);
  });

  it("make: targets become candidates, .PHONY does not", () => {
    const { candidates } = discover(tree(MAKE_FIXTURE));
    expect(resolvedFor(candidates, "test")).toEqual(["make test"]);
    expect(resolvedFor(candidates, "build")).toEqual(["make build"]);
    expect(candidates.every((c) => !c.ref.startsWith("."))).toBe(true);
  });

  it("just: recipes become candidates", () => {
    const { candidates } = discover(tree(JUST_FIXTURE));
    expect(resolvedFor(candidates, "test")).toEqual(["just test"]);
    expect(resolvedFor(candidates, "lint")).toEqual(["just lint"]);
  });

  it("pyproject: a tool's configuration table is the binding signal", () => {
    const { candidates } = discover(tree(PY_FIXTURE));
    expect(resolvedFor(candidates, "test")).toEqual(["pytest"]);
    expect(resolvedFor(candidates, "lint")).toEqual(["ruff check ."]);
    expect(resolvedFor(candidates, "typecheck")).toEqual(["mypy ."]);
  });

  it("pyproject: with no pytest table, pytest is still proposed — at rank 1", () => {
    const root = tree({ "pyproject.toml": "[project]\nname = 'svc'\n" });
    const [test] = forSlot(discover(root).candidates, "test");
    expect(test?.resolved).toBe("pytest");
    expect(test?.rank).toBe(1);
  });

  it("go: the module file is the whole signal", () => {
    const { candidates } = discover(tree(GO_FIXTURE));
    expect(resolvedFor(candidates, "test")).toEqual(["go test ./..."]);
    expect(resolvedFor(candidates, "lint")).toEqual(["go vet ./..."]);
    expect(resolvedFor(candidates, "build")).toEqual(["go build ./..."]);
  });

  it("cargo: test, check, clippy and build", () => {
    const { candidates } = discover(tree(RUST_FIXTURE));
    expect(resolvedFor(candidates, "test")).toEqual(["cargo test"]);
    expect(resolvedFor(candidates, "typecheck")).toEqual(["cargo check"]);
    expect(resolvedFor(candidates, "build")).toEqual(["cargo build"]);
  });

  it("tsc: tsconfig proposes --noEmit, and a declared script outranks it", () => {
    const { candidates } = discover(tree(TSC_FIXTURE));
    expect(resolvedFor(candidates, "typecheck")).toEqual(["npx tsc --noEmit"]);

    const withScript = discover(
      tree({
        ...TSC_FIXTURE,
        "package.json": JSON.stringify({ scripts: { typecheck: "tsc --noEmit --pretty" } }),
      }),
    );
    /** Both are proposed, but only the project's own script is plausible (C-3b). */
    expect(resolvedFor(withScript.candidates, "typecheck")).toEqual(["npm run typecheck", "npx tsc --noEmit"]);
    expect(plausible(withScript.candidates, "typecheck").map((c) => c.resolved)).toEqual(["npm run typecheck"]);
  });

  it("an empty directory proposes nothing rather than guessing", () => {
    const { candidates, stack } = discover(tree({ "README.md": "hi\n" }));
    expect(candidates).toEqual([]);
    expect(stack.markers).toEqual([]);
  });

  it("an unparseable manifest proposes nothing and does not throw", () => {
    const root = tree({ "package.json": "{ not json", "package-lock.json": "{}\n" });
    expect(() => discover(root)).not.toThrow();
    expect(discover(root).candidates).toEqual([]);
  });
});

describe("T-025 ambiguity is surfaced, never resolved (V-1)", () => {
  it("make test + npm test are two plausible candidates", () => {
    const root = tree({ ...NODE_FIXTURE, ...MAKE_FIXTURE });
    const { candidates } = discover(root);
    expect(plausible(candidates, "test").map((c) => c.resolved).sort()).toEqual(["make test", "npm run test"]);
  });

  it("a preference and a fallback are not an ambiguity", () => {
    const { candidates } = discover(tree(TSC_FIXTURE));
    expect(plausible(candidates, "typecheck")).toHaveLength(1);
  });
});

describe("T-025 N-2 determinism", () => {
  const FIXTURES = { node: NODE_FIXTURE, make: MAKE_FIXTURE, just: JUST_FIXTURE, py: PY_FIXTURE, go: GO_FIXTURE, rust: RUST_FIXTURE, tsc: TSC_FIXTURE };

  it.each(Object.entries(FIXTURES))("%s discovery is byte-identical when repeated", (_name, files) => {
    const root = tree(files);
    expect(serializeDiscovery(discover(root))).toBe(serializeDiscovery(discover(root)));
  });

  it("is byte-identical across two separate process invocations", () => {
    const root = tree({ ...NODE_FIXTURE, ...MAKE_FIXTURE, ...PY_FIXTURE });
    const script = `import { discover, serializeDiscovery } from ${JSON.stringify(
      new URL("../../src/adapter/discover/index.ts", import.meta.url).href,
    )}; process.stdout.write(serializeDiscovery(discover(${JSON.stringify(root)})));`;
    const once = execFileSync("npx", ["tsx", "-e", script], { encoding: "utf8" });
    const twice = execFileSync("npx", ["tsx", "-e", script], { encoding: "utf8" });
    expect(once).toBe(twice);
    expect(once).toBe(serializeDiscovery(discover(root)));
  }, 60_000);

  it("emits sorted keys at every depth, so construction order cannot leak", () => {
    const json = serializeDiscovery(discover(tree(NODE_FIXTURE)));
    expect(json.startsWith('{"candidates":')).toBe(true);
    const keys = [...json.matchAll(/"(adapter|config_file|config_hash|config_region|pm|rank|ref|resolved|slot)":/g)].map(
      (m) => m[1],
    );
    expect(keys.slice(0, 9)).toEqual([
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
  });
});

describe("T-025 config regions are precise (V-3 substrate)", () => {
  it("editing an unrelated script does not move the test binding's hash", () => {
    const root = tree(NODE_FIXTURE);
    const before = forSlot(discover(root).candidates, "test")[0]?.config_hash;
    writeTree(root, {
      "package.json": JSON.stringify({ scripts: { test: "vitest run", lint: "eslint . --max-warnings 0" } }, null, 2),
    });
    expect(forSlot(discover(root).candidates, "test")[0]?.config_hash).toBe(before);
  });

  it("editing the defining script does move it", () => {
    const root = tree(NODE_FIXTURE);
    const before = forSlot(discover(root).candidates, "test")[0]?.config_hash;
    writeTree(root, { "package.json": JSON.stringify({ scripts: { test: "vitest run --coverage" } }, null, 2) });
    expect(forSlot(discover(root).candidates, "test")[0]?.config_hash).not.toBe(before);
  });

  it("a make target's region is its own recipe, not the whole file", () => {
    const root = tree(MAKE_FIXTURE);
    const before = forSlot(discover(root).candidates, "test")[0]?.config_hash;
    writeTree(root, { Makefile: MAKE_FIXTURE.Makefile.replace("golangci-lint run", "golangci-lint run --fix") });
    expect(forSlot(discover(root).candidates, "test")[0]?.config_hash).toBe(before);
    expect(forSlot(discover(root).candidates, "lint")[0]?.config_hash).not.toBe(before);
  });

  it("an existence-derived region does not move when the file's contents change", () => {
    const root = tree(GO_FIXTURE);
    const before = forSlot(discover(root).candidates, "test")[0]?.config_hash;
    writeTree(root, { "go.mod": "module example.com/svc\n\ngo 1.23\n\nrequire github.com/x/y v1.0.0\n" });
    expect(forSlot(discover(root).candidates, "test")[0]?.config_hash).toBe(before);
  });
});

describe("T-025 parsers", () => {
  it("parseRecipes captures the block and skips dot-targets", () => {
    const recipes = parseRecipes(".PHONY: test\n\ntest:\n\techo a\n\techo b\n\nlint:\n\techo c\n");
    expect(recipes.map((r) => r.name)).toEqual(["test", "lint"]);
    expect(recipes[0]?.block).toBe("test:\n\techo a\n\techo b");
  });

  it("parseRecipes ignores := assignments", () => {
    expect(parseRecipes("CC := gcc\n\ntest:\n\techo a\n").map((r) => r.name)).toEqual(["test"]);
  });

  it("parseTables captures each table verbatim", () => {
    const tables = parseTables("[project]\nname = 'x'\n\n[tool.ruff]\nline-length = 100\n");
    expect(tables.map((t) => t.name)).toEqual(["project", "tool.ruff"]);
    expect(tables[1]?.block).toBe("[tool.ruff]\nline-length = 100");
  });

  it("gatherFacts reports markers sorted, root only", () => {
    const root = tree({ ...NODE_FIXTURE, "sub/package.json": "{}\n" });
    expect(gatherFacts(root).markers).toEqual(["package-lock.json", "package.json"]);
  });
});
