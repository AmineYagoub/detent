import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunJournal } from "../../src/kernel/journal.js";
import { NoProgressError, SpendLedger, readRecordedSpend } from "../../src/kernel/ledger.js";
import { EXIT_HUMAN_GATED, run } from "../../src/kernel/run.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { ledgerRowSchema } from "../../src/schemas/records.js";
import { MockBackend, okResult } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree, tmpTree, writeTree } from "../helpers.js";
import { addTicket, implementRed, makeRunRepo } from "./run-fixture.js";

/** T-048 — the ledger and the cross-generation spend backstop (S-4, X-8, D-25). */

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

async function fixture(spendCeiling?: number): Promise<string> {
  const { root } = await makeRunRepo();
  roots.push(root);
  if (spendCeiling !== undefined) {
    const configPath = path.join(root, ".detent/config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as { budgets: { run_spend_usd: number } };
    config.budgets.run_spend_usd = spendCeiling;
    writeTree(root, { ".detent/config.json": `${JSON.stringify(config, null, 2)}\n` });
  }
  return root;
}

const rows = (root: string) =>
  readFileSync(path.join(root, ".detent/ledger.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => ledgerRowSchema.parse(JSON.parse(line)));

describe("T-048 D-25: the spend ceiling is a launch gate", () => {
  /**
   * X-1⁵ (PRDR-191) replaces what this case used to assert. It drove a run at a
   * ceiling below one session's cost and required the SECOND launch to be
   * refused → NEEDS_HUMAN. That behaviour is deleted: a total fired on success,
   * and the run above was a working run stopped by arithmetic. Asserted through
   * `run` rather than the ledger class, because the production path is where
   * the old refusal lived and where its absence has to be observable.
   */
  it("a total below one session's cost no longer stops a working run (X-1⁵)", async () => {
    const root = await fixture(0.0005);
    addTicket(root, { id: "t1" });

    const backend = new MockBackend({ implement: implementRed });
    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "spend" });

    /** The ladder runs its course; nothing was refused for reaching a total. */
    expect(backend.calls.length).toBeGreaterThan(1);
    expect(readRecordedSpend(root)).toBeGreaterThan(0.0005);
    const t1 = readTicket(root, "t1");
    /**
     * It still ends human-gated — but for the LADDER exhausting on a red gate,
     * which is the honest outcome for `implementRed`. What must not appear is a
     * refusal for reaching a total, and that is what the note asserts.
     */
    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    expect(t1.notes.map((n) => n.text).join(" ")).not.toContain("run-spend exhaustion");
    expect(rows(root).length).toBeGreaterThan(1);
  });

  it("spend accumulates across resumed invocations — a requeue never resets the money (X-8)", async () => {
    const root = await fixture();
    const journal = RunJournal.open(root);
    try {
      const ledger = new SpendLedger(root, journal, 999);
      ledger.record("t1", 0, "implement", okResult({ costEstimateUsd: 0.25 }), "2026-08-18T10:00:00.000Z");
      expect(ledger.spent()).toBeCloseTo(0.25, 6);
    } finally {
      journal.close();
    }
    /** A second run (fresh ledger) starts from the file's cumulative total. */
    const journal2 = RunJournal.open(root);
    try {
      const ledger2 = new SpendLedger(root, journal2, 0.2);
      expect(ledger2.spent()).toBeCloseTo(0.25, 6);
    } finally {
      journal2.close();
    }
  });
});

/**
 * X-1⁵ (PRDR-191) — the ceiling counts; what halts is spend WITHOUT PROGRESS.
 *
 * A total fires on success and fires late on failure. Legitimate work completes
 * things — a slice, a ticket reaching DONE — and a runaway does not, so the
 * quantity worth bounding is dollars since the last completed unit.
 */
describe("X-1⁵ the run ceiling counts and does not block", () => {
  it("does not halt a run that has passed its advisory total, and says so once", async () => {
    const root = await fixture();
    const journal = RunJournal.open(root);
    const said: string[] = [];
    try {
      const ledger = new SpendLedger(
        root,
        journal,
        0.01,
        { spend_without_progress_floor_usd: 100, spend_without_progress_multiple: 3 },
        (t) => said.push(t),
      );
      ledger.record("t1", 0, "implement", okResult({ costEstimateUsd: 5 }), "2026-08-18T10:00:00.000Z");
      expect(ledger.spent()).toBeGreaterThan(0.01);
      expect(() => ledger.assertLaunchAllowed()).not.toThrow();
      expect(ledger.overAdvisoryTotal()).toBe(true);
      /* Counting without reporting is not counting — but a warning on every launch is noise. */
      expect(said).toHaveLength(1);
      expect(said[0]).toContain("advisory");
      ledger.assertLaunchAllowed();
      ledger.assertLaunchAllowed();
      expect(said).toHaveLength(1);
    } finally {
      journal.close();
    }
  });

  it("halts when money goes out and nothing completes", async () => {
    const root = await fixture();
    const journal = RunJournal.open(root);
    try {
      const ledger = new SpendLedger(root, journal, 0, { spend_without_progress_floor_usd: 10, spend_without_progress_multiple: 3 });
      for (let i = 0; i < 3; i += 1) {
        ledger.record(`t${String(i)}`, 0, "implement", okResult({ costEstimateUsd: 4 }), "2026-08-18T10:00:00.000Z");
      }
      expect(() => ledger.assertLaunchAllowed()).toThrow(NoProgressError);
    } finally {
      journal.close();
    }
  });

  it("never halts a run that keeps completing units, however expensive", async () => {
    const root = await fixture();
    const journal = RunJournal.open(root);
    try {
      const ledger = new SpendLedger(root, journal, 0, { spend_without_progress_floor_usd: 10, spend_without_progress_multiple: 3 });
      for (let i = 0; i < 20; i += 1) {
        ledger.record(`t${String(i)}`, 0, "implement", okResult({ costEstimateUsd: 8 }), "2026-08-18T10:00:00.000Z");
        ledger.noteProgress();
        expect(() => ledger.assertLaunchAllowed()).not.toThrow();
      }
      expect(ledger.spent()).toBeCloseTo(160, 6);
    } finally {
      journal.close();
    }
  });

  /**
   * The trap this design walks into if the threshold is a mean alone. A resumed
   * run reuses finished slices for $0, so the observed cost per unit collapses
   * to zero and a purely derived threshold would halt on the first dollar
   * spent — punishing exactly the checkpoint reuse C-8 exists to provide.
   */
  it("does not collapse to zero when completed units cost nothing (C-8 reuse)", async () => {
    const root = await fixture();
    const journal = RunJournal.open(root);
    try {
      const ledger = new SpendLedger(root, journal, 0, { spend_without_progress_floor_usd: 10, spend_without_progress_multiple: 3 });
      for (let i = 0; i < 8; i += 1) ledger.noteProgress();
      ledger.record("t1", 0, "planner", okResult({ costEstimateUsd: 5 }), "2026-08-18T10:00:00.000Z");
      expect(() => ledger.assertLaunchAllowed()).not.toThrow();
    } finally {
      journal.close();
    }
  });

  it("carries the spend since the last unit in what it throws", async () => {
    const root = await fixture();
    const journal = RunJournal.open(root);
    try {
      const ledger = new SpendLedger(root, journal, 0, { spend_without_progress_floor_usd: 1, spend_without_progress_multiple: 3 });
      ledger.record("t1", 0, "planner", okResult({ costEstimateUsd: 9 }), "2026-08-18T10:00:00.000Z");
      expect(() => ledger.assertLaunchAllowed()).toThrow(/9\.00.*without completing/s);
    } finally {
      journal.close();
    }
  });
});

describe("T-048 field discipline (S-4, PRDR-052/053)", () => {
  it("the per-model breakdown is the token source of record when present", async () => {
    const root = await fixture();
    const journal = RunJournal.open(root);
    try {
      const ledger = new SpendLedger(root, journal, 999);
      const row = ledger.record(
        "t1",
        0,
        "implement",
        okResult({
          /* Cumulative fields deliberately disagree with the breakdown. */
          costEstimateUsd: 0.01,
          inputTokens: 10,
          outputTokens: 1,
          perModel: {
            "claude-opus-5": { inputTokens: 900, outputTokens: 90, cacheReadInputTokens: 100, cacheCreationInputTokens: 5, costUSD: 0.09 },
            "claude-haiku-4-5": { inputTokens: 100, outputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.01 },
          },
        }),
        "2026-08-18T10:00:00.000Z",
      );
      expect(row.input_tokens).toBe(1000);
      expect(row.output_tokens).toBe(100);
      expect(row.cache_read_input_tokens).toBe(100);
      expect(row.cost_estimate_usd).toBeCloseTo(0.1, 6);
    } finally {
      journal.close();
    }
  });

  it("a crashed session's zeroed telemetry is a flagged lower bound — and a zero-turn crash halts as a refusal (PRDR-072)", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });

    /**
     * Crash result: zeroed but PARSED telemetry plus the crash flag; the
     * session process died but the backend still emitted a final result.
     */
    const backend = new MockBackend({
      implement: () =>
        okResult({ ok: false, crashed: true, costEstimateUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0 }),
    });
    /** PRDR-112: a refusal is backed off and retried before the run gives up; the wait is injected here. */
    const sleeps: number[] = [];
    const outcome = await run({
      root,
      backend,
      prompts: PROMPTS,
      runId: "crash",
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    /**
     * The LEDGER ROW comes first and survives the halt: a flagged $0 lower
     * bound, never free work and never the S-4 telemetry breaker. Zero turns
     * means the session never started, so the run then stops as a
     * SessionRefusal (PRDR-072) — the reason names the refusal, not S-4 —
     * after PRDR-112's backoff ladder has been walked in full.
     */
    const crashRow = rows(root).find((r) => r.partial === "crash");
    expect(crashRow).toBeDefined();
    expect(crashRow!.cost_estimate_usd).toBe(0);
    expect(sleeps).toHaveLength(3);
    expect((outcome.summary as { reason?: string }).reason).toMatch(/refused implement session for t1/);
  });

  it("every row validates against the ledger schema — malformed money cannot land", async () => {
    const root = await fixture();
    const journal = RunJournal.open(root);
    try {
      const ledger = new SpendLedger(root, journal, 999);
      expect(() =>
        ledger.record("t1", 0, "implement", okResult({ costEstimateUsd: -1 }), "2026-08-18T10:00:00.000Z"),
      ).toThrow();
    } finally {
      journal.close();
    }
  });
});

/**
 * X-1‴ (PRDR-136) — the READ path is as strict as the write.
 *
 * `readRecordedSpend` was `JSON.parse(line) as { cost_estimate_usd?: number }`
 * followed by `?? 0`, and it is the cross-generation financial backstop the
 * D-25 launch gate compares against. The existing test above covers `record`,
 * the write side, on files the code itself wrote.
 */
describe("X-1‴ a spend total is only as trustworthy as the rows it sums", () => {
  const row = (over: Record<string, unknown>): string =>
    JSON.stringify({
      at: "2026-09-01T00:00:00.000Z",
      ticket: "t-1",
      generation: 0,
      role: "implement",
      cost_estimate_usd: 1,
      input_tokens: 1,
      output_tokens: 1,
      turns: 1,
      ...over,
    });

  function rootWith(lines: string[]): string {
    const root = tmpTree({});
    roots.push(root);
    mkdirSync(path.join(root, ".detent"), { recursive: true });
    writeFileSync(path.join(root, ".detent", "ledger.jsonl"), `${lines.join("\n")}\n`);
    return root;
  }

  it("sums valid rows", () => {
    expect(readRecordedSpend(rootWith([row({ cost_estimate_usd: 5 }), row({ cost_estimate_usd: 3 })]))).toBe(8);
  });

  it("refuses a string cost rather than concatenating it", () => {
    /* `5 + "5" + 3` produced the string "553", which then compared against the ceiling. */
    expect(() => readRecordedSpend(rootWith([row({ cost_estimate_usd: 5 }), row({ cost_estimate_usd: "5" })]))).toThrow(/not a ledger row/);
  });

  it("refuses a negative cost rather than subtracting it", () => {
    expect(() => readRecordedSpend(rootWith([row({ cost_estimate_usd: -1000 })]))).toThrow(/not a ledger row/);
  });

  it("still tolerates a torn LAST line — the one shape a crash produces", () => {
    const root = rootWith([row({ cost_estimate_usd: 4 })]);
    appendFileSync(path.join(root, ".detent", "ledger.jsonl"), '{"at":"2026-09-01T00:00:0');
    expect(readRecordedSpend(root)).toBe(4);
  });

  /**
   * PRDR-151: this used to assert that a torn line anywhere but the end was
   * FATAL, which sounds right and bricked a root. `appendLedger` writes
   * `JSON.stringify(row) + "\n"`, so a line torn mid-append has no trailing
   * newline and the NEXT append concatenates onto it — one `kill -9` then made
   * every later run refuse at startup, forever, with no repair instruction.
   *
   * Unparseable TEXT is a crash artifact at any position and is skipped. The
   * cost is an under-count of the row glued to the torn one: a lower bound,
   * the safe direction, and the same shape S-4 already takes for a crashed
   * session's telemetry.
   */
  it("survives a torn line that a later append glued a real row onto", () => {
    const root = tmpTree({});
    roots.push(root);
    mkdirSync(path.join(root, ".detent"), { recursive: true });
    const f = path.join(root, ".detent", "ledger.jsonl");
    /* The crash shape: a torn last line with no newline. */
    writeFileSync(f, `${row({ cost_estimate_usd: 10 })}\n{"at":"2026`);
    appendFileSync(f, `${row({ cost_estimate_usd: 7 })}\n`);
    appendFileSync(f, `${row({ cost_estimate_usd: 3 })}\n`);
    /* 10 + 3; the 7 was swallowed by the torn line — a lower bound, not a halt. */
    expect(readRecordedSpend(root)).toBe(13);
  });
});
