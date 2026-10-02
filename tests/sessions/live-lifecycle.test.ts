import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindAll } from "../../src/adapter/bind.js";
import { discover } from "../../src/adapter/discover/index.js";
import { writeBindings } from "../../src/adapter/drift.js";
import { bodyHash, recordApprovals } from "../../src/adapter/lifecycle.js";
import { initLayout } from "../../src/fs/layout.js";
import { buildLiveBackend } from "../../src/sessions/live.js";
import { removeTree } from "../helpers.js";

/**
 * V-1⁷ (PRDR-233) — the Stop hook's scoped gate runs the approved `pre` and
 * `post` of the bound npm script around it, and a red gate's tail ends by
 * naming the declared scripts Detent did not run, so the session reading it
 * is not left to guess why the gate it was given is red.
 */

type ScopedGate = (command: string, cwd?: string) => Promise<{ readonly green: boolean; readonly outputTail: string }>;
const registered = (root: string): ScopedGate => (buildLiveBackend(root) as unknown as { readonly config: { readonly runScopedGate: ScopedGate } }).config.runScopedGate;

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const r of roots.splice(0)) removeTree(r);
});

async function bound(scripts: Record<string, string>): Promise<string> {
  const root = mkdtempSync(path.join(tmpdir(), "detent-live-lifecycle-"));
  roots.push(root);
  writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ name: "x", private: true, version: "1.0.0", scripts }, null, 2)}\n`);
  initLayout(root);
  const report = await bindAll(discover(root), { root, timeoutMs: 60_000, redact: (t) => t });
  writeBindings(root, { bindings: [...report.bindings], skips: [] });
  return root;
}

describe("V-1⁷ the Stop hook's scoped gate and the project's approved scripts (PRDR-233)", () => {
  it("runs an approved pretest before the bound gate", async () => {
    const root = await bound({ pretest: "touch GENERATED", test: "test -f GENERATED" });
    recordApprovals(root, [{ package: ".", script: "pretest", body: "touch GENERATED", sha256: bodyHash("touch GENERATED") }], "2026-10-02T10:00:00.000Z", "operator");
    const result = await registered(root)("npm run test", root);
    expect(result.green, result.outputTail).toBe(true);
    expect(existsSync(path.join(root, "GENERATED"))).toBe(true);
  }, 180_000);

  it("runs an approved postinstall with the install it makes first", async () => {
    const root = await bound({ postinstall: "touch GENERATED", test: "test -f GENERATED" });
    recordApprovals(root, [{ package: ".", script: "postinstall", body: "touch GENERATED", sha256: bodyHash("touch GENERATED") }], "2026-10-02T10:00:00.000Z", "operator");
    const result = await registered(root)("npm run test", root);
    expect(result.green, result.outputTail).toBe(true);
  }, 180_000);

  it("reads the run-wide switch as the run does: everything without a record, nothing unapproved with one", async () => {
    vi.stubEnv("DETENT_ALLOW_LIFECYCLE_SCRIPTS", "1");
    const bare = await bound({ install: "touch INSTALLED", test: "test -f INSTALLED" });
    expect((await registered(bare)("npm run test", bare)).green).toBe(true);
    const recorded = await bound({ install: "touch INSTALLED", pretest: "true", test: "test -f INSTALLED" });
    recordApprovals(recorded, [{ package: ".", script: "pretest", body: "true", sha256: bodyHash("true") }], "2026-10-02T10:00:00.000Z", "operator");
    expect((await registered(recorded)("npm run test", recorded)).green).toBe(false);
    expect(existsSync(path.join(recorded, "INSTALLED"))).toBe(false);
  }, 180_000);

  it("ends a red gate's tail by naming the declared scripts it did not run, within the tail the Stop hook keeps", async () => {
    const root = await bound({ pretest: "touch GENERATED", test: "head -c 4000 /dev/zero | tr '\\0' x; test -f GENERATED" });
    const result = await registered(root)("npm run test", root);
    expect(result.green).toBe(false);
    expect(existsSync(path.join(root, "GENERATED"))).toBe(false);
    expect(result.outputTail.endsWith("`detent verify lifecycle --approve <script>`, adding `--package <dir>` for a package's own.")).toBe(true);
    expect(result.outputTail).toContain("pretest (not approved)");
    expect(result.outputTail.length).toBeLessThanOrEqual(1500);
  }, 180_000);
});
