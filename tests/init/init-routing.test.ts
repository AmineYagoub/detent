import { describe, expect, it } from "vitest";
import { runInit } from "../../src/init/machine.js";
import { buildPipeline } from "../../src/init/pipeline.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { ANALYSIS, BUDGETS, DRAFT, LONE_CANDIDATE, PROMPTS, planner, repo } from "./plan-fixture.js";

/**
 * PRDR-114 — the planner's routed model has to reach the planner. Init
 * sessions hard-coded `model: ""`, so `model_routing.planner` was dead on
 * the only path that launches a planner.
 */
describe("PRDR-114 init sessions run on their routed models", () => {
  it("every planner session carries the routed model", async () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({ planner: planner(ANALYSIS(null), DRAFT(["t-100"])) });
    await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS, modelRouting: { planner: "claude-fable-5-1" } }));
    const plannerCalls = backend.calls.filter((c) => c.spec.role === "planner");
    expect(plannerCalls.length).toBeGreaterThanOrEqual(2);
    for (const c of plannerCalls) expect(c.spec.model).toBe("claude-fable-5-1");
  });

  it("no routing means the runtime default, as before", async () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({ planner: planner(ANALYSIS(null), DRAFT(["t-100"])) });
    await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));
    for (const c of backend.calls.filter((c) => c.spec.role === "planner")) expect(c.spec.model).toBe("");
  });
});
