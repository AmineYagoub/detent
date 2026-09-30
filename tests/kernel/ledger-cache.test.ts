import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunJournal } from "../../src/kernel/journal.js";
import { SpendLedger, recordOutOfBandSpend } from "../../src/kernel/ledger.js";
import { ledgerRowSchema } from "../../src/schemas/records.js";
import { okResult } from "../../src/sessions/mock.js";
import { gitInit, removeTree, tmpTree } from "../helpers.js";

/**
 * S-6″ (PRDR-320) — a ledger row says at which lifetime its session wrote the
 * cache, and how much at each, so the effect of the per-kind table is read
 * from the ledger rather than assumed. Tabachir's rows could not say it: the
 * split was found only in the session transcripts.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

function root(): string {
  const r = tmpTree({});
  roots.push(r);
  gitInit(r);
  mkdirSync(path.join(r, ".detent"), { recursive: true });
  return r;
}

const written = okResult({ costEstimateUsd: 0.5, cacheCreationInputTokens: 1540, cacheTtl: "5m", cacheWrites: { "5m": 1500, "1h": 40 } });

describe("S-6″ a ledger row records its cache lifetime and its writes at each", () => {
  it("a run's row", () => {
    const r = root();
    const journal = RunJournal.open(r);
    try {
      const row = new SpendLedger(r, journal, 999).record("t1", 0, "audit", written, "2026-09-30T10:00:00.000Z", "AUDIT");
      expect(row.cache_ttl).toBe("5m");
      expect(row.cache_creation_5m_input_tokens).toBe(1500);
      expect(row.cache_creation_1h_input_tokens).toBe(40);
    } finally {
      journal.close();
    }
  });

  it("an out-of-band row", () => {
    const r = root();
    const row = recordOutOfBandSpend(r, "doctor-smoke", written, "2026-09-30T10:00:00.000Z");
    expect([row.cache_ttl, row.cache_creation_5m_input_tokens, row.cache_creation_1h_input_tokens]).toEqual(["5m", 1500, 40]);
    const back = ledgerRowSchema.parse(JSON.parse(readFileSync(path.join(r, ".detent", "ledger.jsonl"), "utf8").trim()));
    expect(back.cache_ttl).toBe("5m");
  });

  it("a row written before the fields reads back without them, and a result that carries none writes none", () => {
    const old = ledgerRowSchema.parse({ at: "2026-09-28T10:00:00.000Z", ticket: "init", generation: 0, role: "audit", cost_estimate_usd: 3.1, input_tokens: 1, output_tokens: 1, turns: 27 });
    expect(old.cache_ttl).toBeUndefined();
    expect(old.cache_creation_5m_input_tokens).toBeUndefined();
    const r = root();
    const row = recordOutOfBandSpend(r, "doctor-smoke", okResult({ costEstimateUsd: 0.1 }), "2026-09-30T10:00:00.000Z");
    expect("cache_ttl" in row).toBe(false);
  });

  it("refuses a lifetime the table does not have", () => {
    expect(() =>
      ledgerRowSchema.parse({ at: "2026-09-30T10:00:00.000Z", ticket: "init", generation: 0, role: "audit", cost_estimate_usd: 1, input_tokens: 1, output_tokens: 1, turns: 1, cache_ttl: "10m" }),
    ).toThrow();
  });
});
