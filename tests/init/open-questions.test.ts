import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runInit } from "../../src/init/machine.js";
import { buildPipeline } from "../../src/init/pipeline.js";
import { presentInputsFromOutputs, renderPresentation } from "../../src/init/present.js";
import { QUESTION_SIMILARITY, similarQuestions } from "../../src/init/questions.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { ANALYSIS, APPROVE_PLAN, BUDGETS, PROMPTS, repo } from "./plan-fixture.js";
import { DOCS, TWO_SLICES, inputsOf, sliceOf, ticket } from "./slicing-fixture.js";

/**
 * C-3″ (PRDR-207) — one question, asked once.
 *
 * gate-313 asked the founder the npm-identity question twice: ANALYZE raised
 * it, s14's draft raised it again in its own words, and the batch dedups on
 * exact text. Two paid assumptions, two answers. The stages that draft are now
 * handed what was already asked, and PRESENT merges what still slips through.
 */

/* gate-313's pair, verbatim. */
const Q1 =
  "Which npm identity publishes Detent, and which repository hosts the Claude Code plugin marketplace entry? Specifically: the package name (unscoped `detent` versus a scope such as `@<org>/detent`), the npm account or organization that owns it, and the marketplace repository the plugin is listed from. v2 records that the previous name was abandoned precisely because it was taken on npm, so registry availability is a fact about accounts the founder owns rather than an engineering choice.";
const Q2 =
  "Which Claude backend credential will the release pipeline and the developer machines hold for the runs that must be live — `doctor`'s smoke session, the M2 budgeted live run, and the permanent N-7 self-build release gate? PRDR-141 records that the supported transports broadened to three and that `doctor` keying on `ANTHROPIC_API_KEY` alone was stale, but the documents do not say which transport this project's own CI is entitled to use, and that is a credential and billing question rather than a design one.";
const S14Q1 =
  "Which legal name should appear as the copyright holder in the MIT `LICENSE` file, and from which year? v3 resolves the licence itself (MIT, chosen 2026-08-20) but records no holder, and the copyright line is an attribution of ownership rather than an engineering choice — an individual, a company, or a project name are different legal claims and only the owner can say which is true.";
const S14Q2 =
  "Which npm identity publishes the headless driver, and which repository hosts the marketplace listing? Specifically: the package name (unscoped `detent` or a scope such as `@<org>/detent`), the npm account or organization that owns it, and whether the marketplace entry is listed from this repository or another one the founder controls. v2 records that the previous product name was abandoned because it was taken on npm, so registry availability is a fact about accounts rather than an engineering choice, and it lands in this slice because these are the two tickets that publish.";

const q = (id: string, question: string) => ({ id, question, blocking: false, assumption: "proceeds on the founder's own account" });

describe("C-3″ PRESENT merges a question asked twice in two stages' words", () => {
  it("gate-313's pair merges; the two other `Which …` questions do not", () => {
    expect(similarQuestions(Q1, S14Q2), "same question, two drafts").toBe(true);
    expect(similarQuestions(Q1, Q2), "two different founder questions").toBe(false);
    expect(similarQuestions(S14Q1, S14Q2)).toBe(false);
    expect(QUESTION_SIMILARITY).toBeGreaterThan(0);
  });

  it("the batch carries the first, names the other id on it, and the human answers once", () => {
    const built = presentInputsFromOutputs({
      ANALYZE: { open_questions: [q("q-analyze-1", Q1), q("q-analyze-2", Q2)] },
      PLAN: { questions: [q("s14-q1", S14Q1), q("s14-q2", S14Q2)] },
    });
    /* Before PRDR-207: four questions, two of them one question. */
    expect(built.questions?.map((x) => x.id)).toEqual(["q-analyze-1", "q-analyze-2", "s14-q1"]);
    expect(built.questions?.[0]?.also).toEqual(["s14-q2"]);
    const text = renderPresentation({ root: "/tmp/x", tickets: [], bindings: [], skips: [], bootstrap: null, assignments: {}, ...built });
    expect(text).toContain("also asked as s14-q2");
  });
});

/** A planner that raises a question at ANALYZE and another in s01's draft, and records every input it is handed. */
function planner(seen: Record<string, unknown>[], raise: boolean): StageFn {
  return (spec) => {
    const inputs = inputsOf(spec);
    seen.push({ ...inputs, __artifact: spec.artifactOut.split("/").pop() });
    let artifact: object;
    if (spec.artifactOut.endsWith("slices.json")) artifact = TWO_SLICES;
    else if (spec.artifactOut.endsWith("plan-draft.json")) {
      const slice = sliceOf(inputs);
      artifact = {
        schema_version: 1,
        tickets: [ticket(`t-${slice}-001`)],
        questions: raise && slice === "s01" ? [{ id: "q1", question: "Which registry mirror does the build pull from?", blocking: false, assumption: "the public one" }] : [],
      };
    } else if (spec.artifactOut.endsWith("plan-review.json")) artifact = APPROVE_PLAN;
    else artifact = { ...ANALYSIS(null), questions: raise ? [q("q-analyze-1", Q1)] : [] };
    writeFileSync(spec.artifactOut, `${JSON.stringify(artifact)}\n`);
    return okResult();
  };
}

const drafts = (seen: Record<string, unknown>[], slice: string) => seen.filter((i) => i["__artifact"] === "plan-draft.json" && sliceOf(i) === slice);
const ids = (i: Record<string, unknown> | undefined) => ((i?.["open_questions"] as { id: string }[] | undefined) ?? []).map((x) => x.id);

describe("C-3″ the drafting stages are handed what was already asked", () => {
  it("SLICE and every PLAN draft see ANALYZE's questions, and a later slice sees the earlier slice's too", async () => {
    const root = repo(DOCS);
    const seen: Record<string, unknown>[] = [];
    await runInit(root, buildPipeline({ root, backend: new MockBackend({ planner: planner(seen, true) }), prompts: PROMPTS, budgets: BUDGETS }));
    const slice = seen.find((i) => i["__artifact"] === "slices.json");
    /* Before PRDR-207 no stage was told: `open_questions` absent everywhere, and s14 asked ANALYZE's question again. */
    expect(ids(slice), "SLICE sees ANALYZE's").toEqual(["q-analyze-1"]);
    expect(ids(drafts(seen, "s01")[0]), "s01 sees ANALYZE's").toEqual(["q-analyze-1"]);
    expect(ids(drafts(seen, "s02")[0]), "s02 sees ANALYZE's and s01's, numbered as PRESENT numbers them").toEqual(["q-analyze-1", "s01-q1"]);
  });

  it("with nothing asked, no stage is handed an empty list — the prompts are byte-for-byte what they were", async () => {
    const root = repo(DOCS);
    const seen: Record<string, unknown>[] = [];
    await runInit(root, buildPipeline({ root, backend: new MockBackend({ planner: planner(seen, false) }), prompts: PROMPTS, budgets: BUDGETS }));
    for (const i of seen) expect("open_questions" in i, String(i["__artifact"])).toBe(false);
  });
});

/** Audit of PRDR-207: a merge must not lose the `blocking` flag the absorbed question carried. */
describe("audit of PRDR-207", () => {
  it("a kept question inherits `blocking` from the twin it absorbed — AWAIT_INFO still fires", () => {
    const built = presentInputsFromOutputs({
      ANALYZE: { open_questions: [q("q-analyze-1", Q1)] },
      PLAN: { questions: [{ ...q("s14-q2", S14Q2), blocking: true }] },
    });
    expect(built.questions?.map((x) => x.id)).toEqual(["q-analyze-1"]);
    expect(built.questions?.[0]?.blocking, "the absorbed question was blocking; the merged one is").toBe(true);
  });
});
