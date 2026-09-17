import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
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

/**
 * PRDR-264: the session WRITES its brief and `planResearch` reads it back, so
 * the fakes here must put the fixture on disk. Returning it was what let both
 * tests below pass while the validator never saw it — X-6a was named in their
 * fixtures and exercised by neither.
 */
function writeBrief(artifactOut: string, brief: object): void {
  mkdirSync(path.dirname(artifactOut), { recursive: true });
  writeFileSync(artifactOut, JSON.stringify(brief), "utf8");
}

/**
 * PRDR-264: the fourth population. Research SETTLED this question — no source
 * can answer it, and the named human decides — so it is neither answered nor
 * still open to research.
 */
const SETTLED_BRIEF = (question: string): object => ({
  schema_version: 1,
  outcome: "undecidable",
  question,
  question_hash: questionHash(question),
  /** X-6a still applies: a settled verdict shows the searches that came back empty. */
  evidence: [{ source: "PRD.md §Pricing", claim: "names no price ladder" }],
  sources_consulted: [{ tier: 1, ref: "PRD.md" }],
  local_search: { docs_checked: ["PRD.md"], code_checked: [] },
  what_would_falsify: "the founder writes the price ladder down",
  undecidable: { reason: "decision_not_made", detail: "no ladder has been chosen yet", who_decides: "the founder" },
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
   * PRDR-265 retired the distinction this test was written for, and the fixture
   * is kept as the proof that it is gone.
   *
   * PRDR-260 split the AWAIT_INFO batch in two: a question research could not
   * settle, which only the human can answer, and one the pool never reached,
   * which the operator acts on by raising the ceiling. PRDR-262 narrowed the
   * second to a pool genuinely too small to fund one call apiece — the exact
   * shape below, 2 calls against 3 questions. PRDR-265 removed it outright: a
   * budget no longer decides which question goes unasked, so all three are
   * researched and the ceiling advice has nothing left to attach to.
   *
   * What the fixture now pins is that the shape which USED to strand a question
   * strands nobody, and that the operator is told what the three sessions cost
   * rather than what the pool allowed.
   */
  it("researches every question on a pool too small for them, and says what that cost", async () => {
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
        /** As `pipeline.ts` wires it: planning research's notes reach the same operator sink ANALYZE's do. */
        note: (t) => notes.push(t),
        researchOne: async (question, _share, artifactOut) => {
          writeBrief(artifactOut, BRIEF_REFUSED_FOR_EMPTY_LOCAL_SEARCH(question));
          return { toolCalls: 16 };
        },
      },
    });

    expect(outcome.kind).toBe("complete");
    expect(notes.join(" ")).toContain("3 question(s) carried to PRESENT");
    expect(notes.join(" "), "no question is reported as one a bigger ceiling would have reached").toContain(
      "0 settled as undecidable (only a human can answer), 3 researched without a usable answer",
    );
    expect(notes.join(" "), "and the breakdown no longer offers a lever that does nothing").not.toContain("never researched");
    expect(
      outcome.kind === "complete" ? outcome.outputs["research_tool_calls"] : 0,
      "three questions, two attempts each (PRDR-264), 16 calls a session: 96 against a stated pool of 2",
    ).toBe(96);
    /**
     * PRDR-264: the note used to say "no valid brief" and cite nothing. The
     * refusal is the operator's only handle on WHY research came back empty,
     * and this fixture's refusal is X-6a's — so the note must say so.
     */
    expect(notes.join(" "), "the note carries what the validator actually said").toContain(X6A_LOCAL_SEARCH);
  });

  /** The complement: researched and refused by X-6a is unanswered, and after PRDR-265 that is the only way in. */
  it("puts a question in the batch only when a session ran and came back without an answer", async () => {
    const root = repo();
    const question = "unfamiliar API?";
    let launched = 0;
    const result = await planResearch([question], {
      root,
      budget: 16,
      researchOne: async (_question, _share, artifactOut) => {
        launched += 1;
        writeBrief(artifactOut, BRIEF_REFUSED_FOR_EMPTY_LOCAL_SEARCH(question));
        return { toolCalls: 2 };
      },
    });
    expect(result.unanswered).toEqual([question]);
    expect(launched, "PRDR-264 reshapes a refused brief once; both attempts were paid for and neither was skipped").toBe(2);
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
  /**
   * PRDR-264: the breakdown's fourth population, and the one that changes the
   * advice attached to it. A question research SETTLED still rides to PRESENT
   * — the plan proceeds on its assumption exactly as before — but no ceiling
   * will ever reach it, so counting it under "researched without a usable
   * answer" argued for raising a budget that cannot help.
   */
  it("counts a settled question apart from one a bigger ceiling could still answer", async () => {
    const root = repo({ "PRD.md": "# vague\n" });
    const notes: string[] = [];
    const settled = "what is the price ladder?";
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
              { id: "q1", question: settled, blocking: false, assumption: "flat pricing" },
              { id: "q2", question: "q two?", blocking: false, assumption: "b" },
            ],
          }),
        );
      },
      research: {
        budget: 16,
        note: (t) => notes.push(t),
        researchOne: async (question, _share, artifactOut) => {
          writeBrief(artifactOut, question === settled ? SETTLED_BRIEF(question) : BRIEF_REFUSED_FOR_EMPTY_LOCAL_SEARCH(question));
          return { toolCalls: 1 };
        },
      },
    });

    expect(outcome.kind).toBe("complete");
    const said = notes.join(" ");
    expect(said, "a settled question is still carried — the human has to answer it").toContain("2 question(s) carried to PRESENT");
    expect(said, "and it is counted as settled, not as a ceiling to raise").toContain(
      "1 settled as undecidable (only a human can answer), 1 researched without a usable answer",
    );
    expect(said, "the note names who decides it, because that is the only way it gets answered").toContain("the founder");
    expect(
      outcome.kind === "complete" ? (outcome.outputs["open_questions"] as { question: string }[]).map((q) => q.question) : [],
      "both questions reach PRESENT with their assumptions (C-3′)",
    ).toEqual([settled, "q two?"]);
  });
});
