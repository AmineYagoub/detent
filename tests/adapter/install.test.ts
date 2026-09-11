import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ECOSYSTEMS, ensureDependencies, installNeeded, type Ecosystem } from "../../src/adapter/install.js";
import { CI_ENV, suppressionEnv } from "../../src/adapter/normalize.js";
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
    /* Audit: the mark is Detent's, not npm's — npm writes none for a manifest that declares nothing. */
    expect(node.stamp).toBe(path.join("node_modules", ".detent-installed"));
  });

  it("the mark is written by the adapter, so a package manager that leaves none still installs once (audit of PRDR-211)", async () => {
    const dir = workDir({ "package.json": "{}\n" });
    /* An install that succeeds and creates nothing — npm on a dependency-less manifest. */
    const silent: Ecosystem = { ...FAKE, install: "true" };
    expect((await ensureDependencies(dir, runHere(dir), [silent])).kind).toBe("installed");
    expect(installNeeded(dir, silent), "installed once; the adapter's own mark says so").toBeNull();
  });
});

/**
 * SEC-5 (PRDR-232) — the referee runs NOTHING the judged tree declares.
 *
 * V-1⁗ has the referee run `npm install` in a tree the session just wrote, and
 * npm runs that tree's preinstall/install/postinstall/prepare. Everything else
 * a session does passes the D-21 containment hook; this path did not. The
 * second hop is cheaper still: `npm run <gate>` runs the tree's `pre`/`post`
 * siblings on EVERY gate evaluation, and none of those names binds a gate, so
 * the drift check cannot see them either. Suppression rides the ENVIRONMENT,
 * so no bound command string and no config_hash moves.
 */
describe("SEC-5 (PRDR-232): the referee runs nothing the judged tree declares", () => {
  const MARKERS = ["PRE", "INST", "PWNED", "PREPARED"];
  const hostile = (extra: Record<string, string> = {}): string =>
    `${JSON.stringify({ name: "x", private: true, version: "1.0.0", scripts: { preinstall: "touch PRE", install: "touch INST", postinstall: "touch PWNED", prepare: "touch PREPARED", ...extra } }, null, 2)}\n`;

  it("the install runs no lifecycle script of the tree it is judging", async () => {
    const dir = workDir({ "package.json": hostile() });
    const outcome = await ensureDependencies(dir, (command) => runGate({ command, cwd: dir, timeoutMs: 120_000, env: CI_ENV }));
    expect(outcome.kind, JSON.stringify(outcome).slice(0, 300)).toBe("installed");
    for (const marker of MARKERS) {
      expect(existsSync(path.join(dir, marker)), `${marker} — the tree's own script ran under the referee`).toBe(false);
    }
  }, 180_000);

  it("a gate runs the script it is bound to and not the tree's pre/post siblings", async () => {
    const dir = workDir({
      "package.json": `${JSON.stringify({ name: "x", private: true, version: "1.0.0", scripts: { pretest: "touch PRETEST", test: "touch TESTRAN", posttest: "touch POSTTEST" } }, null, 2)}\n`,
    });
    const result = await runGate({ command: "npm run test", cwd: dir, timeoutMs: 120_000, env: CI_ENV });
    expect(result.green, JSON.stringify(result.outcome)).toBe(true);
    expect(existsSync(path.join(dir, "TESTRAN")), "the bound script itself must still run").toBe(true);
    expect(existsSync(path.join(dir, "PRETEST"))).toBe(false);
    expect(existsSync(path.join(dir, "POSTTEST"))).toBe(false);
  }, 180_000);

  it("suppression is the operator's to lift, and a session cannot reach it", () => {
    expect(CI_ENV["npm_config_ignore_scripts"]).toBe("true");
    expect(suppressionEnv(true)["npm_config_ignore_scripts"]).toBe("false");
    expect(suppressionEnv(false)["npm_config_ignore_scripts"]).toBe("true");
  });

  it("a project whose package manager is not npm is not given an npm install, nor an npm lockfile", async () => {
    const dir = workDir({ "package.json": `${JSON.stringify({ name: "x", private: true, scripts: { test: "true" } }, null, 2)}\n`, "pnpm-lock.yaml": 'lockfileVersion: "9.0"\n' });
    const outcome = await ensureDependencies(dir, (command) => runGate({ command, cwd: dir, timeoutMs: 120_000, env: CI_ENV }), ECOSYSTEMS, "pnpm");
    expect(outcome.kind).toBe("none");
    expect(outcome.reason).toContain("pnpm");
    expect(existsSync(path.join(dir, "package-lock.json")), "the referee must not flip the project's package manager").toBe(false);
  }, 60_000);

  it("greenfield and npm projects still install, exactly as V-1⁗ requires", async () => {
    for (const pm of [null, "npm"] as const) {
      const dir = workDir({ "package.json": `${JSON.stringify({ name: "x", private: true, version: "1.0.0" }, null, 2)}\n` });
      const outcome = await ensureDependencies(dir, (command) => runGate({ command, cwd: dir, timeoutMs: 120_000, env: CI_ENV }), ECOSYSTEMS, pm);
      expect(outcome.kind, `pm=${String(pm)}`).toBe("installed");
    }
  }, 180_000);
});
