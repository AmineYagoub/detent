import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main as runMain } from "../../src/cli/run.js";
import { stateDir } from "../../src/fs/layout.js";
import type { SessionBackend } from "../../src/sessions/backend.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { removeTree } from "../helpers.js";
import { makeRunRepo } from "../kernel/run-fixture.js";

/**
 * S-5⁶ (PRDR-319) — `detent run` hands the referee the runtime its live
 * sessions run on, the Claude Code the SDK bundles, since ARCH-1 keeps the
 * SDK's manifest out of the referee's reach. A fixture run has no runtime to
 * judge, and says only what needs none: the superseded defaults.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

async function routed(routing: Readonly<Record<string, string>>): Promise<string> {
  const { root } = await makeRunRepo();
  roots.push(root);
  const file = path.join(stateDir(root), "config.json");
  const config = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  writeFileSync(file, `${JSON.stringify({ ...config, model_routing: routing }, null, 2)}\n`);
  return root;
}

async function stdoutOf(body: () => Promise<unknown>): Promise<string> {
  const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  try {
    await body();
    return out.mock.calls.map((c) => String(c[0])).join("");
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
}

describe("S-5⁶ detent run judges the routing against the runtime its live sessions run on", () => {
  it("a live backend's run names a routed model the bundled runtime cannot serve", async () => {
    const root = await routed({ implement: "claude-sonnet-5-5" });
    const mock = new MockBackend();
    const live: SessionBackend = { name: "claude-code", run: mock.run.bind(mock), checkVersion: async () => undefined };
    const said = await stdoutOf(async () => await runMain([root, "--no-worktree"], { buildBackend: () => live, runtimeVersion: () => "2.1.280" }));
    expect(said).toContain("implement → claude-sonnet-5-5");
    expect(said).toContain("Claude Code 2.1.280");
  }, 30_000);

  it("a fixture run judges no runtime, and still names a superseded default", async () => {
    const root = await routed({ implement: "claude-sonnet-5-5", review: "claude-opus-5" });
    const said = await stdoutOf(async () => await runMain([root, "--backend", "mock", "--no-worktree"], { runtimeVersion: () => "2.1.280" }));
    expect(said).not.toContain("implement → claude-sonnet-5-5");
    expect(said).toContain('"review": "claude-opus-5-5"');
  }, 30_000);
});
