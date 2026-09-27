import { existsSync, symlinkSync } from "node:fs";
import path from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { launchInitSession, withInitJournal } from "../../src/init/session.js";
import { guardToolUse, type GuardPolicy } from "../../src/sessions/guard.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { buildOptions, ClaudeCodeBackend } from "../../src/sessions/sdk.js";
import { CONFORMING_PACK } from "./pack-fixture.js";
import { PROMPTS, planning } from "./plan-fixture.js";
import { clear, planned, seeded, sliced, type Json, type Seeded } from "./seed-fixture.js";

/**
 * PRDR-292 — one prompt per planning job, and planner sessions that read and
 * write their artifact and nothing else (C-4⁵, D-28″).
 *
 * One 1,826-word prompt served SLICE, PLAN and the review, and cited Detent PRD
 * ids no input defines. Of the planning audit's 6,117 tool calls, 2,846 were
 * read-only Bash and 97 tried to spawn a subagent, none of which a planner's
 * allowlist names: the platform grants read-only Bash in default mode.
 */

const JOBS = { SLICE: "slice", PLAN: "plan", REVIEW_PLAN: "plan_review" } as const;

/** A Detent PRD mark or ticket id: `C-2‴`, `A-1⁵`, `PRDR-120`, `P2`, `T-047`. */
const PRD_ID = /(?:PRDR-\d+|\b[A-Z]{1,3}-\d+[a-z]?[′″‴⁗⁵⁶⁷⁸⁹¹⁰²³⁴]*|\bP\d{1,2}\b|\bT-\d{3}\b)/u;

const prompts = (): Readonly<Record<string, string>> => PROMPTS.prompts as unknown as Record<string, string>;

/** The policy the hook of `stage`'s first session was built with. */
const policyOf = (s: Seeded, stage: keyof typeof JOBS): GuardPolicy => {
  const at = s.inputs.findIndex((i) => i["stage"] === stage);
  const policy = s.specs[at]?.policy;
  if (policy === undefined) throw new Error(`no ${stage} session was launched with a policy`);
  return policy;
};

describe("PRDR-292: one prompt per planning job (C-4⁵)", () => {
  it("planner.md is gone, and SLICE's, PLAN's and the review's prompts are each pinned", () => {
    expect(existsSync("prompts/planner.md")).toBe(false);
    const set = loadPromptSet();
    for (const job of Object.values(JOBS)) {
      expect((set.prompts as unknown as Record<string, string>)[job]?.length ?? 0, `prompts/${job}.md`).toBeGreaterThan(200);
      expect((set.hashes as unknown as Record<string, string>)[job], `prompts/${job}.md is pinned`).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it("each planner session reads its own job's prompt and no other job's", async () => {
    const s = seeded();
    await s.init();
    expect(new Set(s.inputs.map((i) => i["stage"]))).toEqual(new Set(Object.keys(JOBS)));
    for (const [i, spec] of s.specs.entries()) {
      const job = JOBS[s.inputs[i]?.["stage"] as keyof typeof JOBS];
      const own = prompts()[job] ?? "";
      expect(own.length, `${job} has a prompt`).toBeGreaterThan(0);
      expect(spec.promptPrefix).toContain(own.trim());
      for (const other of Object.values(JOBS).filter((j) => j !== job)) {
        expect(spec.promptPrefix, `${job}'s session reads ${other}'s prompt`).not.toContain((prompts()[other] ?? "").trim().slice(0, 160));
      }
    }
  });

  it("no prompt a planner session reads cites a Detent PRD id", async () => {
    for (const job of Object.values(JOBS)) expect((prompts()[job] ?? "").match(PRD_ID)?.[0], `prompts/${job}.md`).toBeUndefined();
    const s = seeded();
    await s.init();
    for (const [i, spec] of s.specs.entries()) {
      const inputs = s.inputs[i] ?? {};
      const told = [spec.promptPrefix, inputs["instruction"], inputs["scope_instruction"], inputs["expected_output"]];
      for (const said of told.map((v) => (typeof v === "string" ? v : JSON.stringify(v ?? "")))) {
        expect(said.match(PRD_ID)?.[0], `${String(inputs["stage"])} reads: ${said.slice(0, 100)}`).toBeUndefined();
      }
    }
  });

  it("a planner session launched for a stage no job has is refused, and is not handed another job's prompt", async () => {
    const s = seeded();
    const backend = new MockBackend({
      ...planning(() => {
        throw new Error("a planner session with no job was run");
      }),
    });
    const artifactOut = path.join(s.root, ".detent", "state", "plan-draft.json");
    for (const inputs of [{}, { stage: "ANALYZE" }]) {
      const launch = withInitJournal(s.root, async (journal) => await launchInitSession({ root: s.root, backend, prompts: PROMPTS, spendCeiling: 100, journal }, { role: "planner", inputs, artifactOut }));
      await expect(launch, JSON.stringify(inputs)).rejects.toThrow(/only SLICE and PLAN have a prompt \(C-4⁵\); the review runs on `plan_review`/u);
    }
  });

  it("an edit to PLAN's or the review's prompt plans every slice again and cuts nothing; an edit to SLICE's cuts again", async () => {
    const s = seeded();
    await s.init();
    const hashes = PROMPTS.hashes as unknown as Record<string, string>;
    const edited = (changes: Readonly<Record<string, string>>): Partial<Parameters<Seeded["init"]>[1]> => ({ prompts: { ...PROMPTS, hashes: { ...hashes, ...changes } as unknown as typeof PROMPTS.hashes } });
    clear(s);
    await s.init({}, edited({ plan: "an edited plan prompt" }));
    expect(sliced(s)).toEqual([]);
    expect(planned(s)).toEqual(["PLAN:s01", "PLAN:s02", "PLAN:s03"]);
    clear(s);
    await s.init({}, edited({ plan: "an edited plan prompt", plan_review: "an edited review prompt" }));
    expect(sliced(s)).toEqual([]);
    expect(planned(s)).toEqual(["PLAN:s01", "PLAN:s02", "PLAN:s03"]);
    clear(s);
    await s.init({}, edited({ plan: "an edited plan prompt", plan_review: "an edited review prompt", slice: "an edited slice prompt" }));
    expect(sliced(s)).toEqual(["SLICE"]);
  });
});

describe("PRDR-292: a planner session reads with Read, Grep and Glob and writes its artifact, and has nothing else (C-4⁵, D-28″)", () => {
  const CONFIG = { policy: { surface: [], protectedGlobs: [], workRoot: "/" } };

  it("SLICE, PLAN and the review are given exactly those tools, and neither Bash nor a subagent", async () => {
    const s = seeded();
    await s.init();
    expect(s.specs.length).toBeGreaterThan(0);
    for (const spec of s.specs) {
      const options = buildOptions(spec, CONFIG);
      expect(options.tools).toEqual(["Read", "Grep", "Glob", "Write"]);
      expect(options.allowedTools).toEqual(["Read", "Grep", "Glob", `Write(/${spec.artifactOut})`]);
    }
  });

  it("a planner session launched through the SDK backend is given exactly those tools", async () => {
    const s = seeded();
    let given: Options | undefined;
    const backend = new ClaudeCodeBackend({
      policy: { surface: [], protectedGlobs: [], workRoot: s.root },
      queryFn: ({ options }) => {
        given = options;
        return (async function* () {
          yield { type: "system", subtype: "init" };
          yield {
            type: "result",
            subtype: "success",
            is_error: false,
            num_turns: 1,
            total_cost_usd: 0.01,
            usage: { input_tokens: 10, output_tokens: 5 },
            modelUsage: { "claude-opus-5": { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.01 } },
            result: "ok",
          };
        })();
      },
    });
    const artifactOut = path.join(s.root, ".detent", "state", "plan-draft.json");
    await withInitJournal(s.root, async (journal) => await launchInitSession({ root: s.root, backend, prompts: PROMPTS, spendCeiling: 100, journal }, { role: "planner", inputs: { stage: "PLAN" }, artifactOut }));
    expect(given?.tools).toEqual(["Read", "Grep", "Glob", "Write"]);
    expect(given?.allowedTools).toEqual(["Read", "Grep", "Glob", `Write(/${artifactOut})`]);
  });

  it("their tools cannot reach the originals under the root's archive/, and reach the rest of the project", async () => {
    const s = seeded({ ...CONFORMING_PACK, "archive/docs/PRD.md": "# The original PRD\n\nThe catalog stores products.\n" });
    await s.init();
    for (const stage of ["SLICE", "PLAN", "REVIEW_PLAN"] as const) {
      const policy = policyOf(s, stage);
      const decide = (tool: string, input: Json): string => guardToolUse(tool, input, policy).decision;
      expect(decide("Read", { file_path: path.join(s.root, "archive", "docs", "PRD.md") }), stage).toBe("deny");
      expect(decide("Read", { file_path: "archive/docs/PRD.md" }), stage).toBe("deny");
      expect(decide("Grep", { pattern: "catalog", path: "archive" }), stage).toBe("deny");
      expect(decide("Grep", { pattern: "catalog" }), `${stage}: a search from the root reaches archive/`).toBe("deny");
      expect(decide("Glob", { pattern: "**/*.md" }), stage).toBe("deny");
      expect(decide("Glob", { pattern: "**" }), `${stage}: \`**\` alone matches every directory`).toBe("deny");
      expect(decide("Glob", { pattern: "*/docs/*.md" }), stage).toBe("deny");
      expect(decide("Read", { file_path: "docs/prd/index.md" }), stage).toBe("abstain");
      expect(decide("Grep", { pattern: "MUST", path: "docs" }), stage).toBe("abstain");
      expect(decide("Glob", { pattern: "docs/**/*.md" }), stage).toBe("abstain");
      expect(decide("Glob", { pattern: "*.md" }), `${stage}: a pattern that cannot descend does not reach archive/`).toBe("abstain");
      expect(decide("Read", { file_path: "docs/archive/notes.md" }), `${stage}: only the root's archive/ holds the originals`).toBe("abstain");
    }
  });

  /** The root is reached through a link here, as a macOS temporary directory is, so the link's destination and the archive are compared resolved. */
  it("a link into archive/ reaches it, wherever the link is", async () => {
    const s = seeded({ ...CONFORMING_PACK, "archive/docs/PRD.md": "# The original PRD\n" });
    await s.init();
    const policy = policyOf(s, "PLAN");
    symlinkSync(path.join("..", "archive", "docs"), path.join(s.root, "docs", "old"));
    expect(guardToolUse("Read", { file_path: "docs/old/PRD.md" }, policy).decision).toBe("deny");
    expect(guardToolUse("Grep", { pattern: "PRD", path: "docs/old" }, policy).decision).toBe("deny");
    expect(guardToolUse("Glob", { pattern: "docs/old/*.md" }, policy).decision, "a Glob whose leading directories are the link").toBe("deny");
  });

  it("where the root holds no archive/, a search from the root is the allowlist's, as before", async () => {
    const s = seeded();
    await s.init();
    const policy = policyOf(s, "PLAN");
    expect(guardToolUse("Grep", { pattern: "MUST" }, policy).decision).toBe("abstain");
    expect(guardToolUse("Glob", { pattern: "**/*.md" }, policy).decision).toBe("abstain");
  });
});
