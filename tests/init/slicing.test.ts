import { describe, expect, it } from "vitest";
import { PLAN_REVIEW_SAMPLES } from "../../src/init/plan-review.js";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runInit } from "../../src/init/machine.js";
import { revisionOutcome } from "../../src/init/plan-signal.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { allTickets, readTicket } from "../../src/kernel/tickets/readers.js";
import { PLAN_FINDING_TAGS, slicesSchema, type SliceSpec } from "../../src/schemas/init.js";
import { slicesFromOutputs, slicesSkeleton } from "../../src/init/slice.js";
import { normaliseDraft } from "../../src/init/plan-normalise.js";
import { renderPresentation } from "../../src/init/present.js";
import { presentInputsFromOutputs } from "../../src/init/present-inputs.js";
import { PRODUCTION_BASELINE } from "../../src/init/baseline.js";
import { CLEAN_AUDIT, planningPipeline, APPROVE_PLAN, BUDGETS, LONE_CANDIDATE, PROMPTS, repo } from "./plan-fixture.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";

/**
 * C-2‴ / C-2⁗ / C-3′ (PRDR-117) — the slicing layer.
 *
 * A product larger than one planning pass is planned by Detent itself, to the
 * end: SLICE cuts the pack, and PLAN plans each slice with the earlier index in
 * view. The whole plan was reviewed once for coherence until PRDR-293, which
 * put code's checks across the plan in its place. Nothing between stops for a
 * human, and no stage asks one anything (C-3⁗, C-4⁵).
 */

const TWO_SLICES = {
  schema_version: SCHEMA_VERSION,
  slices: [
    { id: "s01", title: "skeleton", goal: "ping works", requirement_ids: ["R1"], baseline_items: ["PB-001"], docs: ["PRD.md"], depends_on: [], rationale: "" },
    { id: "s02", title: "billing", goal: "invoices", requirement_ids: ["R2"], baseline_items: [], docs: ["prd-billing.md"], depends_on: ["s01"], rationale: "" },
  ],
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
  requirement_ids: [],
  baseline_ids: [],
  criterion_ids: [],
  risk_label: false,
});

const inputsOf = (spec: SessionSpec): Record<string, unknown> =>
  (JSON.parse(spec.promptVariable) as { inputs: Record<string, unknown> }).inputs;

const sliceOf = (inputs: Record<string, unknown>): string => (inputs["slice"] as { id: string }).id;

interface Script {
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
    } else throw new Error(`no scripted artifact for ${spec.artifactOut}`);
    writeFileSync(spec.artifactOut, `${JSON.stringify(artifact)}\n`);
    return okResult();
  };
}

/** Each slice's ids and baseline items are named by its tickets, as A-1⁷'s coverage check asks (PRDR-293). */
const twoSliceDraft = (inputs: Record<string, unknown>): object =>
  sliceOf(inputs) === "s01"
    ? {
        schema_version: SCHEMA_VERSION,
        tickets: [{ ...ticket("t-s01-001"), requirement_ids: ["R1"] }, { ...ticket("t-s01-002", ["t-s01-001"]), baseline_ids: ["PB-001"] }],
      }
    : { schema_version: SCHEMA_VERSION, tickets: [{ ...ticket("t-s02-001", ["t-s01-002"]), requirement_ids: ["R2"] }, ticket("t-s02-002")] };

const DOCS = { ...LONE_CANDIDATE, "prd-billing.md": "# billing\n" };

/**
 * C-4⁗″ (PRDR-200): a slice's review is DRAWN `PLAN_REVIEW_SAMPLES` times.
 *
 * These sequences are about ORDER and REUSE — which slices re-plan when a
 * document moves — not about how many times the reviewer is asked. Expanding
 * the expectation keeps the assertion exact rather than collapsing repeats,
 * which would hide the sampling stopping.
 */
const R = (slice: string): string[] => Array.from({ length: PLAN_REVIEW_SAMPLES }, () => `REVIEW:slice:${slice}`);

describe("C-2‴ the product is planned slice by slice, to the end, without stopping", () => {
  it("plans each slice with the earlier index in view, and writes slice order into the blockers", async () => {
    const root = repo(DOCS);
    const log: string[] = [];
    const seen: Record<string, unknown>[] = [];
    const backend = new MockBackend({ audit: CLEAN_AUDIT, planner: scriptedPlanner({ draft: twoSliceDraft, review: () => APPROVE_PLAN }, log, seen) });
    const result = await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    expect(result.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
    /** Every slice in turn, each reviewed as its own plan; no session reads the plan as one thing (PRDR-293). */
    expect(log).toEqual(["SLICE", "PLAN:s01", ...R("s01"), "PLAN:s02", ...R("s02")]);
    /** The later slice drafts with the earlier slice's tickets in view, and the slice review with the same index. */
    const s02Draft = seen.find((i) => i["stage"] === "PLAN" && sliceOf(i) === "s02")!;
    expect(s02Draft["plan_index"]).toEqual([
      { id: "t-s01-001", title: "t t-s01-001", surface: ["src/**"], provides: [] },
      { id: "t-s01-002", title: "t t-s01-002", surface: ["src/**"], provides: [] },
    ]);
    expect(s02Draft["docs"]).toEqual(["prd-billing.md"]);
    const s01Draft = seen.find((i) => i["stage"] === "PLAN" && sliceOf(i) === "s01")!;
    expect((s01Draft["production_baseline"] as { id: string }[]).map((b) => b.id)).toEqual(["PB-001"]);

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
    /** C-3⁗, C-4⁵: no planning stage asks, so nothing reaches PRESENT as a question. */
    expect(message).not.toContain("Open questions");
  });

  it("C-2⁗: SLICE receives the production baseline unless the config opts out", async () => {
    for (const baseline of ["production", "none"] as const) {
      const root = repo(DOCS);
      const seen: Record<string, unknown>[] = [];
      const backend = new MockBackend({ audit: CLEAN_AUDIT,  planner: scriptedPlanner({ draft: twoSliceDraft, review: () => APPROVE_PLAN }, [], seen) });
      await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS, planBaseline: baseline }));
      const slice = seen.find((i) => i["stage"] === "SLICE")!;
      expect((slice["production_baseline"] as unknown[]).length).toBe(baseline === "production" ? PRODUCTION_BASELINE.length : 0);
    }
  });

  it("the draft's ids and edges are normalised, not trusted: a colliding id is renamed, an edge to nothing planned becomes a dependency finding", () => {
    const slice: SliceSpec = { id: "s02", title: "billing", goal: "g", requirement_ids: [], baseline_items: [], docs: [], depends_on: ["s01"], rationale: "" };
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
    const slice: SliceSpec = { id: "s02", title: "billing", goal: "g", requirement_ids: [], baseline_items: [], docs: [], depends_on: [], rationale: "" };
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

  it("a finding a slice's own review still holds after its revision reaches the presentation", async () => {
    const root = repo(DOCS);
    const held = { tag: "sizing", ticket: "t-s01-002", finding: "still larger than one session after the revision" };
    const backend = new MockBackend({ audit: CLEAN_AUDIT, 
      planner: scriptedPlanner(
        {
          slices: { schema_version: SCHEMA_VERSION, slices: [TWO_SLICES.slices[0]!] },
          draft: twoSliceDraft,
          review: () => ({ schema_version: SCHEMA_VERSION, verdict: "changes", findings: [held] }),
        },
        [],
      ),
    });
    const result = await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    /** The slice's own leftover is the only finding there is. */
    expect(result.interrupt?.message).toContain("Review findings held after revision (1)");
    expect(result.interrupt?.message).toContain("sizing (t-s01-002): still larger than one session");
  });

  it("a dependency dropped as impossible is presented as a finding, not swallowed", async () => {
    const root = repo(DOCS);
    const backend = new MockBackend({ audit: CLEAN_AUDIT, 
      planner: scriptedPlanner(
        {
          slices: { schema_version: SCHEMA_VERSION, slices: [TWO_SLICES.slices[0]!] },
          draft: () => ({ schema_version: SCHEMA_VERSION, tickets: [ticket("t-s01-001", ["t-s99-001"])] }),
          review: () => APPROVE_PLAN,
        },
        [],
      ),
    });
    const result = await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    expect(readTicket(root, "t-s01-001").blockers).toEqual([]);
    expect(result.interrupt?.message).toContain("dependency (t-s01-001)");
    expect(result.interrupt?.message).toContain("t-s99-001");
  });

  it("a slice naming a document nothing discovered is grounded, not planned from an empty desk", async () => {
    const root = repo(DOCS);
    const notes: string[] = [];
    const seen: Record<string, unknown>[] = [];
    const backend = new MockBackend({ audit: CLEAN_AUDIT, 
      planner: scriptedPlanner(
        {
          slices: {
            schema_version: SCHEMA_VERSION,
            slices: [{ ...TWO_SLICES.slices[0]!, docs: ["docs/imagined.md"], baseline_items: ["PB-001", "PB-404"] }],
          },
          draft: () => ({ schema_version: SCHEMA_VERSION, tickets: [ticket("t-s01-001")] }),
          review: () => APPROVE_PLAN,
        },
        [],
        seen,
      ),
    });
    await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS, note: (t) => notes.push(t) }));

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
   * keys below are the question sources it does read, and the shapes are the
   * ones that were observed to throw. There were three sources until PRDR-290
   * folded ANALYZE into DECIDE; its `open_questions` cases moved to SLICE's
   * `questions`, so they still reach a key the builder reads.
   */
  const FOREIGN: Record<string, Record<string, unknown>>[] = [
    {},
    { PLAN: {} },
    { PLAN: { plan: null } },
    { PLAN: { plan: { slices: "not an array" } } },
    { SLICE: { slices: [] }, PLAN: { plan: { slices: [] } } },
    { SLICE: { questions: "not an array" } },
    { PLAN: { questions: "not an array" } },
    { SLICE: { questions: [null] } },
    { SLICE: { questions: [{}] } },
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
    /* C-4⁵ (PRDR-292): the field PLAN's spec defects arrive in, the container and its elements, down to a passage. */
    { PLAN: { spec_defects: "not an array" } },
    { PLAN: { spec_defects: [null, 7, { slice: "s01" }, { slice: "s01", kind: "gap", defect: "d", passages: [null] }] } },
  ];

  /**
   * PRDR-119, on the builder alone. No planning stage asks since C-4⁵, so no
   * pipeline reaches it any more; what PRESENT still reads of `questions` is
   * held to what it did while one could.
   */
  it("two stages that number their questions alike reach the human under distinct ids", () => {
    const q = (id: string, question: string) => ({ id, question, blocking: false, assumption: "" });
    const built = presentInputsFromOutputs({
      SLICE: { questions: [q("s01-q1", "Which Cloudflare zone?")] },
      PLAN: { questions: [q("s01-q1", "Which payment rail serves the USD tier?"), q("s01-q1", "What is the trial credit amount?")] },
    });
    const ids = (built.questions ?? []).map((x) => x.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size, `ids must be unique, got ${ids.join(", ")}`).toBe(3);
  });

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

/**
 * PRDR-193 — the free check runs before the paid one.
 *
 * `applyContracts` is deterministic and costs nothing, and it ran after the
 * largest paid prompt `init` built, so that session rediscovered what code
 * proves. Observed live on gate-312, where the whole-plan review found
 * `t-s02-003 consumes a name no ticket provides`, cited the mechanical checker
 * by ticket id, wrote that such defects "should be corrected rather than
 * discovered by it", and then paid again to redraft the slice. PRDR-293 took
 * the rest of the way: the checks run on each draft before its review, and
 * what they prove goes straight to a redraft, with no session paid to confirm
 * it.
 */
describe("PRDR-193 code proves what it can before a session is paid to look", () => {
  /** s02's ticket leans on a name nothing in the plan owns, on its first draft. */
  const unprovidedDraft = (inputs: Record<string, unknown>): object =>
    sliceOf(inputs) === "s01"
      ? twoSliceDraft(inputs)
      : {
          schema_version: SCHEMA_VERSION,
          tickets: [{ ...ticket("t-s02-001"), requirement_ids: ["R2"], consumes: [{ kind: "symbol", id: "pkg/thing.Nobody" }] }],
        };

  it("sends what code proves to a redraft before any review is paid to read the draft", async () => {
    const root = repo(DOCS);
    const log: string[] = [];
    let s02 = 0;
    const draft = (inputs: Record<string, unknown>): object => {
      if (sliceOf(inputs) !== "s02") return twoSliceDraft(inputs);
      s02 += 1;
      return s02 === 1 ? unprovidedDraft(inputs) : twoSliceDraft(inputs);
    };
    const backend = new MockBackend({ audit: CLEAN_AUDIT, planner: scriptedPlanner({ draft, review: () => APPROVE_PLAN }, log) });
    const result = await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    expect(log).toEqual(["SLICE", "PLAN:s01", ...R("s01"), "PLAN:s02", "PLAN:s02", ...R("s02")]);
    expect(result.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
  });
});

/**
 * PRDR-194 — progress and commentary are different channels.
 *
 * The marker PRDR-190 added was fed from `note`, on the reasoning that what the
 * operator was last told is what was in flight. It is not: `note` also carries
 * review verdicts, reuse status and warnings. A live SIGTERM on gate-312 duly
 * recorded X-1⁵'s advisory spend announcement as the run's activity, when it was
 * re-running the whole-plan review.
 */
describe("PRDR-194 the phase marker is fed by progress, not by every note", () => {
  it("reports where work begins, and never a verdict or a warning", async () => {
    const root = repo(DOCS);
    const notes: string[] = [];
    const progress: string[] = [];
    let s01 = 0;
    /* s01's first draft consumes a name nobody provides, so a redraft is sent: work that begins, with a note beside it. */
    const draft = (inputs: Record<string, unknown>): object => {
      const drafted = twoSliceDraft(inputs) as { tickets: Record<string, unknown>[] };
      if (sliceOf(inputs) !== "s01" || (s01 += 1) > 1) return drafted;
      return { ...drafted, tickets: drafted.tickets.map((t) => ({ ...t, consumes: [{ kind: "config", id: "NOPE" }] })) };
    };
    const backend = new MockBackend({ audit: CLEAN_AUDIT, planner: scriptedPlanner({ draft, review: () => APPROVE_PLAN }, []) });
    await runInit(
      root,
      planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS, note: (t) => notes.push(t), progress: (t) => progress.push(t) }),
      { progress: (t) => progress.push(t) },
    );

    /* Where work begins: the phases, the slices, the redraft. */
    const said = progress.join("\n");
    expect(said).toContain("PLAN");
    expect(said).toMatch(/planning s01/);
    expect(said).toContain("redrafting s01 skeleton for the checks");

    /* And never the commentary `note` carries. */
    expect(said).not.toMatch(/check\(s\)/);
    expect(said).not.toMatch(/review:/);
    expect(notes.join("\n")).toMatch(/its draft fails \d+ check\(s\)/);
  });
});

/**
 * PRDR-196 criterion 3 — whether revision fixes what it was given.
 *
 * Counts alone cannot answer it. This run's revision rounds ended with MORE
 * findings than they started on 11 slices of 19, and that is equally consistent
 * with "the revision introduced defects" and with "a fresh review of rewritten
 * text found fresh, partly spurious things". The literature says the critic is
 * the likelier culprit, which makes the distinction the whole question.
 *
 * Identity is `(ticket, tag)`. Finding TEXT is rewritten every round so it
 * cannot key anything, and the pair is what a reader means by "the same
 * complaint about the same ticket".
 */
describe("PRDR-196 the revision round is measured, not assumed", () => {
  /**
   * Through the real pipeline. `revisionOutcome` computing correctly and never
   * being called is the shape that has broken four times on this line today —
   * PRDR-191's breaker ceilings, PRDR-194's progress seam, PRDR-166's globs,
   * and PRDR-193's own wiring. A measurement nothing runs measures nothing.
   */
  it("is recorded by the run, not merely computable", async () => {
    const root = repo(DOCS);
    const notes: string[] = [];
    const backend = new MockBackend({ audit: CLEAN_AUDIT, 
      planner: scriptedPlanner(
        {
          draft: twoSliceDraft,
          /* A slice review that faults something forces the revision round. */
          review: () => ({ schema_version: SCHEMA_VERSION, verdict: "changes", findings: [{ tag: "sizing", ticket: "t-s01-001", finding: "too big" }] }),
        },
        [],
      ),
    });
    const result = await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS, note: (t) => notes.push(t) }));
    expect(notes.join("\n")).toMatch(/revision: \d+ resolved, \d+ survived, \d+ introduced/);
    /**
     * And it reaches the operator. Measuring into a cache nobody reads is the
     * defect this ticket is about; the audit of the ticket found exactly that
     * and this assertion is what closes it.
     */
    expect(result.interrupt?.message ?? "").toMatch(/Revision rounds: \d+ finding\(s\) resolved/);
  });

  /**
   * PRDR-196 criterion 1, through the REAL pipeline.
   *
   * The hop that carries what code proves to PRESENT is its own surface, and
   * it is the one that broke five times on this line. PRDR-293: PRESENT proves
   * it again from the tickets as written, and holds approval on it.
   */
  it("carries what the checks prove all the way to what PRESENT prints", async () => {
    const root = repo(DOCS);
    /* s02's ticket leans on a name no ticket in the plan owns, in every draft — a failure code proves. */
    const unprovided = (inputs: Record<string, unknown>): object =>
      sliceOf(inputs) === "s01"
        ? twoSliceDraft(inputs)
        : {
            schema_version: SCHEMA_VERSION,
            tickets: [{ ...ticket("t-s02-001"), requirement_ids: ["R2"], consumes: [{ kind: "symbol", id: "pkg/thing.Nobody" }] }],
          };
    const backend = new MockBackend({ audit: CLEAN_AUDIT, 
      planner: scriptedPlanner({ draft: unprovided, review: () => APPROVE_PLAN }, []),
    });
    const result = await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    expect(result.interrupt?.interrupt).toBe("AWAIT_INFO");
    const message = result.interrupt?.message ?? "";
    expect(message).toMatch(/Checks that still fail/i);
    expect(message).toContain("pkg/thing.Nobody");
    expect(message).toContain("proved by code");
  });

  /** A finding naming no ticket belongs to the plan; it cannot be matched, so it is not counted as survival. */
  it("does not pretend an unticketed finding is the same complaint twice", () => {
    const before = [{ tag: "coherence" as const, finding: "the plan double-books a name" }];
    const after = [{ tag: "coherence" as const, finding: "a different plan-wide worry" }];
    expect(revisionOutcome(before, after).survived).toBe(0);
  });
});
