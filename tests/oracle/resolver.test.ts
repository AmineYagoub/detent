import { describe, expect, it } from "vitest";
import { resolveRed } from "../../src/kernel/resolver.js";
import { apply } from "../../src/kernel/machine.js";
import { ZERO_COUNTERS } from "../../src/kernel/generations.js";
import type { Counters } from "../../src/schemas/ticket.js";
import { ctx } from "../helpers.js";

const LADDER = ["BLIND_FIX", "RESEARCH", "INFORMED_FIX", "NEEDS_HUMAN"] as const;

describe("T-013 ladder resolver (X-2, D-13)", () => {
  it("walks blind -> research -> informed -> human, consuming one slot each", () => {
    let c: Counters = ZERO_COUNTERS;
    const seen: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const r = resolveRed(c);
      seen.push(r.next);
      c = r.counters;
    }
    expect(seen).toEqual([...LADDER]);
    expect(c).toMatchObject({ blind_fix_attempts: 1, research_sessions: 1, informed_fix_attempts: 1 });
  });

  it("no second blind fix: once consumed, the resolver never returns BLIND_FIX again", () => {
    let c: Counters = { ...ZERO_COUNTERS };
    let blindCount = 0;
    for (let i = 0; i < 12; i += 1) {
      const r = resolveRed(c);
      if (r.next === "BLIND_FIX") blindCount += 1;
      c = r.counters;
    }
    expect(blindCount).toBe(1);
  });

  it("property: over every reachable counter state, output is in the ladder set and slots are monotone", () => {
    for (const blind of [0, 1]) {
      for (const research of [0, 1]) {
        for (const informed of [0, 1]) {
          const before: Counters = {
            ...ZERO_COUNTERS,
            blind_fix_attempts: blind,
            research_sessions: research,
            informed_fix_attempts: informed,
          };
          const r = resolveRed(before);
          expect(LADDER).toContain(r.next);
          // Monotone: a slot never decreases, and at most one is consumed.
          const deltas =
            r.counters.blind_fix_attempts - before.blind_fix_attempts +
            (r.counters.research_sessions - before.research_sessions) +
            (r.counters.informed_fix_attempts - before.informed_fix_attempts);
          expect(deltas === 0 || deltas === 1).toBe(true);
          expect(r.counters.blind_fix_attempts).toBeGreaterThanOrEqual(before.blind_fix_attempts);
          expect(r.counters.research_sessions).toBeGreaterThanOrEqual(before.research_sessions);
          expect(r.counters.informed_fix_attempts).toBeGreaterThanOrEqual(before.informed_fix_attempts);
          // All three consumed -> the ladder is closed.
          if (blind === 1 && research === 1 && informed === 1) expect(r.next).toBe("NEEDS_HUMAN");
        }
      }
    }
  });

  it("no ladder after the informed fix: INFORMED_FIX red is a table edge, not a resolver call", () => {
    const exhausted: Counters = {
      ...ZERO_COUNTERS,
      blind_fix_attempts: 1,
      research_sessions: 1,
      informed_fix_attempts: 1,
    };
    expect(apply("INFORMED_FIX", "GATE_RED", exhausted, ctx()).to).toBe("NEEDS_HUMAN");
    // ...and it holds even with every slot free, which a resolver call would not.
    expect(apply("INFORMED_FIX", "GATE_RED", ZERO_COUNTERS, ctx()).to).toBe("NEEDS_HUMAN");
  });

  it("crash-resume property: exactly one blind fix across a full ladder traversal", () => {
    // Oracle crash-resume class: kill mid-FIX, resume enters RESEARCH.
    const afterBlind = apply("IN_PROGRESS", "GATE_RED", ZERO_COUNTERS, ctx());
    expect(afterBlind.to).toBe("BLIND_FIX");
    const resumed = apply("BLIND_FIX", "GATE_RED", afterBlind.counters, ctx());
    expect(resumed.to).toBe("RESEARCH");
    expect(resumed.counters.blind_fix_attempts).toBe(1);
  });
});
