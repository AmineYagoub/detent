import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  NO_LOCKFILE,
  UNKNOWN_VERSION,
  cacheKey,
  contradictions,
  detectEcosystems,
  fingerprint,
} from "../../src/adapter/env.js";
import { removeTree, tmpTree, writeTree } from "../helpers.js";

/**
 * T-021 — environment fingerprint (D-18, R-7).
 *
 * Runtime probing is stubbed throughout: what the host happens to have
 * installed must not decide whether these pass.
 */

const trees: string[] = [];
const tree = (files: Record<string, string>): string => {
  const root = tmpTree(files);
  trees.push(root);
  return root;
};
afterEach(() => {
  for (const t of trees.splice(0)) removeTree(t);
});

const noProbe = { probeRuntimes: false } as const;

describe("T-021 per-ecosystem lockfile detection (R-7)", () => {
  it.each([
    ["package-lock.json", "node"],
    ["pnpm-lock.yaml", "node"],
    ["yarn.lock", "node"],
    ["bun.lockb", "node"],
  ])("node detects %s", (lock, eco) => {
    const root = tree({ "package.json": "{}\n", [lock]: "lock\n" });
    const [found] = detectEcosystems(root);
    expect(found?.ecosystem).toBe(eco);
    expect(found?.lockfile).toBe(lock);
  });

  it.each([
    ["uv.lock"],
    ["poetry.lock"],
  ])("python detects %s", (lock) => {
    const root = tree({ "pyproject.toml": "[project]\nname='x'\n", [lock]: "lock\n" });
    const [found] = detectEcosystems(root);
    expect(found?.ecosystem).toBe("python");
    expect(found?.lockfile).toBe(lock);
  });

  it("python's requirements*.txt glob hashes every match, in sorted order", () => {
    const root = tree({
      "pyproject.toml": "[project]\nname='x'\n",
      "requirements.txt": "a\n",
      "requirements-dev.txt": "b\n",
    });
    const [found] = detectEcosystems(root);
    expect(found?.lockfile).toBe("requirements-dev.txt,requirements.txt");
  });

  it("go detects go.sum", () => {
    const root = tree({ "go.mod": "module x\n", "go.sum": "h1:abc\n" });
    expect(detectEcosystems(root)[0]?.lockfile).toBe("go.sum");
  });

  it("rust detects Cargo.lock", () => {
    const root = tree({ "Cargo.toml": "[package]\nname='x'\n", "Cargo.lock": "version=3\n" });
    expect(detectEcosystems(root)[0]?.lockfile).toBe("Cargo.lock");
  });

  it("R-7's order decides when a repo carries two lockfiles", () => {
    const root = tree({ "package.json": "{}\n", "yarn.lock": "y\n", "package-lock.json": "p\n" });
    expect(detectEcosystems(root)[0]?.lockfile).toBe("package-lock.json");
  });

  it("a manifest with no lockfile falls back to the manifest and records `none`", () => {
    const root = tree({ "package.json": '{"name":"x"}\n' });
    const [found] = detectEcosystems(root);
    expect(found?.lockfile).toBe(NO_LOCKFILE);
    expect(found?.lockfile_hash).toBe(
      hashOf([["package.json", '{"name":"x"}\n']]),
    );
  });

  it("a lockfile-less repo is still distinguishable from another lockfile-less repo", () => {
    const a = detectEcosystems(tree({ "package.json": '{"name":"a"}\n' }))[0];
    const b = detectEcosystems(tree({ "package.json": '{"name":"b"}\n' }))[0];
    expect(a?.lockfile).toBe(NO_LOCKFILE);
    expect(a?.lockfile_hash).not.toBe(b?.lockfile_hash);
  });

  it("a directory declaring nothing yields no ecosystems", () => {
    expect(detectEcosystems(tree({ "README.md": "hi\n" }))).toEqual([]);
  });
});

describe("T-021 D-18 cache key", () => {
  it("is exactly sha256(signature | lockfile_hash | runtime_version)", async () => {
    const root = tree({ "package.json": "{}\n", "package-lock.json": "v1\n" });
    const fp = await fingerprint(root, { probe: async () => "22.0.0" });
    const expected = createHash("sha256")
      .update(`sig-abc|${fp.lockfile_hash}|${fp.runtime_version}`)
      .digest("hex");
    expect(cacheKey("sig-abc", fp)).toBe(expected);
  });

  it("the same error under a changed lockfile is a different key (D-18)", async () => {
    const root = tree({ "package.json": "{}\n", "package-lock.json": "v1\n" });
    const before = await fingerprint(root, { probe: async () => "22.0.0" });
    writeTree(root, { "package-lock.json": "v2\n" });
    const after = await fingerprint(root, { probe: async () => "22.0.0" });
    expect(after.lockfile_hash).not.toBe(before.lockfile_hash);
    expect(cacheKey("sig", after)).not.toBe(cacheKey("sig", before));
  });

  it("the same error under a changed runtime is a different key (D-18)", async () => {
    const root = tree({ "package.json": "{}\n", "package-lock.json": "v1\n" });
    const before = await fingerprint(root, { probe: async () => "22.0.0" });
    const after = await fingerprint(root, { probe: async () => "24.1.0" });
    expect(cacheKey("sig", after)).not.toBe(cacheKey("sig", before));
  });

  it("an unprobed runtime is recorded as unknown rather than omitted", async () => {
    const root = tree({ "go.mod": "module x\n", "go.sum": "h1:a\n" });
    const fp = await fingerprint(root, noProbe);
    expect(fp.runtime_version).toBe(`go ${UNKNOWN_VERSION}`);
    expect(fp.version_facts["go"]).toBe(UNKNOWN_VERSION);
  });

  it("a probe that fails degrades to unknown instead of throwing", async () => {
    const root = tree({ "package.json": "{}\n" });
    const fp = await fingerprint(root, {
      probe: async () => {
        throw new Error("no node on this host");
      },
    });
    expect(fp.version_facts["node"]).toBe(UNKNOWN_VERSION);
  });
});

describe("T-021 polyglot repositories", () => {
  it("fingerprints every ecosystem present, in a stable order", async () => {
    const root = tree({
      "package.json": "{}\n",
      "package-lock.json": "p\n",
      "go.mod": "module x\n",
      "go.sum": "h1:a\n",
    });
    const fp = await fingerprint(root, { probe: async (cmd) => (cmd.startsWith("go") ? "1.22.1" : "22.0.0") });
    expect(fp.ecosystems.map((e) => e.ecosystem)).toEqual(["node", "go"]);
    expect(fp.runtime_version).toBe("go 1.22.1; node 22.0.0");
    // The composite is order-independent by construction, so a readdir that
    // reorders cannot move the cache key.
    const again = await fingerprint(root, { probe: async (cmd) => (cmd.startsWith("go") ? "1.22.1" : "22.0.0") });
    expect(again.lockfile_hash).toBe(fp.lockfile_hash);
  });
});

describe("T-021 version_facts validation (X-6)", () => {
  it("reports a disagreement as a contradiction", async () => {
    const root = tree({ "package.json": "{}\n", "package-lock.json": "p\n" });
    const fp = await fingerprint(root, { probe: async () => "24.1.0" });
    expect(contradictions({ node: "22.0.0" }, fp)).toEqual([
      "node: brief recorded 22.0.0, environment reports 24.1.0",
    ]);
  });

  it("agreement contradicts nothing, and a fact the environment no longer reports is not a contradiction", async () => {
    const root = tree({ "package.json": "{}\n", "package-lock.json": "p\n" });
    const fp = await fingerprint(root, { probe: async () => "24.1.0" });
    expect(contradictions({ node: "24.1.0", rust: "1.75.0" }, fp)).toEqual([]);
  });
});

function hashOf(files: readonly (readonly [string, string])[]): string {
  const h = createHash("sha256");
  for (const [rel, body] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    h.update(`${rel}\0`).update(createHash("sha256").update(Buffer.from(body)).digest("hex")).update("\n");
  }
  return h.digest("hex");
}
