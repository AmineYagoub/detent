import { writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { initLayout } from "../../src/fs/layout.js";
import { analysisPath, analyzeStage } from "../../src/init/analyze.js";
import { planResearch, questionHash } from "../../src/init/plan-research.js";
import { parseArtifact } from "../../src/schemas/common.js";
import { planningBriefSchema } from "../../src/schemas/init.js";
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

/**
 * A brief that genuinely satisfies `planningBriefSchema`, mirroring the fixture
 * of the same name in `stages.test.ts`: `evidence` carries source/claim pairs,
 * and the tier/ref pairs belong to `sources_consulted`. The guard test below
 * holds it to that — a fixture named VALID that never parsed is how the two
 * tests here came to assert the right outcomes for the wrong reason.
 */
const VALID_BRIEF = (question: string): object => ({
  schema_version: 1,
  question,
  question_hash: questionHash(question),
  answer: { claim: "callbacks are removed in v3", confidence: "high" },
  evidence: [{ source: "https://docs.example.com/v3/migration", claim: "callbacks removed in v3" }],
  sources_consulted: [
    { tier: 1, ref: "PRD.md" },
    { tier: 3, ref: "https://docs.example.com/v3/migration" },
  ],
  local_search: { docs_checked: ["PRD.md"], code_checked: [] },
  what_would_falsify: "the v3 changelog shows callbacks retained",
});

/**
 * The brief both tests below feed to `researchOne`, and the single reason they
 * see it refused: X-6a — it cites a URL in `evidence` while recording an empty
 * `local_search`. Everything else about it parses, so this override is the
 * whole of the refusal, which is what makes "researched, no usable answer" the
 * arm under test rather than an accident of fixture shape.
 */
const BRIEF_REFUSED_FOR_EMPTY_LOCAL_SEARCH = (question: string): object => ({
  ...VALID_BRIEF(question),
  local_search: { docs_checked: [], code_checked: [] },
});

const X6A_LOCAL_SEARCH =
  "local_search: X-6a: a brief citing a URL must record a non-empty local_search (tiers 1-2 consulted first)";

describe("C-3′ the batch is one batch, and it says which half was tried", () => {

  /**
   * The fixtures' own contract, asserted rather than assumed. Both tests below
   * read as though they exercise X-6a's local_search rule, and that holds only
   * while `VALID_BRIEF` is otherwise valid: a brief malformed anywhere else is
   * refused before X-6a is ever reached, and the tests still pass — silently
   * measuring nothing. This pins both halves.
   */
  it("the fixtures refuse for X-6a's local_search rule and nothing else", () => {
    const question = "does the v3 API still accept callbacks?";

    expect(parseArtifact(planningBriefSchema, VALID_BRIEF(question)).ok).toBe(true);

    const refused = parseArtifact(planningBriefSchema, BRIEF_REFUSED_FOR_EMPTY_LOCAL_SEARCH(question));
    expect(refused.ok).toBe(false);
    /** Exactly one issue, and it is X-6a's: the empty `local_search` is the whole of the refusal. */
    expect(refused.ok === false && refused.reason === "invalid" ? refused.issues : []).toEqual([X6A_LOCAL_SEARCH]);
  });

  /**
   * the AWAIT_INFO batch is one batch (C-3a), but its members
   * are not alike. A question research investigated and could not settle is a
   * question only the human can answer; one the pool never reached is a budget
   * fact the operator acts on by raising the ceiling or trimming questions.
   * Reported as a bare count the two were indistinguishable — and this is the
   * run shape that produced it: three questions and a pool that cannot fund a
   * call for each.
   *
   * PRDR-262 changed what this fixture has to be. It used to be a pool of 16
   * with the first question consuming all of it, because that was enough to
   * starve the other two — the test asserted the live defect as the expected
   * outcome and passed. The pool is divided now, so starvation by document
   * order is unreachable and the only remaining route into `neverResearched` is
   * a pool genuinely too small: 2 calls, 3 questions, one call each until it
   * runs out. The split under test is the same; the only way to reach it is
   * not.
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
        budget: 2,
        researchOne: async (question) => ({
          brief: BRIEF_REFUSED_FOR_EMPTY_LOCAL_SEARCH(question),
          toolCalls: 16,
        }),
      },
    });

    expect(outcome.kind).toBe("complete");
    expect(notes.join(" ")).toContain("3 question(s) carried to PRESENT");
    expect(notes.join(" ")).toContain("2 researched without a usable answer, 1 never researched");
  });

  /** The complement: researched and refused by X-6a is unanswered, but it is not untried. */
  it("counts never-researched as the skip arm only, not everything unanswered", async () => {
    const root = repo();
    const question = "unfamiliar API?";
    const result = await planResearch([question], {
      root,
      budget: 16,
      researchOne: async () => ({
        brief: BRIEF_REFUSED_FOR_EMPTY_LOCAL_SEARCH(question),
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
