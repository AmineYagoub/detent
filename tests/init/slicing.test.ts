import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildPipeline } from "../../src/init/pipeline.js";
import { runInit, sliceCacheDir } from "../../src/init/machine.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { allTickets, readTicket } from "../../src/kernel/tickets/readers.js";
import { PLAN_FINDING_TAGS, slicesSchema, type SliceSpec } from "../../src/schemas/init.js";
import { slicesSkeleton } from "../../src/init/slice.js";
import { normaliseDraft } from "../../src/init/plan-slices.js";
import { PRODUCTION_BASELINE } from "../../src/init/baseline.js";
import { ANALYSIS, APPROVE_PLAN, BUDGETS, LONE_CANDIDATE, PROMPTS, repo } from "./plan-fixture.js";

/**
 * C-2‴ / C-2⁗ / C-3′ (PRDR-117) — the slicing layer.
 *
 * A product larger than one planning pass is planned by Detent itself, to the
 * end: SLICE cuts the pack, PLAN plans each slice with the earlier index in
 * view, the whole plan is reviewed once for coherence, and every question
 * rides to PRESENT with its assumption. Nothing between stops for a human.
 */

const TWO_SLICES = {
  schema_version: 1,
  slices: [
    { id: "s01", title: "skeleton", goal: "ping works", requirement_ids: ["R1"], baseline_items: ["PB-001"], docs: ["PRD.md"], depends_on: [], expected_tickets: 2, rationale: "" },
    { id: "s02", title: "billing", goal: "invoices", requirement_ids: ["R2"], baseline_items: [], docs: ["prd-billing.md"], depends_on: ["s01"], expected_tickets: 2, rationale: "" },
  ],
  questions: [{ id: "sq1", question: "Which region hosts the data?", blocking: false, assumption: "eu-west-1" }],
};

const ticket = (id: string, deps: string[] = []) => ({
  id,
  type: "feature",
  title: `t ${id}`,
  description: "",
  acceptance_criteria: ["it works"],
  non_goals: [],
  surface: ["src/**"],
  depends_on: deps,
  risk_label: false,
});

const inputsOf = (spec: SessionSpec): Record<string, unknown> =>
  (JSON.parse(spec.promptVariable) as { inputs: Record<string, unknown> }).inputs;

const sliceOf = (inputs: Record<string, unknown>): string => (inputs["slice"] as { id: string }).id;

interface Script {
  readonly analysis?: object;
  readonly slices?: object;
  readonly draft: (inputs: Record<string, unknown>) => object;
  readonly review: (inputs: Record<string, unknown>) => object;
}

/** A planner that answers by stage and logs which stage, and which slice, each launch served. */
function scriptedPlanner(script: Script, log: string[], seen: Record<string, unknown>[] = []): StageFn {
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

const twoSliceDraft = (inputs: Record<string, unknown>): object =>
  sliceOf(inputs) === "s01"
    ? {
        schema_version: 1,
        tickets: [ticket("t-s01-001"), ticket("t-s01-002", ["t-s01-001"])],
        questions: [{ id: "pq1", question: "which region hosts the data?", blocking: false, assumption: "eu-west-1" }],
      }
    : { schema_version: 1, tickets: [ticket("t-s02-001", ["t-s01-002"]), ticket("t-s02-002")], questions: [] };

const DOCS = { ...LONE_CANDIDATE, "prd-billing.md": "# billing\n" };

describe("C-2‴ the product is planned slice by slice, to the end, without stopping", () => {
  it("plans each slice with the earlier index in view, reviews the whole, revises the slice it faults, and writes slice order into the blockers", async () => {
    const root = repo(DOCS);
    const log: string[] = [];
    const notes: string[] = [];
    const seen: Record<string, unknown>[] = [];
    let wholeReviews = 0;
    const backend = new MockBackend({
      planner: scriptedPlanner(
        {
          draft: twoSliceDraft,
          review: (inputs) => {
            if (inputs["scope"] !== "whole") return APPROVE_PLAN;
            wholeReviews += 1;
            return wholeReviews === 1
              ? { schema_version: 1, verdict: "changes", findings: [{ tag: "coherence", ticket: "t-s02-002", finding: "duplicates t-s01-002" }] }
              : APPROVE_PLAN;
          },
        },
        log,
        seen,
      ),
    });
    const result = await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS, note: (t) => notes.push(t) }));

    expect(result.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
    /** Every slice in turn, each reviewed as its own plan; then the whole; then only the faulted slice again; then the whole again. */
    expect(log).toEqual(["ANALYZE", "SLICE", "PLAN:s01", "REVIEW:slice:s01", "PLAN:s02", "REVIEW:slice:s02", "REVIEW:whole", "PLAN:s02", "REVIEW:whole"]);
    /** The later slice drafts with the earlier slice's tickets in view, and the slice review with the same index. */
    const s02Draft = seen.find((i) => i["stage"] === "PLAN" && sliceOf(i) === "s02")!;
    expect(s02Draft["plan_index"]).toEqual([
      { id: "t-s01-001", slice: "s01", title: "t t-s01-001", surface: ["src/**"] },
      { id: "t-s01-002", slice: "s01", title: "t t-s01-002", surface: ["src/**"] },
    ]);
    expect(s02Draft["docs"]).toEqual(["prd-billing.md"]);
    const s01Draft = seen.find((i) => i["stage"] === "PLAN" && sliceOf(i) === "s01")!;
    expect((s01Draft["production_baseline"] as { id: string }[]).map((b) => b.id)).toEqual(["PB-001"]);
    const redraft = seen.filter((i) => i["stage"] === "PLAN" && sliceOf(i) === "s02")[1]!;
    expect((redraft["review_findings"] as { tag: string }[]).map((f) => f.tag)).toEqual(["coherence"]);
    const whole = seen.find((i) => i["stage"] === "REVIEW_PLAN" && i["scope"] === "whole")!;
    expect((whole["plan"] as { slice: string }[]).map((t) => t.slice)).toEqual(["s01", "s01", "s02", "s02"]);

    expect(allTickets(root).map((t) => t.id).sort()).toEqual(["t-s01-001", "t-s01-002", "t-s02-001", "t-s02-002"]);
    /** A ticket with its own edge into the slice it thickens keeps just that edge. */
    expect(readTicket(root, "t-s02-001").blockers).toEqual(["t-s01-002"]);
    /** One without is blocked on the earlier slice's capstones — the tickets nothing else in it depends on. */
    expect(readTicket(root, "t-s02-002").blockers).toEqual(["t-s01-002"]);
    expect(readTicket(root, "t-s01-001").blockers).toEqual([]);

    const plan = JSON.parse(readFileSync(path.join(root, ".detent", "plan", "plan.json"), "utf8")) as { slices: unknown };
    expect(plan.slices).toEqual([
      { id: "s01", title: "skeleton", tickets: ["t-s01-001", "t-s01-002"] },
      { id: "s02", title: "billing", tickets: ["t-s02-001", "t-s02-002"] },
    ]);

    const message = result.interrupt?.message ?? "";
    expect(message).toContain("Slices (2");
    expect(message).toContain("s02  billing  — 2 ticket(s)");
    /** C-3′: the slice's question and the plan's are the same question — asked once, with its assumption. */
    expect(message).toContain("Open questions (1)");
    expect(message).toContain("assumed: eu-west-1");
    expect(notes.join("\n")).toContain("redrafting s02 billing for 1 whole-plan finding(s)");
    expect(notes.join("\n")).toContain("whole-plan review after revision: approve");
  });

  it("C-3′: a blocking question is asked once, at PRESENT, after the whole plan is written", async () => {
    const root = repo(DOCS);
    const log: string[] = [];
    const backend = new MockBackend({
      planner: scriptedPlanner(
        {
          analysis: { ...ANALYSIS(null), questions: [{ id: "q1", question: "Which payment provider?", blocking: true, assumption: "" }] },
          draft: twoSliceDraft,
          review: () => APPROVE_PLAN,
        },
        log,
      ),
    });
    const result = await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    expect(result.reachedPhase).toBe("PRESENT");
    expect(result.interrupt?.interrupt).toBe("AWAIT_INFO");
    expect(result.interrupt?.items).toEqual(["Which payment provider?"]);
    /** ANALYZE, SLICE and PLAN all completed first: the plan exists on disk before anyone is asked anything. */
    expect(result.executed).toEqual(expect.arrayContaining(["ANALYZE", "SLICE", "PLAN", "PREPARE_AGENTS"]));
    expect(allTickets(root)).toHaveLength(4);
    expect(result.interrupt?.message).toContain("[BLOCKING] q1: Which payment provider?");
    expect(result.interrupt?.message).toContain("1 blocking question(s) need an answer");
  });

  it("C-8 inside PLAN: an unchanged slice is reused from its cache when another slice's documents move; --replan re-plans every slice", async () => {
    const root = repo(DOCS);
    const log: string[] = [];
    const notes: string[] = [];
    const backend = new MockBackend({ planner: scriptedPlanner({ draft: twoSliceDraft, review: () => APPROVE_PLAN }, log) });
    const handlers = buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS, note: (t) => notes.push(t) });

    await runInit(root, handlers);
    expect(log).toEqual(["ANALYZE", "SLICE", "PLAN:s01", "REVIEW:slice:s01", "PLAN:s02", "REVIEW:slice:s02", "REVIEW:whole"]);
    expect(existsSync(path.join(sliceCacheDir(root), "s01.json"))).toBe(true);

    /** Only the billing document changes: s01 read nothing that moved. */
    writeFileSync(path.join(root, "prd-billing.md"), "# billing, revised\n");
    log.splice(0);
    notes.splice(0);
    await runInit(root, handlers);
    expect(log).toEqual(["ANALYZE", "SLICE", "PLAN:s02", "REVIEW:slice:s02", "REVIEW:whole"]);
    expect(notes.join("\n")).toContain("s01 skeleton: reused — nothing it read has changed (C-8)");

    /** C-8′: a replan is a fresh planning session — the cache is wiped, every slice drafted again. */
    log.splice(0);
    await runInit(root, handlers, { replan: true });
    expect(log).toEqual(["ANALYZE", "SLICE", "PLAN:s01", "REVIEW:slice:s01", "PLAN:s02", "REVIEW:slice:s02", "REVIEW:whole"]);
  });

  it("C-2⁗: SLICE receives the production baseline unless the config opts out", async () => {
    for (const baseline of ["production", "none"] as const) {
      const root = repo(DOCS);
      const seen: Record<string, unknown>[] = [];
      const backend = new MockBackend({ planner: scriptedPlanner({ draft: twoSliceDraft, review: () => APPROVE_PLAN }, [], seen) });
      await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS, planBaseline: baseline }));
      const slice = seen.find((i) => i["stage"] === "SLICE")!;
      expect((slice["production_baseline"] as unknown[]).length).toBe(baseline === "production" ? PRODUCTION_BASELINE.length : 0);
    }
  });

  it("the draft's ids and edges are normalised, not trusted: a colliding id is renamed, an edge to nothing planned becomes a dependency finding", () => {
    const slice: SliceSpec = { id: "s02", title: "billing", goal: "g", requirement_ids: [], baseline_items: [], docs: [], depends_on: ["s01"], expected_tickets: 2, rationale: "" };
    const earlier = [{ ...ticket("t-s01-001"), type: "feature" as const, slice: "s01" }];
    const notes: string[] = [];
    const out = normaliseDraft(
      slice,
      [
        { ...ticket("t-s01-001"), type: "feature" as const, slice: "s02" },
        { ...ticket("t-s02-002", ["t-s01-001", "t-s09-001", "t-s02-002"]), type: "feature" as const, slice: "s02" },
      ],
      earlier,
      (t) => notes.push(t),
    );
    expect(out.tickets.map((t) => t.id)).toEqual(["t-s02-001", "t-s02-002"]);
    /** The slice's own references follow the rename; the unknown edge and the self-edge are gone. */
    expect(out.tickets[1]!.depends_on).toEqual(["t-s02-001"]);
    expect(out.findings).toEqual([{ tag: "dependency", ticket: "t-s02-002", finding: expect.stringContaining("t-s09-001") }]);
    expect(notes.join("\n")).toContain("t-s01-001 collides with a planned ticket — renamed t-s02-001");
    expect(notes.join("\n")).toContain("edge dropped");
  });

  it("the SLICE skeleton parses through its own schema; the baseline is well-formed; `coherence` is in the closed tag set", () => {
    expect(slicesSchema.safeParse(slicesSkeleton()).success).toBe(true);
    const ids = PRODUCTION_BASELINE.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(12);
    for (const item of PRODUCTION_BASELINE) {
      expect(item.id).toMatch(/^PB-\d{3}$/);
      expect(String(item.applies_when).length).toBeGreaterThan(0);
      expect(String(item.verifiable_by).length).toBeGreaterThan(0);
    }
    expect(PLAN_FINDING_TAGS).toContain("coherence");
    /** A slice may only depend on an EARLIER slice. */
    const backwards = slicesSchema.safeParse({ ...TWO_SLICES, slices: [...TWO_SLICES.slices].reverse() });
    expect(backwards.success).toBe(false);
  });
});
