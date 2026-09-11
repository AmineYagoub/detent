import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ECOSYSTEMS, ensureDependencies, installNeeded, type Ecosystem } from "../../src/adapter/install.js";
import { runGate } from "../../src/adapter/run.js";
import { removeTree } from "../helpers.js";

/**
 * V-1⁗ (PRDR-211) — the adapter installs what the manifest declares before a
 * gate runs. A session's Bash is two git verbs (S-3), so a greenfield bootstrap
 * writes `package.json` and cannot install it; without `node_modules` every
 * gate is `vitest: command not found`. The last green gate (3.1.0) got its
 * lockfile through a containment hole PRDR-122 closed.
 *
 * A fake ecosystem whose "package manager" is a shell one-liner, so the
 * freshness rule and the failure path run as real processes without a network.
 */

const FAKE: Ecosystem = {
  name: "fake",
  manifest: "package.json",
  lockfile: "package-lock.json",
  dir: "node_modules",
  stamp: path.join("node_modules", ".installed"),
  install: "mkdir -p node_modules && touch node_modules/.installed",
};

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

function workDir(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "detent-install-"));
  roots.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

const runHere = (dir: string) => (command: string) => runGate({ command, cwd: dir, timeoutMs: 30_000 });
const backdate = (file: string, seconds: number): void => {
  const t = new Date(Date.now() - seconds * 1000);
  utimesSync(file, t, t);
};

describe("V-1⁗ the adapter installs before the gate runs", () => {
  it("a directory with no manifest needs nothing", async () => {
    const dir = workDir({ "README.md": "hi\n" });
    expect(installNeeded(dir, FAKE)).toBeNull();
    expect((await ensureDependencies(dir, runHere(dir), [FAKE])).kind).toBe("none");
  });

  it("a manifest with no install mark installs once, and not again while the mark is fresh", async () => {
    const dir = workDir({ "package.json": "{}\n" });
    expect(installNeeded(dir, FAKE)).toContain("no node_modules/.installed");
    const first = await ensureDependencies(dir, runHere(dir), [FAKE]);
    expect(first.kind).toBe("installed");
    expect(first.kind === "installed" && first.result.command).toBe(FAKE.install);
    expect((await ensureDependencies(dir, runHere(dir), [FAKE])).kind).toBe("none");
  });

  it("a manifest or lockfile edited after the last install makes it stale", async () => {
    const dir = workDir({ "package.json": "{}\n", "package-lock.json": "{}\n" });
    await ensureDependencies(dir, runHere(dir), [FAKE]);
    /* The mark is newest; nothing to do. Then the session edits the manifest. */
    backdate(path.join(dir, FAKE.stamp), 10);
    expect(installNeeded(dir, FAKE)).toContain("package.json");
    /* Fresh again after an install; then only the lockfile moves. */
    await ensureDependencies(dir, runHere(dir), [FAKE]);
    expect(installNeeded(dir, FAKE)).toBeNull();
    backdate(path.join(dir, FAKE.stamp), 10);
    backdate(path.join(dir, "package.json"), 20);
    expect(installNeeded(dir, FAKE)).toContain("package-lock.json");
  });

  it("an install that fails is a failed outcome carrying the process result, and the mark is not written", async () => {
    const dir = workDir({ "package.json": "{}\n" });
    const broken: Ecosystem = { ...FAKE, install: "echo 'registry unreachable' >&2; exit 3" };
    const outcome = await ensureDependencies(dir, runHere(dir), [broken]);
    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.result.exitCode).toBe(3);
      expect(outcome.result.output).toContain("registry unreachable");
    }
    expect(installNeeded(dir, FAKE), "still needed — nothing was installed").not.toBeNull();
  });

  it("Node is the one ecosystem in the table, installed with `npm install` — never `npm ci`, which refuses a lockfile the session could not update", () => {
    expect(ECOSYSTEMS.map((e) => e.name)).toEqual(["node"]);
    const node = ECOSYSTEMS[0]!;
    expect(node.manifest).toBe("package.json");
    expect(node.install.startsWith("npm install")).toBe(true);
    expect(node.install).not.toContain("npm ci");
    expect(node.dir).toBe("node_modules");
  });
});
