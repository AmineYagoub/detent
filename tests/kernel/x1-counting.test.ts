import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CEILINGS, CEILING_KEYS, type CeilingKey } from "../../src/schemas/budgets.js";
import { breachTargetFor } from "../../src/kernel/budgets.js";
import { ZERO_COUNTERS } from "../../src/kernel/generations.js";
import { resolveRed } from "../../src/kernel/resolver.js";
import { maxPossibleSessions } from "../../src/kernel/worstcase.js";
import { SpendLedger, noteUnitComplete, type ProgressBreaker } from "../../src/kernel/ledger.js";
import { RunJournal } from "../../src/kernel/journal.js";
import { briefCachePath, researchStage } from "../../src/kernel/stages/research.js";
import { cacheKey, type EnvFingerprint } from "../../src/adapter/env.js";
import { planResearch, planningBriefPath, questionHash } from "../../src/init/plan-research.js";
import { okResult } from "../../src/sessions/mock.js";
import { removeTree, tmpTree } from "../helpers.js";
import { makeRunRepo } from "./run-fixture.js";

/**
 * PRDR-265 — the X-1 ceilings that are genuinely budgets count instead of
 * halting, and the six that are sequencers are proven untouched.
 *
 * An eight-agent survey mapped every enforcement site before a line was
 * changed, and its finding is the reason this file has two halves. Five keys on
 * the original convert list are not budgets: `resolveRed` takes only `Counters`
 * and has no `Budgets` parameter at all, so the ladder's ceilings are ALREADY
 * inert and its `=== 0` comparisons are rungs one, two and three; removing them
 * deletes escalation. `review_fix_attempts` and `hypotheses` each close a
 * concrete cycle. The survey verified the consequence rather than predicting
 * it: with those two count-only, `maxPossibleSessions` throws
 * `UnboundedWorstCaseError` at CONFIG LOAD.
 *
 * So the second describe block is not decoration. Those cases PASS on HEAD and
 * are named as regression guards rather than counted as falsification — they
 * are the evidence that the scope held, and `the worst case is still finite`
 * is the single test that would have caught the unsafe version.
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

async function runRoot(): Promise<string> {
  const made = await makeRunRepo();
  roots.push(made.root);
  return made.root;
}

const CONVERTED: readonly CeilingKey[] = [
  "failure_research_tool_calls",
  "planning_research_tool_calls",
  "sessions",
  "spend_without_progress_floor_usd",
  "spend_without_progress_multiple",
  "spend_without_progress_sessions",
];

/** The six the survey proved are sequencers or timeouts, plus the three process guards. */
const CARVED_OUT: readonly CeilingKey[] = [
  "blind_fix_attempts",
  "informed_fix_attempts",
  "research_sessions",
  "review_fix_attempts",
  "hypotheses",
  "ticket_wall_clock_ms",
];

const ENV: EnvFingerprint = {
  ecosystems: [],
  lockfile_hash: "c".repeat(64),
  runtime_version: "node 22.0.0",
  version_facts: {},
};

const SIGNATURE = "a".repeat(64);

const GOOD_BRIEF = {
  schema_version: 1,
  failure_signature: SIGNATURE,
  cache_key: cacheKey(SIGNATURE, ENV),
  root_cause: { claim: "found it", confidence: "high" },
  evidence: [{ source: "src/x.py", claim: "here" }],
  version_facts: {},
  recommended_fix: { strategy: "do the thing" },
  what_would_falsify: "it stays red",
  local_search: { docs_checked: ["a"], code_checked: [] },
};

const VALID_PLANNING_BRIEF = (question: string): object => ({
  schema_version: 1,
  question,
  question_hash: questionHash(question),
  answer: { claim: "the ladder is published", confidence: "high" },
  evidence: [{ source: "https://docs.example.com/pricing", claim: "the ladder is published" }],
  sources_consulted: [{ tier: 1, ref: "PRD.md" }],
  local_search: { docs_checked: ["PRD.md"], code_checked: [] },
  what_would_falsify: "the page stops listing prices",
});

describe("PRDR-265 a converted ceiling declares NONE and keeps its counting site", () => {
  it("every converted key routes nowhere, joining turns_per_stage and run_spend_usd", () => {
    /** The two already-converted keys are the precedent, asserted so the shape is one shape. */
    expect(breachTargetFor("turns_per_stage")).toBe("NONE");
    expect(breachTargetFor("run_spend_usd")).toBe("NONE");
    for (const key of CONVERTED) {
      expect(breachTargetFor(key), `${key} still routes a breach`).toBe("NONE");
    }
  });

  it("keeps every ceiling's DEFAULT exactly where it was — what changes is whether crossing it halts", () => {
    expect(CEILINGS.sessions.default).toBe(28);
    expect(CEILINGS.failure_research_tool_calls.default).toBe(8);
    expect(CEILINGS.planning_research_tool_calls.default).toBe(16);
    expect(CEILINGS.spend_without_progress_floor_usd.default).toBe(5);
    expect(CEILINGS.spend_without_progress_sessions.default).toBe(20);
    expect(CEILINGS.spend_without_progress_multiple.default).toBe(3);
    expect(CEILING_KEYS, "no key is deleted — they stay configurable and reported").toHaveLength(17);
  });
});

describe("PRDR-265 failure_research_tool_calls counts", () => {
  /**
   * PRDR-250 made the ceiling read the observed turn count back and route
   * RESEARCH_DRY past it, which is enforcement. Under counting the turn count
   * says nothing about whether the brief is any good, so a brief that parses is
   * accepted and cached on its own merits.
   */
  it("a session past its ceiling still yields its brief, and still seeds the cache", async () => {
    const r = await runRoot();
    const notes: string[] = [];
    const outcome = await researchStage({
      root: r,
      launch: async () => CEILINGS.failure_research_tool_calls.default + 1,
      readArtifact: () => GOOD_BRIEF,
      readFailureSignature: () => SIGNATURE,
      budgets: { failure_research_tool_calls: CEILINGS.failure_research_tool_calls.default },
      note: (t) => notes.push(t),
      env: async () => ENV,
      ticketInputs: {},
    });

    expect(outcome.event.event, "the turn count is not a verdict on the brief").toBe("RESEARCH_VALID");
    expect(existsSync(briefCachePath(r, cacheKey(SIGNATURE, ENV))), "a brief that parses is cached on its own merits").toBe(true);
  });

  it("reports the turns against the stated ceiling on EVERY session, not only on overrun", async () => {
    const r = await runRoot();
    const notes: string[] = [];
    await researchStage({
      root: r,
      launch: async () => 3,
      readArtifact: () => GOOD_BRIEF,
      readFailureSignature: () => SIGNATURE,
      budgets: { failure_research_tool_calls: 8 },
      note: (t) => notes.push(t),
      env: async () => ENV,
      ticketInputs: {},
    });
    /** Counting without reporting is not counting — the figure has to be observable when nothing is wrong. */
    expect(notes.join(" "), "an in-budget session's spend is reported too").toMatch(/3 turns against .*8/);
  });
});

describe("PRDR-265 planning_research_tool_calls counts (D-18)", () => {
  const THREE = ["which accounts are payable?", "what is the price ladder?", "what retention applies?"];

  async function drive(r: string, questions: readonly string[], budget: number, spend: number) {
    const notes: string[] = [];
    const result = await planResearch(questions, {
      root: r,
      budget,
      note: (t) => notes.push(t),
      researchOne: (question, _share, artifactOut) => {
        mkdirSync(path.dirname(artifactOut), { recursive: true });
        writeFileSync(artifactOut, JSON.stringify(VALID_PLANNING_BRIEF(question)), "utf8");
        return Promise.resolve({ toolCalls: spend });
      },
    });
    return { result, notes };
  }

  /**
   * The skip arm is the only thing this ceiling ever did to behaviour: a
   * question whose turn came after the pool was gone got NO session at all and
   * joined the AWAIT_INFO batch unresearched. Under counting, a budget may not
   * decide that a question goes unasked.
   */
  it("gives every question a session even when the pool is long gone", async () => {
    const { result } = await drive(root(), THREE, 2, 5);
    expect(result.sessionsLaunched, "three questions, three sessions, whatever the pool says").toBe(3);
    expect(result.briefs, "a budget may not decide which question goes unasked — all three are answered").toHaveLength(3);
    expect(result.unanswered, "and none of them joins the AWAIT_INFO batch for want of budget").toEqual([]);
  });

  /**
   * D-18's actual complaint. `Math.min(spentHere, share)` made `toolCallsUsed`
   * report ALLOCATION while reading as SPEND — the file's own doc-block conceded
   * the excess "has always fallen on the floor here". With nothing to enforce
   * there is no reason left to discard the observation. Live run 4 spent 33
   * against a pool of 16 and the counter said 16.
   */
  it("reports the calls that were actually made, not the share they were allowed", async () => {
    const { result } = await drive(root(), THREE, 16, 11);
    expect(result.toolCallsUsed, "33 against a pool of 16 is the number an operator needs to see").toBe(33);
  });

  it("still answers a cached question for free — C-3a's acceptance is unaffected", async () => {
    const r = root();
    const cached = THREE[1] as string;
    const file = planningBriefPath(r, questionHash(cached));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(VALID_PLANNING_BRIEF(cached)), "utf8");

    const { result } = await drive(r, THREE, 16, 1);
    expect(result.cacheHits).toBe(1);
    expect(result.sessionsLaunched, "only the two uncached questions cost a session").toBe(2);
  });
});

describe("PRDR-265 the no-progress breaker announces instead of refusing", () => {
  const TINY: ProgressBreaker = {
    spend_without_progress_floor_usd: 0.001,
    spend_without_progress_multiple: 1,
    spend_without_progress_sessions: 1,
  };

  it("records the launch and says what it would have stopped, rather than throwing", async () => {
    const r = await runRoot();
    const journal = RunJournal.open(r);
    const said: string[] = [];
    try {
      const ledger = new SpendLedger(r, journal, 0, TINY, (t) => said.push(t));
      for (let i = 0; i < 6; i += 1) {
        ledger.record(`t${String(i)}`, 0, "planner", okResult({ costEstimateUsd: 2 }), "2026-09-16T08:00:00.000Z");
      }
      expect(() => ledger.recordLaunch(), "a budget may not refuse a launch").not.toThrow();
      expect(said.join(" "), "but it must say what it saw — counting without reporting is not counting").toContain(
        "without completing a unit of work",
      );
    } finally {
      journal.close();
    }
  });

  /** Say-once, on the precedent `announceAdvisoryTotal` already set for `run_spend_usd`. */
  it("says it once, not on every launch", async () => {
    const r = await runRoot();
    const journal = RunJournal.open(r);
    const said: string[] = [];
    try {
      const ledger = new SpendLedger(r, journal, 0, TINY, (t) => said.push(t));
      for (let i = 0; i < 6; i += 1) {
        ledger.record(`t${String(i)}`, 0, "planner", okResult({ costEstimateUsd: 2 }), "2026-09-16T08:00:00.000Z");
      }
      ledger.recordLaunch();
      ledger.recordLaunch();
      ledger.recordLaunch();
      expect(said.filter((t) => t.includes("without completing a unit of work")), "a warning that fires constantly is one an operator learns to skip (V-1‴)").toHaveLength(1);
    } finally {
      journal.close();
    }
  });

  /**
   * The complement of say-once, and the reason the two flags differ.
   *
   * `announceAdvisoryTotal` is said once for the RUN, because cumulative spend
   * only grows and the operator learns nothing from hearing it again. A
   * no-progress episode ENDS when something finishes, so the flag clears with
   * the mark: an operator who acted on the first warning and got a unit through
   * is owed the next one. Carrying `breakerAnnounced` forward through
   * `noteUnitComplete` would silence every episode after the first — one
   * warning for a run that stalls, recovers and stalls again for hours.
   */
  it("re-arms after a unit completes, so a second stall is news again", async () => {
    const r = await runRoot();
    const journal = RunJournal.open(r);
    const said: string[] = [];
    const breakerSaid = (): string[] => said.filter((t) => t.includes("without completing a unit of work"));
    try {
      const ledger = new SpendLedger(r, journal, 0, TINY, (t) => said.push(t));
      for (let i = 0; i < 6; i += 1) {
        ledger.record(`a${String(i)}`, 0, "planner", okResult({ costEstimateUsd: 2 }), "2026-09-16T08:00:00.000Z");
      }
      ledger.recordLaunch();
      expect(breakerSaid(), "the first stall").toHaveLength(1);

      noteUnitComplete(r);
      ledger.recordLaunch();
      expect(breakerSaid(), "something finished — nothing to report, and the flag is down").toHaveLength(1);

      /**
       * Comfortably past the threshold, which the completed unit reset to its
       * own $12 cost: a second stall that merely TIES it is suppressed by
       * TIE_TOLERANCE, and that is the tolerance working rather than the flag
       * failing to clear.
       */
      for (let i = 0; i < 12; i += 1) {
        ledger.record(`b${String(i)}`, 0, "planner", okResult({ costEstimateUsd: 2 }), "2026-09-16T08:00:00.000Z");
      }
      ledger.recordLaunch();
      expect(breakerSaid(), "and the SECOND stall is a new episode, not a repeat of the first").toHaveLength(2);
    } finally {
      journal.close();
    }
  });

  /**
   * The arithmetic PRDR-261 pinned survives the conversion untouched: the
   * threshold, its governing term and the mean are still computed, because they
   * are the only place the repo learns what a unit of work costs.
   */
  it("still computes the threshold it no longer enforces", async () => {
    const r = await runRoot();
    const journal = RunJournal.open(r);
    try {
      const ledger = new SpendLedger(r, journal, 0, TINY);
      ledger.record("t0", 0, "planner", okResult({ costEstimateUsd: 2 }), "2026-09-16T08:00:00.000Z");
      expect(ledger.progressThreshold(), "measurement is kept; only the throw goes").toBeGreaterThan(0);
    } finally {
      journal.close();
    }
  });
});

describe("PRDR-265 the dead budget route goes with the live ones", () => {
  /**
   * PRDR-191 converted `run_spend_usd` and left the corpse wired in.
   * `SpendExhaustedError` has zero throw sites in src or tests — verified by
   * grep — while `referee/registry.ts` still maps it to error code BREACH,
   * which reads as a live budget route to anyone tracing how a breach happens.
   */
  it("SpendExhaustedError is gone from the ledger's exports", async () => {
    const ledger = (await import("../../src/kernel/ledger.js")) as Record<string, unknown>;
    expect(ledger["SpendExhaustedError"], "a class nothing can throw is not a budget route").toBeUndefined();
  });
});

/*
 * ---------------------------------------------------------------------------
 * Regression guards. These PASS on HEAD and must keep passing: they are the
 * evidence that the survey's carve-out held.
 */

describe("PRDR-265 the six carve-outs are untouched", () => {
  it("every carved-out key keeps the breach target it had", () => {
    for (const key of CARVED_OUT) {
      expect(breachTargetFor(key), `${key} must still route its breach`).toBe("BUDGET_BREACH");
    }
    /** The three process guards, excluded from the outset, keep their own targets. */
    expect(breachTargetFor("flake_reruns")).toBe("LADDER_ENTRY");
    expect(breachTargetFor("gate_timeout_ms")).toBe("RED_GATE_NO_EXIT");
    expect(breachTargetFor("binding_probe_timeout_ms")).toBe("REJECTED_CANDIDATE");
  });

  /**
   * The ladder is three rungs, not three caps. `resolveRed`'s signature is the
   * proof — it takes `Counters` and nothing else, so the configured ceiling
   * cannot reach it and the comparisons cannot be budgeting.
   */
  it("still escalates BLIND_FIX -> RESEARCH -> INFORMED_FIX -> NEEDS_HUMAN", () => {
    const a = resolveRed({ ...ZERO_COUNTERS });
    expect(a.next).toBe("BLIND_FIX");
    const b = resolveRed(a.counters);
    expect(b.next).toBe("RESEARCH");
    const c = resolveRed(b.counters);
    expect(c.next).toBe("INFORMED_FIX");
    const d = resolveRed(c.counters);
    expect(d.next, "the ladder terminates at a human, not at a budget").toBe("NEEDS_HUMAN");
  });

  /**
   * THE test that would have caught the unsafe scope. With
   * `review_fix_attempts` or `hypotheses` count-only, this throws
   * `UnboundedWorstCaseError` — the walk finds a cycle and there is no finite
   * answer. That it returns a number is the property that makes PRDR-265
   * shippable on its own.
   */
  it("the worst case is still finite — the machine still terminates", () => {
    const budgets = Object.fromEntries(CEILING_KEYS.map((k) => [k, CEILINGS[k].default])) as Record<CeilingKey, number>;
    const computed = maxPossibleSessions(budgets);
    expect(Number.isFinite(computed), "a cycle here means a paid session per lap, forever").toBe(true);
    expect(computed).toBeGreaterThan(0);
  });
});
