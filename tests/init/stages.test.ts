import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initLayout, stateDir } from "../../src/fs/layout.js";
import { analysisPath, analysisSkeleton, analyzeStage, isGreenfield } from "../../src/init/analyze.js";
import { planDraftSkeleton } from "../../src/init/plan.js";
import { presentStage } from "../../src/init/present.js";
import { analysisSchema, planDraftSchema } from "../../src/schemas/init.js";
import { DOC_PATTERNS, awaitDocsMessage, discoverDocs } from "../../src/init/discover-docs.js";
import { planResearch, planningBriefPath, questionHash } from "../../src/init/plan-research.js";
import { buildPipeline } from "../../src/init/pipeline.js";
import { msUntilReset } from "../../src/init/session.js";
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

/**
 * PRDR-264: `researchOne` no longer RETURNS a brief — the session writes
 * `artifactOut` and `planResearch` reads it back, so the file and the
 * validation stay together and a stale artifact cannot answer for a session
 * that produced nothing (D-19). This builds the launcher each case needs.
 */
const writes = (brief: (q: string) => object, toolCalls: number) => (question: string, _share: number, artifactOut: string) => {
  mkdirSync(path.dirname(artifactOut), { recursive: true });
  writeFileSync(artifactOut, JSON.stringify(brief(question)), "utf8");
  return Promise.resolve({ toolCalls });
};

describe("T-063 planning research (C-3a, D-11)", () => {
  it("an answered question yields a cited brief, cached by question hash", async () => {
    const root = repo();
    const question = "Does the v3 API still accept callbacks?";
    const result = await planResearch([question], {
      root,
      budget: 16,
      researchOne: writes(VALID_BRIEF, 3),
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
    await planResearch([question], { root, budget: 16, researchOne: writes(VALID_BRIEF, 3) });

    let launched = 0;
    const second = await planResearch([question], {
      root,
      budget: 16,
      researchOne: (q, share, artifactOut) => {
        launched += 1;
        return writes(VALID_BRIEF, 3)(q, share, artifactOut);
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

  it("the 16-call pool is DIVIDED per init, and every question gets its share", async () => {
    const root = repo();
    const questions = ["q one?", "q two?", "q three?"];
    const notes: string[] = [];
    let launched = 0;

    const result = await planResearch(questions, {
      root,
      budget: 16,
      note: (t) => notes.push(t),
      researchOne: (question, share, artifactOut) => {
        launched += 1;
        /* Every session tries to take the whole allowance; PRDR-262 is why none of them can. */
        return writes(VALID_BRIEF, 16)(question, share, artifactOut);
      },
    });

    /**
     * PRDR-262: this used to assert `launched === 1` with the comment "the
     * first question burns the whole allowance" — the live defect written down
     * as the specification, which is why nothing detected it. The per-init
     * ceiling was never the defect and still holds exactly; what changed is
     * that holding it no longer costs the other questions their session.
     */
    expect(launched, "a question that overruns cannot take another question's share of the division").toBe(3);
    /**
     * PRDR-265 (D-18): this asserted `toolCallsUsed === 16` and `<= BUDGETS
     * .planning_research_tool_calls`, which was true only because the charge
     * was clamped to each share. Three sessions each reporting 16 calls really
     * made 48, and the pool cannot refuse any of them — so 48 is what the
     * operator is shown. The DIVISION is what this test is about and is
     * unchanged: each question was still asked for its own cut, which is what
     * `launched === 3` and the "is held for" note below pin.
     */
    expect(result.toolCallsUsed, "three sessions at 16 calls apiece is 48, whatever the pool said").toBe(48);
    expect(result.toolCallsUsed).toBeGreaterThan(BUDGETS.planning_research_tool_calls);
    expect(result.unanswered, "all three were researched, and all three parsed").toEqual([]);
    expect(notes.join(" "), "the division is reported so an operator can see why a share was small").toContain("is held for");
    expect(notes.join(" "), "and so is the overrun, which is the half the clamp used to hide").toContain("OVERRAN");
  });

  /**
   * PRDR-265 turned this one around too, and it is the clearest single case.
   * The old title was "an over-reporting backend cannot push the counter past
   * the ceiling" and it asserted 16 — a session that reported 9999 calls was
   * recorded as having made 16. Whether the backend is over-reporting or the
   * session really did run away, 16 is the one answer that is certainly wrong,
   * and it is what run 4 showed the operator (D-18).
   */
  it("a session reporting far past its share is counted at what it reported", async () => {
    const root = repo();
    const notes: string[] = [];
    const result = await planResearch(["q?"], {
      root,
      budget: 16,
      note: (t) => notes.push(t),
      researchOne: writes(VALID_BRIEF, 9999),
    });
    expect(result.toolCallsUsed, "an implausible figure is an observation, not a number to round down").toBe(9999);
    expect(notes.join(" "), "and it is flagged against the share it was asked for").toContain("OVERRAN");
  });

  it("a brief citing a URL with no local_search is refused — X-6a, the SHARED validator", async () => {
    const root = repo();
    const question = "unfamiliar API?";
    const result = await planResearch([question], {
      root,
      budget: 16,
      researchOne: writes((q) => ({ ...VALID_BRIEF(q), local_search: { docs_checked: [], code_checked: [] } }), 2),
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
      research: { budget: 16, researchOne: writes(VALID_BRIEF, 2) },
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
    await planResearch([question], { root, budget: 16, researchOne: writes(VALID_BRIEF, 1) });
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
  /**
   * PRDR-189: an outage that states NO reset time — the ladder is for exactly
   * those. A message naming a reset takes the other path and is covered below.
   */
  const limit = "Claude Code returned an error result: upstream overloaded, try again";

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

/**
 * PRDR-189 — a usage limit names its own reset time, and the wait honours it.
 *
 * PRDR-185's 1/5/15 ladder is right for a transient outage and wrong for a
 * usage window. Observed live on the gate run: three retries exhausted in 21
 * minutes against a limit that reset hours later, and `init` died having done
 * everything correctly at every step.
 *
 * The messages below are verbatim from that run's log.
 */
describe("PRDR-189 the wait honours the reset the limit states", () => {
  const LIVE = "Claude Code returned an error result: You've hit your session limit · resets 10:30pm (Africa/Algiers)";

  /** 21:00 in Algiers (UTC+1) — 90 minutes before a 22:30 reset there. */
  const at = (iso: string): Date => new Date(iso);

  it("reads the live message and waits until the stated time, not the ladder", () => {
    const ms = msUntilReset(LIVE, at("2026-09-08T20:00:00Z"));
    expect(ms, "21:00 Algiers → 22:30 Algiers is 90 minutes").not.toBeNull();
    expect(Math.round((ms as number) / 60_000), "plus the one-minute margin").toBe(91);
  });

  /**
   * The zone is not decoration. Africa/Algiers is UTC+1 all year and the
   * machine that hit this was on CEST (UTC+2), so reading "10:30pm" as LOCAL
   * time waits an hour early and the retry fails again — a wait that looks like
   * it honoured the reset and did not.
   */
  /**
   * The zone is not decoration, and this must hold wherever the suite runs —
   * the machine that found the defect happens to BE on Africa/Algiers, which is
   * exactly the coincidence that would make a naive implementation look right.
   * Two explicitly different zones, five hours apart, independent of the runner.
   */
  it("honours the named zone rather than the runner's own clock", () => {
    const when = at("2026-09-08T20:00:00Z");
    const algiers = msUntilReset("resets 10:30pm (Africa/Algiers)", when) as number;
    const newYork = msUntilReset("resets 10:30pm (America/New_York)", when) as number;
    expect(algiers, "21:00 in Algiers → 22:30 there").not.toBeNull();
    expect(newYork, "16:00 in New York → 22:30 there").not.toBeNull();
    expect(Math.round((newYork - algiers) / 60_000), "the two zones are five hours apart").toBe(5 * 60);
  });

  it("rolls to tomorrow when the stated time has already passed there", () => {
    const ms = msUntilReset(LIVE, at("2026-09-08T22:00:00Z")) as number;
    expect(ms, "23:00 Algiers is past 22:30, so the next one is tomorrow").toBeGreaterThan(23 * 60 * 60_000);
  });

  it("says nothing about a message that states no reset", () => {
    expect(msUntilReset("Claude Code returned an error result: overloaded")).toBeNull();
    expect(msUntilReset("resets soon")).toBeNull();
  });

  it("waits for the reset instead of the ladder, and says which it is doing", async () => {
    const root = repo({ "PRD.md": "# thing\n", "package.json": '{"scripts":{"test":"vitest run"}}\n' });
    let calls = 0;
    const waits: number[] = [];
    const notes: string[] = [];
    const flaky: StageFn = (spec) => {
      calls += 1;
      if (calls === 1) return outageResult(LIVE);
      return plannerStage(ANALYSIS_BROWNFIELD, DRAFT)(spec);
    };
    const handlers = buildPipeline({
      root,
      backend: new MockBackend({ planner: flaky }),
      prompts: PROMPTS,
      budgets: BUDGETS,
      note: (t) => notes.push(t),
      /* 21:00 in Algiers, 90 minutes before the stated 22:30 reset. */
      now: () => at("2026-09-08T20:00:00Z"),
      sleep: async (ms: number) => {
        waits.push(ms);
      },
    });
    await runInit(root, handlers);

    expect(Math.round((waits[0] ?? 0) / 60_000), "the stated reset, not the ladder's one minute").toBe(91);
    expect(notes.join(" "), "and the operator is told which kind of wait this is").toContain("for the stated reset");
  }, 30_000);
});

/**
 * PRDR-166 — an instruction the reader can act on, and a signal when they could not.
 *
 * `init` halted at AWAIT_INFO saying "Answer them in the planning documents and
 * re-run". Following that literally — `planning-answers.md` at the root — changed
 * nothing: DISCOVER matches `PRD*.md`, a docs-tree glob and twelve more, and
 * that file matches none. ANALYZE re-derived, the same question came back, and the
 * failure was indistinguishable from an answer judged inadequate. The cost is a
 * full ANALYZE round per wrong guess.
 */
describe("PRDR-166 AWAIT_INFO says where an answer goes, and when one was missed", () => {
  const blocking = [{ id: "q1", question: "which npm account publishes this?", blocking: true, assumption: "none" }];

  it("names the patterns DISCOVER actually searched, rather than a second copy", async () => {
    const outcome = await presentStage({
      root: "/tmp/x",
      tickets: [],
      bindings: [],
      skips: [],
      bootstrap: null,
      assignments: {},
      slices: [],
      questions: blocking,
      findings: [],
      derivedEdges: [],
      gateNotices: [],
      docPatterns: ["PRD*.md", "docs/**/*.md"],
    });
    expect(outcome.kind).toBe("interrupt");
    const message = outcome.kind === "interrupt" ? outcome.message : "";
    expect(message).toContain("PRD*.md");
    expect(message).toContain("docs/**/*.md");
  });

  it("still asks the question when it does not know the patterns", async () => {
    const outcome = await presentStage({
      root: "/tmp/x",
      tickets: [],
      bindings: [],
      skips: [],
      bootstrap: null,
      assignments: {},
      slices: [],
      questions: blocking,
      findings: [],
      derivedEdges: [],
      gateNotices: [],
    });
    expect(outcome.kind).toBe("interrupt");
    const message = outcome.kind === "interrupt" ? outcome.message : "";
    expect(message).toContain("which npm account");
  });
});
