import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initLayout, stateDir } from "../../src/fs/layout.js";
import { analysisPath, analysisSkeleton, analyzeStage, isGreenfield } from "../../src/init/analyze.js";
import { planDraftSkeleton } from "../../src/init/plan.js";
import { analysisSchema, planDraftSchema } from "../../src/schemas/init.js";
import { DOC_PATTERNS, awaitDocsMessage, discoverDocs } from "../../src/init/discover-docs.js";
import { planResearch, planningBriefPath, questionHash } from "../../src/init/plan-research.js";
import { buildPipeline } from "../../src/init/pipeline.js";
import { guardToolUse, type GuardPolicy } from "../../src/sessions/guard.js";
import { runInit } from "../../src/init/machine.js";
import { CEILINGS } from "../../src/schemas/budgets.js";
import type { Budgets } from "../../src/schemas/budgets.js";
import { MockBackend, okResult, outageResult, type StageFn } from "../../src/sessions/mock.js";
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

/*
 * ---------------------------------------------------------------------------
 * T-061
 */

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
    /** N-2 */
    expect(discoverDocs(root).docs).toEqual(found.docs);
    /** Source and manifests are not planning documents. */
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

  it("T-140: the expected_output skeletons parse through their own schemas — the contract cannot drift", () => {
    /**
     * The live ANALYZE session followed its prompt into a plan-shaped
     * mega-document the strict validator refused. The skeletons ARE the
     * contract the session sees; these parses pin them to the schemas.
     */
    expect(analysisSchema.parse(analysisSkeleton(true)).stack?.language).toBeTruthy();
    expect(analysisSchema.parse(analysisSkeleton(false)).stack).toBeNull();
    expect(planDraftSchema.parse(planDraftSkeleton()).tickets).toHaveLength(1);
  });

  it("C-2′ (PRDR-066): an infix prd document is a planning document — N-7's own filename discovers", () => {
    /** Found by T-140's first live firing: the gate names detent-prd-v3.md. */
    const root = repo({ "detent-prd-v3.md": "# the prd\n", "acme-PRD-draft.md": "# theirs\n" });
    expect(discoverDocs(root).docs).toEqual(["acme-PRD-draft.md", "detent-prd-v3.md"]);
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

/*
 * ---------------------------------------------------------------------------
 * T-062
 */

const ANALYSIS_BROWNFIELD = {
  schema_version: 1,
  summary: "An existing TypeScript service with vitest already wired.",
  stack: null,
  questions: [],
  assumptions: [{ claim: "tests live under tests/", evidence: "tests/ exists" }],
  docs_read: ["PRD.md"],
};

/** C-2‴: one slice over the whole pack — what SLICE produces for a small product. */
const ONE_SLICE = {
  schema_version: 1,
  slices: [{ id: "s01", title: "the product", goal: "it works end to end", requirement_ids: [], baseline_items: [], docs: [], depends_on: [], expected_tickets: 3, rationale: "" }],
  questions: [],
};

/**
 * The planner serves several phases (ANALYZE, SLICE, PLAN); which artifact it
 * must write is named in the spec, so the fixture answers the request rather
 * than guessing from call order.
 */
const plannerStage =
  (analysis: object, draft: object): StageFn =>
  (spec) => {
    const payload = spec.artifactOut.endsWith("plan-draft.json") ? draft : spec.artifactOut.endsWith("slices.json") ? ONE_SLICE : analysis;
    writeFileSync(spec.artifactOut, `${JSON.stringify(payload)}\n`);
    return okResult();
  };

const DRAFT = {
  schema_version: 1,
  tickets: [
    {
      id: "t-100",
      type: "feature",
      title: "Ship the thing",
      description: "",
      acceptance_criteria: ["the thing ships"],
      non_goals: [],
      surface: ["src/**"],
      depends_on: [],
      risk_label: false,
    },
  ],
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
    /** D-10: the stack decision is an ANALYZE output that T-064 consumes. */
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
          /** stack: null */
          writeFileSync(analysisPath(root), JSON.stringify(ANALYSIS_BROWNFIELD));
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

  it("missing info no longer stops ANALYZE: every open question rides to PRESENT with its assumption (C-3′, PRDR-117)", async () => {
    const root = repo({ "PRD.md": "# vague\n" });
    const notes: string[] = [];
    const outcome = await analyzeStage({
      root,
      docs: ["PRD.md"],
      stackMarkers: ["package.json"],
      note: (t) => notes.push(t),
      launch: async () => {
        writeFileSync(
          analysisPath(root),
          JSON.stringify({
            ...ANALYSIS_BROWNFIELD,
            questions: [
              { id: "q1", question: "Which database backs the ledger?", blocking: true },
              { id: "q2", question: "Is multi-tenancy in scope for v1?", blocking: false, assumption: "single tenant" },
              { id: "q3", question: "Preferred log format?", blocking: false, assumption: "JSON lines" },
            ],
          }),
        );
      },
    });

    /** C-3′: the phase completes; the batch is asked once, with the whole plan, at PRESENT. */
    expect(outcome.kind).toBe("complete");
    if (outcome.kind !== "complete") throw new Error("unreachable");
    const open = outcome.outputs["open_questions"] as { id: string; blocking: boolean; assumption: string }[];
    expect(open.map((q) => q.id)).toEqual(["q1", "q2", "q3"]);
    expect(open.filter((q) => q.blocking).map((q) => q.id)).toEqual(["q1"]);
    expect(open[1]!.assumption).toBe("single tenant");
    expect(notes.join(" ")).toContain("carried to PRESENT");
    expect(notes.join(" ")).toContain("blocking");
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

  /**
   * PRDR-176 — AGENTS.md reaches init sessions.
   *
   * `InitSessionDeps.rulesText` was declared and consumed by
   * `launchInitSession`, and `pipeline.ts` — the only production caller — never
   * supplied it, so every planning session was prompted with the literal
   * `(no rules file)` while the rules file's own header claims it is fed to
   * every session Detent launches. Asserted on the spec the backend actually
   * receives, because the defect was precisely that the declared seam had no
   * supplier.
   */
  it("a planning session is told the repository's rules (PRDR-176)", async () => {
    const marker = "RULE-MARKER-176: named exports only";
    const root = repo({
      "PRD.md": "# thing\n",
      "package.json": '{"scripts":{"test":"vitest run"}}\n',
      "AGENTS.md": `# Rules\n\n- ${marker}\n`,
    });
    const backend = new MockBackend({ planner: plannerStage(ANALYSIS_BROWNFIELD, DRAFT) });
    const handlers = buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS });
    await runInit(root, handlers);

    const call = backend.calls.find((c) => c.role === "planner");
    expect(call, "a planner session must have run").toBeDefined();
    expect(call!.spec.promptPrefix, "the session must be told the rules it is expected to follow").toContain(marker);
    expect(call!.spec.promptPrefix, "and must not be told there are none").not.toContain("(no rules file)");
  });

  /**
   * SEC-3 (PRDR-184) — the init session may write its artifact, judged by the
   * REAL guard against the REAL policy.
   *
   * `analysisPath` is `.detent/state/analysis.json`; PRDR-149 added
   * `.detent/state/**` to the structural floor, correctly — it holds the
   * checkpoints and the run lock. Protected globs are consulted before the
   * surface, so from that commit every init session was denied the one write it
   * exists to make, and `init` died at ANALYZE. No test caught it because every
   * init test uses `MockBackend`, which writes artifacts with `fs` and never
   * runs the guard. This one asks the guard directly.
   */
  it("an init session can write its own artifact and nothing else under the floor (PRDR-184)", async () => {
    const root = repo({ "PRD.md": "# thing\n", "package.json": '{"scripts":{"test":"vitest run"}}\n' });
    const backend = new MockBackend({ planner: plannerStage(ANALYSIS_BROWNFIELD, DRAFT) });
    const handlers = buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS });
    await runInit(root, handlers);

    const spec = backend.calls.find((c) => c.role === "planner")?.spec;
    expect(spec?.policy, "the init arm must publish a policy").toBeDefined();
    const policy = spec!.policy as GuardPolicy;
    const identity = (p: string): string => p;

    expect(
      guardToolUse("Write", { file_path: spec!.artifactOut }, policy, identity).decision,
      "the artifact is the one write an init session exists to make",
    ).toBe("allow");
    for (const [label, file] of [
      ["another checkpoint", path.join(root, ".detent", "state", "PLAN.json")],
      ["the run lock", path.join(root, ".detent", "state", "run.lock")],
      ["the ledger", path.join(root, ".detent", "ledger.jsonl")],
      ["git's own config", path.join(root, ".git", "config")],
    ] as [string, string][]) {
      expect(guardToolUse("Write", { file_path: file }, policy, identity).decision, label).toBe("deny");
    }
  });

  it("the planner session gets the read-only surface plus ONE scoped write — its artifact (S-1′, PRDR-067)", async () => {
    const root = repo({ "PRD.md": "# thing\n", "package.json": '{"scripts":{"test":"vitest run"}}\n' });
    const backend = new MockBackend({ planner: plannerStage(ANALYSIS_BROWNFIELD, DRAFT) });
    const handlers = buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS });
    await runInit(root, handlers);

    const call = backend.calls.find((c) => c.role === "planner");
    expect(call).toBeDefined();
    /**
     * Plan mode would deny the very write C-3 demands — T-140's first live
     * read-only session proved it in seconds. Default mode; read-only-ness is
     * the allowlist (no general write tool) plus the D-21 hook.
     */
    expect(call!.spec.permissionMode).toBe("");
    expect(call!.spec.allowedTools.slice(0, 3)).toEqual(["Read", "Grep", "Glob"]);
    expect(call!.spec.allowedTools).not.toContain("Write");
    expect(call!.spec.allowedTools).not.toContain("Edit");
    /**
     * S-1″ (PRDR-124): the allowlist's one write rule is only true if the
     * hook's surface agrees. The backend's fallback policy was `**`, and a
     * mutating call the guard clears returns a TERMINAL allow, so the
     * allowlist was never reached — a planner asked for one artifact wrote its
     * draft as `<slice>-part1.json` and `-part2.json` instead, and the phase
     * found nothing where it was told to look.
     */
    expect(call!.spec.policy?.surface).toEqual([".detent/state/analysis.json"]);
    expect(call!.spec.policy?.workRoot).toBe(root);
    for (const shut of [".detent/plan/**", ".detent/config.json", ".detent/bindings.json"]) {
      expect(call!.spec.policy?.protectedGlobs).toContain(shut);
    }
    const writeRules = call!.spec.allowedTools.filter((t) => t.startsWith("Write("));

    expect(writeRules).toHaveLength(1);
    expect(writeRules[0]).toBe(`Write(/${call!.spec.artifactOut})`);
    expect(writeRules[0]).toContain(".detent/state/analysis.json");
  });
});

/*
 * ---------------------------------------------------------------------------
 * T-063
 */

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
        /* The first question burns the whole allowance. */
        return { brief: VALID_BRIEF(question), toolCalls: 16 };
      },
    });

    expect(launched).toBe(1);
    expect(result.toolCallsUsed).toBe(16);
    expect(result.toolCallsUsed).toBeLessThanOrEqual(BUDGETS.planning_research_tool_calls);
    /** C-3a: no new interrupt class — the unanswered questions batch into AWAIT_INFO. */
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

    /** The question was researched, not asked: no interrupt at all. */
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

/**
 * PRDR-185 — a backend outage during init is waited out, not fatal.
 *
 * Found by a live planning run that hit four session limits, each ending the
 * command and needing a human to notice and restart. `kernel/driver.ts` has
 * backed off since PRDR-112; `init` had nothing, so `detent run` waited and
 * `detent init` died. The sleep is injected so this costs no wall clock.
 */
describe("PRDR-185 init waits out a backend outage", () => {
  const limit = "Claude Code returned an error result: You've hit your session limit · resets 5:20pm";

  it("retries after a session limit and completes on the next attempt", async () => {
    const root = repo({ "PRD.md": "# thing\n", "package.json": '{"scripts":{"test":"vitest run"}}\n' });
    let calls = 0;
    const waits: number[] = [];
    const flaky: StageFn = (spec) => {
      calls += 1;
      /* PRDR-188: DERIVED from the SDK shape, not hand-built — the gap PRDR-187 lived in. */
      if (calls === 1) return outageResult(limit);
      return plannerStage(ANALYSIS_BROWNFIELD, DRAFT)(spec);
    };
    const notes: string[] = [];
    const handlers = buildPipeline({
      root,
      backend: new MockBackend({ planner: flaky }),
      prompts: PROMPTS,
      budgets: BUDGETS,
      note: (t) => notes.push(t),
      sleep: async (ms: number) => {
        waits.push(ms);
      },
    });
    await runInit(root, handlers);

    expect(calls, "the first attempt is the outage, the second is the work").toBeGreaterThanOrEqual(2);
    expect(waits[0], "PRDR-112's first step is one minute").toBe(60_000);
    expect(notes.join(" "), "a silent fifteen-minute wait is worse than a failure").toContain("backend outage");
  }, 30_000);

  it("gives up on a failure that is not an outage, without waiting", async () => {
    const root = repo({ "PRD.md": "# thing\n", "package.json": '{"scripts":{"test":"vitest run"}}\n' });
    const waits: number[] = [];
    const broken: StageFn = () => outageResult("the model refused: the PRD contradicts itself");
    const handlers = buildPipeline({
      root,
      backend: new MockBackend({ planner: broken }),
      prompts: PROMPTS,
      budgets: BUDGETS,
      sleep: async (ms: number) => {
        waits.push(ms);
      },
    });
    await expect(runInit(root, handlers)).rejects.toThrow(/contradicts itself/);
    expect(waits, "a real failure must not be retried as though it were transport").toEqual([]);
  }, 30_000);
});
