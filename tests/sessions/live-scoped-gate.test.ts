import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildLiveBackend, scopedGate } from "../../src/sessions/live.js";
import { removeTree } from "../helpers.js";

/**
 * PRDR-332 — the Stop hook's scoped gate runs under the gate runner's
 * environment (V-1⁶). `detent run` builds its backend with `buildLiveBackend`,
 * and every implement or fix session that tries to end runs the root's bound
 * `test` in its worktree through that backend's `runScopedGate`. It ran
 * `sh -c` with Detent's own environment, so `npm run test` ran the `pretest`
 * and `posttest` the session wrote, as Detent's own child.
 *
 * The gate is reached through the backend `buildLiveBackend` builds, so the
 * tests hold the wiring `detent run` uses as well as the function.
 */

type ScopedGate = (command: string, cwd?: string) => Promise<{ readonly green: boolean; readonly outputTail: string }>;

/** The closure the SDK backend's Stop hook runs: the backend's own, as `detent run` registers it. */
const registered = (root: string): ScopedGate => (buildLiveBackend(root) as unknown as { readonly config: { readonly runScopedGate: ScopedGate } }).config.runScopedGate;

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

function workDir(scripts: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "detent-scoped-gate-"));
  roots.push(dir);
  writeFileSync(path.join(dir, "package.json"), `${JSON.stringify({ name: "x", private: true, version: "1.0.0", scripts }, null, 2)}\n`);
  return dir;
}

describe("PRDR-332 the Stop hook's scoped gate runs under the gate runner's environment (V-1⁶)", () => {
  it("runs the bound script and neither of its pre and post siblings", async () => {
    const dir = workDir({ pretest: "touch PRETEST", test: "touch TESTRAN", posttest: "touch POSTTEST" });
    const result = await registered(dir)("npm run test", dir);
    expect(result.green, result.outputTail).toBe(true);
    expect(existsSync(path.join(dir, "TESTRAN")), "the bound script itself must still run").toBe(true);
    expect(existsSync(path.join(dir, "PRETEST")), "PRETEST — the tree's own script ran in Detent's process").toBe(false);
    expect(existsSync(path.join(dir, "POSTTEST")), "POSTTEST — the tree's own script ran in Detent's process").toBe(false);
  }, 180_000);

  it("installs as before, running none of the tree's lifecycle scripts (PRDR-232)", async () => {
    const dir = workDir({ preinstall: "touch PRE", postinstall: "touch PWNED", prepare: "touch PREPARED", test: "true" });
    const result = await registered(dir)("npm run test", dir);
    expect(result.green, result.outputTail).toBe(true);
    expect(existsSync(path.join(dir, "node_modules", ".detent-installed")), "the manifest's dependencies are installed first (V-1⁗)").toBe(true);
    for (const marker of ["PRE", "PWNED", "PREPARED"]) expect(existsSync(path.join(dir, marker)), `${marker} — the tree's own script ran`).toBe(false);
  }, 180_000);

  it("decides as before: a red gate is not green, and its tail is the gate's own output", async () => {
    const dir = workDir({ test: "echo the-gate-said-no && exit 3" });
    const result = await registered(dir)("npm run test", dir);
    expect(result.green).toBe(false);
    expect(result.outputTail).toContain("the-gate-said-no");
  }, 180_000);

  it("kills a gate that outlives its timeout with its process group, so a child holding the pipes cannot hold the Stop hook", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "detent-scoped-gate-"));
    roots.push(dir);
    const started = Date.now();
    const result = await scopedGate("sleep 30 & wait", dir, 1_000);
    expect(result.green).toBe(false);
    expect(Date.now() - started, "the gate's child kept its pipes open past the timeout").toBeLessThan(15_000);
  }, 60_000);
});
