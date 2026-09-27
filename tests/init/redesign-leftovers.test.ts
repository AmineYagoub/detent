import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main as initMain } from "../../src/cli/init.js";
import { LAYOUT, initLayout, stateDir } from "../../src/fs/layout.js";
import { determineVerification } from "../../src/init/bind.js";
import { readPresentation } from "../../src/init/present.js";
import { withOneRelaunch } from "../../src/init/retry.js";
import { symbolReminder } from "../../src/init/symbol-reminder.js";
import { claimHash } from "../../src/init/audit-claims.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { claimBriefSchema } from "../../src/schemas/audit.js";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { buildOptions } from "../../src/sessions/sdk.js";
import { git, gitInit, removeTree, tmpTree, writeTree } from "../helpers.js";
import { seeded } from "./seed-fixture.js";

/**
 * PRDR-298 (C-3⁵) — what the planning redesign replaced is deleted, and what
 * the planning audit found describing more than the code does says what it does.
 *
 * September's patches kept most of what they replaced. Planning research wrote
 * briefs no phase read; the question machinery outlived every stage that asked;
 * a setup-consent engine no path reached was described to operators as the way
 * AWAIT_SETUP_CONSENT is answered; the backend kept a streaming signal and a
 * told-path alias for draws that no longer exist; and doc-blocks went on
 * describing a spend gate PRDR-265 had removed.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

const source = (rel: string): string => readFileSync(rel, "utf8");

describe("PRDR-298: planning research is gone from init, and AUDIT keeps its engine (C-3⁵)", () => {
  it("its module and the launch switch that gave a planner the web are gone", () => {
    expect(existsSync("src/init/plan-research.ts")).toBe(false);
    expect(source("src/init/session.ts"), "no init launch asks for research tools by a flag").not.toContain("withWeb");
  });

  it("its brief schema and its cache directory are gone", async () => {
    const schemas = await import("../../src/schemas/init.js");
    expect(Object.keys(schemas)).not.toContain("planningBriefSchema");
    expect(LAYOUT.map((e) => e.rel)).not.toContain("research/planning");
  });

  it("the research prompt answers a failing ticket alone", () => {
    const prompt = source("prompts/research.md");
    expect(prompt).not.toContain("PLANNING question");
    expect(prompt).not.toContain("question_hash");
  });

  it("AUDIT's claim briefs keep X-6a's rule: a page cited without a local search is refused", () => {
    const hash = claimHash("the SDK streams events", "sdk@1.0.0");
    const brief = {
      schema_version: SCHEMA_VERSION,
      claim: "the SDK streams events",
      claim_hash: hash,
      verdict: "confirmed",
      source: "https://example.com/sdk",
      evidence: [{ source: "https://example.com/sdk", claim: "it streams" }],
      sources_consulted: [{ tier: 3, ref: "the SDK's docs" }],
      local_search: { docs_checked: [], code_checked: [] },
      what_would_falsify: "a release that drops the stream",
    };
    expect(claimBriefSchema.safeParse(brief).success).toBe(false);
    expect(claimBriefSchema.safeParse({ ...brief, local_search: { docs_checked: ["docs/"], code_checked: [] } }).success).toBe(true);
  });
});

describe("PRDR-298: DECIDE owns questions (C-3⁵)", () => {
  it("the similarity DECIDE uses is DECIDE's own, and questions.ts is gone", async () => {
    expect(existsSync("src/init/questions.ts")).toBe(false);
    const { similarQuestions } = await import("../../src/init/decide-items.js");
    expect(similarQuestions("Which npm identity publishes Detent?", "Which npm identity publishes the driver?")).toBe(true);
  });

  it("DISCOVER records no search patterns, which nothing reads", async () => {
    const s = seeded();
    await s.init();
    const discover = JSON.parse(readFileSync(path.join(stateDir(s.root), "state", "DISCOVER.json"), "utf8")) as { outputs: Record<string, unknown> };
    expect(Object.keys(discover.outputs)).not.toContain("patterns_searched");
  });
});

describe("PRDR-298: the setup-consent engine nothing reached is gone, and nothing describes it (C-3⁵)", () => {
  it("its modules, and the plan seams only tests used, are gone", async () => {
    for (const file of ["src/init/consent.ts", "src/init/allowlist.ts"]) expect(existsSync(file), file).toBe(false);
    const plan = await import("../../src/init/plan.js");
    expect(Object.keys(plan)).not.toContain("bootstrapBlocks");
    expect(Object.keys(plan)).not.toContain("planPath");
  });

  it("AWAIT_SETUP_CONSENT offers no setup command, since Detent runs none", async () => {
    const root = tmpTree({ "PRD.md": "# spec\n" });
    roots.push(root);
    gitInit(root);
    writeTree(root, { "seed.txt": "seed\n" });
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "init");
    initLayout(root);
    const outcome = await determineVerification({ root, greenfield: false, timeoutMs: 30_000 });
    expect(outcome.kind === "interrupt" ? outcome.interrupt : outcome.kind).toBe("AWAIT_SETUP_CONSENT");
    const message = outcome.kind === "interrupt" ? outcome.message : "";
    expect(message).not.toMatch(/propose|allowlist/u);
    expect(message).toContain("Detent runs no setup command");
  });

  it("`detent init` outside a repository promises no engine", async () => {
    const root = tmpTree({ "PRD.md": "# product\n" });
    roots.push(root);
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      expect(await initMain([root])).toBe(2);
      const said = err.mock.calls.join("");
      expect(said).toMatch(/not a git repository/u);
      expect(said).not.toMatch(/T-065|setup-consent engine/u);
    } finally {
      err.mockRestore();
    }
  });

  it("the init skill does not say Detent runs setup commands", () => {
    const skill = source("skills/init/SKILL.md");
    expect(skill).not.toContain("executes setup commands");
    expect(skill).not.toContain("consenting to the proposal");
  });
});

describe("PRDR-298: what the audit named describes what the code does (C-3⁵)", () => {
  it("`readPresentation` returns null for a file that will not parse, as its doc-block says", () => {
    const root = tmpTree({});
    roots.push(root);
    mkdirSync(path.join(stateDir(root), "plan"), { recursive: true });
    writeFileSync(path.join(stateDir(root), "plan", "presentation.json"), '{"schema_version": 2, "presentation": "torn');
    expect(readPresentation(root)).toBeNull();
  });

  it("the symbol reminder says which sessions symbol tools reach: `run`'s, never planning's", () => {
    const message = symbolReminder(undefined, [{ tag: "coherence", ticket: "t-1", finding: "contradicts `v1.TerminalStates`" }]) ?? "";
    expect(message).toContain("Symbol intelligence is not configured");
    expect(message).not.toContain("could have checked mechanically");
    expect(message).toContain("the sessions `detent run` launches");
  });

  it("a second unusable artifact is not announced as a failed phase: its caller says what follows", async () => {
    const notes: string[] = [];
    const result = await withOneRelaunch({ stage: "claim brief", note: (t) => notes.push(t) }, async () => ({ value: null, issue: "no artifact written" }));
    expect(result.value).toBeNull();
    expect(notes.at(-1)).toContain("claim brief artifact unusable again (no artifact written)");
    expect(notes.join("\n"), "AUDIT records such a claim unverified and goes on").not.toContain("the phase fails");
  });

  it.each([
    ["src/init/session.ts", "the ceiling is a launch gate"],
    ["src/init/session.ts", "D-25 gate"],
    ["src/init/plan-slices.ts", "buys its next budget"],
    ["src/init/retry.ts", "one relaunch for every strict planning artifact"],
    ["src/init/contracts.ts", "four tickets each edited"],
  ])("%s no longer says %j", (file, stale) => {
    expect(source(file)).not.toContain(stale);
  });
});

describe("PRDR-298: the backend carries nothing for draws that no longer exist (C-3⁵)", () => {
  const SPEC: SessionSpec = {
    role: "implement",
    ticketId: "t1",
    promptPrefix: "prefix",
    promptVariable: "{}",
    cwd: "/wt",
    artifactOut: "/wt/.detent/runs/t1/implement.json",
    allowedTools: ["Edit", "Write"],
    permissionMode: "",
    model: "",
  };

  it("no session asks for the event stream: nothing waits on a first response", () => {
    const options = buildOptions({ ...SPEC, onFirstResponse: () => undefined } as SessionSpec, { policy: { surface: ["src/**"], protectedGlobs: [], workRoot: "/wt" } });
    expect("includePartialMessages" in options).toBe(false);
  });

  it("the guard carries no write from a told path to another", async () => {
    expect(Object.keys(await import("../../src/sessions/guard.js"))).not.toContain("carryArtifact");
  });

  it("the plan corpus reads no ledger it reports to nobody", async () => {
    const corpus = Object.keys(await import("../../scripts/plan-corpus.js"));
    expect(corpus).not.toContain("readLedger");
    expect(corpus).not.toContain("ledgerSpend");
  });
});
