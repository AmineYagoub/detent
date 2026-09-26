import { readFileSync, writeFileSync } from "node:fs";
import { newTicket, writeTicket } from "../../src/kernel/tickets/mutations.js";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { analysisSchema } from "../../src/schemas/init.js";
import { withDecidedStack } from "../../src/init/analyze.js";
import { decisionLogFile } from "../../src/init/decide-log.js";
import { presentInputsFromOutputs, renderPresentation } from "../../src/init/present.js";
import { readBindings } from "../../src/adapter/drift.js";
import { DECISION_LOG_PATH } from "../../src/schemas/pack.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { ANALYSIS, LONE_CANDIDATE, repo } from "./plan-fixture.js";
import { DOCS, LATE, REFUND, SORTED, SURVEY, TS_STACK, artifact, auditFinds, decide, initThrough, type Json } from "./decide-fixture.js";
import { R, TWO_SLICES, scriptedPlanner, twoSliceDraft } from "./slicing-fixture.js";

/**
 * PRDR-282 — what the planning phases do with what DECIDE settled (C-3⁗,
 * D-10′, C-2¹²): PRESENT lists every vetoable default and names a question the
 * log answers rather than asking it; every slice plans with the log; in
 * greenfield ANALYZE plans on the decided stack; and a veto replays from DECIDE,
 * never from AUDIT. The whole pipeline runs, with scripted sessions.
 */

/** A brownfield project whose lone test script binds without a question, with the fixture's documents. */
const PROJECT = { ...LONE_CANDIDATE, ...DOCS, "prd-billing.md": "# Billing\n\nInvoices go out monthly.\n", "src/borrow.js": "export const price = 0;\n" };
const REGION = "# Founder decisions\n\n## Decisions\n\n| Id | Question | Answer | Reason |\n|---|---|---|---|\n| D-1 | Which region hosts the data? | **eu-west-1** | The members are in Europe. |\n";

const approved = { askApproval: async () => ({ kind: "deferred" as const }) };

describe("PRDR-282: PRESENT lists every vetoable default (C-3⁗)", () => {
  it("shows each X-n with its reason, and names a planning question the log answers instead of asking it", async () => {
    const root = repo({ ...PROJECT, [DECISION_LOG_PATH]: REGION });
    const log: string[] = [];
    const result = await initThrough(root, decide((_, i) => SORTED(i)), {
      all: true,
      script: { planner: scriptedPlanner({ draft: twoSliceDraft, review: () => ({ schema_version: SCHEMA_VERSION, verdict: "approve", findings: [] }) }, log) },
    });
    expect(result.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
    const shown = result.interrupt?.message ?? "";
    expect(shown).toContain("Defaults (3) — the plan follows each; to veto one, edit its row in docs/founder-decisions.md");
    expect(shown).toContain(`  X-1: ${LATE.value}\n      because: ${LATE.reason}`);
    expect(shown).toContain(`  X-2: ${REFUND.value}`);
    expect(shown).toContain("  X-3: Free in the MVP");
    /* SLICE's sq1 and the s01 draft's pq1 are both D-1's question. */
    expect(shown).toContain("Not asked again (1) — the decision log already answers: sq1 by D-1 (C-3‴).");
    expect(shown).not.toContain("Open questions");
  });

  it("keeps a question the log does not answer, and lists no defaults when the log holds none", () => {
    const outputs = {
      DECIDE: { decisions: [{ id: "D-1", question: "Which region hosts the data?", answer: "**eu-west-1**", reason: "r" }], defaults: [null, { id: "X-1" }] },
      SLICE: { questions: [{ id: "sq1", question: "Which payment provider do we use?", blocking: false, assumption: "Stripe" }] },
    };
    const inputs = presentInputsFromOutputs(outputs);
    expect(inputs.questions?.map((q) => q.id)).toEqual(["sq1"]);
    expect(inputs.defaults, "a row without its fields is not shown").toEqual([]);
    const text = renderPresentation({ root: "/nowhere", tickets: [], bindings: [], skips: [], bootstrap: null, assignments: {}, ...inputs });
    expect(text).not.toContain("Defaults (");
    expect(text).not.toContain("Not asked again");
  });
});

describe("PRDR-282: every slice plans with the decision log (C-2¹²)", () => {
  it("hands the log to SLICE and to each slice's draft, whatever documents the slice names", async () => {
    const root = repo(PROJECT);
    const seen: Record<string, unknown>[] = [];
    await initThrough(root, decide((_, i) => SORTED(i)), {
      all: true,
      script: { planner: scriptedPlanner({ slices: TWO_SLICES, draft: twoSliceDraft, review: () => ({ schema_version: SCHEMA_VERSION, verdict: "approve", findings: [] }) }, [], seen) },
    });
    const drafts = seen.filter((i) => i["stage"] === "PLAN");
    expect(drafts.map((i) => i["docs"])).toEqual([
      ["PRD.md", DECISION_LOG_PATH],
      ["prd-billing.md", DECISION_LOG_PATH],
    ]);
    const slicing = seen.find((i) => i["stage"] === "SLICE");
    expect(slicing?.["docs"]).toContain(DECISION_LOG_PATH);
    expect(seen.find((i) => i["expected_output"] !== undefined && i["stage"] === undefined)?.["docs"], "ANALYZE reads it too").toContain(DECISION_LOG_PATH);
  });

  it("leaves a slice that names no documents to plan from every document, the log among them", async () => {
    const root = repo(PROJECT);
    const seen: Record<string, unknown>[] = [];
    const bare = { ...TWO_SLICES, slices: TWO_SLICES.slices.map((sl) => (sl.id === "s02" ? { ...sl, docs: [] } : sl)) };
    await initThrough(root, decide((_, i) => SORTED(i)), {
      all: true,
      script: { planner: scriptedPlanner({ slices: bare, draft: twoSliceDraft, review: () => ({ schema_version: SCHEMA_VERSION, verdict: "approve", findings: [] }) }, [], seen) },
    });
    const s02 = seen.find((i) => i["stage"] === "PLAN" && (i["slice"] as { id: string }).id === "s02");
    expect(s02?.["docs"]).toEqual(["PRD.md", DECISION_LOG_PATH, "docs/roadmap.md", "prd-billing.md"].sort());
  });

  it("replays a veto from DECIDE, never from AUDIT, and re-plans every slice until C-2⁸ narrows it", async () => {
    const root = repo(PROJECT);
    const log: string[] = [];
    const planner = scriptedPlanner({ slices: TWO_SLICES, draft: twoSliceDraft, review: () => ({ schema_version: SCHEMA_VERSION, verdict: "approve", findings: [] }) }, log);
    const stub = decide((_, i) => SORTED(i));
    await initThrough(root, stub, { all: true, script: { planner }, more: approved });

    log.length = 0;
    const file = decisionLogFile(root);
    writeFileSync(file, readFileSync(file, "utf8").replace(LATE.value, "A late return costs a day's fee."));
    const vetoed = await initThrough(root, stub, { all: true, script: { planner }, more: approved });
    expect(vetoed.reused.slice(0, 3)).toEqual(["INIT_FS", "DISCOVER", "AUDIT"]);
    expect(vetoed.executed.slice(0, 2)).toEqual(["DECIDE", "ANALYZE"]);
    expect(stub.inputs, "the veto left every item settled, so DECIDE ran no session").toHaveLength(1);
    expect(log).toEqual(["ANALYZE", "SLICE", "PLAN:s01", ...R("s01"), "PLAN:s02", ...R("s02"), "REVIEW:whole"]);
  });
});

describe("PRDR-282: in greenfield ANALYZE plans on the stack DECIDE recorded (D-10′)", () => {
  it("is handed the entry, and code writes it over the stack the session chose, so the bindings follow the log", async () => {
    const root = repo({ ...DOCS });
    const seen: Record<string, unknown>[] = [];
    const chose = { language: "Python", runtime: "3.12", test_framework: "pytest", rationale: "the session's pick", scaffold_files: ["pyproject.toml"], verification: { lint: "ruff check ." } };
    await initThrough(root, decide((_, i) => SORTED(i)), {
      all: true,
      script: { planner: scriptedPlanner({ analysis: ANALYSIS(chose), draft: twoSliceDraft, review: () => ({ schema_version: SCHEMA_VERSION, verdict: "approve", findings: [] }) }, [], seen) },
    });
    const analyzing = seen.find((i) => i["decided_stack"] !== undefined);
    expect(analyzing?.["decided_stack"]).toEqual({ ...TS_STACK, decision: "X-3" });
    expect(String(analyzing?.["instruction"])).toContain("whose stack the decision log settles, as X-3");
    const analysis = (JSON.parse(readFileSync(path.join(stateDir(root), "state", "ANALYZE.json"), "utf8")) as { outputs: { analysis: { stack: unknown } } }).outputs.analysis;
    expect(analysis.stack).toEqual({
      language: "TypeScript",
      runtime: "Node.js 24 with pnpm 10",
      test_framework: "",
      rationale: "The decision log settles the stack, as X-3 (D-10′).",
      scaffold_files: ["package.json"],
      verification: { test: "pnpm test" },
    });
    expect(readBindings(root).bindings.map((b) => [b.slot, b.resolved, b.status])).toEqual([["test", "pnpm test", "provisional"]]);
  });
});

describe("PRDR-282: in an existing project the stack is discovered, not decided (D-10′)", () => {
  it("hands ANALYZE no decided stack, and leaves its stack null, though the log records one", async () => {
    const withStack = "# Founder decisions\n\n## Stack\n\n| Field | Value |\n|---|---|\n| decision | X-9 |\n| language | Go |\n| toolchain | Go 1.24 |\n";
    const root = repo({ ...PROJECT, [DECISION_LOG_PATH]: withStack });
    const seen: Record<string, unknown>[] = [];
    await initThrough(root, decide((_, i) => SORTED(i)), {
      all: true,
      script: { planner: scriptedPlanner({ draft: twoSliceDraft, review: () => ({ schema_version: SCHEMA_VERSION, verdict: "approve", findings: [] }) }, [], seen) },
    });
    expect(seen.some((i) => i["decided_stack"] !== undefined)).toBe(false);
    const analysis = (JSON.parse(readFileSync(path.join(stateDir(root), "state", "ANALYZE.json"), "utf8")) as { outputs: { analysis: { stack: unknown } } }).outputs.analysis;
    expect(analysis.stack).toBeNull();
  });
});

describe("PRDR-282: the decided stack in the analysis's shape (D-10′)", () => {
  const session = { language: "typescript", runtime: "node", test_framework: "vitest", rationale: "", scaffold_files: ["tsconfig.json"], verification: { test: "npm test", lint: "eslint ." } };

  it("keeps what the session read for the same language where the entry is silent, and the entry wins where it speaks", () => {
    const stack = withDecidedStack(session, { decision: "X-1", language: "TypeScript", toolchain: "Node.js 24", scaffold_files: [], gates: { test: "pnpm test", test_single: "pnpm vitest run" } });
    expect(stack).toEqual({
      language: "TypeScript",
      runtime: "Node.js 24",
      test_framework: "vitest",
      rationale: "The decision log settles the stack, as X-1 (D-10′).",
      scaffold_files: ["tsconfig.json"],
      verification: { test: "pnpm test", lint: "eslint ." },
    });
    /* `test_single` is a binding's slot, not an analysis's; the analysis must still parse. */
    expect(analysisSchema.safeParse({ schema_version: SCHEMA_VERSION, summary: "s", stack }).success).toBe(true);
  });

  it("keeps nothing the session wrote for another language", () => {
    const stack = withDecidedStack(session, { decision: "D-2", language: "Go", toolchain: "Go 1.24", scaffold_files: [], gates: {} });
    expect(stack).toEqual({ language: "Go", runtime: "Go 1.24", test_framework: "", rationale: "The decision log settles the stack, as D-2 (D-10′).", scaffold_files: [] });
  });
});

describe("PRDR-282: DECIDE stands off the chain, so AUDIT's re-runs re-plan only through the log (C-2¹¹, C-2¹²)", () => {
  const approve = () => ({ schema_version: SCHEMA_VERSION, verdict: "approve", findings: [] });
  const DRIFT = { passage: { file: "PRD.md", line: 3, quote: "Borrowing is free in the MVP." }, code_checked: ["src/borrow.js"], finding: "the code charges a fee" };

  /** A planned project, and a way to run init again with AUDIT finding `survey`. */
  async function planned() {
    const root = repo(PROJECT);
    const log: string[] = [];
    const planner = scriptedPlanner({ slices: TWO_SLICES, draft: twoSliceDraft, review: approve }, log);
    const stub = decide((n, i) => (n === 0 ? SORTED(i) : artifact({ settled: [{ item: "G1", entry: "X-1" }], defaults: (i["items"] as { id: string }[]).some((x) => x.id === "R1") ? [{ value: "The plan follows the PRD: borrowing is free.", reason: "The PRD is the later intent.", settles: ["R1"] }] : [] })));
    await initThrough(root, stub, { all: true, script: { planner }, more: approved });
    let edits = 0;
    const again = async (survey: Json) => {
      log.length = 0;
      edits += 1;
      writeFileSync(path.join(root, "src", "borrow.js"), `export const price = ${String(edits)};\n`);
      return await initThrough(root, stub, { all: true, audit: auditFinds("wrong", survey), script: { planner }, more: approved });
    };
    return { root, log, stub, again };
  }

  it("re-plans nothing when a code edit re-runs AUDIT and the items it leaves open are the same, in other words", async () => {
    const { log, stub, again } = await planned();
    const reworded = JSON.parse(JSON.stringify(SURVEY).replace("cannot both hold at launch", "are incompatible").replace("no document says", "nothing says")) as Json;
    const result = await again(reworded);
    expect(result.executed).toEqual(["AUDIT"]);
    /* PRESENT deferred its approval last time, so it presents again; it checkpoints nothing when it stops. */
    expect(result.reused).toEqual(["INIT_FS", "DISCOVER", "DECIDE", "ANALYZE", "DETERMINE_VERIFICATION", "SLICE", "PLAN", "PREPARE_AGENTS"]);
    expect(log).toEqual([]);
    expect(stub.inputs).toHaveLength(1);
  });

  it("re-runs DECIDE for an item whose key moved, and re-plans nothing when the log already settles it", async () => {
    const { root, log, stub, again } = await planned();
    const before = readFileSync(decisionLogFile(root), "utf8");
    const result = await again({ ...SURVEY, gaps: [{ topic: "Late returns of tools", detail: "no document says", passages: [] }] });
    expect(result.executed.slice(0, 2)).toEqual(["AUDIT", "DECIDE"]);
    expect(stub.inputs.map((i) => ((i["items"] as { id: string }[]) ?? []).map((x) => x.id))).toEqual([["C1", "G1", "K1"], ["G1"]]);
    expect(readFileSync(decisionLogFile(root), "utf8"), "the session cited X-1, so the log is as it was").toBe(before);
    expect(result.executed).not.toContain("ANALYZE");
    expect(log).toEqual([]);
  });

  it("re-plans when a new item is settled into the log", async () => {
    const { root, log, again } = await planned();
    const result = await again({ ...SURVEY, drift: [DRIFT] });
    expect(result.executed.slice(0, 3)).toEqual(["AUDIT", "DECIDE", "ANALYZE"]);
    expect(readFileSync(decisionLogFile(root), "utf8")).toContain("| X-4 | The plan follows the PRD: borrowing is free. |");
    expect(log[0]).toBe("ANALYZE");
  });

  it("refuses the re-plan a new entry would start while a ticket is in flight, and keeps what DECIDE recorded (C-8″)", async () => {
    const { root, log, again } = await planned();
    writeTicket(root, { ...newTicket({ id: "t-live", type: "feature", title: "t", acceptance_criteria: ["a"], surface: ["src/**"] }), state: "IN_PROGRESS" });
    const result = await again({ ...SURVEY, drift: [DRIFT] });
    expect(result.exitCode).toBe(2);
    expect(result.messages.join(" ")).toContain("re-planning refused: t-live (IN_PROGRESS) still in flight");
    expect(result.reachedPhase).toBe("ANALYZE");
    expect(result.executed).toEqual(["AUDIT", "DECIDE"]);
    expect(log, "no planning session ran").toEqual([]);
    expect(readFileSync(decisionLogFile(root), "utf8")).toContain("| X-4 |");
  });
});
