import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  planResearch,
  planningArtifactPath,
  planningBriefPath,
  planningBriefSkeleton,
  questionHash,
  undecidableBriefSkeleton,
} from "../../src/init/plan-research.js";
import { buildPipeline } from "../../src/init/pipeline.js";
import { runInit } from "../../src/init/machine.js";
import { parseArtifact } from "../../src/schemas/common.js";
import { planningBriefSchema } from "../../src/schemas/init.js";
import { MockBackend, type RecordedCall } from "../../src/sessions/mock.js";
import { removeTree, tmpTree } from "../helpers.js";
import { BUDGETS, DRAFT, LONE_CANDIDATE, PROMPTS, planner, repo as fixtureRepo } from "./plan-fixture.js";

/**
 * PRDR-264 — the contract planning research was never handed.
 *
 * `init/pipeline` launched `role: "research"` with no `expected_output`, so the
 * session followed the only shape its prompt names — the A-4 failure brief —
 * and `planningBriefSchema` refused it every time. Two live questions, $0.98 of
 * research, and an empty `.detent/research/planning/`.
 *
 * Three things are asserted here and none of them can be by injecting a brief:
 * that the SKELETON a session is handed parses against the SCHEMA its answer is
 * judged by (the seam every existing test mocks past), that a question research
 * settles as undecidable is a valid answer rather than a failure, and that a
 * brief is bound to the question it claims to answer (D-19).
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

function root(): string {
  const r = tmpTree({});
  roots.push(r);
  return r;
}

const Q = "what is the price ladder?";
const OTHER = "what retention applies?";

/** The `answered` arm: a claim, and evidence that is local so X-6a is satisfied. */
function answered(question: string): Record<string, unknown> {
  return {
    schema_version: 1,
    outcome: "answered",
    question,
    question_hash: questionHash(question),
    answer: { claim: "the ladder is published", confidence: "high" },
    evidence: [{ source: "docs/pricing.md", claim: "the ladder is published" }],
    sources_consulted: [{ tier: 1, ref: "docs/pricing.md" }],
    local_search: { docs_checked: ["docs/pricing.md"], code_checked: [] },
    what_would_falsify: "the page stops listing prices",
  };
}

/**
 * The `undecidable` arm, shaped on run 4's first live brief: research did its
 * job and established that the value does not exist to be found, because the
 * founder has not decided it.
 */
function undecidable(question: string): Record<string, unknown> {
  return {
    schema_version: 1,
    outcome: "undecidable",
    question,
    question_hash: questionHash(question),
    undecidable: {
      reason: "decision_not_made",
      detail: "four PRDs record the ladder as open and founder-owned; no source carries a number",
      who_decides: "the founder",
    },
    evidence: [{ source: "docs/founder-decisions.md", claim: "listed under items that remain open" }],
    sources_consulted: [{ tier: 1, ref: "docs/founder-decisions.md" }],
    local_search: { docs_checked: ["docs/founder-decisions.md"], code_checked: [] },
    what_would_falsify: "the decision ledger records a chosen ladder",
  };
}

interface Seen {
  readonly artifactOuts: string[];
  readonly notes: string[];
  readonly previous: (string | null)[];
}

/**
 * Drives the real allocator with a launcher that WRITES ITS ARTIFACT, which is
 * what a session does. `write` decides what each successive session leaves at
 * `artifactOut` — returning `null` means it wrote nothing at all, the case D-19
 * turns on.
 */
async function drive(
  r: string,
  questions: readonly string[],
  budget: number,
  write: (question: string, attempt: number) => unknown | null,
): Promise<{ readonly result: Awaited<ReturnType<typeof planResearch>>; readonly seen: Seen }> {
  const seen: Seen = { artifactOuts: [], notes: [], previous: [] };
  let attempt = 0;
  const result = await planResearch(questions, {
    root: r,
    budget,
    note: (text) => seen.notes.push(text),
    researchOne: (question, share, artifactOut, previous) => {
      const n = attempt;
      attempt += 1;
      seen.artifactOuts.push(artifactOut);
      seen.previous.push(previous === null || previous === undefined ? null : previous.issue);
      const body = write(question, n);
      if (body !== null) {
        mkdirSync(path.dirname(artifactOut), { recursive: true });
        writeFileSync(artifactOut, JSON.stringify(body), "utf8");
      }
      return Promise.resolve({ toolCalls: share });
    },
  });
  return { result, seen };
}

describe("PRDR-264 the skeleton is the contract", () => {
  /**
   * The assertion that would have caught this on day one. `researchBriefSkeleton`
   * has had this property since it existed; the planning side had no skeleton at
   * all, so nothing could compare.
   */
  it("the skeleton a planning-research session is handed parses against the schema that judges it", () => {
    const skeleton = planningBriefSkeleton(Q, questionHash(Q));
    const parsed = parseArtifact(planningBriefSchema, skeleton);
    expect(
      parsed.ok,
      `the skeleton must be a valid brief, else the session is told to write something the validator refuses: ${
        parsed.ok === false && parsed.reason === "invalid" ? parsed.issues.join("; ") : ""
      }`,
    ).toBe(true);
  });

  it("the skeleton carries the question and the hash the session must echo, not a placeholder to invent", () => {
    const hash = questionHash(Q);
    const skeleton = planningBriefSkeleton(Q, hash);
    expect(skeleton.question, "the session is never asked to restate the question").toBe(Q);
    expect(skeleton.question_hash, "nor to compute a sha256 — it is handed the one to copy").toBe(hash);
  });
});

describe("PRDR-264 a settled question is not a failed one", () => {
  it("accepts an undecidable brief with no answer at all", () => {
    const parsed = parseArtifact(planningBriefSchema, undecidable(Q));
    expect(
      parsed.ok,
      parsed.ok === false && parsed.reason === "invalid" ? parsed.issues.join("; ") : "",
    ).toBe(true);
  });

  /**
   * Each negative below opens with its own positive control. Without one they
   * pass on HEAD for a reason that has nothing to do with what they claim: the
   * schema is a `strictObject`, so `outcome` and `undecidable` are unrecognized
   * keys and EVERY brief here is refused. A test that cannot tell "refused for
   * the rule under test" from "refused for existing before the rule" measures
   * nothing — the same defect PRDR-262 found in its own fixtures.
   */
  function issuesOf(brief: Record<string, unknown>): string {
    const parsed = parseArtifact(planningBriefSchema, brief);
    return parsed.ok === false && parsed.reason === "invalid" ? parsed.issues.join("; ") : "";
  }

  it("still requires an answer on the answered arm", () => {
    const complete = answered(Q);
    expect(parseArtifact(planningBriefSchema, complete).ok, "control: the complete answered brief parses").toBe(true);

    const { answer, ...withoutAnswer } = complete;
    expect(answer).toBeDefined();
    expect(parseArtifact(planningBriefSchema, withoutAnswer).ok, "an answered brief with no answer is nonsense").toBe(false);
    expect(issuesOf(withoutAnswer), "and it is the missing answer that refuses it").toContain("answer");
  });

  it("refuses an undecidable brief that does not say who decides or why", () => {
    const complete = undecidable(Q);
    expect(parseArtifact(planningBriefSchema, complete).ok, "control: the complete undecidable brief parses").toBe(true);

    const { undecidable: block, ...withoutBlock } = complete;
    expect(block).toBeDefined();
    expect(
      parseArtifact(planningBriefSchema, withoutBlock).ok,
      "`undecidable` with no reason is an unexplained refusal to answer, which is what HEAD already produced",
    ).toBe(false);
    expect(issuesOf(withoutBlock), "and it is the missing verdict that refuses it").toContain("undecidable");
  });

  it("refuses an answer and an undecidable verdict in the same brief", () => {
    expect(parseArtifact(planningBriefSchema, answered(Q)).ok, "control: each arm alone parses").toBe(true);
    expect(parseArtifact(planningBriefSchema, undecidable(Q)).ok, "control: each arm alone parses").toBe(true);

    const both = { ...answered(Q), outcome: "undecidable", undecidable: (undecidable(Q) as { undecidable: unknown }).undecidable };
    expect(parseArtifact(planningBriefSchema, both).ok, "a question is settled or answered, never both").toBe(false);
    expect(issuesOf(both), "and the refusal names the arm that may not carry an answer").toContain("undecidable");
  });

  /** A brief written before this ticket has no `outcome`; it must still read as an answer. */
  it("reads a brief with no outcome field as answered", () => {
    const { outcome, ...old } = answered(Q);
    expect(outcome).toBe("answered");
    const parsed = parseArtifact(planningBriefSchema, old);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok === true ? parsed.value.outcome : null, "the default is the arm that existed before").toBe("answered");
  });

  it("treats an undecidable question as researched and settled, not as unanswered", async () => {
    const { result, seen } = await drive(root(), [Q], 8, (q) => undecidable(q));
    expect(result.undecidable, "the question is settled: research established there is nothing to find").toEqual([Q]);
    expect(result.unanswered, "and it is NOT in the batch that needs more research").toEqual([]);
    expect(seen.notes.join(" "), "the operator is told who has to decide it").toContain("the founder");
  });

  it("caches an undecidable verdict so a re-run does not pay to rediscover it (C-3a)", async () => {
    const r = root();
    await drive(r, [Q], 8, (q) => undecidable(q));
    expect(existsSync(planningBriefPath(r, questionHash(Q))), "a settled question is a cached question").toBe(true);

    const second = await drive(r, [Q], 8, () => {
      throw new Error("a cached undecidable question must not buy a second session");
    });
    expect(second.result.cacheHits).toBe(1);
    expect(second.result.sessionsLaunched).toBe(0);
    expect(second.result.undecidable, "and it is still reported as settled, not silently dropped").toEqual([Q]);
  });
});

describe("PRDR-264 / D-19 a brief is bound to its question", () => {
  it("gives every question its own artifact path", async () => {
    const r = root();
    const { seen } = await drive(r, [Q, OTHER], 8, (q) => answered(q));
    expect(seen.artifactOuts[0], "keyed by the question, so two sessions cannot collide").toBe(
      planningArtifactPath(r, questionHash(Q)),
    );
    expect(seen.artifactOuts[1]).toBe(planningArtifactPath(r, questionHash(OTHER)));
    expect(seen.artifactOuts[0]).not.toBe(seen.artifactOuts[1]);
  });

  /**
   * The live shape of D-19: session two writes nothing, and on HEAD the fixed
   * path still holds session one's file, which parses and is cached under
   * question two's hash — answering it for free on every future run.
   */
  it("does not adopt the previous question's brief when a session writes nothing", async () => {
    const r = root();
    const { result } = await drive(r, [Q, OTHER], 16, (q, n) => (n === 0 ? answered(q) : null));

    expect(result.briefs.map((b) => b.question), "only the question that was actually answered").toEqual([Q]);
    expect(result.unanswered, "the silent session produced nothing, and says so").toEqual([OTHER]);
    expect(
      existsSync(planningBriefPath(r, questionHash(OTHER))),
      "and nothing is cached under the question it never answered",
    ).toBe(false);
  });

  it("refuses a brief that answers a different question than the one asked", async () => {
    const r = root();
    const { result, seen } = await drive(r, [Q], 8, () => answered(OTHER));
    expect(result.briefs, "a brief for another question is not this question's answer").toEqual([]);
    expect(result.unanswered).toEqual([Q]);
    expect(seen.notes.join(" ")).toContain("does not answer the question it was asked");
    expect(existsSync(planningBriefPath(r, questionHash(Q))), "and it is not cached under the asking question").toBe(false);
  });

  it("clears a stale artifact before the session runs", async () => {
    const r = root();
    const stale = planningArtifactPath(r, questionHash(Q));
    mkdirSync(path.dirname(stale), { recursive: true });
    writeFileSync(stale, JSON.stringify(answered(Q)), "utf8");

    const { result } = await drive(r, [Q], 8, () => null);
    expect(result.briefs, "a file the session did not write this turn is not its answer").toEqual([]);
    expect(result.unanswered).toEqual([Q]);
  });
});

describe("PRDR-264 a refused brief buys one reshape relaunch", () => {
  it("relaunches once with the validator's own words and accepts the second attempt", async () => {
    const { result, seen } = await drive(root(), [Q], 8, (q, n) => (n === 0 ? { malformed: true } : answered(q)));
    expect(seen.previous[0], "the first attempt is told nothing — there is nothing to tell it").toBeNull();
    expect(seen.previous[1], "the second is told exactly what the validator refused").toContain("question");
    expect(result.briefs.map((b) => b.question), "and the reshaped brief is accepted").toEqual([Q]);
  });

  /**
   * PRDR-265 moved this claim from the TOTAL to the division. `toolCallsUsed`
   * no longer bounds anything — it reports what the sessions did — so the
   * property worth pinning is the one that survives: a question that needs two
   * attempts is still offered the same share as one that needs a single
   * attempt, because the reshape is charged against its own question's cut.
   */
  it("charges both attempts against the one question's share, never another's", async () => {
    const { result, seen } = await drive(root(), [Q, OTHER], 16, (q, n) => (n === 0 ? { malformed: true } : answered(q)));
    expect(seen.artifactOuts.length, "two attempts at the first question, one at the second").toBe(3);
    expect(result.briefs, "and a relaunch never costs the other question its session").toHaveLength(2);
  });

  it("stops after the second refusal rather than relaunching forever", async () => {
    const { result, seen } = await drive(root(), [Q], 8, () => ({ malformed: true }));
    expect(seen.artifactOuts.length, "one attempt and one relaunch — P2 fails the phase after that").toBe(2);
    expect(result.unanswered).toEqual([Q]);
  });
});

/**
 * PRDR-264 — D-17 itself, asserted where it lived.
 *
 * Everything above this line drives `planResearch` with an injected launcher,
 * and every one of those tests passed on HEAD's pipeline: the skeleton was
 * correct, the schema was correct, and the defect was that the CALL SITE never
 * handed the one to a session judged by the other. A contract that exists and
 * is not passed is the same as no contract, and only a test that runs the real
 * `buildPipeline` can tell the two apart.
 */
describe("PRDR-264 the pipeline hands planning research its contract (D-17)", () => {
  const ASKED = "does the v3 API still accept callbacks?";

  /**
   * The research role is unscripted, so the mock succeeds without writing an
   * artifact: every attempt is refused for "the session wrote no artifact", and
   * both the first launch and its reshape relaunch are recorded.
   */
  async function researchCalls(): Promise<{ readonly calls: readonly RecordedCall[]; readonly root: string }> {
    const root = fixtureRepo(LONE_CANDIDATE);
    const analysis = {
      schema_version: 1,
      summary: "s",
      stack: null,
      questions: [{ id: "q1", question: ASKED, blocking: false, assumption: "callbacks still work" }],
      assumptions: [],
      docs_read: ["PRD.md"],
    };
    const backend = new MockBackend({ planner: planner(analysis, DRAFT(["t-100"])) });
    await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));
    const calls = backend.calls.filter((c) => c.role === "research");
    expect(calls[0], "ANALYZE raised a question and no research session was launched at all").toBeDefined();
    return { calls, root };
  }

  function inputsOf(call: RecordedCall): Record<string, unknown> {
    return (JSON.parse(call.spec.promptVariable) as { inputs: Record<string, unknown> }).inputs;
  }

  it("passes both expected_output arms, so the session is not left to guess at prompts/research.md", async () => {
    const { calls } = await researchCalls();
    const inputs = inputsOf(calls[0]!);
    const hash = questionHash(ASKED);
    expect(inputs["expected_output"], "the shape planningBriefSchema actually accepts").toEqual(planningBriefSkeleton(ASKED, hash));
    expect(inputs["expected_output_if_undecidable"], "and the arm that settles a question without answering it").toEqual(
      undecidableBriefSkeleton(ASKED, hash),
    );
  });

  it("binds the session to its question by hash and by artifact path (D-19)", async () => {
    const { calls, root } = await researchCalls();
    const inputs = inputsOf(calls[0]!);
    const hash = questionHash(ASKED);
    expect(inputs["question"]).toBe(ASKED);
    expect(inputs["question_hash"], "the session echoes this; it is what proves the brief answers THIS question").toBe(hash);
    expect(calls[0]!.spec.artifactOut, "one fixed path for every question is how a stale brief became an answer").toBe(
      planningArtifactPath(root, hash),
    );
  });

  it("hands the session its SHARE of the pool under the key the prompt reads", async () => {
    const { calls } = await researchCalls();
    const inputs = inputsOf(calls[0]!);
    expect(inputs["tool_call_budget"], "a lone question is offered the whole pool (D-16)").toBe(
      BUDGETS.planning_research_tool_calls,
    );
  });
  /**
   * The relaunch exists to tell the session what the validator refused. Nothing
   * pinned that it reaches the session — `previousAttemptInput` is asserted at
   * the plan-review call site and this one merely spreads it, which is the same
   * "the mechanism exists, the call site does not use it" shape as D-17.
   */
  it("tells the reshape relaunch what the validator refused, and the first attempt nothing", async () => {
    const { calls } = await researchCalls();
    expect(calls.length, "one attempt and one reshape relaunch").toBe(2);
    expect(inputsOf(calls[0]!)["previous_attempt"], "there is nothing to tell a first attempt").toBeUndefined();
    const carried = inputsOf(calls[1]!)["previous_attempt"] as { issue: string } | undefined;
    expect(carried?.issue, "the relaunch is told why, in the validator's own words").toBe("the session wrote no artifact");
  });
});
