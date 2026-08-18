import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunJournal } from "../../src/kernel/journal.js";
import { SpendExhaustedError, SpendLedger, readRecordedSpend } from "../../src/kernel/ledger.js";
import { EXIT_HUMAN_GATED, run } from "../../src/kernel/run.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { ledgerRowSchema } from "../../src/schemas/records.js";
import { MockBackend, okResult } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree, writeTree } from "../helpers.js";
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
  it("overshoot is bounded by ONE in-flight session; the next launch is refused → NEEDS_HUMAN, exit 10", async () => {
    // Ceiling below one session's cost: the first launch is allowed (spend 0),
    // its 0.001 crosses the ceiling, and the second launch is refused.
    const root = await fixture(0.0005);
    addTicket(root, { id: "t1" });

    const backend = new MockBackend({ implement: implementRed });
    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "spend" });

    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    // exactly one launch
    expect(backend.calls.map((c) => c.role)).toEqual(["implement"]);
    const t1 = readTicket(root, "t1");
    expect(t1.state).toBe("NEEDS_HUMAN");
    expect(t1.notes.map((n) => n.text).join(" ")).toContain("run-spend exhaustion");
    // The overshoot is recorded honestly: ledger total exceeds the ceiling by
    // at most the one session that was in flight.
    expect(rows(root)).toHaveLength(1);
    expect(readRecordedSpend(root)).toBeCloseTo(0.001, 6);
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
    // A second run (fresh ledger) starts from the file's cumulative total.
    const journal2 = RunJournal.open(root);
    try {
      const ledger2 = new SpendLedger(root, journal2, 0.2);
      expect(ledger2.spent()).toBeCloseTo(0.25, 6);
      expect(() => ledger2.assertLaunchAllowed()).toThrow(SpendExhaustedError);
    } finally {
      journal2.close();
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
          // Cumulative fields deliberately disagree with the breakdown.
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

  it("a crashed session's zeroed telemetry is a flagged lower bound — partial: crash, never free and never the breaker", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });

    // Crash result: zeroed but PARSED telemetry plus the crash flag; the
    // session process died but the backend still emitted a final result.
    const backend = new MockBackend({
      implement: () =>
        okResult({ ok: false, crashed: true, costEstimateUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0 }),
    });
    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "crash" });

    // Not the S-4 breaker: the run continues (gate judges the tree, red, ladder…)
    // — what matters here is the LEDGER ROW.
    const crashRow = rows(root).find((r) => r.partial === "crash");
    expect(crashRow).toBeDefined();
    expect(crashRow!.cost_estimate_usd).toBe(0);
    expect(outcome.exitCode).not.toBe(1);
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
