import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkpointPath } from "../../src/fs/checkpoints.js";
import { stateDir } from "../../src/fs/layout.js";
import { runInit, sliceCacheDir } from "../../src/init/machine.js";
import { readPresentation } from "../../src/init/present.js";
import { planningSessions } from "../../src/init/slice.js";
import { readPlanFindings } from "../../src/kernel/plan-findings.js";
import { migrateState } from "../../src/kernel/migrate.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { planReviewSchema } from "../../src/schemas/init.js";
import { DEFAULT_EFFORT_ROUTING, DEFAULT_MODEL_ROUTING, READ_ONLY_ROLES, ROLE_IDS, promptOf } from "../../src/schemas/roles.js";
import { READ_ONLY_STAGES, toolsForRole } from "../../src/sessions/guard.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree } from "../helpers.js";
import { makeRunRepo } from "../kernel/run-fixture.js";
import { CONFORMING_PACK } from "./pack-fixture.js";
import { BUDGETS, CLEAN_AUDIT, PROMPTS, planning, planningPipeline, repo } from "./plan-fixture.js";
import { draft as covering, seeded, type Json } from "./seed-fixture.js";
import { DOCS, MockBackend, inputsOf, scriptedPlanner, sliceOf, ticket, twoSliceDraft } from "./slicing-fixture.js";

/**
 * PRDR-294 — one review read, by the `plan_review` role (C-4⁶, built as C-4⁸).
 *
 * The review ran as the drafter: its role, model and effort, three reads a
 * slice, a revision, three more reads. In the runs that built ksar-cloud's
 * plan it cost 78% of planning and never wrote `approve`. Each slice now gets
 * one read, graded by severity, on a role of its own; a blocker or major buys
 * one revision that nothing reads again, and minors go to the sessions that
 * run their tickets.
 */

const MAJOR = {
  severity: "major",
  tag: "sizing",
  ticket: "t-s01-001",
  finding: "t-s01-001 builds the parser and the store, two sessions' work",
  fix: "split the store into its own ticket that depends on t-s01-001",
};
const MINOR = {
  severity: "minor",
  tag: "coherence",
  ticket: "t-s01-002",
  finding: "t-s01-002's title names a store its description never mentions",
  fix: "name the store in the description",
};
const verdict = (findings: readonly object[], word?: string): object => ({
  schema_version: SCHEMA_VERSION,
  verdict: word ?? (findings.some((f) => ["blocker", "major"].includes((f as { severity?: string }).severity ?? "")) ? "changes" : "approve"),
  findings,
});
const APPROVE = verdict([]);

interface Planned {
  readonly root: string;
  readonly backend: MockBackend;
  readonly log: string[];
  readonly seen: Record<string, unknown>[];
  readonly notes: string[];
  readonly outcome: Awaited<ReturnType<typeof runInit>>;
}

async function plan(review: (inputs: Record<string, unknown>) => object, draft: (inputs: Record<string, unknown>) => object = twoSliceDraft): Promise<Planned> {
  const root = repo(DOCS);
  const log: string[] = [];
  const seen: Record<string, unknown>[] = [];
  const notes: string[] = [];
  const backend = new MockBackend({ audit: CLEAN_AUDIT, ...planning(scriptedPlanner({ draft, review }, log, seen)) });
  const outcome = await runInit(
    root,
    planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS, modelRouting: DEFAULT_MODEL_ROUTING, effortRouting: DEFAULT_EFFORT_ROUTING, note: (t) => notes.push(t) }),
  );
  return { root, backend, log, seen, notes, outcome };
}

/** Whichever review a slice's inputs ask for; the rest approve. */
const reviewing =
  (bySlice: Readonly<Record<string, object>>) =>
  (inputs: Record<string, unknown>): object =>
    bySlice[sliceOf(inputs)] ?? APPROVE;

const planOutputs = (root: string): Record<string, unknown> =>
  (JSON.parse(readFileSync(checkpointPath(root, "PLAN"), "utf8")) as { outputs: Record<string, unknown> }).outputs;

/** The launches that served one slice, drafts and reads alike, in order. */
const sessionsOf = (p: Planned, slice: string): string[] => p.log.filter((l) => l.endsWith(`:${slice}`));
const reviewCalls = (p: Planned) => p.backend.calls.filter((c) => c.role === "plan_review");

describe("PRDR-294: the plan_review role (S-1‴, C-4⁶)", () => {
  it("is a role of its own, routed to the planner's seat: claude-opus-5 at max (planning decision 9)", () => {
    expect(ROLE_IDS as readonly string[]).toContain("plan_review");
    expect((DEFAULT_MODEL_ROUTING as Readonly<Record<string, string>>)["plan_review"]).toBe("claude-opus-5");
    expect((DEFAULT_EFFORT_ROUTING as Readonly<Record<string, string>>)["plan_review"]).toBe("max");
    expect((DEFAULT_MODEL_ROUTING as Readonly<Record<string, string>>)["plan_review"]).toBe(DEFAULT_MODEL_ROUTING.planner);
  });

  it("reads its own prompt, and a planner session is no longer handed the review's", () => {
    expect(promptOf("plan_review", undefined)).toBe("plan_review");
    expect(() => promptOf("planner", "REVIEW_PLAN")).toThrow(/only SLICE and PLAN have a prompt/u);
  });

  it("is read-only, with no stop gate and no tool that writes code (S-1′)", () => {
    expect((READ_ONLY_ROLES as ReadonlySet<string>).has("plan_review")).toBe(true);
    expect(READ_ONLY_STAGES.has("plan_review")).toBe(true);
    expect(toolsForRole("plan_review").some((t) => t.startsWith("Bash") || t.startsWith("Edit"))).toBe(false);
  });

  it("each review session runs on the role, its prompt, its model and its effort, with a planner session's tools", async () => {
    const p = await plan(() => APPROVE);
    const reads = reviewCalls(p);
    expect(reads.map((c) => sliceOf(inputsOf(c.spec)))).toEqual(["s01", "s02"]);
    for (const c of reads) {
      expect(c.spec.model).toBe("claude-opus-5");
      expect(c.spec.effort).toBe("max");
      expect(c.spec.promptPrefix).toContain(PROMPTS.prompts.plan_review);
      expect(c.spec.tools).toEqual(["Read", "Grep", "Glob", "Write"]);
    }
    expect(p.backend.calls.filter((c) => c.role === "planner").every((c) => !c.spec.artifactOut.endsWith("plan-review.json"))).toBe(true);
  });
});

describe("PRDR-294: what a review reads and writes (C-4⁶)", () => {
  it("a finding carries its severity, one of the four tags, its ticket and its fix", () => {
    const of = (finding: object) => planReviewSchema.safeParse({ schema_version: SCHEMA_VERSION, verdict: "changes", findings: [finding] }).success;
    expect(of(MAJOR)).toBe(true);
    expect(of({ ...MAJOR, severity: "blocker" })).toBe(true);
    expect(of(MINOR)).toBe(true);
    const without = (key: keyof typeof MAJOR): object => Object.fromEntries(Object.entries(MAJOR).filter(([k]) => k !== key));
    expect(of(without("severity")), "no severity").toBe(false);
    expect(of(without("fix")), "no fix").toBe(false);
    expect(of(without("ticket")), "no ticket").toBe(false);
    for (const tag of ["coverage", "traceability", "testability", "boundaries"]) expect(of({ ...MAJOR, tag }), tag).toBe(false);
  });

  it("the prompt grades by severity and names the four tags alone: coverage, traceability and contracts are code's", () => {
    const text = PROMPTS.prompts.plan_review;
    for (const word of ["`blocker`", "`major`", "`minor`", "`sizing`", "`shape`", "`dependency`", "`coherence`", "`fix`"]) expect(text, word).toContain(word);
    for (const tag of ["`coverage`", "`traceability`", "`testability`", "`boundaries`"]) expect(text, tag).not.toContain(tag);
  });

  it("the read is told the shape it writes, a severity and a fix on every finding, and how to grade what it finds", async () => {
    const p = await plan(() => APPROVE);
    const inputs = inputsOf(reviewCalls(p)[0]!.spec);
    const shape = (inputs["expected_output"] as { findings: Record<string, unknown>[] }).findings[0]!;
    expect(Object.keys(shape).sort()).toEqual(["finding", "fix", "severity", "tag", "ticket"]);
    /* The instruction restates the prompt in its own words (PRDR-292): the four tags, the grades, the fix and the verdict rule. */
    const instruction = String(inputs["instruction"]);
    for (const word of ["`sizing`", "`shape`", "`dependency`", "`coherence`", "`blocker`", "`major`", "`minor`", "`fix`", "`approve`"]) expect(instruction, word).toContain(word);
  });
});

describe("PRDR-294: one read a slice, one revision for a blocker or major (C-4⁶)", () => {
  it("a clean draft is read once, approved, and never revised: two sessions for the slice", async () => {
    const p = await plan(() => APPROVE);
    expect(sessionsOf(p, "s01")).toEqual(["PLAN:s01", "REVIEW:slice:s01"]);
    expect(sessionsOf(p, "s02")).toEqual(["PLAN:s02", "REVIEW:slice:s02"]);
    expect(p.outcome.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
  });

  it("minors alone are an approval, whatever word the model wrote, and each reaches its ticket's sessions (PRDR-271)", async () => {
    const p = await plan(reviewing({ s01: verdict([MINOR], "changes") }));
    expect(sessionsOf(p, "s01")).toEqual(["PLAN:s01", "REVIEW:slice:s01"]);
    expect(p.notes.some((n) => /s01.*`changes`.*approve/u.test(n)), p.notes.join("\n")).toBe(true);
    const findings = readPlanFindings(p.root, "t-s01-002");
    expect(findings).toEqual([expect.objectContaining({ severity: "minor", tag: "coherence", finding: MINOR.finding, fix: MINOR.fix })]);
  });

  it("a major buys one revision, handed the draft it read and the major alone, and nothing reads the revision: three sessions", async () => {
    const p = await plan(reviewing({ s01: verdict([MAJOR, MINOR]) }));
    expect(sessionsOf(p, "s01")).toEqual(["PLAN:s01", "REVIEW:slice:s01", "PLAN:s01"]);
    expect(reviewCalls(p)).toHaveLength(2);
    const revision = p.seen.filter((i) => i["stage"] === "PLAN" && sliceOf(i) === "s01")[1]!;
    expect(revision["review_findings"]).toEqual([MAJOR]);
    expect((revision["draft"] as { id: string }[]).map((t) => t.id)).toEqual(["t-s01-001", "t-s01-002"]);
    expect(revision["check_failures"]).toBeUndefined();
  });

  it("a blocker is a revision too, and a slice's majors and blockers are the operator's risks, not a run session's", async () => {
    const BLOCKER = { ...MAJOR, severity: "blocker", tag: "shape", finding: "the slice finishes its store before anything runs end to end" };
    const p = await plan(reviewing({ s01: verdict([BLOCKER, MINOR]) }));
    expect(sessionsOf(p, "s01")).toHaveLength(3);
    expect(planOutputs(p.root)["review_risks"]).toEqual([{ slice: "s01", ...BLOCKER }]);
    expect(readPlanFindings(p.root, "t-s01-001"), "a blocker went to a revision, not to the run").toBeNull();
    expect(readPlanFindings(p.root, "t-s01-002")).toEqual([expect.objectContaining({ severity: "minor" })]);
    const text = readPresentation(p.root)?.presentation ?? "";
    expect(text).toContain(BLOCKER.finding);
    expect(text).toContain(BLOCKER.fix);
  });

  it("the checks run on the revision, and a revision they send back is redrafted, never reviewed", async () => {
    let s01Drafts = 0;
    const draft = (inputs: Record<string, unknown>): object => {
      if (sliceOf(inputs) !== "s01") return twoSliceDraft(inputs);
      s01Drafts += 1;
      /* The revision forgets R1; the redraft the checks send restores it. */
      if (s01Drafts !== 2) return twoSliceDraft(inputs);
      return { schema_version: SCHEMA_VERSION, tickets: [ticket("t-s01-001"), { ...ticket("t-s01-002", ["t-s01-001"]), baseline_ids: ["PB-001"] }] };
    };
    const p = await plan(reviewing({ s01: verdict([MAJOR]) }), draft);
    expect(sessionsOf(p, "s01")).toEqual(["PLAN:s01", "REVIEW:slice:s01", "PLAN:s01", "PLAN:s01"]);
    const redraft = p.seen.filter((i) => i["stage"] === "PLAN" && sliceOf(i) === "s01")[2]!;
    expect(JSON.stringify(redraft["check_failures"])).toMatch(/R1/u);
    expect(p.outcome.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
  });

  it("a revision that still fails the checks after its redraft is discarded, and the draft the review read stands", async () => {
    const reviewed = { ...ticket("t-s01-001"), title: "the draft the review read", requirement_ids: ["R1"] };
    let s01Drafts = 0;
    const draft = (inputs: Record<string, unknown>): object => {
      if (sliceOf(inputs) !== "s01") return twoSliceDraft(inputs);
      s01Drafts += 1;
      if (s01Drafts === 1) return { schema_version: SCHEMA_VERSION, tickets: [reviewed, { ...ticket("t-s01-002", ["t-s01-001"]), baseline_ids: ["PB-001"] }] };
      return { schema_version: SCHEMA_VERSION, tickets: [ticket("t-s01-001"), { ...ticket("t-s01-002", ["t-s01-001"]), baseline_ids: ["PB-001"] }] };
    };
    const p = await plan(reviewing({ s01: verdict([MAJOR]) }), draft);
    expect(sessionsOf(p, "s01")).toEqual(["PLAN:s01", "REVIEW:slice:s01", "PLAN:s01", "PLAN:s01"]);
    const written = JSON.parse(readFileSync(path.join(stateDir(p.root), "plan", "t-s01-001.json"), "utf8")) as { title: string };
    expect(written.title).toBe("the draft the review read");
    expect(p.notes.some((n) => /s01.*revision.*discarded/u.test(n)), p.notes.join("\n")).toBe(true);
    expect(planOutputs(p.root)["review_risks"]).toEqual([{ slice: "s01", ...MAJOR }]);
    expect(p.outcome.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
    /* What the revision's redraft was sent is not the standing draft's, so the checks across the plan may still send it (A-1⁷). */
    const cache = JSON.parse(readFileSync(path.join(sliceCacheDir(p.root), "s01.json"), "utf8")) as { sent: string[] };
    expect(cache.sent).toEqual([]);
  });

  it("what code repaired in a revision is recorded, as a draft's repairs are (A-1″)", async () => {
    let s01Drafts = 0;
    const draft = (inputs: Record<string, unknown>): object => {
      if (sliceOf(inputs) !== "s01") return twoSliceDraft(inputs);
      s01Drafts += 1;
      const drafted = twoSliceDraft(inputs) as { tickets: Record<string, unknown>[] };
      if (s01Drafts !== 2) return drafted;
      /* The revision names a ticket no slice plans: code drops the edge and records that it did. */
      return { ...drafted, tickets: drafted.tickets.map((t) => (t["id"] === "t-s01-002" ? { ...t, depends_on: ["t-s01-001", "t-s99-999"] } : t)) };
    };
    const p = await plan(reviewing({ s01: verdict([MAJOR]) }), draft);
    expect(sessionsOf(p, "s01")).toEqual(["PLAN:s01", "REVIEW:slice:s01", "PLAN:s01"]);
    expect(readPlanFindings(p.root, "t-s01-002")).toEqual([expect.objectContaining({ tag: "dependency", finding: expect.stringContaining("t-s99-999") as unknown })]);
    expect(readPresentation(p.root)?.presentation ?? "").toContain("What code did to the drafts (1)");
  });

  it("a slice reused from its cache keeps what its read left: its risks and its minors (C-8)", async () => {
    const root = repo(DOCS);
    const log: string[] = [];
    const run = async (): Promise<void> => {
      const backend = new MockBackend({ audit: CLEAN_AUDIT, ...planning(scriptedPlanner({ draft: twoSliceDraft, review: reviewing({ s01: verdict([MAJOR, MINOR]) }) }, log)) });
      await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));
    };
    await run();
    /* s02 plans from this document, so an edit to it plans s02 again and reuses s01. */
    writeFileSync(path.join(root, "prd-billing.md"), "# billing, edited\n");
    log.splice(0);
    await run();
    expect(log).toContain("PLAN:s02");
    expect(log, "s01 was reused, and read no more").not.toContain("REVIEW:slice:s01");
    expect(planOutputs(root)["review_risks"]).toEqual([{ slice: "s01", ...MAJOR }]);
    expect(readPlanFindings(root, "t-s01-002")).toEqual([expect.objectContaining({ severity: "minor", fix: MINOR.fix })]);
  });

  it("a draft the checks still fail after its redraft is not read, and PRESENT names the slice unreviewed", async () => {
    const draft = (inputs: Record<string, unknown>): object =>
      sliceOf(inputs) === "s01"
        ? { schema_version: SCHEMA_VERSION, tickets: [ticket("t-s01-001"), { ...ticket("t-s01-002", ["t-s01-001"]), baseline_ids: ["PB-001"] }] }
        : twoSliceDraft(inputs);
    const p = await plan(() => APPROVE, draft);
    expect(sessionsOf(p, "s01")).toEqual(["PLAN:s01", "PLAN:s01"]);
    expect(sessionsOf(p, "s02")).toEqual(["PLAN:s02", "REVIEW:slice:s02"]);
    expect(planOutputs(p.root)["unreviewed"]).toEqual([{ slice: "s01", reason: expect.stringMatching(/fails 1 check/u) as unknown }]);
    expect(readPresentation(p.root)?.presentation ?? "").toMatch(/s01[^\n]*not reviewed|not reviewed[^\n]*s01/u);
  });

  it("each slice's verdict is kept under its own slice, where the next slice's read cannot remove it (PRDR-260)", async () => {
    const p = await plan((inputs) => verdict([{ ...MINOR, ticket: `t-${sliceOf(inputs)}-002`, finding: `${sliceOf(inputs)}'s own read` }]));
    for (const slice of ["s01", "s02"]) {
      const file = path.join(stateDir(p.root), "state", "slices", slice, "plan-review.json");
      expect(readFileSync(file, "utf8"), slice).toContain(`${slice}'s own read`);
    }
  });

  it("SLICE announces 2N + R + C: a draft and one read a slice, a session per revision, one per redraft", () => {
    expect(planningSessions(3)).toMatch(/at least 6 planning sessions, 2N \+ R \+ C/u);
    expect(planningSessions(1)).toMatch(/1 slice takes at least 2 planning sessions/u);
  });
});

describe("PRDR-294: what the loop was measured by is gone (C-4⁶)", () => {
  it("the sampling, the churn and null lines, the held labels and the advice file are deleted", async () => {
    for (const file of ["plan-sample.ts", "plan-signal.ts", "plan-notes.ts", "present-advice.ts"]) {
      expect(existsSync(path.join(process.cwd(), "src", "init", file)), file).toBe(false);
    }
    const many = Array.from({ length: 14 }, (_, i) => ({ ...MINOR, finding: `${MINOR.finding} (${String(i)})` }));
    const p = await plan(reviewing({ s01: verdict([MAJOR, ...many]) }));
    const outputs = planOutputs(p.root);
    expect(outputs["revision_summary"]).toBeUndefined();
    expect(outputs["churn_summary"]).toBeUndefined();
    for (const f of outputs["review_findings"] as Record<string, unknown>[]) {
      expect(Object.keys(f).filter((k) => ["held", "seen", "seen_before", "seen_after"].includes(k)), JSON.stringify(f)).toEqual([]);
    }
    expect(existsSync(path.join(stateDir(p.root), "state", "advice.md"))).toBe(false);
    expect(readPresentation(p.root)?.presentation ?? "").not.toMatch(/Revision rounds|repeated reads/u);
  });
});

describe("PRDR-294: an existing config routes the review where its planner sits (F-3″)", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  async function olderConfig(routing: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { root } = await makeRunRepo();
    cleanups.push(() => removeTree(root));
    const file = path.join(stateDir(root), "config.json");
    const config = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    delete config["model_routing"];
    delete config["effort_routing"];
    writeFileSync(file, `${JSON.stringify({ ...config, ...routing, schema_version: SCHEMA_VERSION - 1 }, null, 2)}\n`);
    migrateState(root, { promptHashes: loadPromptSet().hashes });
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  }

  it("a config that routes its planner gives the review the same seat, model and effort", async () => {
    const config = await olderConfig({ model_routing: { planner: "claude-fable-5-1" }, effort_routing: { planner: "high" } });
    expect((config["model_routing"] as Record<string, string>)["plan_review"]).toBe("claude-fable-5-1");
    expect((config["effort_routing"] as Record<string, string>)["plan_review"]).toBe("high");
  });

  it("a config that routes no planner gives it the planner's default seat, and one that routes the review keeps it", async () => {
    const none = await olderConfig({});
    expect((none["model_routing"] as Record<string, string>)["plan_review"]).toBe("claude-opus-5");
    expect((none["effort_routing"] as Record<string, string>)["plan_review"]).toBe("max");
    const own = await olderConfig({ model_routing: { planner: "claude-fable-5-1", plan_review: "claude-sonnet-5" }, effort_routing: {} });
    expect((own["model_routing"] as Record<string, string>)["plan_review"]).toBe("claude-sonnet-5");
  });
});

/**
 * C-4⁸ (PRDR-294): what the read is handed. `coherence` is judged against what
 * the draft was planned from, so the read gets the slice's records on a pack,
 * as its draft did, and the slice's documents without one. It gets nothing
 * code proved, which is code's to send to a redraft, and no spec defect, which
 * is the operator's at PRESENT.
 */
describe("PRDR-294: the read is handed what its draft was planned from, and nothing code proved", () => {
  const reads = (inputs: readonly Json[]): Json[] => inputs.filter((i) => i["stage"] === "REVIEW_PLAN");
  const draftOf = (inputs: readonly Json[], read: Json): Json | undefined => inputs.find((i) => i["stage"] === "PLAN" && sliceOf(i) === sliceOf(read));

  it("on a pack, the slice's records as its draft was handed them, no documents, and not the failures its redraft was sent", async () => {
    /* s01's first draft consumes a name nobody provides, so the checks send it a redraft before the read. */
    const failing = (inputs: Json): Json => {
      const d = covering(inputs) as { tickets: Json[] };
      return { ...d, tickets: [{ ...d.tickets[0], consumes: [{ kind: "config", id: "NOPE" }] }] };
    };
    const s = seeded(CONFORMING_PACK, { draft: (take, inputs) => (sliceOf(inputs) === "s01" && take === 1 ? failing(inputs) : covering(inputs)) });
    await s.init();
    expect(s.inputs.some((i) => i["stage"] === "PLAN" && "check_failures" in i), "a redraft was sent, so there was something to hand").toBe(true);
    expect(reads(s.inputs).length).toBeGreaterThan(0);
    for (const read of reads(s.inputs)) {
      expect(read["records"], sliceOf(read)).toEqual(draftOf(s.inputs, read)?.["records"]);
      for (const key of ["docs", "check_failures", "spec_defects", "already_found", "review_findings", "draft"]) expect(read, `${sliceOf(read)} ${key}`).not.toHaveProperty(key);
    }
  });

  it("without a pack, the documents its draft was planned from", async () => {
    const p = await plan(() => APPROVE);
    expect(reads(p.seen)).toHaveLength(2);
    for (const read of reads(p.seen)) {
      expect(read["docs"], sliceOf(read)).toEqual(draftOf(p.seen, read)?.["docs"]);
      expect(read).not.toHaveProperty("records");
    }
  });
});
