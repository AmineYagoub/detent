import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gapTable, lifetimeFor, parseTranscript, reportKinds, type TranscriptSession } from "../../scripts/cache-gaps.js";
import { FIVE_MINUTE_KINDS, FIVE_MINUTE_P99_CEILING_S } from "../../src/schemas/cache-lifetime.js";
import { removeTree, tmpTree } from "../helpers.js";

/**
 * S-6″ (PRDR-320) — the measurement behind the per-kind cache lifetimes is
 * kept, and its rule holds: a kind whose 99th-percentile gap between requests
 * reaches four minutes is not given five, however cheap five measured.
 */

const T0 = Date.parse("2026-09-30T08:00:00.000Z");
const at = (s: number): string => new Date(T0 + s * 1000).toISOString();

type Usage = { input?: number; output?: number; read?: number; write?: number; w5m?: number; w1h?: number };
const user = (s: number, content: unknown): string => JSON.stringify({ type: "user", timestamp: at(s), message: { role: "user", content } });
const assistant = (s: number, id: string, u: Usage, model = "claude-opus-5-5"): string =>
  JSON.stringify({
    type: "assistant",
    timestamp: at(s),
    message: {
      id,
      model,
      usage: {
        input_tokens: u.input ?? 0,
        output_tokens: u.output ?? 0,
        cache_read_input_tokens: u.read ?? 0,
        cache_creation_input_tokens: u.write ?? 0,
        cache_creation: { ephemeral_5m_input_tokens: u.w5m ?? 0, ephemeral_1h_input_tokens: u.w1h ?? u.write ?? 0 },
      },
    },
  });
const prompt = (inputs: Record<string, unknown>): string => `Your inputs:\n${JSON.stringify(inputs, null, 2)}`;

/** A session whose requests start at `starts` (seconds), each after a user entry at that time. */
function session(inputs: Record<string, unknown>, starts: readonly number[], u: Usage = { write: 100 }): string {
  return starts.flatMap((s, i) => [user(s, i === 0 ? prompt(inputs) : [{ type: "tool_result", content: "ok" }]), assistant(s + 3, `msg_${String(i)}`, u)]).join("\n");
}

let dir: string | null = null;
afterEach(() => {
  if (dir !== null) removeTree(dir);
  dir = null;
});

describe("S-6″ the gap measurement reads a session's transcript", () => {
  it("names the kind from the task or stage the first message names, and the role that runs it", () => {
    expect(parseTranscript(session({ task: "verify_claims" }, [0]))?.kind).toBe("audit/verify_claims");
    expect(parseTranscript(session({ task: "verify_claim" }, [0]))?.kind, "an older build's name for a claim check").toBe("audit/verify_claim");
    expect(parseTranscript(session({ stage: "REVIEW_PLAN" }, [0]))?.kind).toBe("plan_review/REVIEW_PLAN");
    const blocks = [user(0, [{ type: "text", text: prompt({ task: "review" }) }]), assistant(4, "m", { write: 1 })].join("\n");
    expect(parseTranscript(blocks)?.kind, "a first message given as blocks").toBe("spec_review/review");
    expect(parseTranscript(session({ ticket: "t1" }, [0]))?.kind, "a run role's session names no task").toBe("?/?");
  });

  it("dates a request from the entry before it, and counts a message split over several entries once", () => {
    const text = [user(0, prompt({ task: "write" })), assistant(5, "a", { write: 700, output: 9 }), assistant(9, "a", { write: 700, output: 50 }), user(40, "r"), assistant(61, "b", { read: 700, write: 20 })].join("\n");
    const parsed = parseTranscript(text);
    expect(parsed?.requests.map((r) => [(r.start - T0) / 1000, r.cacheWrite, r.output])).toEqual([
      [0, 700, 9],
      [40, 20, 0],
    ]);
  });

  it("skips Claude Code's own synthetic notes, reads the write split, and survives a torn last line", () => {
    const text = [
      user(0, prompt({ task: "fix" })),
      assistant(3, "a", { write: 300, w5m: 300, w1h: 0 }),
      user(10, "r"),
      assistant(11, "note", {}, "<synthetic>"),
      '{"type":"assistant","timestamp":"2026-09-30T08:0',
    ].join("\n");
    const parsed = parseTranscript(text);
    expect(parsed?.requests).toHaveLength(1);
    expect(parsed?.requests[0]?.written).toEqual({ "5m": 300, "1h": 0 });
    expect(parseTranscript(user(0, "hello")), "a transcript with no request").toBeNull();
  });
});

describe("S-6″ each kind's gaps and costs, and the lifetime its rule gives", () => {
  it("prices the recorded tokens at one hour, and at five minutes prices a request after a gap past five minutes as a rewrite", () => {
    const s = parseTranscript(
      [
        user(0, prompt({ task: "write" })),
        assistant(2, "a", { input: 10, output: 100, write: 1000 }),
        user(60, "r"),
        assistant(61, "b", { output: 50, read: 1000, write: 200 }),
        user(460, "r"),
        assistant(462, "c", { read: 1200, write: 10 }),
      ].join("\n"),
    ) as TranscriptSession;
    const [k] = reportKinds([s]);
    const hour = (10 * 4 + 100 * 20 + 1000 * 8 + (50 * 20 + 1000 * 0.2 + 200 * 8) + (1200 * 0.2 + 10 * 8)) / 1e6;
    const five = (10 * 4 + 100 * 20 + 1000 * 5 + (50 * 20 + 1000 * 0.2 + 200 * 5) + (1200 + 10) * 5) / 1e6;
    expect(k?.cost["1h"]).toBeCloseTo(hour, 12);
    expect(k?.cost["5m"]).toBeCloseTo(five, 12);
    expect(k?.gaps.max).toBe(400);
    expect([k?.over5m, k?.gapCount]).toEqual([1, 2]);
  });

  it("gives five minutes only under the four-minute ceiling at the 99th percentile, and only where five is cheaper", () => {
    expect(FIVE_MINUTE_P99_CEILING_S).toBe(240);
    expect(lifetimeFor(239, { "5m": 1, "1h": 2 })).toBe("5m");
    expect(lifetimeFor(240, { "5m": 1, "1h": 2 }), "at the ceiling").toBe("1h");
    expect(lifetimeFor(30, { "5m": 2, "1h": 1 }), "five dearer").toBe("1h");
    expect(lifetimeFor(30, { "5m": 1, "1h": 1 }), "no cheaper").toBe("1h");
  });

  it("keeps an hour for a kind like the triage: cheaper at five, but one of fifteen gaps passed four minutes", () => {
    const starts = [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 906, 910];
    const [k] = reportKinds([parseTranscript(session({ task: "triage" }, starts, { read: 500, write: 2000 })) as TranscriptSession]);
    expect(k?.gaps.p99).toBe(854);
    expect(k?.cost["5m"], "five minutes is cheaper on it").toBeLessThan(k?.cost["1h"] ?? 0);
    expect(k?.lifetime).toBe("1h");
  });

  it("gives five minutes to a kind like the claim checks, whose gaps stay short", () => {
    const sessions = [0, 1, 2].map((n) => parseTranscript(session({ task: "verify_claims" }, [0, 12, 30, 45, 80, 137].map((s) => s + n), { read: 20000, write: 800 })) as TranscriptSession);
    const [k] = reportKinds(sessions);
    expect([k?.sessions, k?.requests, k?.gaps.p99]).toEqual([3, 18, 57]);
    expect(k?.lifetime).toBe("5m");
  });

  it("reads the 99th percentile, not the worst gap: the claim checks kept five minutes past one 5,746-second gap", () => {
    const starts = Array.from({ length: 150 }, (_, i) => i * 12);
    const withLongGap = starts.map((s, i) => (i >= 75 ? s + 5746 : s));
    const [k] = reportKinds([parseTranscript(session({ task: "verify_claims" }, withLongGap, { read: 20000, write: 800 })) as TranscriptSession]);
    expect([k?.gaps.max, k?.gaps.p99]).toEqual([5758, 12]);
    expect(k?.lifetime).toBe("5m");
  });

  it("reads a project's transcripts into the table the table in cache-lifetime.ts was measured with", () => {
    dir = tmpTree();
    writeFileSync(path.join(dir, "a.jsonl"), session({ task: "verify_claims" }, [0, 10, 20], { read: 9000, write: 400, w1h: 0, w5m: 400 }));
    writeFileSync(path.join(dir, "b.jsonl"), session({ task: "review" }, [0, 10, 900], { read: 9000, write: 400 }));
    writeFileSync(path.join(dir, "notes.txt"), "not a transcript");
    const table = gapTable(dir).split("\n");
    expect(table[0]).toContain("| Kind | Sessions |");
    expect(table.find((l) => l.startsWith("| audit/verify_claims |"))).toMatch(/\| 1200, 0 \|.*\| 5m \|$/u);
    expect(table.find((l) => l.startsWith("| spec_review/review |"))).toMatch(/\| 0, 1200 \|.*\| 1h \|$/u);
  });

  it("the five-minute kinds are ones init's sessions send", () => {
    expect(FIVE_MINUTE_KINDS).toEqual({ audit: ["verify_claims"], spec_write: ["write", "fix"] });
  });
});
