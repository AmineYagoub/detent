import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli/init.js";
import { decideSymbols, ensureConfig } from "../../src/init/config.js";
import { gitInit, removeTree, tmpTree } from "../helpers.js";

/**
 * S-3⁗ (PRDR-208) — symbol intelligence is decided by a flag.
 *
 * S-3″ made `symbols.enabled` tri-state so only a person decides, and the only
 * way to decide was a prompt at a TTY. The runs that matter most have none:
 * the self-build gate, CI, a background launch. gate-313 planned and ran with
 * serena installed and undecided, and sent 80 symbol-level couplings to review.
 * A flag is a person deciding, carried where a prompt cannot go.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

const ready = () => ({ kind: "ready" as const, command: "serena" });
const missing = () => ({ kind: "missing" as const, command: "serena", reason: "spawn serena ENOENT" });

function repo(): string {
  const root = tmpTree({});
  roots.push(root);
  gitInit(root);
  return root;
}
const symbolsOf = (root: string): unknown => (JSON.parse(readFileSync(path.join(root, ".detent/config.json"), "utf8")) as { symbols?: unknown }).symbols;

describe("S-3⁗ symbol intelligence is decided by a flag", () => {
  it("`--symbols` records `enabled: true` when the probe finds the tool", () => {
    const root = repo();
    ensureConfig(root, 10);
    const decided = decideSymbols(root, "on", ready);
    expect(decided.ok).toBe(true);
    expect(symbolsOf(root)).toEqual({ enabled: true, command: "serena", pinned: "0.1.4" });
  });

  it("`--symbols` refuses, names the install, and writes nothing when the tool cannot run", () => {
    const root = repo();
    ensureConfig(root, 10);
    const decided = decideSymbols(root, "on", missing);
    expect(decided.ok).toBe(false);
    expect(decided.ok === false && decided.message).toContain("uv tool install -p 3.13 serena-agent==0.1.4");
    expect(symbolsOf(root), "never `enabled: true` for a tool that is not there").toBeUndefined();
  });

  it("`--no-symbols` records the decline S-3″ honours absolutely", () => {
    const root = repo();
    ensureConfig(root, 10);
    expect(decideSymbols(root, "off", missing).ok).toBe(true);
    expect((symbolsOf(root) as { enabled: boolean }).enabled).toBe(false);
  });

  it("both flags are refused before anything runs", async () => {
    const root = repo();
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      expect(await main([root, "--symbols", "--no-symbols"])).toBe(1);
      expect(err.mock.calls.join("")).toMatch(/at most one of --symbols \/ --no-symbols/);
    } finally {
      err.mockRestore();
    }
  });

  it("the flag reaches the config through `detent init` itself, before anything is spent", async () => {
    const root = repo();
    /* A token satisfies R-10 without a probe; with no planning document, DISCOVER stops the pipeline (AWAIT_DOCS) before any session. */
    const saved = process.env["CLAUDE_CODE_OAUTH_TOKEN"];
    process.env["CLAUDE_CODE_OAUTH_TOKEN"] = "test-token-never-used";
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      expect(await main([root, "--no-symbols"])).toBe(2);
    } finally {
      out.mockRestore();
      err.mockRestore();
      if (saved === undefined) delete process.env["CLAUDE_CODE_OAUTH_TOKEN"];
      else process.env["CLAUDE_CODE_OAUTH_TOKEN"] = saved;
    }
    expect((symbolsOf(root) as { enabled: boolean }).enabled).toBe(false);
  });
});
