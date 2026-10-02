import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildClaimsSet } from "../../src/eval/claims-set.js";
import { report } from "../../src/eval/report.js";
import { writeResults, type ReviewsResults } from "../../src/eval/results.js";
import { buildReviewsSet } from "../../src/eval/reviews-set.js";
import { runEvaluation, type EvalDeps } from "../../src/eval/run.js";
import type { PipelineDeps } from "../../src/init/pipeline.js";
import { checkReview } from "../../src/init/validate-checks.js";
import { reviewKey } from "../../src/init/validate-kept.js";
import type { ReviewTask } from "../../src/init/validate-round.js";
import { loadConfig } from "../../src/kernel/worstcase.js";
import { CEILINGS } from "../../src/schemas/budgets.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { DECISION_LOG_PATH } from "../../src/schemas/pack.js";
import type { ReviewArtifact } from "../../src/schemas/validate.js";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { buildOptions } from "../../src/sessions/sdk.js";
import { definitionText } from "../docs/prd-marks.js";
import { armACopy, outside } from "../eval/eval-fixture.js";
import { at, stoppedCopy } from "../eval/review-fixture.js";
import { git, gitInit, writeTree } from "../helpers.js";
import { PROMPTS, repo } from "./plan-fixture.js";
import { inputsOf } from "./slicing-fixture.js";
import { appliesAll, clean, initThroughValidate, review, reviewers, type Reviewers } from "./validate-fixture.js";
import { ALL, prdOf, wide } from "./validate-wide-fixture.js";
import { RAW } from "./write-fixture.js";

/**
 * S-6‴ — a VALIDATE round's reviewers share one cached prefix.
 *
 * Each reviewer read the pack's foundations itself, into its own context, so
 * each wrote them to the cache. With `review_foundations: given` the round
 * hands every reviewer their text as its system prompt, the same bytes for
 * the whole round. The system prompt, because a shared start of a first
 * message is not read from the cache by another session: Claude Code sets its
 * breakpoint at the message's end.
 */

const REPO = path.resolve(import.meta.dirname, "..", "..");
const FOUNDATIONS = [DECISION_LOG_PATH, "docs/prd/index.md", "docs/research/verified-facts.md"];
type Json = Record<string, unknown>;

/** A file as the Read tool shows it: each line after its number and a tab. */
const numbered = (text: string): string =>
  text
    .replace(/\n$/u, "")
    .split("\n")
    .map((line, i) => `${String(i + 1)}\t${line}`)
    .join("\n");

/** The fixture's pipeline through VALIDATE with `more`: each reviewer's session, and what the foundations held when the round began. */
async function round(
  more: Partial<PipelineDeps>,
  r: Reviewers = clean(),
  notes: string[] = [],
): Promise<{ readonly specs: SessionSpec[]; readonly inputs: Json[]; readonly held: Map<string, string> }> {
  const root = repo(RAW);
  const seen = { backend: null as MockBackend | null };
  const held = new Map<string, string>();
  const stage: StageFn = async (spec) => {
    for (const rel of FOUNDATIONS) if (!held.has(rel)) held.set(rel, readFileSync(path.join(spec.cwd, rel), "utf8"));
    return await r.stage(spec);
  };
  await initThroughValidate(root, { reviewers: { stage, inputs: r.inputs }, seen, more, notes });
  const specs = (seen.backend?.calls ?? []).filter((c) => c.role === "spec_review").map((c) => c.spec);
  return { specs, inputs: r.inputs, held };
}

describe("S-6‴ a round hands every reviewer the foundations as its system prompt", () => {
  it("hands each the same bytes: every foundation whole, under its path, its lines numbered as Read numbers them", async () => {
    const { specs, inputs, held } = await round({ reviewFoundations: "given" });
    expect(specs.length, "the foundations' reviewer and Lending's").toBeGreaterThanOrEqual(2);
    expect(new Set(specs.map((s) => s.systemPrompt)).size, "every reviewer of the round is handed the same system prompt").toBe(1);
    const prompt = specs[0]?.systemPrompt ?? "";
    for (const rel of FOUNDATIONS) expect(prompt, rel).toContain(`<document path="${rel}">\n${numbered(held.get(rel) ?? "")}\n</document>`);
    expect(prompt.indexOf(DECISION_LOG_PATH), "in the round's order").toBeLessThan(prompt.indexOf("docs/research/verified-facts.md"));
    expect(inputs.every((i) => i["foundations_given"] === true)).toBe(true);
    expect(inputs.map((i) => i["foundations"]), "and each is still told which they are").toEqual(inputs.map(() => FOUNDATIONS));
    for (const spec of specs) expect(`${spec.promptPrefix}\n\n${spec.promptVariable}`, "the first message holds no document").not.toContain("<document path=");
  }, 120_000);

  it("hands nothing, and says nothing of it, where the reviewers read the foundations themselves, as by default", async () => {
    for (const more of [{}, { reviewFoundations: "read" as const }]) {
      const { specs, inputs } = await round(more);
      expect(specs.length).toBeGreaterThanOrEqual(2);
      for (const spec of specs) expect(spec.systemPrompt, JSON.stringify(more)).toBeUndefined();
      for (const i of inputs) expect(Object.hasOwn(i, "foundations_given"), JSON.stringify(more)).toBe(false);
    }
  }, 120_000);

  it("takes a review that lists as read none of the foundations it was handed, with no relaunch and nothing said", async () => {
    const r = reviewers((_, inputs) => ({
      schema_version: SCHEMA_VERSION,
      documents_read: ((inputs["documents"] as string[] | undefined) ?? []).filter((d) => !FOUNDATIONS.includes(d)),
      findings: [],
    }));
    const notes: string[] = [];
    const { inputs } = await round({ reviewFoundations: "given" }, r, notes);
    expect(inputs.filter((i) => i["area"] === "foundations"), "the foundations' reviewer ran once").toHaveLength(1);
    expect(notes.join("\n")).not.toMatch(/did not read/u);
  }, 120_000);

  it("passes a session's system prompt to the SDK, and names none for a session that has none", () => {
    const spec: SessionSpec = { role: "spec_review", ticketId: "init", promptPrefix: "p", promptVariable: "{}", cwd: "/wt", artifactOut: "/wt/a.json", allowedTools: [], permissionMode: "", model: "" };
    const config = { policy: { surface: ["**"], protectedGlobs: [], workRoot: "/wt" } };
    expect(buildOptions({ ...spec, systemPrompt: "the foundations" }, config).systemPrompt).toBe("the foundations");
    expect(Object.hasOwn(buildOptions(spec, config), "systemPrompt"), "every other session's options are as they were").toBe(false);
  });

  it("counts a foundation it was handed as read, and still asks for each other document it was given", () => {
    const art: ReviewArtifact = { schema_version: SCHEMA_VERSION, documents_read: [], findings: [] };
    const facts = "docs/research/verified-facts.md";
    const lending = "docs/prd/01-lending.md";
    expect(checkReview("/nowhere", art, { pack: [], documents: [facts], previous: [] }).unread).toEqual([facts]);
    expect(checkReview("/nowhere", art, { pack: [], documents: [facts], previous: [], handed: [facts] }).unread).toEqual([]);
    expect(checkReview("/nowhere", art, { pack: [], documents: [facts, lending], previous: [], handed: [facts] }).unread).toEqual([lending]);
  });

  it("keeps a review made with the foundations handed under a key of its own, and every other under the key it had", () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "detent-key-")));
    mkdirSync(path.join(root, "docs"), { recursive: true });
    writeFileSync(path.join(root, "docs/facts.md"), "# Facts\n\nThe ministry sets the term's dates.\n");
    writeFileSync(path.join(root, "docs/lending.md"), "# Lending\n\nA tool is lent for a week.\n");
    const task: ReviewTask = { area: { name: "Lending", documents: ["docs/lending.md"] }, foundations: ["docs/facts.md"], documents: ["docs/lending.md"], previous: null, diff: null, heuristic: [] };
    /* Computed at 8e09020, before S-6‴: N-8's sets and every kept review were keyed so. */
    const before = "6f97e3b1edc8b7470a85b208f11d4692ca3b80a20a9f9a2e466978068d0ccba8";
    expect(reviewKey(root, 1, task, "a".repeat(64))).toBe(before);
    expect(reviewKey(root, 1, task, "a".repeat(64), "read")).toBe(before);
    expect(reviewKey(root, 1, task, "a".repeat(64), "given")).not.toBe(before);
  });

  it("takes no review a stopped run kept while its reviewers read the foundations, once they are handed them", async () => {
    for (const [setting, taken] of [["read", true], ["given", false]] as const) {
      const root = await stoppedCopy();
      const notes: string[] = [];
      const again = clean();
      await initThroughValidate(root, { reviewers: again, writer: appliesAll(), notes, more: { reviewFoundations: setting } }, wide());
      expect(/VALIDATE round 1: \d+ of \d+ reviews are the ones a stopped run kept/u.test(notes.join("\n")), setting).toBe(taken);
      expect(new Set(again.inputs.filter((i) => i["round"] === 1).map((i) => i["area"])).size === ALL.length, setting).toBe(!taken);
    }
  }, 240_000);

  it("reaches the pipeline from the config, as both routings do (PRDR-197's lesson)", () => {
    expect(readFileSync(path.join(REPO, "src", "cli", "init.ts"), "utf8")).toContain("reviewFoundations: config.review_foundations");
    expect(readFileSync(path.join(REPO, "scripts", "eval-run.ts"), "utf8")).toContain('...(values.foundations === "given" ? { foundations: "given" as const } : {})');
  });

  it("is read by default, takes given, and refuses anything else", () => {
    const base = { schema_version: SCHEMA_VERSION, budgets: Object.fromEntries(Object.entries(CEILINGS).map(([k, v]) => [k, v.default])), pinned: { agent_sdk: "0.3.285", claude_code: "2.1.285" } };
    expect(loadConfig(base).config.review_foundations).toBe("read");
    expect(loadConfig({ ...base, review_foundations: "given" }).config.review_foundations).toBe("given");
    expect(() => loadConfig({ ...base, review_foundations: "handed" })).toThrow(/review_foundations/u);
  });

  it("tells the reviewer the foundations may be given, and that it reads its own documents", () => {
    const prompt = readFileSync(path.join(REPO, "prompts", "spec_review.md"), "utf8");
    expect(prompt).toContain("Where `foundations_given` is true, your system prompt holds each of them whole");
    expect(prompt).toContain("Then read every document in `documents` from its file, whole, unless your system prompt holds it.");
  });

  it("S-6‴ states the setting, its default and why the system prompt carries it", () => {
    const text = (definitionText(readFileSync(path.join(REPO, "detent-prd-v3.md"), "utf8"), "S-6‴")[0] ?? "").replace(/\s+/gu, " ");
    for (const said of ["`review_foundations`", "`given`", "as its system prompt", "stays `read`", "`foundations_given`", "count as read (C-2¹⁴)"]) expect(text, said).toContain(said);
  });
});

describe("S-6‴ an evaluation hands a reviews set's reviewers the foundations where asked (N-8)", () => {
  const tmp = (): string => realpathSync(mkdtempSync(path.join(tmpdir(), "detent-copy-")));
  function unrelated(): string {
    const root = tmp();
    gitInit(root);
    writeTree(root, { "NOTES.md": "# notes\n" });
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "notes");
    return root;
  }
  const deps = (setDir: string, stage: StageFn, over: Partial<EvalDeps> = {}): EvalDeps => ({
    setDir,
    copy: unrelated(),
    route: { model: "claude-opus-5-5", effort: "max" },
    budgetUsd: 100,
    atOnce: 4,
    stage: true,
    backend: () => new MockBackend({ audit: stage, spec_review: stage }),
    prompts: PROMPTS,
    runtime: "2.1.285",
    note: () => undefined,
    sandbox: async () => await Promise.resolve({ kind: "off" as const, reason: "the test's own" }),
    ...over,
  });

  it("hands each the foundations, records that it did, and names the results so", async () => {
    const from = await stoppedCopy();
    const setDir = path.join(tmp(), "reviews");
    buildReviewsSet(from, setDir, { promptHash: PROMPTS.hashes.spec_review });
    const specs: SessionSpec[] = [];
    const stage: StageFn = (spec) => {
      specs.push(spec);
      writeFileSync(spec.artifactOut, `${JSON.stringify(review(inputsOf(spec) as Json, [at("blocker", prdOf(0))]))}\n`);
      return okResult({ turns: 4, costEstimateUsd: 3 });
    };
    const results = (await runEvaluation(deps(setDir, stage, { foundations: "given" }))) as ReviewsResults;
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) expect(spec.systemPrompt).toMatch(/^The pack's foundations, handed alike to every reviewer of this round/u);
    expect(results.foundations).toBe("given");
    expect(report(results, {}).text).toContain("at max, the foundations given: PASS");
    expect(path.basename(writeResults(tmp(), results))).toMatch(/^reviews-claude-opus-5-5-max-foundations-given-/u);
  }, 120_000);

  it("hands nothing unless asked, and refuses to hand a claims set's checks anything", async () => {
    const from = await stoppedCopy();
    const setDir = path.join(tmp(), "reviews");
    buildReviewsSet(from, setDir, { promptHash: PROMPTS.hashes.spec_review });
    const specs: SessionSpec[] = [];
    const stage: StageFn = (spec) => {
      specs.push(spec);
      writeFileSync(spec.artifactOut, `${JSON.stringify(review(inputsOf(spec) as Json, [at("blocker", prdOf(0))]))}\n`);
      return okResult({ turns: 4, costEstimateUsd: 3 });
    };
    const results = (await runEvaluation(deps(setDir, stage))) as ReviewsResults;
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) expect(spec.systemPrompt).toBeUndefined();
    expect(Object.hasOwn(results, "foundations")).toBe(false);
    const claimsDir = outside();
    buildClaimsSet(armACopy(), claimsDir, { confirmed: 2 });
    await expect(runEvaluation(deps(claimsDir, stage, { foundations: "given" }))).rejects.toThrow(/only a reviews set's reviewers are handed the foundations/u);
  }, 120_000);
});
