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
    /**
      * S-5″ (PRDR-125): the planner runs on Opus. Fable was chosen for speed
      * and cost on the strength of a probe, and the first self-build gate
      * measured it in earnest: a single slice draft of 176,391 output tokens,
      * which is where a session limit killed the run.
      */
    expect(DEFAULT_MODEL_ROUTING.planner).toBe("claude-opus-5");
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

describe("C-2⁵′ (PRDR-125) the slice band is configuration, not a constant in a prompt", () => {
  it("defaults to 12–18 and reaches the SLICE session as an input", async () => {
    const { loadConfig } = await import("../../src/kernel/worstcase.js");
    const { CEILINGS } = await import("../../src/schemas/budgets.js");
    const base = {
      schema_version: 1,
      budgets: Object.fromEntries(Object.entries(CEILINGS).map(([k, v]) => [k, v.default])),
      pinned: { agent_sdk: "0.3.258", claude_code: "2.1.258" },
    };
    expect(loadConfig(base).config.slice_size).toEqual({ min: 12, max: 18 });
    /** A band the operator narrows is honoured; an inverted one is refused at load. */
    expect(loadConfig({ ...base, slice_size: { min: 8, max: 10 } }).config.slice_size).toEqual({ min: 8, max: 10 });
    expect(() => loadConfig({ ...base, slice_size: { min: 20, max: 5 } })).toThrow(/at least/);
  });

  it("the instruction names the configured band, so tuning it needs no prompt edit", async () => {
    const { sliceStage } = await import("../../src/init/slice.js");
    const { repo } = await import("./plan-fixture.js");
    const { writeFileSync } = await import("node:fs");
    const { slicesPath } = await import("../../src/init/slice.js");
    const root = repo({ "PRD.md": "# spec\n" });
    /** The state directory is INIT_FS's job; this test calls the stage directly. */
    const { mkdirSync } = await import("node:fs");
    const path = (await import("node:path")).default;
    mkdirSync(path.dirname(slicesPath(root)), { recursive: true });
    let seen: Record<string, unknown> = {};
    await sliceStage({
      root,
      docs: ["PRD.md"],
      analysis: null,
      greenfield: true,
      baseline: "none",
      sliceSize: { min: 9, max: 13 },
      launch: async (inputs) => {
        seen = inputs;
        writeFileSync(
          slicesPath(root),
          JSON.stringify({
            schema_version: 1,
            slices: [{ id: "s01", title: "t", goal: "g", requirement_ids: [], baseline_items: [], docs: [], depends_on: [], expected_tickets: 10, rationale: "" }],
            questions: [],
          }),
        );
      },
    });
    expect(seen["slice_size"]).toEqual({ min: 9, max: 13 });
    expect(String(seen["instruction"])).toContain("Size a slice to 9–13 tickets");
    /** And it says WHY the ceiling matters, because that is what a planner needs to respect it. */
    expect(String(seen["instruction"])).toContain("largest thing this pipeline must produce without failing");
  });
});
