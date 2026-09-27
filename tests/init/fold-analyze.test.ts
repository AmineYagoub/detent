import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeCheckpoint } from "../../src/fs/checkpoints.js";
import { stateDir } from "../../src/fs/layout.js";
import { determineVerification } from "../../src/init/bind.js";
import type { DecideAsk } from "../../src/init/decide.js";
import { runInit, type InitOptions, type PhaseHandler } from "../../src/init/machine.js";
import { checkPack } from "../../src/init/pack-check.js";
import { packDocuments } from "../../src/init/pack.js";
import { buildPipeline } from "../../src/init/pipeline.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { INIT_PHASES } from "../../src/schemas/init.js";
import { DECISION_LOG_PATH } from "../../src/schemas/pack.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { DOCS, SORTED, decide, initThrough, type Json } from "./decide-fixture.js";
import { CONFORMING_PACK, DECISION_LOG, commitRecord, packRepo } from "./pack-fixture.js";
import { BUDGETS, LONE_CANDIDATE, PROMPTS, repo } from "./plan-fixture.js";
import { scriptedPlanner, ticket } from "./slicing-fixture.js";
import { clean, initThroughValidate } from "./validate-fixture.js";
import { RAW, writesPack } from "./write-fixture.js";

/**
 * PRDR-290 — ANALYZE folds into DECIDE (D-10′).
 *
 * ANALYZE handed the phases after it three things: `greenfield`, which code
 * computes from the stack markers; in greenfield the stack, which DECIDE
 * records in the decision log; and a prose summary, which the checker's parse
 * of the pack replaces. So the phase goes, and nothing the planning phases
 * read comes from a model session they did not need. The cases run the real
 * pipeline on the pack fixture, a greenfield project whose pack conforms, so
 * the only sessions are the planner's; one runs an existing project whose
 * pack WRITE writes, and the rest run DECIDE on raw documents.
 */

const SLICES = {
  schema_version: SCHEMA_VERSION,
  slices: [
    {
      id: "s01",
      title: "the shop",
      goal: "a product is listed and sold",
      requirement_ids: ["CAT-F-001", "CAT-F-002", "CAT-N-001", "CHK-F-001", "CHK-F-002"],
      baseline_items: [],
      docs: [],
      depends_on: [],
      rationale: "",
    },
  ],
};
/** The pack WRITE's fixture writes, in one slice. */
const LENDING_SLICES = {
  ...SLICES,
  slices: [{ ...SLICES.slices[0], title: "lending", goal: "a tool is lent", requirement_ids: ["LND-F-001", "LND-F-002", "LND-F-003"] }],
};
const draft = (): object => ({ schema_version: SCHEMA_VERSION, tickets: [ticket("t-s01-001"), ticket("t-s01-002", ["t-s01-001"])] });
const approve = (): object => ({ schema_version: SCHEMA_VERSION, verdict: "approve", findings: [] });

/** The stack entry the pack fixture's log records, as the checker parses it. */
const ENTRY = {
  decision: "X-2",
  language: "TypeScript",
  toolchain: "Node.js 22 with pnpm 9",
  scaffold_files: ["package.json", "tsconfig.json"],
  gates: { test: "pnpm test", lint: "pnpm lint" },
};

interface Planned {
  readonly log: string[];
  /** Every planner session's inputs, and the artifact each was told to write. */
  readonly inputs: Json[];
  readonly artifacts: string[];
  readonly backend: MockBackend;
}

/** The whole pipeline, with a planner that answers SLICE, PLAN and the reviews, and nothing else. */
function pipeline(root: string, notes: string[] = []): { readonly handlers: PhaseHandler[]; readonly planned: Planned } {
  const log: string[] = [];
  const inputs: Json[] = [];
  const artifacts: string[] = [];
  const answer = scriptedPlanner({ slices: SLICES, draft, review: approve }, log, inputs);
  const backend = new MockBackend({
    planner: (spec) => {
      artifacts.push(path.basename(spec.artifactOut));
      return answer(spec);
    },
  });
  const handlers = buildPipeline({
    root,
    backend,
    prompts: PROMPTS,
    budgets: BUDGETS,
    note: (t) => notes.push(t),
    sandbox: async () => ({ kind: "off", reason: "the test fixture probes no sandbox" }),
  });
  return { handlers, planned: { log, inputs, artifacts, backend } };
}

async function init(root: string, opts: InitOptions = {}, notes: string[] = []) {
  const { handlers, planned } = pipeline(root, notes);
  return { ...(await runInit(root, handlers, opts)), planned };
}

/** The pack fixture, committed with the record that says it conforms; `log` replaces its decision log. */
function conforming(log: string = DECISION_LOG): string {
  const root = packRepo({ ...CONFORMING_PACK, [DECISION_LOG_PATH]: log });
  commitRecord(root);
  return root;
}

const sliceInputs = (planned: Planned): Json | undefined => planned.inputs.find((i) => i["stage"] === "SLICE");
const draftInputs = (planned: Planned): Json | undefined => planned.inputs.find((i) => i["stage"] === "PLAN");
const outputsOf = (root: string, phase: string): Json =>
  (JSON.parse(readFileSync(path.join(stateDir(root), "state", `${phase}.json`), "utf8")) as { outputs: Json }).outputs;

/** ANALYZE's checkpoint and artifact, as a build before D-10′ left them: another stack, and a question. */
function leaveAnalysis(root: string): void {
  writeCheckpoint(root, "ANALYZE", "f".repeat(64), {
    analysis: {
      schema_version: SCHEMA_VERSION,
      summary: "a shop",
      stack: { language: "Python", runtime: "3.13", test_framework: "pytest", rationale: "", scaffold_files: ["pyproject.toml"], verification: { test: "pytest" } },
      questions: [{ id: "q9", question: "Which cloud region hosts the shop?", blocking: true, assumption: "" }],
      assumptions: [],
      docs_read: [],
    },
    greenfield: false,
    open_questions: [{ id: "q9", question: "Which cloud region hosts the shop?", blocking: true, assumption: "" }],
    research_briefs: [],
    research_tool_calls: 0,
  });
  writeFileSync(path.join(stateDir(root), "state", "analysis.json"), "{}\n");
}

const analysisLeft = (root: string): boolean =>
  existsSync(path.join(stateDir(root), "state", "ANALYZE.json")) || existsSync(path.join(stateDir(root), "state", "analysis.json"));

const why = (messages: readonly string[]): string | undefined => messages.find((m) => m.includes("ANALYZE"));

describe("PRDR-290: the phase list (D-10′)", () => {
  it("holds eleven phases, DECIDE before DETERMINE_VERIFICATION, and no ANALYZE", () => {
    expect(INIT_PHASES).toEqual([
      "INIT_FS",
      "DISCOVER",
      "AUDIT",
      "DECIDE",
      "WRITE",
      "VALIDATE",
      "DETERMINE_VERIFICATION",
      "SLICE",
      "PLAN",
      "PREPARE_AGENTS",
      "PRESENT",
    ]);
  });

  it("is the list the README and the init skill give, in order, with its count in words", () => {
    const words: Record<number, string> = { 11: "eleven", 12: "twelve" };
    const count = words[INIT_PHASES.length] ?? String(INIT_PHASES.length);
    const readme = readFileSync("README.md", "utf8");
    const start = readme.indexOf("`init` runs");
    const golden = readme.slice(start, readme.indexOf("detent run", start));
    expect(golden).toContain(`\`init\` runs ${count} phases, in order.`);
    expect([...golden.matchAll(/^- \*\*([A-Z_]+)\*\*:/gmu)].map((m) => m[1])).toEqual([...INIT_PHASES]);
    const skill = readFileSync("skills/init/SKILL.md", "utf8");
    const heading = `## The ${count} phases (C-4.1, in order)`;
    expect(skill).toContain(heading);
    const list = skill.slice(skill.indexOf(heading) + heading.length).split("\n\n")[1] ?? "";
    expect([...list.matchAll(/`([A-Z_]+)`/gu)].map((m) => m[1])).toEqual([...INIT_PHASES]);
  });
});

describe("PRDR-290: the planner is told the stack is decided (D-10′)", () => {
  /** C-4⁵ (PRDR-292): one prompt per planning job, each with its own line on the stack. */
  it("has each job that is handed the stack plan on the entry in greenfield, and choose nothing about it", () => {
    const [slice, plan, review] = ["slice", "plan", "plan_review"].map((id) => readFileSync(`prompts/${id}.md`, "utf8"));
    expect(plan).toContain("`stack`: in a new project, the stack the decision log settled. Plan on it, and choose nothing about it.");
    expect(slice).toContain("In a new project `stack` is the stack the decision log settled: cut on it, and choose nothing about it.");
    for (const prompt of [slice, plan, review]) {
      expect(prompt, "no planning job is ANALYZE").not.toContain("ANALYZE");
      expect(prompt, "and no phase launches planning research").not.toContain("planning research");
    }
  });
});

describe("PRDR-290: planning from a conforming pack, with no analysis (D-10′)", () => {
  it("launches no session but SLICE's, PLAN's and the reviews', and greenfield reaches DETERMINE_VERIFICATION, SLICE and PLAN from code", async () => {
    const root = conforming();
    const first = await init(root);
    expect(first.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
    expect(first.executed).not.toContain("ANALYZE");
    expect(first.planned.backend.rolesLaunched().every((r) => r === "planner"), "no specification session: the pack conforms").toBe(true);
    expect(new Set(first.planned.artifacts), "no session writes an analysis").toEqual(new Set(["slices.json", "plan-draft.json", "plan-review.json"]));
    expect(outputsOf(root, "DETERMINE_VERIFICATION")["status"]).toBe("provisional");
    expect(draftInputs(first.planned)).toMatchObject({ greenfield: true });
  });

  /** PRDR-291: on a pack SLICE is handed the seed, and the entry keys every slice PLAN drafts (C-2⁸). */
  it("hands PLAN the stack entry the decision log records, SLICE the seed, and neither an analysis", async () => {
    const root = conforming();
    const { planned } = await init(root);
    expect(draftInputs(planned)).toHaveProperty("stack", ENTRY);
    expect(sliceInputs(planned)).toHaveProperty("seed");
    expect(sliceInputs(planned)).not.toHaveProperty("stack");
    for (const inputs of [sliceInputs(planned), draftInputs(planned)]) expect(inputs).not.toHaveProperty("analysis");
  });

  it("binds the entry's documented commands, test_single among them, where an analysis had five slots (PRDR-115)", async () => {
    const withSingle = DECISION_LOG.replace("| . | lint | `pnpm lint` |", "| . | lint | `pnpm lint` |\n| . | test_single | `pnpm run test:single` |");
    const root = conforming(withSingle);
    await init(root);
    const bindings = outputsOf(root, "DETERMINE_VERIFICATION")["bindings"] as Json[];
    expect(bindings.map((b) => [b["slot"], b["resolved"], b["status"]])).toEqual([
      ["test", "pnpm test", "provisional"],
      ["lint", "pnpm lint", "provisional"],
      ["test_single", "pnpm run test:single", "provisional"],
    ]);
  });

  it("makes the bootstrap provide the entry's scaffold files, and says which decision settled the stack", async () => {
    const root = conforming();
    await init(root);
    const bootstrap = readTicket(root, "t-001-bootstrap");
    expect(bootstrap.provides.filter((p) => p.kind === "file").map((p) => p.id)).toEqual(["package.json", "tsconfig.json"]);
    expect(bootstrap.description).toContain("X-2");
    expect(bootstrap.description).toContain("TypeScript");
    expect(bootstrap.description).not.toContain("ANALYZE");
  });

  it("still reads an existing project's stack from the repository, and gives PLAN none", async () => {
    const root = repo({ ...LONE_CANDIDATE, ...RAW });
    const inputs: Json[] = [];
    const planner = scriptedPlanner({ slices: LENDING_SLICES, draft, review: approve }, [], inputs);
    await initThroughValidate(root, { all: true, reviewers: clean(), script: { planner } }, writesPack());
    const bound = outputsOf(root, "DETERMINE_VERIFICATION");
    expect(bound["status"], "discovered and run, not proposed from a stack").toBe("approved");
    const test = (bound["bindings"] as Json[]).find((b) => b["slot"] === "test");
    expect(test).toMatchObject({ resolved: "npm run test", status: "approved" });
    expect(test?.["adapter"]).not.toMatch(/^greenfield:/u);
    const drafting = inputs.find((i) => i["stage"] === "PLAN");
    expect(drafting).toMatchObject({ greenfield: false });
    expect(drafting).toHaveProperty("stack", null);
    expect(inputs.find((i) => i["stage"] === "SLICE")).not.toHaveProperty("analysis");
  });
});

describe("PRDR-290: planning reads the parse VALIDATE handed on, or the log where it handed none (D-10′)", () => {
  it("fails on a parse that will not read, rather than planning as if the project had no stack", async () => {
    const root = conforming();
    await init(root);
    const file = path.join(stateDir(root), "state", "VALIDATE.json");
    const checkpoint = JSON.parse(readFileSync(file, "utf8")) as { outputs: Json };
    const pack = { ...(checkpoint.outputs["pack"] as Json), stack: "TypeScript" };
    writeFileSync(file, JSON.stringify({ ...checkpoint, outputs: { ...checkpoint.outputs, pack } }));
    await expect(init(root)).rejects.toThrow("the VALIDATE checkpoint's parse of the pack is unreadable (stack:");
  });
});

describe("PRDR-290: in a new project, no stack entry leaves nothing to bind (D-10′)", () => {
  it("stops DETERMINE_VERIFICATION for the stack, and names where the log records it", async () => {
    const root = repo({ "PRD.md": "# a shop\n" });
    const outcome = await determineVerification({ root, greenfield: true, stack: null });
    expect(outcome.kind).toBe("interrupt");
    if (outcome.kind !== "interrupt") throw new Error("unreachable");
    expect(outcome.interrupt).toBe("AWAIT_SETUP_CONSENT");
    expect(outcome.items, "the stack, where a stack with no gate command asks for `test`").toEqual(["stack"]);
    expect(outcome.message).toContain("## Stack");
    expect(outcome.message).toContain(DECISION_LOG_PATH);
  });
});

describe("PRDR-290: --replan enters at DETERMINE_VERIFICATION (C-8⁵)", () => {
  it("re-runs DETERMINE_VERIFICATION and every phase after it, and nothing of the specification phase", async () => {
    const root = conforming();
    await init(root);
    const again = await init(root, { replan: true });
    expect(again.replayedFrom).toBe("DETERMINE_VERIFICATION");
    expect(again.reachedPhase, "PRESENT asks for approval, so it is not checkpointed").toBe("PRESENT");
    expect(again.executed).toEqual(["DETERMINE_VERIFICATION", "SLICE", "PLAN", "PREPARE_AGENTS"]);
    expect(again.reused).toEqual(["INIT_FS", "DISCOVER", "AUDIT", "DECIDE", "WRITE", "VALIDATE"]);
  });
});

describe("PRDR-290: a state an older build left holds ANALYZE's checkpoint (F-3)", () => {
  it("re-runs from DECIDE and says why, reads nothing the checkpoint holds, and retires it", async () => {
    const root = conforming();
    await init(root);
    leaveAnalysis(root);
    const notes: string[] = [];
    const resumed = await init(root, {}, notes);
    const said = why(resumed.messages);
    expect(said, "the init says why").toBeDefined();
    expect(said).toMatch(/DECIDE/u);
    expect(said).toMatch(/D-10′/u);
    expect(said).toMatch(/F-3/u);
    expect(resumed.replayedFrom).toBe("DECIDE");
    expect(resumed.executed).toContain("DECIDE");
    expect(resumed.reused).toEqual(expect.arrayContaining(["AUDIT", "WRITE", "VALIDATE", "DETERMINE_VERIFICATION"]));
    expect(resumed.interrupt?.interrupt, "the checkpoint's blocking question is not asked").toBe("AWAIT_APPROVAL");
    expect(resumed.interrupt?.message ?? "").not.toContain("Which cloud region");
    expect((outputsOf(root, "DETERMINE_VERIFICATION")["bindings"] as Json[]).map((b) => b["resolved"])).toEqual(["pnpm test", "pnpm lint"]);
    expect(analysisLeft(root), "the checkpoint and its artifact are gone").toBe(false);
    const after = await init(root);
    expect(why(after.messages), "and it says so once").toBeUndefined();
    expect(after.reused).toContain("DECIDE");
  });

  it("re-runs DECIDE whatever its own checkpoint says, and re-plans nothing where DECIDE moves no key, since it stands off the chain", async () => {
    const root = repo(DOCS);
    const stub = decide((_, inputs) => SORTED(inputs));
    const answer: DecideAsk = async (screen) => screen.map(() => ({ option: 0 }));
    const log: string[] = [];
    const planner = scriptedPlanner({ slices: SLICES, draft, review: approve }, log);
    const first = await initThrough(root, stub, { ask: answer, all: true, script: { planner } });
    expect(first.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
    expect(stub.inputs).toHaveLength(1);
    leaveAnalysis(root);
    log.length = 0;
    const notes: string[] = [];
    const again = await initThrough(root, stub, { ask: answer, all: true, script: { planner }, notes });
    expect(again.executed, "no phase after DECIDE is forced: WRITE, which restarts the chain, is not in this pipeline").toEqual(["DECIDE"]);
    expect(again.reused).toEqual(expect.arrayContaining(["DETERMINE_VERIFICATION", "SLICE", "PLAN", "PREPARE_AGENTS"]));
    expect(log, "no planning session").toEqual([]);
    expect(stub.inputs, "no second session: every item is settled").toHaveLength(1);
    expect(notes).toContain("DECIDE: every item AUDIT left open is settled by an entry the decision log still holds, so no session ran (C-2¹²)");
    expect(analysisLeft(root)).toBe(false);
  });

  it("keeps the checkpoint while DECIDE does not complete, and says why again on the next init", async () => {
    const root = repo(DOCS);
    leaveAnalysis(root);
    const stub = decide((_, inputs) => SORTED(inputs));
    const later: DecideAsk = async () => "later";
    const deferred = await initThrough(root, stub, { ask: later });
    expect(deferred.reachedPhase).toBe("DECIDE");
    expect(deferred.interrupt?.interrupt).toBe("AWAIT_INFO");
    expect(why(deferred.messages)).toBeDefined();
    expect(analysisLeft(root), "DECIDE did not complete").toBe(true);
    const answered = await initThrough(root, stub, { ask: async (screen) => screen.map(() => ({ option: 0 })) });
    expect(answered.reachedPhase).toBe("READY");
    expect(why(answered.messages)).toBeDefined();
    expect(analysisLeft(root)).toBe(false);
  });
});

describe("PRDR-290: a greenfield pack with no stack entry does not conform (C-2⁷, D-10′)", () => {
  it("fails the checker, and the finding names the entry", () => {
    const withoutStack = DECISION_LOG.slice(0, DECISION_LOG.indexOf("## Stack")) + DECISION_LOG.slice(DECISION_LOG.indexOf("## Packages"));
    const root = packRepo({ ...CONFORMING_PACK, [DECISION_LOG_PATH]: withoutStack });
    const check = checkPack(root, packDocuments(root), { greenfield: true });
    expect(check.green).toBe(false);
    const stack = check.findings.filter((f) => f.rule === "stack" && f.blocks);
    expect(stack.map((f) => f.file)).toEqual([DECISION_LOG_PATH]);
    expect(stack[0]?.message).toContain("## Stack");
  });
});
