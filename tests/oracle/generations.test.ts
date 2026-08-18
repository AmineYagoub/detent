import { describe, expect, it } from "vitest";
import {
  FrozenGenerationError,
  ZERO_COUNTERS,
  cumulativeCounters,
  currentCounters,
  openGeneration,
  withCurrentCounters,
} from "../../src/kernel/generations.js";
import type { Generation } from "../../src/schemas/ticket.js";

const AT = "2026-08-17T12:00:00.000Z";
const gen = (index: number, counters = ZERO_COUNTERS, outcome: Generation["outcome"] = "in_flight"): Generation => ({
  index,
  counters: { ...counters },
  outcome,
  started_at: AT,
});

describe("T-015 attempt generations (X-8, D-17)", () => {
  it("HUMAN_REQUEUE opens generation N+1 with zeroed counters", () => {
    const spent = { ...ZERO_COUNTERS, blind_fix_attempts: 1, research_sessions: 1, sessions: 5 };
    const gens = openGeneration({ generations: [gen(0, spent)] }, { at: AT, reason: "try the other approach" });
    expect(gens).toHaveLength(2);
    expect(gens[1]!.index).toBe(1);
    expect(gens[1]!.counters).toEqual(ZERO_COUNTERS);
    expect(gens[1]!.reason).toBe("try the other approach");
  });

  it("the prior generation is preserved, closed, and stamped — not erased", () => {
    /** The oracle reset `attempts` in place; X-8 supersedes that (PRD §13). */
    const spent = { ...ZERO_COUNTERS, blind_fix_attempts: 1, sessions: 5 };
    const gens = openGeneration({ generations: [gen(0, spent)] }, { at: AT });
    expect(gens[0]!.counters).toEqual(spent);
    expect(gens[0]!.outcome).toBe("requeued");
    expect(gens[0]!.ended_at).toBe(AT);
  });

  it("a frozen generation cannot be mutated", () => {
    const gens = [gen(0), gen(1)];
    expect(() => withCurrentCounters(gens, 0, ZERO_COUNTERS)).toThrow(FrozenGenerationError);
    expect(() => withCurrentCounters(gens, 1, ZERO_COUNTERS)).not.toThrow();
  });

  it("current counters are the last generation's", () => {
    const spent = { ...ZERO_COUNTERS, sessions: 3 };
    expect(currentCounters({ generations: [gen(0, { ...ZERO_COUNTERS, sessions: 9 }), gen(1, spent)] })).toEqual(spent);
  });

  it("cumulative totals span generations — what dossiers and status display", () => {
    const g0 = gen(0, { ...ZERO_COUNTERS, blind_fix_attempts: 1, sessions: 6 }, "requeued");
    const g1 = gen(1, { ...ZERO_COUNTERS, blind_fix_attempts: 1, sessions: 4 });
    const total = cumulativeCounters({ generations: [g0, g1] });
    expect(total.sessions).toBe(10);
    /** Per-generation the slot was consumed at most once; cumulatively it is 2. */
    expect(total.blind_fix_attempts).toBe(2);
  });

  it("openGeneration does not mutate the input generations", () => {
    const original = gen(0, { ...ZERO_COUNTERS, sessions: 2 });
    const before = JSON.stringify(original);
    openGeneration({ generations: [original] }, { at: AT });
    expect(JSON.stringify(original)).toBe(before);
  });
});
