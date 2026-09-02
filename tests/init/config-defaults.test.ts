import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureConfig } from "../../src/init/config.js";
import { DEFAULT_MODEL_ROUTING, ROLE_IDS } from "../../src/schemas/roles.js";
import { removeTree, tmpTree } from "../helpers.js";

/** PRDR-114 — `init` has an opinion about models, and every role is covered. */
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

describe("PRDR-114 init writes the model routing", () => {
  it("covers every role, judgement on the stronger models and volume on Sonnet", () => {
    for (const role of ROLE_IDS) expect(DEFAULT_MODEL_ROUTING[role]).toMatch(/^claude-/);
    expect(DEFAULT_MODEL_ROUTING.planner).toBe("claude-fable-5-1");
    expect(DEFAULT_MODEL_ROUTING.review).toBe("claude-opus-5");
    expect(DEFAULT_MODEL_ROUTING.implement).toBe("claude-sonnet-5");
  });

  it("a first init writes it; an existing config is never rewritten", () => {
    const root = tmpTree({});
    roots.push(root);
    expect(ensureConfig(root, 10)).toBe("written");
    const file = path.join(root, ".detent", "config.json");
    const config = JSON.parse(readFileSync(file, "utf8")) as { model_routing: Record<string, string>; pinned: { agent_sdk: string } };
    expect(config.model_routing).toEqual(DEFAULT_MODEL_ROUTING);
    /** S-5: the pin mirrors package.json's exact dependency. */
    const dep = (JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> }).dependencies["@anthropic-ai/claude-agent-sdk"];
    expect(config.pinned.agent_sdk).toBe(dep);
    expect(ensureConfig(root, 10)).toBe("exists");
    expect((JSON.parse(readFileSync(file, "utf8")) as { model_routing: unknown }).model_routing).toEqual(DEFAULT_MODEL_ROUTING);
  });
});
