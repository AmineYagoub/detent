import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initLayout, stateDir } from "../../src/fs/layout.js";
import { analysisPath, analyzeStage, isGreenfield } from "../../src/init/analyze.js";
import { DOC_PATTERNS, awaitDocsMessage, discoverDocs } from "../../src/init/discover-docs.js";
import { planResearch, planningBriefPath, questionHash } from "../../src/init/plan-research.js";
import { buildPipeline } from "../../src/init/pipeline.js";
import { runInit } from "../../src/init/machine.js";
import { CEILINGS } from "../../src/schemas/budgets.js";
import type { Budgets } from "../../src/schemas/budgets.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { git, gitInit, removeTree, tmpTree, writeTree } from "../helpers.js";

/** T-061 (doc discovery), T-062 (ANALYZE), T-063 (planning research). */

const PROMPTS = loadPromptSet();
const BUDGETS = Object.fromEntries(
  Object.entries(CEILINGS).map(([k, spec]) => [k, "default" in spec ? (spec as { default: number }).default : 25]),
) as Budgets;

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

function repo(files: Record<string, string> = {}): string {
  const root = tmpTree(files);
  roots.push(root);
  gitInit(root);
  writeTree(root, { "seed.txt": "seed\n" });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  initLayout(root);
  return root;
}

// ---------------------------------------------------------------------------
// T-061

describe("T-061 doc discovery (C-2 docs half)", () => {
  it("finds the named patterns, sorted and POSIX — deterministic across calls", () => {
    const root = repo({
      "PRD.md": "# prd\n",
      "SRS-v2.md": "# srs\n",
      "README.md": "# readme\n",
      "docs/architecture.md": "# arch\n",
      "docs/deep/notes.txt": "notes\n",
      "src/main.ts": "export {}\n",
      "package.json": "{}\n",
    });
    const found = discoverDocs(root);
    expect(found.docs).toEqual([
      "PRD.md",
      "README.md",
      "SRS-v2.md",
      "docs/architecture.md",
      "docs/deep/notes.txt",
    ]);
    expect(discoverDocs(root).docs).toEqual(found.docs); // N-2
    // Source and manifests are not planning documents.
    expect(found.docs).not.toContain("src/main.ts");
    expect(found.docs).not.toContain("package.json");
  });

  it("never traverses dependency or state trees", () => {
    const root = repo({
      "PRD.md": "# prd\n",
      "node_modules/pkg/README.md": "# vendored\n",
      ".detent/plan/README.md": "# state\n",
      "dist/README.md": "# built\n",
    });
    expect(discoverDocs(root).docs).toEqual(["PRD.md"]);
  });

  it("no docs → the message lists EXACTLY what was looked for (C-2's AC)", () => {
    const root = repo({ "src/main.ts": "export {}\n" });
    const found = discoverDocs(root);
    expect(found.docs).toEqual([]);
    const message = awaitDocsMessage(found, root);
    for (const pattern of DOC_PATTERNS) expect(message).toContain(pattern);
    expect(message).toContain(root);
  });

  it("through the pipeline, an empty repo raises AWAIT_DOCS exactly once", async () => {
    const root = repo({ "src/main.ts": "export {}\n" });
    const handlers = buildPipeline({ root, backend: new MockBackend(), prompts: PROMPTS, budgets: BUDGETS });
    const result = await runInit(root, handlers);
    expect(result.exitCode).toBe(2);
    expect(result.interrupt?.interrupt).toBe("AWAIT_DOCS");
    expect(result.interrupt?.items).toEqual([...DOC_PATTERNS]);
    expect(result.reachedPhase).toBe("DISCOVER");
  });
});

// ---------------------------------------------------------------------------
// T-062

const ANALYSIS_BROWNFIELD = {
  schema_version: 1,
  summary: "An existing TypeScript service with vitest already wired.",
  stack: null,
  questions: [],
  assumptions: [{ claim: "tests live under tests/", evidence: "tests/ exists" }],
  docs_read: ["PRD.md"],
};

const analysisStage =
  (root: string, payload: object): StageFn =>
  () => {
    writeFileSync(analysisPath(root), `${JSON.stringify(payload)}\n`);
    return okResult();
  };

describe("T-062 ANALYZE (C-3, D-10)", () => {
  it("greenfield is the absence of stack markers, and the planner must choose a stack", async () => {
    const root = repo({ "PRD.md": "# build a thing\n" });
    expect(isGreenfield([])).toBe(true);

    let sawInputs: Record<string, unknown> | null = null;
    const outcome = await analyzeStage({
      root,
      docs: ["PRD.md"],
      stackMarkers: [],
      launch: async (inputs) => {
        sawInputs = inputs;
        writeFileSync(
          analysisPath(root),
          JSON.stringify({
            ...ANALYSIS_BROWNFIELD,
            stack: { language: "typescript", runtime: "node", test_framework: "vitest", rationale: "PRD says TS" },
          }),
        );
      },
    });

    expect(outcome.kind).toBe("complete");
    if (outcome.kind !== "complete") throw new Error("unreachable");
    expect(sawInputs!["greenfield"]).toBe(true);
    // D-10: the stack decision is an ANALYZE output that T-064 consumes.
    expect((outcome.outputs["analysis"] as { stack: { language: string } }).stack.language).toBe("typescript");
    expect(outcome.outputs["greenfield"]).toBe(true);
  });

  it("a greenfield analysis with no stack fails the phase — D-10 has nothing to bind", async () => {
    const root = repo({ "PRD.md": "# thing\n" });
    await expect(
      analyzeStage({
        root,
        docs: ["PRD.md"],
        stackMarkers: [],
        launch: async () => {
          writeFileSync(analysisPath(root), JSON.stringify(ANALYSIS_BROWNFIELD)); // stack: null
        },
      }),
    ).rejects.toThrow(/without choosing a stack/);
  });

  it("brownfield keeps stack null — the stack is discovered, not chosen", async () => {
    const root = repo({ "PRD.md": "# thing\n", "package.json": "{}\n" });
    const outcome = await analyzeStage({
      root,
      docs: ["PRD.md"],
      stackMarkers: ["package.json"],
      launch: async () => {
        writeFileSync(analysisPath(root), JSON.stringify(ANALYSIS_BROWNFIELD));
      },
    });
    expect(outcome.kind).toBe("complete");
    expect(isGreenfield(["package.json"])).toBe(false);
  });

  it("missing info yields ONE interruption carrying ≥2 questions (C-3's AC — a batch, not a drip)", async () => {
    const root = repo({ "PRD.md": "# vague\n" });
    const outcome = await analyzeStage({
      root,
      docs: ["PRD.md"],
      stackMarkers: ["package.json"],
      launch: async () => {
        writeFileSync(
          analysisPath(root),
          JSON.stringify({
            ...ANALYSIS_BROWNFIELD,
            questions: [
              { id: "q1", question: "Which database backs the ledger?", blocking: true },
              { id: "q2", question: "Is multi-tenancy in scope for v1?", blocking: true },
              { id: "q3", question: "Preferred log format?", blocking: false },
            ],
          }),
        );
      },
    });

    expect(outcome.kind).toBe("interrupt");
    if (outcome.kind !== "interrupt") throw new Error("unreachable");
    expect(outcome.interrupt).toBe("AWAIT_INFO");
    expect(outcome.items).toHaveLength(2); // blocking only, batched together
    expect(outcome.message).toContain("Which database");
    expect(outcome.message).toContain("multi-tenancy");
  });

  it("an invalid analysis fails the phase rather than becoming a user question (P2)", async () => {
    const root = repo({ "PRD.md": "# thing\n" });
    await expect(
      analyzeStage({
        root,
        docs: ["PRD.md"],
        stackMarkers: ["package.json"],
        launch: async () => {
          writeFileSync(analysisPath(root), JSON.stringify({ schema_version: 1, summary: "" }));
        },
      }),
    ).rejects.toThrow(/invalid analysis|no analysis artifact/);
  });

  it("the planner session runs in plan mode with no write tools (S-1)", async () => {
    const root = repo({ "PRD.md": "# thing\n", "package.json": '{"scripts":{"test":"vitest run"}}\n' });
    const backend = new MockBackend({ planner: analysisStage(root, ANALYSIS_BROWNFIELD) });
    const handlers = buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS });
    await runInit(root, handlers);

    const call = backend.calls.find((c) => c.role === "planner");
    expect(call).toBeDefined();
    expect(call!.spec.permissionMode).toBe("plan");
    expect(call!.spec.allowedTools).toEqual(["Read", "Grep", "Glob"]);
    expect(call!.spec.allowedTools).not.toContain("Write");
    expect(call!.spec.allowedTools).not.toContain("Edit");
  });
});

// ---------------------------------------------------------------------------
// T-063

const VALID_BRIEF = (question: string) => ({
  schema_version: 1,
  question,
  question_hash: questionHash(question),
  answer: { claim: "The v3 API replaced the callback form with promises.", confidence: "high" },
  evidence: [{ source: "https://docs.example.com/v3/migration", claim: "callbacks removed in v3" }],
  sources_consulted: [
    { tier: 1, ref: "PRD.md" },
    { tier: 3, ref: "https://docs.example.com/v3/migration" },
  ],
  local_search: { docs_checked: ["PRD.md"], code_checked: [] },
  what_would_falsify: "the v3 changelog shows callbacks retained",
});

describe("T-063 planning research (C-3a, D-11)", () => {
  it("an answered question yields a cited brief, cached by question hash", async () => {
    const root = repo();
    const question = "Does the v3 API still accept callbacks?";
    const result = await planResearch([question], {
      root,
      budget: 16,
      researchOne: async () => ({ brief: VALID_BRIEF(question), toolCalls: 3 }),
    });

    expect(result.briefs).toHaveLength(1);
    expect(result.unanswered).toEqual([]);
    expect(result.toolCallsUsed).toBe(3);
    expect(result.briefs[0]?.evidence[0]?.source).toContain("docs.example.com");
    expect(existsSync(planningBriefPath(root, questionHash(question)))).toBe(true);
  });

  it("re-running hits the cache with ZERO sessions and zero tool calls (C-3a's AC)", async () => {
    const root = repo();
    const question = "Does the v3 API still accept callbacks?";
    await planResearch([question], { root, budget: 16, researchOne: async () => ({ brief: VALID_BRIEF(question), toolCalls: 3 }) });

    let launched = 0;
    const second = await planResearch([question], {
      root,
      budget: 16,
      researchOne: async () => {
        launched += 1;
        return { brief: VALID_BRIEF(question), toolCalls: 3 };
      },
    });
    expect(launched).toBe(0);
    expect(second.sessionsLaunched).toBe(0);
    expect(second.toolCallsUsed).toBe(0);
    expect(second.cacheHits).toBe(1);
    expect(second.briefs).toHaveLength(1);
  });

  it("the question hash normalizes whitespace and case — the same question is one entry", () => {
    expect(questionHash("Does the API accept callbacks?")).toBe(questionHash("  does the   API accept callbacks? "));
    expect(questionHash("a")).not.toBe(questionHash("b"));
  });

  it("the 16-call ceiling is enforced per init, and exhaustion joins the AWAIT_INFO batch", async () => {
    const root = repo();
    const questions = ["q one?", "q two?", "q three?"];
    const notes: string[] = [];
    let launched = 0;

    const result = await planResearch(questions, {
      root,
      budget: 16,
      note: (t) => notes.push(t),
      researchOne: async (question) => {
        launched += 1;
        // The first question burns the whole allowance.
        return { brief: VALID_BRIEF(question), toolCalls: 16 };
      },
    });

    expect(launched).toBe(1);
    expect(result.toolCallsUsed).toBe(16);
    expect(result.toolCallsUsed).toBeLessThanOrEqual(BUDGETS.planning_research_tool_calls);
    // C-3a: no new interrupt class — the unanswered questions batch into AWAIT_INFO.
    expect(result.unanswered).toEqual(["q two?", "q three?"]);
    expect(notes.join(" ")).toContain("exhausted");
  });

  it("an over-reporting backend cannot push the counter past the ceiling", async () => {
    const root = repo();
    const result = await planResearch(["q?"], {
      root,
      budget: 16,
      researchOne: async (question) => ({ brief: VALID_BRIEF(question), toolCalls: 9999 }),
    });
    expect(result.toolCallsUsed).toBe(16);
  });

  it("a brief citing a URL with no local_search is refused — X-6a, the SHARED validator", async () => {
    const root = repo();
    const question = "unfamiliar API?";
    const result = await planResearch([question], {
      root,
      budget: 16,
      researchOne: async () => ({
        brief: { ...VALID_BRIEF(question), local_search: { docs_checked: [], code_checked: [] } },
        toolCalls: 2,
      }),
    });
    expect(result.briefs).toEqual([]);
    expect(result.unanswered).toEqual([question]);
    expect(existsSync(planningBriefPath(root, questionHash(question)))).toBe(false);
  });

  it("planning and failure research keep SEPARATE budgets (two counters, D-11)", () => {
    expect(BUDGETS.planning_research_tool_calls).toBe(16);
    expect(BUDGETS.failure_research_tool_calls).toBe(8);
    expect(CEILINGS.planning_research_tool_calls.scope).toBe("init");
    expect(CEILINGS.failure_research_tool_calls.scope).toBe("research-session");
  });

  it("research answers a blocking question so ANALYZE completes without interrupting", async () => {
    const root = repo({ "PRD.md": "# uses an unfamiliar API\n" });
    const question = "Does the v3 API still accept callbacks?";
    const outcome = await analyzeStage({
      root,
      docs: ["PRD.md"],
      stackMarkers: ["package.json"],
      launch: async () => {
        writeFileSync(
          analysisPath(root),
          JSON.stringify({ ...ANALYSIS_BROWNFIELD, questions: [{ id: "q1", question, blocking: true }] }),
        );
      },
      research: { budget: 16, researchOne: async () => ({ brief: VALID_BRIEF(question), toolCalls: 2 }) },
    });

    // The question was researched, not asked: no interrupt at all.
    expect(outcome.kind).toBe("complete");
    if (outcome.kind !== "complete") throw new Error("unreachable");
    expect(outcome.outputs["research_tool_calls"]).toBe(2);
    expect((outcome.outputs["research_briefs"] as string[])[0]).toBe(questionHash(question));
  });

  it("briefs live in the committed research/planning tree (F-1, P8)", async () => {
    const root = repo();
    const question = "shared knowledge?";
    await planResearch([question], { root, budget: 16, researchOne: async () => ({ brief: VALID_BRIEF(question), toolCalls: 1 }) });
    const file = planningBriefPath(root, questionHash(question));
    expect(file.startsWith(path.join(stateDir(root), "research", "planning"))).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ question });
  });
});
