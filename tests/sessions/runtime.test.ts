import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_ROUTING, FIRST_RUNTIME_SERVING, SUPERSEDED_MODELS, supersededRoutes, unservedRoutes } from "../../src/schemas/roles.js";
import { bundledRuntime, sdkManifest } from "../../src/sessions/runtime.js";

/**
 * S-5⁶ (PRDR-319) — a routed model is judged against the runtime that serves
 * it: the Claude Code the SDK bundles (S-5‴), not the `claude` on PATH. The
 * pinned 0.3.280 bundled 2.1.280, whose binary names `claude-opus-5-5` and
 * never `claude-sonnet-5-5`, and nothing compared a routing to it.
 */
describe("S-5⁶ each routed model is judged against the bundled runtime", () => {
  it("the table states a first runtime for every model a default routes to", () => {
    for (const model of new Set(Object.values(DEFAULT_MODEL_ROUTING))) {
      expect(FIRST_RUNTIME_SERVING[model], `${model} has a first runtime`).toMatch(/^\d+\.\d+\.\d+$/u);
    }
  });

  it("the runtime this Detent bundles serves every default, read from the SDK's own manifest", () => {
    const runtime = bundledRuntime();
    expect(runtime, "the manifest's claudeCodeVersion").toMatch(/^\d+\.\d+\.\d+$/u);
    expect(runtime).toBe(sdkManifest().runtime);
    expect(unservedRoutes(DEFAULT_MODEL_ROUTING, runtime)).toEqual([]);
  });

  it("names each role on a model the runtime predates, comparing versions as numbers, and judges no model outside the table", () => {
    const routing = { implement: "claude-sonnet-5-5", review: "claude-opus-5-5", research: "claude-haiku-9" };
    expect(unservedRoutes(routing, "2.1.280")).toEqual([{ role: "implement", model: "claude-sonnet-5-5", first: FIRST_RUNTIME_SERVING["claude-sonnet-5-5"] }]);
    expect(unservedRoutes(routing, "2.1.279")).toEqual([
      { role: "implement", model: "claude-sonnet-5-5", first: FIRST_RUNTIME_SERVING["claude-sonnet-5-5"] },
      { role: "review", model: "claude-opus-5-5", first: "2.1.280" },
    ]);
    expect(unservedRoutes(routing, FIRST_RUNTIME_SERVING["claude-sonnet-5-5"] ?? ""), "the first runtime serves it").toEqual([]);
    expect(unservedRoutes(routing, "2.1.1000"), "1000 is past 284 as a number, not as text").toEqual([]);
    expect(unservedRoutes(routing, "3.0.0")).toEqual([]);
  });

  it("a model named like an object's own key is judged as any unknown model, not read off the prototype", () => {
    expect(unservedRoutes({ review: "constructor", implement: "toString" }, "2.1.285")).toEqual([]);
    expect(supersededRoutes({ review: "constructor", implement: "__proto__" })).toEqual([]);
  });

  it("an unreadable runtime judges nothing, rather than passing or failing every model", () => {
    expect(unservedRoutes({ implement: "claude-sonnet-5-5" }, "unknown")).toBeNull();
  });

  it("names each role on a superseded default with the model that supersedes it, in the routing's order", () => {
    expect(supersededRoutes({ review: "claude-opus-5", implement: "claude-sonnet-5", planner: "claude-opus-5-5", research: "claude-haiku-9" })).toEqual([
      { role: "review", model: "claude-opus-5", successor: "claude-opus-5-5" },
      { role: "implement", model: "claude-sonnet-5", successor: "claude-sonnet-5-5" },
    ]);
    for (const successor of Object.values(SUPERSEDED_MODELS)) {
      expect(Object.values(DEFAULT_MODEL_ROUTING), `${successor} is a default today`).toContain(successor);
    }
  });
});
