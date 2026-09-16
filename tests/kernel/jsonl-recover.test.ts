import { describe, expect, it } from "vitest";
import { recoverObjects } from "../../src/kernel/jsonl-recover.js";

/** X-1 (PRDR-249) — the complete objects a crash glued onto a torn line. */

const A = JSON.stringify({ at: "2026-09-01T00:00:00.000Z", cost_estimate_usd: 10 });
const B = JSON.stringify({ at: "2026-09-01T00:01:00.000Z", cost_estimate_usd: 7 });

/**
 * X-1 (PRDR-249) — the two glue shapes a torn append leaves behind.
 *
 * `appendLedger` writes `JSON.stringify(row) + "\n"`, so a line torn mid-append
 * carries no newline and the next append concatenates onto it. Which shape you
 * get depends on where the tear landed, and they need different recoveries:
 * two complete rows are balanced and can be scanned apart, while a fragment
 * ending inside a string leaves the brace depth unusable and needs a parse
 * attempt from the right.
 */
describe("X-1 recovering the complete objects on a glued line", () => {
  it("splits two complete objects glued at the record separator", () => {
    expect(recoverObjects(A + B)).toEqual([JSON.parse(A), JSON.parse(B)]);
  });

  it("recovers the complete object after a fragment that died inside a string", () => {
    expect(recoverObjects(`{"at":"2026${B}`)).toEqual([JSON.parse(B)]);
  });

  it("recovers the complete object after a fragment that died between keys", () => {
    expect(recoverObjects(`{"at":"2026-09-01T00:00:00.000Z",${B}`)).toEqual([JSON.parse(B)]);
  });

  it("recovers nothing from a torn fragment with nothing glued to it", () => {
    expect(recoverObjects('{"at":"2026-09-01T00:00:0')).toEqual([]);
  });

  it("recovers nothing from text that was never JSON", () => {
    expect(recoverObjects("Killed: 9")).toEqual([]);
  });

  it("does not mistake a brace inside a string for structure", () => {
    const withBrace = JSON.stringify({ at: "2026-09-01T00:00:00.000Z", note: "a } and a { inside", cost_estimate_usd: 2 });
    expect(recoverObjects(withBrace + B)).toEqual([JSON.parse(withBrace), JSON.parse(B)]);
  });

  it("does not mistake an escaped quote for the end of a string", () => {
    const withQuote = JSON.stringify({ at: "2026-09-01T00:00:00.000Z", note: 'she said "}" once', cost_estimate_usd: 3 });
    expect(recoverObjects(withQuote + B)).toEqual([JSON.parse(withQuote), JSON.parse(B)]);
  });

  it("returns an intact single object unchanged", () => {
    expect(recoverObjects(A)).toEqual([JSON.parse(A)]);
  });
});
