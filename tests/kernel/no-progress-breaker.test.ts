import { afterEach, describe, expect, it } from "vitest";
import { RunJournal } from "../../src/kernel/journal.js";
import { SpendLedger, readRecordedSpend, type ProgressBreaker } from "../../src/kernel/ledger.js";
import { CEILINGS } from "../../src/schemas/budgets.js";
import { okResult } from "../../src/sessions/mock.js";
import { removeTree } from "../helpers.js";
import { makeRunRepo } from "./run-fixture.js";

/**
 * D-14 and D-15 (PRDR-261) — what the no-progress breaker counts, and where its
 * boundary sits.
 *
 * `meanSessionCost` and `progressThreshold` had no direct coverage in the suite
 * at all, and every test that reached the threshold through `SpendLedger` set
 * `spend_without_progress_sessions` to 1, 0.001 or 0. The shipped default of 20
 * — the value the live run used — was never exercised, and no test ever had
 * `rows === sessions`. The term was covered; the boundary of the term was not.
 *
 * Three of the cases below PASS on HEAD and are named as regression guards
 * rather than counted as falsification: the r = n + 1 and r = n - 1 rails,
 * which a too-wide tolerance or a relocated default would break.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

const PRODUCTION: ProgressBreaker = {
  spend_without_progress_floor_usd: CEILINGS.spend_without_progress_floor_usd.default,
  spend_without_progress_multiple: CEILINGS.spend_without_progress_multiple.default,
  spend_without_progress_sessions: CEILINGS.spend_without_progress_sessions.default,
};

const AT = "2026-09-16T08:00:00.000Z";

async function root(): Promise<string> {
  const made = await makeRunRepo();
  roots.push(made.root);
  return made.root;
}

/**
 * Drive a fresh ledger through `sessions` launches at one price, then ask for
 * the verdict.
 *
 * PRDR-265: the verdict used to be an exception and is now a sentence. Every
 * assertion below reads the TEXT and is unchanged by that — what D-14 and D-15
 * are about is which sessions the breaker counts and what evidence it carries,
 * and neither depends on whether the number halts the run.
 */
async function verdict(cost: number, sessions: number, breaker: ProgressBreaker = PRODUCTION): Promise<string> {
  const r = await root();
  const journal = RunJournal.open(r);
  const said: string[] = [];
  try {
    const ledger = new SpendLedger(r, journal, 0, breaker, (t) => said.push(t));
    for (let i = 0; i < sessions; i += 1) {
      ledger.record(`t${String(i)}`, 0, "planner", okResult({ costEstimateUsd: cost }), AT);
    }
    ledger.recordLaunch();
    return said.find((t) => t.includes("no-progress breaker")) ?? "allowed";
  } finally {
    journal.close();
  }
}

/**
 * D-15 — the boundary the design names, decided by arithmetic and not by IEEE-754.
 *
 * Before any unit completes the mark is $0, so `sinceProgress` IS the file's
 * total — and the governing term divides that same total by the session count
 * and multiplies it by `spend_without_progress_sessions`. At rows === sessions
 * the two sides are one number and the design's own `>` says ALLOWED. Twenty
 * sessions at $0.251 sum to 5.0200000000000004619 while (S/20)*20 is
 * 5.0199999999999995737 — one ulp low, so HEAD refuses. The same twenty
 * sessions at $251 round-trip exactly, so HEAD allows them. Identical count,
 * identical rule, opposite verdict, decided by the low bits of the money.
 */
describe("D-15 twenty sessions is twenty sessions, at every price", () => {
  it("does not refuse the session that completes the count, at either scale", async () => {
    const cheap = await verdict(0.251, 20);
    const dear = await verdict(251, 20);
    expect(cheap, "the twentieth session IS the twentieth — what crosses the bound is the twenty-FIRST").toBe("allowed");
    expect(dear, "a boundary that is a count cannot be decided by the scale of the money").toBe(cheap);
  });

  /** Regression guard, not falsification: passes on HEAD. It is the trap a too-wide tolerance springs. */
  it("and refuses the one past it, at either scale", async () => {
    expect(await verdict(0.251, 21)).toContain("no-progress breaker");
    expect(await verdict(251, 21)).toContain("no-progress breaker");
  });

  /** Regression guard, not falsification: passes on HEAD. */
  it("and leaves the one below it alone, at either scale", async () => {
    expect(await verdict(0.251, 19)).toBe("allowed");
    expect(await verdict(251, 19)).toBe("allowed");
  });

  it("names the term that governs, its factors, and the sessions they were observed over", async () => {
    const message = await verdict(0.251, 21);
    expect(message, "the ceiling key, not a bare dollar figure").toContain("spend_without_progress_sessions = 20");
    expect(message, "the count the mean was taken over (D-14)").toContain("21 transacting session(s)");
    expect(message, "the observation the bound multiplies").toContain("$0.2510 mean");
    expect(message, "and the spend, at the resolution the ledger carries").toContain("$5.2710 spent");
  });
});

/**
 * D-15 — a halt may not present one figure as past itself.
 *
 * Reachable with no float subtlety at all through the perUnit term: $12.001
 * spent since a $4 unit at a multiple of 3 rendered "$12.00 spent ... past the
 * $12.00 this run allows" on HEAD. The same shape on the ceilings
 * `tests/plugin/parity.test.ts` configures rendered "$0.00 ... past the $0.00" —
 * a breaker reporting its own halt in a unit too coarse to represent the
 * ceiling it just enforced.
 */
describe("D-15 the halt carries evidence, not a contradiction", () => {
  const halt = async (breaker: ProgressBreaker, drive: (ledger: SpendLedger) => void): Promise<string> => {
    const r = await root();
    const journal = RunJournal.open(r);
    const said: string[] = [];
    try {
      const ledger = new SpendLedger(r, journal, 0, breaker, (t) => said.push(t));
      drive(ledger);
      ledger.recordLaunch();
      return said.find((t) => t.includes("no-progress breaker")) ?? "allowed";
    } finally {
      journal.close();
    }
  };

  it("never prints the same figure on both sides of the bound", async () => {
    const message = await halt(
      { spend_without_progress_floor_usd: 1, spend_without_progress_multiple: 3, spend_without_progress_sessions: 1 },
      (ledger) => {
        ledger.record("t1", 0, "implement", okResult({ costEstimateUsd: 4 }), AT);
        ledger.noteProgress();
        ledger.record("t2", 0, "implement", okResult({ costEstimateUsd: 12.001 }), AT);
      },
    );
    expect(message, "the launch must be refused at all").toContain("no-progress breaker");
    expect(message, "the term that actually governed Math.max is the one named").toContain("spend_without_progress_multiple = 3");
    const figures = [...message.matchAll(/\$[\d,]+\.\d+/g)].map((match) => match[0]);
    expect(new Set(figures).size, `"${figures.join('" past "')}" tells an operator nothing: ${message}`).toBe(figures.length);
  });

  it("prints money in a unit that can represent the ceiling it enforced", async () => {
    const message = await halt(
      { spend_without_progress_floor_usd: 0.0001, spend_without_progress_multiple: 3, spend_without_progress_sessions: 0.001 },
      (ledger) => {
        ledger.record("t1", 0, "planner", okResult({ costEstimateUsd: 0.001 }), AT);
      },
    );
    expect(message).toContain("no-progress breaker");
    expect(message, "a sub-cent ceiling rendered at two decimals is $0.00 past $0.00").not.toContain("$0.00 ");
    expect(message, "and the configured minimum is printed as configured, not as a dollar total").toContain("spend_without_progress_floor_usd = 0.0001");
  });
});

/**
 * D-14 — a row that transacted nothing does not set the scale.
 *
 * The live ksar-cloud file: three `planner` rows carrying $11.0275965 between
 * them, and twenty-one rows at $0 flagged `partial: "crash"` — the wreckage of
 * D-13's mis-parsed usage limit. They left the numerator alone and grew the
 * denominator from 3 to 24.
 */
describe("D-14 the mean's denominator counts sessions that transacted", () => {
  const KSAR_PAID = [3.2017305, 4.030335999999999, 3.79553];
  const KSAR_TOTAL = 11.0275965;

  const ksar = async (): Promise<{ ledger: SpendLedger; journal: RunJournal; said: string[] }> => {
    const r = await root();
    const journal = RunJournal.open(r);
    const said: string[] = [];
    const ledger = new SpendLedger(r, journal, 0, PRODUCTION, (t) => said.push(t));
    for (const [i, cost] of KSAR_PAID.entries()) ledger.record(`p${String(i)}`, 0, "planner", okResult({ costEstimateUsd: cost, turns: 38 }), AT);
    for (let i = 0; i < 21; i += 1) {
      ledger.record(`c${String(i)}`, 0, "planner", okResult({ costEstimateUsd: 0, crashed: true, turns: 18 }), AT);
    }
    return { ledger, journal, said };
  };

  /**
   * PRDR-265 kept this test's subject and changed its verb: "do not halt" is
   * now "have nothing to say". D-14 is about the DENOMINATOR — twenty-one rows
   * that transacted nothing must not drag the mean down until three paid
   * sessions look like a runaway — and that arithmetic is what decides whether
   * the breaker speaks, exactly as it used to decide whether it threw.
   */
  it("twenty-one crash rows at $0 say nothing about a run three paid sessions in (the live shape)", async () => {
    const { ledger, journal, said } = await ksar();
    try {
      expect(ledger.progressThreshold(), "the three sessions that transacted are the denominator").toBeCloseTo((KSAR_TOTAL / 3) * 20, 6);
      ledger.recordLaunch();
      expect(
        said.filter((t) => t.includes("no-progress breaker")),
        "$11.03 against a threshold of $73.52 — the crash rows must not make this look like a runaway",
      ).toEqual([]);
    } finally {
      journal.close();
    }
  });

  it("a partial row's money still counts as spend, and still does not set the scale", async () => {
    const r = await root();
    const journal = RunJournal.open(r);
    try {
      const breaker: ProgressBreaker = { spend_without_progress_floor_usd: 1, spend_without_progress_multiple: 3, spend_without_progress_sessions: 1 };
      const ledger = new SpendLedger(r, journal, 0, breaker);
      ledger.record("t1", 0, "implement", okResult({ costEstimateUsd: 10 }), AT);
      const crashed = ledger.record("t2", 0, "implement", okResult({ costEstimateUsd: 2, crashed: true }), AT);
      expect(crashed.partial, "the flag is set from result.crashed alone, whatever the cost").toBe("crash");
      expect(readRecordedSpend(r), "money of record: never dropped").toBeCloseTo(12, 6);
      expect(ledger.progressThreshold(), "a flagged lower bound is not an observation of what a session costs").toBeCloseTo(10, 6);
    } finally {
      journal.close();
    }
  });

  it("with no session to average the mean is 0 and the FLOOR governs — never NaN", async () => {
    const r = await root();
    const journal = RunJournal.open(r);
    try {
      const ledger = new SpendLedger(r, journal, 0, PRODUCTION);
      for (let i = 0; i < 24; i += 1) ledger.record(`c${String(i)}`, 0, "planner", okResult({ costEstimateUsd: 0.3, crashed: true }), AT);
      const threshold = ledger.progressThreshold();
      expect(Number.isFinite(threshold), "0/0 is NaN, Math.max(5,0,NaN) is NaN, and x > NaN is always false").toBe(true);
      expect(threshold, "the floor is a MINIMUM, not a fallback").toBe(5);
      expect(readRecordedSpend(r), "their money is still money").toBeCloseTo(7.2, 6);
      const said: string[] = [];
      const speaking = new SpendLedger(r, journal, 0, PRODUCTION, (t) => said.push(t));
      speaking.recordLaunch();
      expect(said.join(" "), "$7.20 past a floor of $5 is worth saying").toContain("no-progress breaker");
    } finally {
      journal.close();
    }
  });
});
