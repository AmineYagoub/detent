import { describe, expect, it } from "vitest";
import { apply, isLegal, legalEvents, TABLE, TransitionError } from "../../src/kernel/machine.js";
import { EVENTS, STATES, TERMINAL_STATES, type Event, type State } from "../../src/schemas/states.js";
import { ZERO_COUNTERS } from "../../src/kernel/generations.js";
import { DEFAULT_BUDGETS, ctx } from "../helpers.js";

describe("T-011 transition table (X-3)", () => {
  it("every (state,event) pair outside the table raises", () => {
    let illegal = 0;
    for (const s of STATES) {
      for (const e of EVENTS) {
        if (isLegal(s, e)) continue;
        illegal += 1;
        expect(() => apply(s, e, ZERO_COUNTERS, ctx())).toThrow(TransitionError);
      }
    }
    /** The table is sparse by design; if this ever hits zero the guard is vacuous. */
    expect(illegal).toBeGreaterThan(0);
  });

  it("the table is data: rows are a literal target or a guard reference", () => {
    for (const row of TABLE.values()) {
      const shape = "to" in row ? "literal" : "guard";
      expect(["literal", "guard"]).toContain(shape);
      if ("to" in row) expect(STATES).toContain(row.to);
      else expect(typeof row.guard).toBe("string");
    }
  });

  it("BUDGET_BREACH is legal from every non-DONE state and lands on NEEDS_HUMAN", () => {
    for (const s of STATES) {
      if (TERMINAL_STATES.has(s)) {
        expect(isLegal(s, "BUDGET_BREACH")).toBe(false);
        continue;
      }
      expect(apply(s, "BUDGET_BREACH", ZERO_COUNTERS, ctx()).to).toBe("NEEDS_HUMAN");
    }
  });

  it("GATE_DRIFT is legal from every non-DONE state and lands on BLOCKED (D-23 — draft.7, not an oracle port)", () => {
    /**
     * V-3's halt is in the machine: a drift-blocked ticket reopens only via the
     * BLOCKED | HUMAN_REQUEUE row, which opens a new generation (X-8).
     */
    for (const s of STATES) {
      if (TERMINAL_STATES.has(s)) {
        expect(isLegal(s, "GATE_DRIFT")).toBe(false);
        continue;
      }
      const result = apply(s, "GATE_DRIFT", ZERO_COUNTERS, ctx());
      expect(result.to).toBe("BLOCKED");
      expect(result.counters).toEqual(ZERO_COUNTERS);
    }
    expect(apply("BLOCKED", "HUMAN_REQUEUE", ZERO_COUNTERS, ctx()).to).toBe("READY");
  });

  it("DONE is terminal: no event is legal from it", () => {
    expect(legalEvents("DONE")).toEqual([]);
  });

  it("CLAIMED routes by ticket type", () => {
    expect(apply("READY", "CLAIMED", ZERO_COUNTERS, ctx("bug")).to).toBe("DIAGNOSED");
    expect(apply("READY", "CLAIMED", ZERO_COUNTERS, ctx("feature")).to).toBe("IN_PROGRESS");
  });

  it("happy path: claim -> implement -> green -> review -> approve -> done", () => {
    const path: Array<[State, Event, State]> = [
      ["READY", "CLAIMED", "IN_PROGRESS"],
      ["IN_PROGRESS", "GATE_GREEN", "IN_REVIEW"],
      ["IN_REVIEW", "REVIEW_APPROVE", "APPROVED"],
      ["APPROVED", "GATE_GREEN", "DONE"],
    ];
    let counters = ZERO_COUNTERS;
    for (const [from, event, expected] of path) {
      const r = apply(from, event, counters, ctx("feature"));
      expect(r.to).toBe(expected);
      counters = r.counters;
    }
    expect(counters).toEqual(ZERO_COUNTERS);
  });

  it("wrong repro recycles, and the third exceeds the hypothesis budget", () => {
    let counters = ZERO_COUNTERS;
    for (const expected of ["DIAGNOSED", "DIAGNOSED", "NEEDS_HUMAN"]) {
      const r = apply("DIAGNOSED", "REPRO_WRONG", counters, ctx("bug"));
      expect(r.to).toBe(expected);
      counters = r.counters;
    }
    expect(counters.hypotheses).toBe(3);
    expect(counters.hypotheses).toBeGreaterThan(DEFAULT_BUDGETS.hypotheses);
  });

  it("a falsified premise on a feature ticket is a plan-level flaw", () => {
    expect(apply("IN_PROGRESS", "PREMISE_FALSIFIED", ZERO_COUNTERS, ctx("feature")).to).toBe("NEEDS_HUMAN");
    expect(apply("IN_PROGRESS", "PREMISE_FALSIFIED", ZERO_COUNTERS, ctx("bug")).to).toBe("DIAGNOSED");
  });

  it("review changes routes to REVIEW_FIX review_fix_attempts times, then to a human (X-1‴, PRDR-108)", () => {
    let counters = ZERO_COUNTERS;
    const rounds = DEFAULT_BUDGETS.review_fix_attempts;
    expect(rounds).toBeGreaterThan(1);
    for (let i = 1; i <= rounds; i += 1) {
      const step = apply("IN_REVIEW", "REVIEW_CHANGES", counters, ctx());
      expect(step.to).toBe("REVIEW_FIX");
      expect(step.counters.review_fix_attempts).toBe(i);
      counters = step.counters;
    }
    expect(apply("IN_REVIEW", "REVIEW_CHANGES", counters, ctx()).to).toBe("NEEDS_HUMAN");
    /** The ceiling is the config's, not the guard's: one round when the config says one. */
    const one = ctx("feature", { ...DEFAULT_BUDGETS, review_fix_attempts: 1 });
    const first = apply("IN_REVIEW", "REVIEW_CHANGES", ZERO_COUNTERS, one);
    expect(apply("IN_REVIEW", "REVIEW_CHANGES", first.counters, one).to).toBe("NEEDS_HUMAN");
  });

  it("a discovered dependency re-queues the ticket (X-4′, PRDR-111)", () => {
    const step = apply("IN_PROGRESS", "DEPENDENCY_DISCOVERED", ZERO_COUNTERS, ctx());
    expect(step.to).toBe("READY");
    expect(step.counters).toEqual(ZERO_COUNTERS);
  });

  it("dry research enters the informed attempt, not a human (X-2′, PRDR-110)", () => {
    const step = apply("RESEARCH", "RESEARCH_DRY", ZERO_COUNTERS, ctx());
    expect(step.to).toBe("INFORMED_FIX");
    expect(step.counters.informed_fix_attempts).toBe(1);
    /** D-13 holds: the informed attempt's red gate is still a direct edge to a human. */
    expect(apply("INFORMED_FIX", "GATE_RED", step.counters, ctx()).to).toBe("NEEDS_HUMAN");
  });

  it("apply is pure: input counters are never mutated", () => {
    const before = { ...ZERO_COUNTERS };
    apply("IN_PROGRESS", "GATE_RED", before, ctx());
    expect(before).toEqual(ZERO_COUNTERS);
  });
});
