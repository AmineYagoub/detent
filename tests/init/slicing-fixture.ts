import { writeFileSync } from "node:fs";
import { PLAN_REVIEW_SAMPLES } from "../../src/init/plan-review.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { LONE_CANDIDATE } from "./plan-fixture.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";

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
  schema_version: SCHEMA_VERSION,
  slices: [
    { id: "s01", title: "skeleton", goal: "ping works", requirement_ids: ["R1"], baseline_items: ["PB-001"], docs: ["PRD.md"], depends_on: [], rationale: "" },
    { id: "s02", title: "billing", goal: "invoices", requirement_ids: ["R2"], baseline_items: [], docs: ["prd-billing.md"], depends_on: ["s01"], rationale: "" },
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
  requirement_ids: [],
  baseline_ids: [],
  risk_label: false,
});

export const inputsOf = (spec: SessionSpec): Record<string, unknown> =>
  (JSON.parse(spec.promptVariable) as { inputs: Record<string, unknown> }).inputs;

export const sliceOf = (inputs: Record<string, unknown>): string => (inputs["slice"] as { id: string }).id;

/**
 * PRDR-291: TWO_SLICES as a model writes it on its n-th take, the same cut in
 * new words. 1 of 24 titles survived between two real runs, so a cache that
 * holds only while SLICE writes the same bytes again holds nowhere.
 */
export const reworded = (take: number): object => ({
  ...TWO_SLICES,
  slices: TWO_SLICES.slices.map((s) => ({ ...s, title: `${s.title}, take ${String(take)}`, goal: `${s.goal} (take ${String(take)})`, rationale: `take ${String(take)}` })),
});

/** Every requirement id a seeded SLICE session is handed (C-2⁸); none without a parse. */
export const seedIds = (inputs: Record<string, unknown>): string[] =>
  ((inputs["seed"] as { groups: { requirement_ids: string[] }[] }[] | undefined) ?? []).flatMap((m) => m.groups.flatMap((g) => g.requirement_ids));

/** PRDR-291: one slice holding every id of the seed, which a pack's SLICE refuses to see any id left out of. */
export const oneSlice =
  (title: string, docs: readonly string[] = []) =>
  (_take: number, inputs: Record<string, unknown>): object => ({
    schema_version: SCHEMA_VERSION,
    slices: [{ id: "s01", title, goal: `${title} works end to end`, requirement_ids: seedIds(inputs), baseline_items: [], docs: [...docs], depends_on: [], rationale: "" }],
    questions: [],
  });

export interface Script {
  /** SLICE's artifact, or the artifact of its n-th launch (1-based) given its inputs. */
  readonly slices?: object | ((take: number, inputs: Record<string, unknown>) => object);
  /** C-2¹⁵: what a SLICE session that may only add writes; by default every id of its seed joins the last slice. */
  readonly additions?: (inputs: Record<string, unknown>) => object;
  readonly draft: (inputs: Record<string, unknown>) => object;
  readonly review: (inputs: Record<string, unknown>) => object;
}

/** A planner that answers by stage and logs which stage, and which slice, each launch served. */
export function scriptedPlanner(script: Script, log: string[], seen: Record<string, unknown>[] = []): StageFn {
  let takes = 0;
  return (spec) => {
    const inputs = inputsOf(spec);
    seen.push(inputs);
    let artifact: object;
    if (spec.artifactOut.endsWith("slices.json")) {
      takes += 1;
      log.push("SLICE");
      artifact = typeof script.slices === "function" ? script.slices(takes, inputs) : (script.slices ?? TWO_SLICES);
    } else if (spec.artifactOut.endsWith("slice-additions.json")) {
      log.push("SLICE:add");
      const last = ((inputs["slices"] as { id: string }[] | undefined) ?? []).at(-1)?.id ?? "s01";
      artifact = script.additions?.(inputs) ?? { schema_version: SCHEMA_VERSION, placed: seedIds(inputs).map((id) => ({ requirement_id: id, slice: last })), new_slices: [] };
    } else if (spec.artifactOut.endsWith("plan-draft.json")) {
      log.push(`PLAN:${sliceOf(inputs)}`);
      artifact = script.draft(inputs);
    } else if (spec.artifactOut.endsWith("plan-review.json")) {
      log.push(`REVIEW:${String(inputs["scope"])}${inputs["scope"] === "slice" ? `:${sliceOf(inputs)}` : ""}`);
      artifact = script.review(inputs);
    } else {
      throw new Error(`the planner was asked for ${spec.artifactOut}, which no planning stage writes`);
    }
    writeFileSync(spec.artifactOut, `${JSON.stringify(artifact)}\n`);
    return okResult();
  };
}

export const twoSliceDraft = (inputs: Record<string, unknown>): object =>
  sliceOf(inputs) === "s01"
    ? {
        schema_version: SCHEMA_VERSION,
        tickets: [ticket("t-s01-001"), ticket("t-s01-002", ["t-s01-001"])],
        questions: [{ id: "pq1", question: "which region hosts the data?", blocking: false, assumption: "eu-west-1" }],
      }
    : { schema_version: SCHEMA_VERSION, tickets: [ticket("t-s02-001", ["t-s01-002"]), ticket("t-s02-002")], questions: [] };

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
