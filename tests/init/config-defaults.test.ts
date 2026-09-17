import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureConfig } from "../../src/init/config.js";
import { DEFAULT_MODEL_ROUTING, ROLE_IDS } from "../../src/schemas/roles.js";
import { removeTree, tmpTree } from "../helpers.js";
import { loadConfig } from "../../src/kernel/worstcase.js";

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

/**
 * PRDR-197 — effort per role, refused by name when it is wrong.
 *
 * `model_routing` accepted any key, so a typo routed that role to the runtime
 * default forever with nothing printed (PRDR-142). This field is validated on
 * BOTH axes because it has two ways to be wrong, and a config that says nothing
 * must produce exactly the sessions it produced before the key existed.
 */
describe("PRDR-197 effort_routing is validated on both axes", () => {
  const base = (): Record<string, unknown> => {
    const root = tmpTree({});
    roots.push(root);
    ensureConfig(root, 10);
    return JSON.parse(readFileSync(path.join(root, ".detent", "config.json"), "utf8")) as Record<string, unknown>;
  };

  /**
   * PRDR-263: reads a config with the key REMOVED. `base()` now returns one
   * that carries the written routing, so asserting `{}` against it would no
   * longer tell the SCHEMA default apart from what `ensureConfig` wrote. A
   * regression guard against this ticket, not evidence for it.
   */
  it("defaults to empty when the key is absent, so a config predating it is unchanged", () => {
    const withoutKey = base();
    delete withoutKey["effort_routing"];
    expect(
      loadConfig(withoutKey).config.effort_routing,
      "a config written before the key existed must produce exactly the sessions it always did",
    ).toEqual({});
  });

  it("accepts a real role at a real level", () => {
    expect(loadConfig({ ...base(), effort_routing: { review: "xhigh" } }).config.effort_routing).toEqual({ review: "xhigh" });
  });

  it("refuses a role that does not exist, naming it", () => {
    expect(() => loadConfig({ ...base(), effort_routing: { reviewr: "xhigh" } })).toThrow(/effort_routing has no role `reviewr`/);
  });

  it("refuses a level the SDK does not have, naming it", () => {
    expect(() => loadConfig({ ...base(), effort_routing: { review: "extreme" } })).toThrow(/effort_routing\.review is `extreme`/);
  });

  /**
   * The audit of this ticket found `cli/init.ts` passing `modelRouting` and not
   * `effortRouting`, so the knob was read by the schema and reached no init
   * session — dead on that path while working on the loop, which is ARCH-2
   * asymmetry in the ticket whose own criteria warn about it. The parity case
   * asserted the RUN driver and passed.
   */
  it("a first init writes the key, so the knob is discoverable", () => {
    const root = tmpTree({});
    roots.push(root);
    ensureConfig(root, 10);
    const written = JSON.parse(readFileSync(path.join(root, ".detent", "config.json"), "utf8")) as Record<string, unknown>;
    expect(written).toHaveProperty("effort_routing");
    /* PRDR-263: present AND populated — PRDR-197's argument carried one step further. */
    expect(
      written["effort_routing"],
      "an operator must be able to see, in the file they edit, the level each role runs at",
    ).toEqual({
      planner: "max",
      review: "xhigh",
      diagnose: "xhigh",
      informed_fix: "xhigh",
      implement: "xhigh",
      blind_fix: "xhigh",
      review_fix: "xhigh",
      research: "xhigh",
    });
  });
});

/**
 * PRDR-263 — `init` has an opinion about how hard each role thinks, and a level
 * is only meaningful against the model that must serve it.
 *
 * Before this ticket `ensureConfig` wrote `effort_routing: {}`, both drivers
 * omitted the field for an unrouted role and `sessions/sdk.ts` omitted it
 * again, so no `effort` option reached the SDK from a default install and every
 * role ran at the SDK's own default, `high`.
 */
describe("PRDR-263 init writes the effort routing", () => {
  const writtenRouting = (): Record<string, string> => {
    const root = tmpTree({});
    roots.push(root);
    ensureConfig(root, 10);
    const cfg = JSON.parse(readFileSync(path.join(root, ".detent", "config.json"), "utf8")) as Record<string, unknown>;
    return cfg["effort_routing"] as Record<string, string>;
  };

  it("routes every role — the planner at max, the other seven at xhigh", () => {
    const routing = writtenRouting();
    expect(
      Object.keys(routing).sort(),
      "a role left out of the routing silently runs at the SDK default instead",
    ).toEqual([...ROLE_IDS].sort());
    expect(routing["planner"], "the planner drafts the whole plan in one session (S-5″)").toBe("max");
    for (const role of ROLE_IDS) {
      if (role === "planner") continue;
      expect(routing[role], `${role} is routed to xhigh`).toBe("xhigh");
    }
  });

  /**
   * The SDK's own declaration is the oracle (`sdk.d.ts:1751-1754`): `xhigh` is
   * Fable 5 / Opus 4.7+ / Sonnet 5, `max` is Fable 5 / Opus 4.6+ / Sonnet 4.6+.
   * The PAIR is asserted, not the two tables separately, because checking them
   * apart leaves the join to a reader and the join is the whole claim. A pair
   * outside this table is a silent downgrade that PRDR-237 can only report
   * after the money is spent.
   */
  it("never routes a role to a level its own model cannot serve", () => {
    const servable: Readonly<Record<string, readonly string[]>> = {
      "claude-opus-5": ["low", "medium", "high", "xhigh", "max"],
      "claude-sonnet-5": ["low", "medium", "high", "xhigh", "max"],
    };
    const routing = writtenRouting();
    expect(Object.keys(routing).length, "an empty routing would make every assertion below vacuous").toBe(ROLE_IDS.length);
    for (const role of ROLE_IDS) {
      const model = DEFAULT_MODEL_ROUTING[role];
      const level = routing[role];
      expect(servable[model], `${model} is a model whose effort support this test has not verified`).toBeDefined();
      expect(servable[model], `${role} runs on ${model} at ${level}, which that model cannot serve`).toContain(level);
    }
  });
});
