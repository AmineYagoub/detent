import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { routingNote } from "../../src/init/config.js";
import { stateDir } from "../../src/fs/layout.js";
import { migrateState } from "../../src/kernel/migrate.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { INIT_PHASES } from "../../src/schemas/init.js";
import { DEFAULT_EFFORT_ROUTING, DEFAULT_MODEL_ROUTING, READ_ONLY_ROLES, ROLE_IDS } from "../../src/schemas/roles.js";
import { READ_ONLY_STAGES, researchTools, toolsForRole } from "../../src/sessions/guard.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree } from "../helpers.js";
import { makeRunRepo } from "../kernel/run-fixture.js";

/**
 * PRDR-281 — the `audit` role (S-1‴, S-5⁵) and the step it adds to the one
 * v1→v2 migration (F-3″). PRDR-282's `spec_write` and PRDR-284's
 * `spec_review` join the same step, so each table the migration writes routes
 * all three.
 */

const roles = ROLE_IDS as readonly string[];
const models = DEFAULT_MODEL_ROUTING as Readonly<Record<string, string>>;
const efforts = DEFAULT_EFFORT_ROUTING as Readonly<Record<string, string>>;

describe("PRDR-281: the audit role", () => {
  it("is a role, routed to claude-opus-5-5 at max (specification decision 14)", () => {
    expect(roles).toContain("audit");
    expect(models["audit"]).toBe("claude-opus-5-5");
    expect(efforts["audit"]).toBe("max");
  });

  it("is read-only, has no stop gate, and reaches the web as research does (S-1′)", () => {
    expect((READ_ONLY_ROLES as ReadonlySet<string>).has("audit")).toBe(true);
    expect(READ_ONLY_STAGES.has("audit")).toBe(true);
    expect(toolsForRole("audit", ["docs.example.com"])).toEqual(researchTools(["docs.example.com"]));
  });

  it("has a prompt of its own, pinned in the manifest", () => {
    const set = loadPromptSet();
    expect((set.prompts as Readonly<Record<string, string>>)["audit"]).toMatch(/verify_claim/u);
    expect((set.hashes as Readonly<Record<string, string>>)["audit"]).toMatch(/^[0-9a-f]{64}$/u);
    expect((set.prompts as Readonly<Record<string, string>>)["audit"]).not.toBe((set.prompts as Readonly<Record<string, string>>)["research"]);
  });

  it("runs as AUDIT, directly after DISCOVER (C-2⁶)", () => {
    const phases = INIT_PHASES as readonly string[];
    expect(phases.indexOf("AUDIT")).toBe(phases.indexOf("DISCOVER") + 1);
  });

  it("is named, with its model and effort, where `init` tells the operator what it routed", () => {
    expect(routingNote()).toMatch(/audit[^;]*claude-opus-5-5/u);
    expect(routingNote()).toMatch(/audit[^;.]*max/u);
  });
});

describe("PRDR-281, PRDR-282: the v1→v2 migration routes the new roles (F-3″, S-5′)", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  /** A state whose config an older build wrote, routed as given. */
  async function olderConfig(routing: Record<string, unknown>): Promise<string> {
    const { root } = await makeRunRepo();
    cleanups.push(() => removeTree(root));
    const file = path.join(stateDir(root), "config.json");
    const config = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    delete config["model_routing"];
    delete config["effort_routing"];
    writeFileSync(file, `${JSON.stringify({ ...config, ...routing, schema_version: SCHEMA_VERSION - 1 }, null, 2)}\n`);
    return root;
  }
  const config = (root: string): Record<string, unknown> => JSON.parse(readFileSync(path.join(stateDir(root), "config.json"), "utf8")) as Record<string, unknown>;
  const PROMPT_HASHES = { promptHashes: loadPromptSet().hashes };

  it("writes audit's default model and effort into a config that routes other roles but not audit", async () => {
    const root = await olderConfig({ model_routing: { planner: "claude-fable-5-1" }, effort_routing: { planner: "high" } });
    migrateState(root, PROMPT_HASHES);
    expect(config(root)["model_routing"]).toEqual({ planner: "claude-fable-5-1", audit: "claude-opus-5-5", spec_write: "claude-opus-5-5", spec_review: "claude-opus-5-5" });
    expect(config(root)["effort_routing"]).toEqual({ planner: "high", audit: "max", spec_write: "max", spec_review: "max" });
  });

  it("leaves a routed audit as the config says, model and effort separately", async () => {
    const root = await olderConfig({ model_routing: { audit: "claude-sonnet-5" }, effort_routing: {} });
    migrateState(root, PROMPT_HASHES);
    expect(config(root)["model_routing"]).toEqual({ audit: "claude-sonnet-5", spec_write: "claude-opus-5-5", spec_review: "claude-opus-5-5" });
    expect(config(root)["effort_routing"]).toEqual({ audit: "max", spec_write: "max", spec_review: "max" });
  });

  it("leaves a routing table that is not a table for the config's reader to refuse", async () => {
    const root = await olderConfig({ model_routing: "claude-opus-5", effort_routing: ["max"] });
    migrateState(root, PROMPT_HASHES);
    expect(config(root)["model_routing"]).toBe("claude-opus-5");
    expect(config(root)["effort_routing"]).toEqual(["max"]);
  });

  it("gives a config that never routed anything the new roles' routing alone", async () => {
    const root = await olderConfig({});
    migrateState(root, PROMPT_HASHES);
    expect(config(root)["model_routing"]).toEqual({ audit: "claude-opus-5-5", spec_write: "claude-opus-5-5", spec_review: "claude-opus-5-5" });
    expect(config(root)["effort_routing"]).toEqual({ audit: "max", spec_write: "max", spec_review: "max" });
  });
});
