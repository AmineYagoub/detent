import { describe, expect, it } from "vitest";
import {
  ALL_CEILING_KEYS,
  ENFORCEMENT_SITES,
  SlotExhaustedError,
  UNIT_SLOTS,
  breachTargetFor,
  consumeSlot,
  slotAvailable,
} from "../../src/kernel/budgets.js";
import { CEILINGS } from "../../src/schemas/budgets.js";
import { ZERO_COUNTERS } from "../../src/kernel/generations.js";

describe("T-012 unit budgets (X-1, D-12)", () => {
  it("per-slot at-most-once, over every reachable counter state", () => {
    for (const slot of UNIT_SLOTS) {
      expect(slotAvailable(ZERO_COUNTERS, slot)).toBe(true);
      const once = consumeSlot(ZERO_COUNTERS, slot);
      expect(once[slot]).toBe(1);
      expect(slotAvailable(once, slot)).toBe(false);
      expect(() => consumeSlot(once, slot)).toThrow(SlotExhaustedError);
    }
  });

  it("consuming one slot leaves the others untouched — they are independent budgets", () => {
    for (const slot of UNIT_SLOTS) {
      const after = consumeSlot(ZERO_COUNTERS, slot);
      for (const other of UNIT_SLOTS) {
        if (other !== slot) expect(after[other]).toBe(0);
      }
    }
  });

  it("review_fix_attempts is independent of the ladder slots (D-6)", () => {
    const laddered = consumeSlot(
      consumeSlot(consumeSlot(ZERO_COUNTERS, "blind_fix_attempts"), "research_sessions"),
      "informed_fix_attempts",
    );
    expect(slotAvailable(laddered, "review_fix_attempts")).toBe(true);
  });

  it("every X-1 ceiling has a named enforcement site — no ceiling routes nowhere (P6)", () => {
    for (const key of ALL_CEILING_KEYS) {
      expect(ENFORCEMENT_SITES[key], `${key} has no enforcement site`).toBeTruthy();
    }
    expect(Object.keys(ENFORCEMENT_SITES).sort()).toEqual([...ALL_CEILING_KEYS].sort());
  });

  it("each ceiling declares its own breach target — six are not BUDGET_BREACH", () => {
    expect(breachTargetFor("failure_research_tool_calls")).toBe("RESEARCH_DRY");
    expect(breachTargetFor("planning_research_tool_calls")).toBe("AWAIT_INFO_BATCH");
    expect(breachTargetFor("flake_reruns")).toBe("LADDER_ENTRY");
    expect(breachTargetFor("gate_timeout_ms")).toBe("RED_GATE_NO_EXIT");
    expect(breachTargetFor("binding_probe_timeout_ms")).toBe("REJECTED_CANDIDATE");
    /* X-1″ (PRDR-106): the planner's sizing target has nothing to breach. */
    expect(breachTargetFor("turns_per_stage")).toBe("NONE");
    expect(CEILINGS.turns_per_stage.scope).toBe("plan-sizing");
    const nonBreach = ALL_CEILING_KEYS.filter((k) => breachTargetFor(k) !== "BUDGET_BREACH");
    expect(nonBreach).toHaveLength(6);
  });

  it("the X-1 table has exactly fourteen keys, and the adapter timeouts derive from it (PRDR-061)", () => {
    expect(ALL_CEILING_KEYS).toHaveLength(14);
    expect(CEILINGS.gate_timeout_ms.default).toBe(900_000);
    expect(CEILINGS.binding_probe_timeout_ms.default).toBe(120_000);
  });

  it("run_spend_usd is the only run-scoped ceiling, and EVERY ceiling has a default (X-1′)", () => {
    const runScoped = ALL_CEILING_KEYS.filter((k) => CEILINGS[k].scope === "run");
    expect(runScoped).toEqual(["run_spend_usd"]);
    /**
     * PRDR-083: the spend cap was the lone defaultless ceiling, which made the
     * first init of every project a required spend decision. It defaults now;
     * the ceiling still routes to a human (P6), it just is not demanded.
     */
    const noDefault = ALL_CEILING_KEYS.filter((k) => !("default" in CEILINGS[k]));
    expect(noDefault).toEqual([]);
    expect(CEILINGS.run_spend_usd.default).toBe(100);
  });
});
