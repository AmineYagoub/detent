import { writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { initLayout } from "../../src/fs/layout.js";
import { analysisPath, analyzeStage } from "../../src/init/analyze.js";
import { planResearch, questionHash } from "../../src/init/plan-research.js";
import { git, gitInit, removeTree, tmpTree, writeTree } from "../helpers.js";

/**
 * PRDR-260 — C-3a's AWAIT_INFO batch, and what the operator is told about it.
 *
 * `planResearch` has one flat `unanswered` array carrying two outcomes that are
 * actionable in opposite directions: a question research investigated and could
 * not settle, which only the human can answer, and a question the pool never
 * reached, which is a ceiling to raise or a question to drop. A live init
 * carried three and reported one number. `T-063` in `tests/init/stages.test.ts`
 * covers the pool, the cache and the X-6a validator; this file covers the
 * distinction ANALYZE now draws across them, and it lives apart because that
 * file is at its 600-line ceiling.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

/** The same repo shape `stages.test.ts` builds: a committed tree with `.detent` laid out. */
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

const ANALYSIS_BROWNFIELD = {
  schema_version: 1,
  summary: "An existing TypeScript service with vitest already wired.",
  stack: null,
  questions: [],
  assumptions: [{ claim: "tests live under tests/", evidence: "tests/ exists" }],
  docs_read: ["PRD.md"],
};

const VALID_BRIEF = (question: string): object => ({
  schema_version: 1,
  question,
  question_hash: questionHash(question),
  answer: { claim: "callbacks are removed in v3", confidence: "high" },
  evidence: [
    { tier: 1, ref: "PRD.md" },
    { tier: 3, ref: "https://docs.example.com/v3/migration" },
  ],
  local_search: { docs_checked: ["PRD.md"], code_checked: [] },
  what_would_falsify: "the v3 changelog shows callbacks retained",
});

describe("C-3′ the batch is one batch, and it says which half was tried", () => {

  /**
   * the AWAIT_INFO batch is one batch (C-3a), but its members
   * are not alike. A question research investigated and could not settle is a
   * question only the human can answer; one the pool never reached is a budget
   * fact the operator acts on by raising the ceiling or trimming questions.
   * Reported as a bare count the two were indistinguishable — and this is the
   * run shape that produced it: three questions, one pool of 16, the first
   * question consuming all of it and returning nothing usable.
   */
  it("separates the questions research tried from the ones the pool never reached", async () => {
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
              { id: "q1", question: "q one?", blocking: false, assumption: "a" },
              { id: "q2", question: "q two?", blocking: false, assumption: "b" },
              { id: "q3", question: "q three?", blocking: false, assumption: "c" },
            ],
          }),
        );
      },
      research: {
        budget: 16,
        researchOne: async (question) => ({
          brief: { ...VALID_BRIEF(question), local_search: { docs_checked: [], code_checked: [] } },
          toolCalls: 16,
        }),
      },
    });

    expect(outcome.kind).toBe("complete");
    expect(notes.join(" ")).toContain("3 question(s) carried to PRESENT");
    expect(notes.join(" ")).toContain("1 researched without a usable answer, 2 never researched");
  });

  /** The complement: researched and refused by X-6a is unanswered, but it is not untried. */
  it("counts never-researched as the skip arm only, not everything unanswered", async () => {
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
    expect(result.unanswered).toEqual([question]);
    expect(result.neverResearched).toEqual([]);
  });

  /**
   * The third population, which the breakdown above would otherwise absorb: an
   * init with no research configured reaches the same line with every question
   * unanswered. "Never researched" is literally true there and misleading — it
   * reads as a ceiling that was hit. It is named for what it is instead.
   */
  it("does not report an init with research switched off as one that ran out of budget", async () => {
    const root = repo({ "PRD.md": "# vague\n" });
    const notes: string[] = [];
    await analyzeStage({
      root,
      docs: ["PRD.md"],
      stackMarkers: ["package.json"],
      note: (t) => notes.push(t),
      launch: async () => {
        writeFileSync(
          analysisPath(root),
          JSON.stringify({
            ...ANALYSIS_BROWNFIELD,
            questions: [{ id: "q1", question: "which database?", blocking: true, assumption: "postgres" }],
          }),
        );
      },
    });

    const said = notes.join(" ");
    expect(said).toContain("1 question(s) carried to PRESENT");
    expect(said).toContain("planning research did not run for this init");
    expect(said).not.toContain("never researched");
  });
});
