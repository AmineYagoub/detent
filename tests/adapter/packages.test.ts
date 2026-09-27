import { afterEach, describe, expect, it } from "vitest";
import { discoverPackages, findPackages, gateLabel, ownerOf, touchedPackages } from "../../src/adapter/packages.js";
import { packagePath } from "../../src/schemas/records.js";
import { gitInit, removeTree, tmpTree } from "../helpers.js";

/**
 * V-5′ (PRDR-295) — a repository's packages, and which of them a path lies in.
 *
 * A package is a directory holding a manifest an engine binds from, and the
 * root is always one. A path lies in the deepest package holding it, the way
 * each ecosystem reads a nested manifest.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

function tree(files: Readonly<Record<string, string>>, repo = true): string {
  const root = tmpTree(files);
  roots.push(root);
  if (repo) gitInit(root);
  return root;
}

const LAYOUT: Readonly<Record<string, string>> = {
  "go.mod": "module example.test/app\n",
  "dashboard/package.json": '{"name":"dashboard"}\n',
  "services/api/pyproject.toml": "[project]\nname = \"api\"\n",
  "services/api/Makefile": "test:\n\ttrue\n",
  "crates/core/Cargo.toml": "[package]\nname = \"core\"\n",
  "tools/Makefile": "test:\n\ttrue\n",
  "tools/tsconfig.json": "{}\n",
  "node_modules/dep/package.json": "{}\n",
  "vendor/example.test/mod/go.mod": "module example.test/mod\n",
  "internal/testdata/sample/go.mod": "module sample\n",
  "tests/fixtures/app/package.json": "{}\n",
  "web/__fixtures__/app/package.json": "{}\n",
  ".github/actions/label/package.json": "{}\n",
};

describe("V-5′ a repository's packages", () => {
  it("finds a manifest in every package directory, and the root is a package whether or not it holds one", () => {
    const root = tree({ ...LAYOUT, "build/package.json": "{}\n", ".gitignore": "build/\n" });
    expect(findPackages(root)).toEqual([".", "crates/core", "dashboard", "services/api"]);
    expect(findPackages(tree({ "README.md": "# empty\n" })), "the root alone").toEqual(["."]);
  });

  it("reads the tree itself where git cannot list it, with the same exclusions", () => {
    const root = tree(LAYOUT, false);
    expect(findPackages(root)).toEqual([".", "crates/core", "dashboard", "services/api"]);
  });

  it("puts a path in the deepest package that holds it, by whole segments", () => {
    const packages = [".", "web", "web/admin"];
    expect(ownerOf("README.md", packages)).toBe(".");
    expect(ownerOf("web", packages)).toBe("web");
    expect(ownerOf("web/src/index.ts", packages)).toBe("web");
    expect(ownerOf("web/admin/page.ts", packages)).toBe("web/admin");
    expect(ownerOf("webapp/index.ts", packages), "a prefix that is not a segment").toBe(".");
    expect(ownerOf("a", [".", "a"]), "a one-letter package still outranks the root").toBe("a");
  });

  it("reads a surface as the packages its paths lie in and its globs can reach", () => {
    const packages = [".", "api", "packages/a", "packages/b", "web", "web/admin"];
    expect(touchedPackages(["web/src/**"], packages)).toEqual(["web"]);
    expect(touchedPackages(["web/**"], packages)).toEqual(["web", "web/admin"]);
    expect(touchedPackages(["web"], packages), "a directory named as a path holds its children").toEqual(["web", "web/admin"]);
    expect(touchedPackages(["src/**", "web/src/index.ts"], packages)).toEqual([".", "web"]);
    expect(touchedPackages(["docs/*.md"], packages)).toEqual(["."]);
    expect(touchedPackages(["**"], packages)).toEqual(packages);
    expect(touchedPackages(["**/*.test.ts"], packages)).toEqual(packages);
    expect(touchedPackages(["packages/*/src/**"], packages)).toEqual([".", "packages/a", "packages/b"]);
    expect(touchedPackages(["web/*/page.ts"], packages), "a fixed depth reaches the package at that depth").toEqual(["web", "web/admin"]);
    expect(touchedPackages(["web/*.ts"], packages), "and none below it").toEqual(["web"]);
    expect(touchedPackages(["web/*"], packages), "a directory it names is not a path in it").toEqual(["web"]);
    expect(touchedPackages(["./api/handler.go"], packages)).toEqual(["api"]);
    expect(touchedPackages(["web/"], packages), "a trailing slash names the same directory").toEqual(["web", "web/admin"]);
    expect(touchedPackages(["."], packages), "the repository named as a directory").toEqual(packages);
    expect(touchedPackages(["!web/**"], packages), "an exclusion touches nothing").toEqual([]);
    expect(touchedPackages([], packages)).toEqual([]);
  });

  it("accepts as a package only a directory inside the repository, since its gates run there", () => {
    for (const ok of [".", "web", "services/api"]) expect(packagePath.safeParse(ok).success, ok).toBe(true);
    for (const bad of ["", "..", "../elsewhere", "web/../..", "/etc", "web//admin", "./web", "web\\admin"]) expect(packagePath.safeParse(bad).success, bad).toBe(false);
  });

  it("names a package's gate by its path, and the root's by its slot alone", () => {
    expect(gateLabel({ package: ".", slot: "test" })).toBe("test");
    expect(gateLabel({ package: "web/admin", slot: "lint" })).toBe("web/admin:lint");
  });

  it("discovers each package in its own directory, a package with no lockfile taking the package manager of the one that holds it", () => {
    const root = tree({
      "package.json": '{"name":"root","scripts":{"test":"vitest run"}}\n',
      "pnpm-lock.yaml": "lockfileVersion: 9\n",
      "packages/ui/package.json": '{"name":"ui","scripts":{"lint":"eslint ."}}\n',
      "tools/cli/package.json": '{"name":"cli","scripts":{"test":"node test.js"}}\n',
      "tools/cli/package-lock.json": "{}\n",
    });
    const found = discoverPackages(root, findPackages(root));
    expect([...found.keys()]).toEqual([".", "packages/ui", "tools/cli"]);
    const resolved = (pkg: string): string[] => (found.get(pkg)?.candidates ?? []).map((c) => `${c.slot}=${c.resolved}`);
    expect(resolved(".")).toEqual(["test=pnpm run test"]);
    expect(resolved("packages/ui")).toEqual(["lint=pnpm run lint"]);
    expect(resolved("tools/cli"), "its own lockfile decides").toEqual(["test=npm run test"]);
  });
});
