import { writeFileSync } from "node:fs";
import { PLAN_REVIEW_SAMPLES } from "../../src/init/plan-review.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { ANALYSIS, LONE_CANDIDATE } from "./plan-fixture.js";

/**
 * The two-slice world every slicing and cache suite plans against.
 *
 * Split out of `slicing.test.ts` under AGENTS.md's rule to divide by
 * responsibility at the ceiling rather than mechanically: that file grew past
 * 600 lines covering two separate questions — how a product is planned slice by
 * slice, and what the C-8 slice cache will and will not reuse. The fixture is
 * shared by both; `MockBackend` is re-exported so a suite needs one import.
 */

export { MockBackend };

export const TWO_SLICES = {
  schema_version: 1,
  slices: [
    { id: "s01", title: "skeleton", goal: "ping works", requirement_ids: ["R1"], baseline_items: ["PB-001"], docs: ["PRD.md"], depends_on: [], expected_tickets: 2, rationale: "" },
    { id: "s02", title: "billing", goal: "invoices", requirement_ids: ["R2"], baseline_items: [], docs: ["prd-billing.md"], depends_on: ["s01"], expected_tickets: 2, rationale: "" },
  ],
  questions: [{ id: "sq1", question: "Which region hosts the data?", blocking: false, assumption: "eu-west-1" }],
};

export const ticket = (id: string, deps: string[] = []) => ({
  id,
  type: "feature",
  title: `t ${id}`,
  description: "",
  acceptance_criteria: ["it works"],
  non_goals: [],
  surface: ["src/**"],
  depends_on: deps,
  provides: [],
  consumes: [],
  risk_label: false,
});

export const inputsOf = (spec: SessionSpec): Record<string, unknown> =>
  (JSON.parse(spec.promptVariable) as { inputs: Record<string, unknown> }).inputs;

export const sliceOf = (inputs: Record<string, unknown>): string => (inputs["slice"] as { id: string }).id;

export interface Script {
  readonly analysis?: object;
  readonly slices?: object;
  readonly draft: (inputs: Record<string, unknown>) => object;
  readonly review: (inputs: Record<string, unknown>) => object;
}

/** A planner that answers by stage and logs which stage, and which slice, each launch served. */
export function scriptedPlanner(script: Script, log: string[], seen: Record<string, unknown>[] = []): StageFn {
  return (spec) => {
    const inputs = inputsOf(spec);
    seen.push(inputs);
    let artifact: object;
    if (spec.artifactOut.endsWith("slices.json")) {
      log.push("SLICE");
      artifact = script.slices ?? TWO_SLICES;
    } else if (spec.artifactOut.endsWith("plan-draft.json")) {
      log.push(`PLAN:${sliceOf(inputs)}`);
      artifact = script.draft(inputs);
    } else if (spec.artifactOut.endsWith("plan-review.json")) {
      log.push(`REVIEW:${String(inputs["scope"])}${inputs["scope"] === "slice" ? `:${sliceOf(inputs)}` : ""}`);
      artifact = script.review(inputs);
    } else {
      log.push("ANALYZE");
      artifact = script.analysis ?? ANALYSIS(null);
    }
    writeFileSync(spec.artifactOut, `${JSON.stringify(artifact)}\n`);
    return okResult();
  };
}

export const twoSliceDraft = (inputs: Record<string, unknown>): object =>
  sliceOf(inputs) === "s01"
    ? {
        schema_version: 1,
        tickets: [ticket("t-s01-001"), ticket("t-s01-002", ["t-s01-001"])],
        questions: [{ id: "pq1", question: "which region hosts the data?", blocking: false, assumption: "eu-west-1" }],
      }
    : { schema_version: 1, tickets: [ticket("t-s02-001", ["t-s01-002"]), ticket("t-s02-002")], questions: [] };

export const DOCS = { ...LONE_CANDIDATE, "prd-billing.md": "# billing\n" };

/**
 * C-4⁗″ (PRDR-200): a slice's review is DRAWN `PLAN_REVIEW_SAMPLES` times.
 *
 * These sequences are about ORDER and REUSE — which slices re-plan when a
 * document moves — not about how many times the reviewer is asked. Expanding
 * the expectation keeps the assertion exact rather than collapsing repeats,
 * which would hide the sampling stopping.
 */
export const R = (slice: string): string[] => Array.from({ length: PLAN_REVIEW_SAMPLES }, () => `REVIEW:slice:${slice}`);
