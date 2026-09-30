import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli/init.js";
import { ensureConfig } from "../../src/init/config.js";
import type { SessionBackend } from "../../src/sessions/backend.js";
import { gitInit, removeTree, tmpTree } from "../helpers.js";

/**
 * S-5⁶ (PRDR-319) — `init` says, before its first session, which routed model
 * the bundled runtime cannot serve and which role still names a superseded
 * default. An existing config keeps its routing (S-5′); a config cannot tell a
 * chosen `claude-opus-5` from a defaulted one, so it is told, not rewritten.
 */

const roots: string[] = [];
beforeEach(() => {
  vi.stubEnv("DETENT_NO_LIVE", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-fixture");
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const r of roots.splice(0)) removeTree(r);
});

/** A repository whose config was written by an earlier init, then routed as given. */
function repo(routing: Readonly<Record<string, string>>): { readonly root: string; readonly file: string } {
  const root = tmpTree({ "PRD.md": "# product\n\nA tool that adds numbers.\n" });
  roots.push(root);
  gitInit(root);
  ensureConfig(root, 10);
  const file = path.join(root, ".detent", "config.json");
  const config = JSON.parse(readFileSync(file, "utf8")) as { model_routing: Record<string, string> };
  writeFileSync(file, `${JSON.stringify({ ...config, model_routing: { ...config.model_routing, ...routing } }, null, 2)}\n`);
  return { root, file };
}

/** Runs `init` up to its first session, and returns what it had written by then. */
async function untilFirstSession(root: string, runtime: string): Promise<{ readonly said: string; readonly launched: boolean }> {
  const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  let said = "";
  let launched = false;
  const backend: SessionBackend = {
    name: "mock",
    checkVersion: async () => undefined,
    run: async () => {
      launched = true;
      said = out.mock.calls.map((c) => String(c[0])).join("");
      throw new Error("stopped at the first session");
    },
  };
  try {
    await main([root], { buildBackend: () => backend, runtimeVersion: () => runtime });
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
  return { said, launched };
}

describe("S-5⁶ init names the routing's problems before its first session", () => {
  it("names a model the runtime cannot serve, and each superseded default with the line that moves it", async () => {
    const { root, file } = repo({ implement: "claude-sonnet-5-5", review: "claude-opus-5" });
    const { said, launched } = await untilFirstSession(root, "2.1.280");
    expect(launched, "init reached a session, so what it said came before one").toBe(true);
    expect(said).toContain("implement → claude-sonnet-5-5");
    expect(said).toContain("2.1.280");
    const line = readFileSync(file, "utf8").split("\n").findIndex((l) => l.includes('"review": "claude-opus-5"')) + 1;
    expect(said).toContain(`.detent/config.json:${String(line)} "review": "claude-opus-5-5"`);
    expect(JSON.parse(readFileSync(file, "utf8")).model_routing.review, "the config is not rewritten (S-5′)").toBe("claude-opus-5");
  });

  it("says nothing of the routing when the runtime serves it and nothing is superseded", async () => {
    const { root } = repo({});
    const { said, launched } = await untilFirstSession(root, "2.1.285");
    expect(launched).toBe(true);
    expect(said).not.toMatch(/model routing:/u);
  });
});
