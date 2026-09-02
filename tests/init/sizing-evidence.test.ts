import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runInit } from "../../src/init/machine.js";
import { buildPipeline } from "../../src/init/pipeline.js";
import { sizingEvidence } from "../../src/init/sizing-evidence.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { ANALYSIS, BUDGETS, DRAFT, LONE_CANDIDATE, PROMPTS, planner, repo } from "./plan-fixture.js";

/**
 * X-4″ (PRDR-102) — the planner and the plan review size against what a
 * previous plan of these documents actually cost, when that exists.
 */

function ledgerRow(ticket: string, role: string, turns: number, partial?: string): string {
  return JSON.stringify({
    at: "2026-09-01T10:00:00.000Z",
    ticket,
    generation: 0,
    role,
    cost_estimate_usd: 1,
    input_tokens: 1,
    output_tokens: 1,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    turns,
    models: [],
    ...(partial === undefined ? {} : { partial }),
  });
}

function seedEvidence(root: string): void {
  const state = path.join(root, ".detent");
  mkdirSync(path.join(state, "runs", "t-9"), { recursive: true });
  writeFileSync(
    path.join(state, "ledger.jsonl"),
    `${[ledgerRow("t-1", "implement", 40), ledgerRow("t-2", "implement", 70), ledgerRow("t-3", "implement", 110), ledgerRow("t-3", "review", 5), ledgerRow("t-4", "implement", 222, "crash")].join("\n")}\n`,
  );
  writeFileSync(path.join(state, "runs", "t-9", "oversized.json"), JSON.stringify({ note: "three sections in one", split: ["a", "b", "c"] }));
}

describe("X-4″ sizing evidence", () => {
  it("is null with nothing measured, and measured otherwise — completed implement turns and every proposal", () => {
    const root = repo(LONE_CANDIDATE);
    expect(sizingEvidence(root)).toBeNull();
    seedEvidence(root);
    const evidence = sizingEvidence(root);
    expect(evidence?.implement_turns).toEqual({ sessions: 3, p50: 70, p90: 110, max: 110 });
    expect(evidence?.oversized).toEqual([{ ticket: "t-9", title: "t-9", note: "three sections in one", split: ["a", "b", "c"] }]);
  });

  it("reaches PLAN and REVIEW_PLAN as `sizing_evidence`", async () => {
    const root = repo(LONE_CANDIDATE);
    seedEvidence(root);
    const backend = new MockBackend({ planner: planner(ANALYSIS(null), DRAFT(["t-100"])) });
    await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));
    const inputs = backend.calls
      .filter((c) => c.spec.artifactOut.endsWith("plan-draft.json") || c.spec.artifactOut.endsWith("plan-review.json"))
      .map((c) => (JSON.parse(c.spec.promptVariable) as { inputs: Record<string, unknown> }).inputs);
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    for (const i of inputs) {
      const evidence = i["sizing_evidence"] as { implement_turns: { sessions: number }; oversized: unknown[] };
      expect(evidence.implement_turns.sessions).toBe(3);
      expect(evidence.oversized).toHaveLength(1);
    }
  });
});
