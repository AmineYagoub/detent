import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildPipeline } from "../../src/init/pipeline.js";
import { runInit, sliceCacheDir } from "../../src/init/machine.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { allTickets, readTicket } from "../../src/kernel/tickets/readers.js";
import { PLAN_FINDING_TAGS, slicesSchema, type SliceSpec } from "../../src/schemas/init.js";
import { slicesFromOutputs, slicesSkeleton } from "../../src/init/slice.js";
import { normaliseDraft } from "../../src/init/plan-slices.js";
import { presentInputsFromOutputs, renderPresentation } from "../../src/init/present.js";
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
  provides: [],
  consumes: [],
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

  /**
   * F-3′ (PRDR-137): the cache advertises itself as a validated trust boundary
   * — "a shape this does not recognise is a miss, not a crash" — and validated
   * 3 of the 11 fields it casts to `DraftedTicket`. `sliceKey` hashes what the
   * slice READ, not the code that read it, so a cache from an older build still
   * matches its key and was a HIT that crashed `init` mid-PLAN with
   * `TypeError: t.provides is not iterable`.
   */
  it("a cache whose tickets are missing the fields it casts to is a MISS, not a crash", async () => {
    const root = repo(DOCS);
    const handlers = (): ReturnType<typeof buildPipeline> =>
      buildPipeline({ root, backend: new MockBackend({ planner: scriptedPlanner({ draft: twoSliceDraft, review: () => APPROVE_PLAN }, []) }), prompts: PROMPTS, budgets: BUDGETS });
    await runInit(root, handlers());

    const cacheFile = path.join(sliceCacheDir(root), "s01.json");
    const cached = JSON.parse(readFileSync(cacheFile, "utf8")) as { tickets: Record<string, unknown>[] };
    /* An older build's shape: the ids are there, the contract fields are not. */
    cached.tickets = cached.tickets.map((t) => ({ id: t["id"], depends_on: t["depends_on"], slice: t["slice"] }));
    writeFileSync(cacheFile, JSON.stringify(cached));

    /* A miss re-plans the slice; it must not throw. */
    await expect(runInit(root, handlers())).resolves.toBeDefined();
  });

  it("C-8‴: a re-analysis does not re-plan slices whose own documents never moved", async () => {
    const root = repo(DOCS);
    let summary = "the first analysis";
    const log: string[] = [];
    const backend = new MockBackend({
      planner: (spec) => {
        const inputs = (JSON.parse(spec.promptVariable) as { inputs: Record<string, unknown> }).inputs;
        let artifact: object;
        if (spec.artifactOut.endsWith("slices.json")) artifact = TWO_SLICES;
        else if (spec.artifactOut.endsWith("plan-draft.json")) {
          log.push(`PLAN:${sliceOf(inputs)}`);
          artifact = twoSliceDraft(inputs);
        } else if (spec.artifactOut.endsWith("plan-review.json")) artifact = APPROVE_PLAN;
        else artifact = { ...ANALYSIS(null), summary };
        writeFileSync(spec.artifactOut, `${JSON.stringify(artifact)}\n`);
        return okResult();
      },
    });
    const handlers = () => buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS });
    await runInit(root, handlers());
    expect(log).toEqual(["PLAN:s01", "PLAN:s02"]);

    /**
     * Editing one slice's document re-runs ANALYZE, and ANALYZE is a model act
     * — its prose differs every time. While the whole analysis was in every
     * slice's cache key, that drift re-planned the entire product for a typo.
     */
    log.splice(0);
    summary = "the second analysis, worded differently";
    writeFileSync(path.join(root, "prd-billing.md"), "# billing, revised\n");
    await runInit(root, handlers());
    expect(log).toEqual(["PLAN:s02"]);
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
    /**
     * The reference is NOT rewritten to the renamed local ticket: `t-s01-001`
     * also names a real ticket in an earlier slice, and that is what the
     * planner was given in `plan_index`. Rewriting it would have destroyed the
     * only cross-slice edge the draft declared, and silently.
     */
    expect(out.tickets[1]!.depends_on).toEqual(["t-s01-001"]);
    expect(out.findings).toEqual([{ tag: "dependency", ticket: "t-s02-002", finding: expect.stringContaining("t-s09-001") }]);
    expect(notes.join("\n")).toContain('"t-s01-001" is unusable or already planned — renamed t-s02-001');
    expect(notes.join("\n")).toContain("edge dropped");
  });

  /**
   * The cross-slice case above proves a reference to an EARLIER ticket survives
   * the rename. This is the other half, and it was broken: when the planner
   * drafted one id twice inside a slice, the rename map pointed at the second,
   * RENAMED copy — so every edge naming that id was redirected away from the
   * ticket that still held it. The plan stayed well-formed and silently meant
   * something else.
   */
  it("a duplicated id inside one slice: edges naming it mean the ticket that KEPT it, and the collision is a finding", () => {
    const slice: SliceSpec = { id: "s02", title: "billing", goal: "g", requirement_ids: [], baseline_items: [], docs: [], depends_on: [], expected_tickets: 3, rationale: "" };
    const out = normaliseDraft(
      slice,
      [
        { ...ticket("t-s02-001"), type: "feature" as const, slice: "s02" },
        { ...ticket("t-s02-001"), type: "feature" as const, slice: "s02" },
        { ...ticket("t-s02-009", ["t-s02-001"]), type: "feature" as const, slice: "s02" },
      ],
      [],
      undefined,
    );
    expect(out.tickets.map((t) => t.id)).toEqual(["t-s02-001", "t-s02-002", "t-s02-009"]);
    /* The survivor, not the renamed duplicate. */
    expect(out.tickets[2]!.depends_on).toEqual(["t-s02-001"]);
    expect(out.findings).toContainEqual({
      tag: "coherence",
      ticket: "t-s02-002",
      finding: expect.stringContaining("an id another ticket in this slice already holds"),
    });
  });

  it("a finding a slice's own review still holds after its revision reaches the presentation — the single-slice case, where no whole-plan review runs", async () => {
    const root = repo(DOCS);
    const held = { tag: "sizing", ticket: "t-s01-002", finding: "still larger than one session after the revision" };
    const backend = new MockBackend({
      planner: scriptedPlanner(
        {
          slices: { schema_version: 1, slices: [TWO_SLICES.slices[0]!], questions: [] },
          draft: () => ({ schema_version: 1, tickets: [ticket("t-s01-001"), ticket("t-s01-002", ["t-s01-001"])], questions: [] }),
          review: () => ({ schema_version: 1, verdict: "changes", findings: [held] }),
        },
        [],
      ),
    });
    const result = await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    /** One slice means no whole-plan review, so the slice's own leftover is the ONLY finding there is. */
    expect(result.interrupt?.message).toContain("Review findings held after revision (1)");
    expect(result.interrupt?.message).toContain("sizing (t-s01-002): still larger than one session");
  });

  /**
   * `wholePlanReview` guards the FIRST review's absence carefully and then, in
   * the same function, read a null SECOND verdict as an empty finding list —
   * printing "approve" for a re-review that never ran. A plan redrafted for
   * coherence findings and then never re-checked reached the human as approved.
   */
  it("a whole-plan re-review that produced no verdict is reported, never read as approval", async () => {
    const root = repo(DOCS);
    const notes: string[] = [];
    let whole = 0;
    const backend = new MockBackend({
      planner: scriptedPlanner(
        {
          draft: twoSliceDraft,
          review: (inputs) => {
            if (inputs["scope"] !== "whole") return APPROVE_PLAN;
            whole += 1;
            /* The first whole review faults a ticket, which forces the redraft. */
            if (whole === 1) {
              return { schema_version: 1, verdict: "changes", findings: [{ tag: "coherence", ticket: "t-s01-001", finding: "duplicates t-s02-001" }] };
            }
            /* The re-review and its one relaunch both come back unusable. */
            return { not: "a review at all" };
          },
        },
        [],
      ),
    });
    const result = await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS, note: (t) => notes.push(t) }));

    expect(notes.join("\n")).toContain("whole-plan review after revision: NO VERDICT");
    expect(notes.join("\n")).not.toContain("whole-plan review after revision: approve");
    /* And the human is told, rather than shown a plan that looks reviewed. */
    expect(result.interrupt?.message).toContain("no usable verdict");
  });

  it("a dependency dropped as impossible is presented as a finding, not swallowed", async () => {
    const root = repo(DOCS);
    const backend = new MockBackend({
      planner: scriptedPlanner(
        {
          slices: { schema_version: 1, slices: [TWO_SLICES.slices[0]!], questions: [] },
          draft: () => ({ schema_version: 1, tickets: [ticket("t-s01-001", ["t-s99-001"])], questions: [] }),
          review: () => APPROVE_PLAN,
        },
        [],
      ),
    });
    const result = await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    expect(readTicket(root, "t-s01-001").blockers).toEqual([]);
    expect(result.interrupt?.message).toContain("dependency (t-s01-001)");
    expect(result.interrupt?.message).toContain("t-s99-001");
  });

  it("a slice naming a document nothing discovered is grounded, not planned from an empty desk", async () => {
    const root = repo(DOCS);
    const notes: string[] = [];
    const seen: Record<string, unknown>[] = [];
    const backend = new MockBackend({
      planner: scriptedPlanner(
        {
          slices: {
            schema_version: 1,
            slices: [{ ...TWO_SLICES.slices[0]!, docs: ["docs/imagined.md"], baseline_items: ["PB-001", "PB-404"] }],
            questions: [],
          },
          draft: () => ({ schema_version: 1, tickets: [ticket("t-s01-001")], questions: [] }),
          review: () => APPROVE_PLAN,
        },
        [],
        seen,
      ),
    });
    await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS, note: (t) => notes.push(t) }));

    expect(notes.join("\n")).toContain("docs/imagined.md was never discovered");
    expect(notes.join("\n")).toContain("it will plan from every discovered document");
    expect(notes.join("\n")).toContain("PB-404 name no production-baseline item");
    /** The slice plans from the whole discovered set rather than from a path that does not exist. */
    const draft = seen.find((i) => i["stage"] === "PLAN")!;
    expect(draft["docs"]).toEqual(["PRD.md", "prd-billing.md"]);
    expect((draft["production_baseline"] as { id: string }[]).map((b) => b.id)).toEqual(["PB-001"]);
  });

  it("an unreadable SLICE checkpoint fails the phase — it never silently reverts to planning the whole product in one pass", () => {
    expect(slicesFromOutputs({})).toEqual([]);
    expect(() => slicesFromOutputs({ SLICE: { slices: [{ id: "nope", title: "t" }] } })).toThrow(/SLICE checkpoint is unreadable/);
    expect(slicesFromOutputs({ SLICE: { slices: TWO_SLICES.slices } }).map((s) => s.id)).toEqual(["s01", "s02"]);
  });

  it("PRDR-119: every question reaching the human has a unique id, across a slice's two drafts and across stages", async () => {
    const root = repo(DOCS);
    /** Both drafts of s01 number their own questions from one, as a planner naturally would. */
    const first = { id: "s01-q1", question: "Which payment rail serves the USD tier?", blocking: false, assumption: "Chargily only" };
    const second = { id: "s01-q1", question: "What is the trial credit amount?", blocking: false, assumption: "5000 DZD" };
    let drafts = 0;
    const backend = new MockBackend({
      planner: (spec) => {
        let artifact: object;
        if (spec.artifactOut.endsWith("slices.json")) {
          artifact = { schema_version: 1, slices: [TWO_SLICES.slices[0]!], questions: [{ id: "s01-q1", question: "Which Cloudflare zone?", blocking: false, assumption: "ksarapp.dev" }] };
        } else if (spec.artifactOut.endsWith("plan-draft.json")) {
          drafts += 1;
          artifact = { schema_version: 1, tickets: [ticket(`t-s01-00${drafts}`)], questions: [drafts === 1 ? first : second] };
        } else if (spec.artifactOut.endsWith("plan-review.json")) {
          /** The first review asks for a revision, so the slice drafts twice. */
          artifact = drafts === 1 ? { schema_version: 1, verdict: "changes", findings: [{ tag: "sizing", ticket: "t-s01-001", finding: "too big" }] } : APPROVE_PLAN;
        } else {
          artifact = { ...ANALYSIS(null), questions: [{ id: "s01-q1", question: "What is the apps domain?", blocking: false, assumption: "ksarapp.dev" }] };
        }
        writeFileSync(spec.artifactOut, `${JSON.stringify(artifact)}\n`);
        return okResult();
      },
    });
    const result = await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    const message = result.interrupt?.message ?? "";
    const ids = [...message.matchAll(/^ {2}(\S+): /gm)].map((m) => m[1] as string);
    expect(ids.length, "four questions from three stages, all shown").toBe(4);
    expect(new Set(ids).size, `ids must be unique, got ${ids.join(", ")}`).toBe(ids.length);
    /** Both of the slice's drafts contributed, and neither was lost to the other's id. */
    expect(message).toContain("Which payment rail serves the USD tier?");
    expect(message).toContain("What is the trial credit amount?");
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

/**
 * PRDR-144 — `presentInputsFromOutputs` directly.
 *
 * It reads a checkpoint's `outputs`, which the schema types as
 * `z.record(z.string(), z.unknown())`, and casts at six sites. It was only ever
 * exercised through pipelines that had just written their own inputs — so a
 * checkpoint from an older build reaches PRESENT unvalidated and throws inside
 * rendering, AFTER the expensive phases have been skipped as reusable.
 */
describe("PRDR-144 the PRESENT input builder, on shapes it did not write", () => {
  /**
   * PRDR-157: these must hit the keys the builder actually READS.
   *
   * The first version of this list carried `ANALYZE.questions`, which
   * `presentInputsFromOutputs` never reads — so its one wrong-type case was
   * structurally equivalent to `{}`, and the five others were shapes the
   * function already tolerated before the commit that introduced them. The
   * keys below are the three question sources it does read, and the shapes are
   * the ones that were observed to throw.
   */
  const FOREIGN: Record<string, Record<string, unknown>>[] = [
    {},
    { PLAN: {} },
    { PLAN: { plan: null } },
    { PLAN: { plan: { slices: "not an array" } } },
    { SLICE: { slices: [] }, PLAN: { plan: { slices: [] } } },
    { ANALYZE: { open_questions: "not an array" } },
    { SLICE: { questions: "not an array" } },
    { PLAN: { questions: "not an array" } },
    { ANALYZE: { open_questions: [null] } },
    { ANALYZE: { open_questions: [{}] } },
    { PLAN: { review_findings: "not an array", derived_edges: 7 } },
    /**
     * PRDR-164: ELEMENT shapes for the other two fields. The first pass
     * filtered the elements of `questions` and `slices` and checked only the
     * container type for `findings` and `derivedEdges` — so the builder's own
     * comment, "it returns something renderable or nothing", was true of half
     * its return value, and the renderer still died on `[null]`.
     */
    { PLAN: { review_findings: [null] } },
    { PLAN: { derived_edges: [null] } },
    /**
     * PRDR-165: these two pass against the UNFIXED builder. They guard against
     * over-correction rather than reproducing a defect, and are labelled so
     * rather than counted as evidence — the ticket claimed all four were
     * observed to throw first, and two were not (V-6).
     */
    { PLAN: { review_findings: [{}, "a string"] } },
    { PLAN: { derived_edges: [{ consumer: "t-1" }] } },
    /**
     * PRDR-165: the FIFTH field. `gateNotices` was added by the sibling ticket
     * in the same commit and the list still covered four — the exact
     * field-count omission PRDR-164 exists to fix, against the field added
     * beside it.
     */
    { DETERMINE_VERIFICATION: { gate_notices: "not an array" } },
    { DETERMINE_VERIFICATION: { gate_notices: [null, 7, { a: 1 }] } },
  ];

  it("survives outputs that are missing, empty, or the wrong shape", () => {
    for (const outputs of FOREIGN) {
      expect(
        () => presentInputsFromOutputs(outputs),
        `presentInputsFromOutputs threw on ${JSON.stringify(outputs).slice(0, 60)}`,
      ).not.toThrow();
    }
  });

  /**
   * PRDR-157: carried to the end of the pipeline, because the hazard this
   * block's own comment names is "throws inside RENDERING". A builder that
   * returns `slices: "not an array"` has not survived anything — the renderer
   * reads `.length` on it, finds 12, and then iterates its characters.
   */
  it("returns a shape the renderer can actually render", () => {
    for (const outputs of FOREIGN) {
      const built = presentInputsFromOutputs(outputs);
      expect(
        () =>
          renderPresentation({
            ...built,
            root: "/tmp",
            tickets: [],
            bindings: [],
            skips: [],
            assignments: {},
            bootstrap: null,
          }),
        `renderPresentation threw on ${JSON.stringify(outputs).slice(0, 60)}`,
      ).not.toThrow();
    }
  });
});
