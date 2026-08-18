import { describe, expect, it } from "vitest";
import {
  ConfigRejectedError,
  UnboundedWorstCaseError,
  loadConfig,
  maxPossibleSessions,
} from "../../src/kernel/worstcase.js";
import { tableWith } from "../../src/kernel/machine.js";
import { DEFAULT_BUDGETS } from "../helpers.js";

const validConfig = (overrides: Record<string, unknown> = {}) => ({
  schema_version: 1,
  budgets: { run_spend_usd: 25, sessions: 20, ...((overrides.budgets as object) ?? {}) },
  pinned: { agent_sdk: "0.3.191", claude_code: "2.1.191" },
  ...overrides,
});

describe("T-014 maxPossibleSessions (X-1)", () => {
  it("regression pin (X-1 AC, PRDR-057): the computed worst case is exactly 14", () => {
    // X-1's AC requires this pin so a table or budget edit that moves the
    // figure fails CI rather than silently invalidating the shipped defaults.
    // If this moves, the PRD's informative note and the default net move with
    // it — deliberately, not incidentally.
    expect(maxPossibleSessions(DEFAULT_BUDGETS)).toBe(14);
  });

  it("PRDR-057 resolved: the default config loads — net 18 strictly exceeds the computed 14", () => {
    // Draft.6 shipped sessions=14 against a computed worst case of 14, so no
    // default config could load (the defect this suite pinned until draft.7).
    const { config, computedWorstCase } = loadConfig(validConfig({ budgets: { run_spend_usd: 25 } }));
    expect(computedWorstCase).toBe(14);
    expect(config.budgets.sessions).toBe(18);
    expect(DEFAULT_BUDGETS.sessions).toBe(18);
  });

  it("D-24: a ladder ceiling set to any value but 1 is rejected at load, naming the key", () => {
    for (const key of ["blind_fix_attempts", "informed_fix_attempts", "research_sessions"]) {
      for (const value of [0, 2]) {
        try {
          loadConfig(validConfig({ budgets: { run_spend_usd: 25, [key]: value } }));
          expect.unreachable(`${key}=${value} must be refused`);
        } catch (err) {
          expect(String(err), `${key}=${value}`).toContain(key);
        }
      }
    }
    // review_fix_attempts is deliberately not structural (PRDR-058 non-goal).
    expect(() => loadConfig(validConfig({ budgets: { run_spend_usd: 25, review_fix_attempts: 2 } }))).not.toThrow();
  });

  it("the walk never traverses GATE_DRIFT — a halt is not the worst path (D-23)", () => {
    // If the walk took drift edges, BLOCKED would join every path at zero cost;
    // the figure must be identical to a table with no drift rows at all.
    expect(maxPossibleSessions(DEFAULT_BUDGETS)).toBe(14);
  });

  it("is sensitive to the TABLE: a synthetic recovery edge raises the figure", () => {
    const base = maxPossibleSessions(DEFAULT_BUDGETS);
    // T-014's AC as written: add a recovery edge to a *test copy* of the table.
    // NEEDS_HUMAN is otherwise a sink; letting it fall back to IN_PROGRESS adds
    // reachable launches, so the computed worst case must rise.
    // BLOCKED is otherwise a sink for the per-generation walk. Letting it
    // recover to DIAGNOSED adds reachable launches without forming a cycle
    // (RESEARCH, the only route to BLOCKED, is consumable once).
    const withRecovery = tableWith([["BLOCKED", "REPRO_AS_PREDICTED", { to: "DIAGNOSED" }]]);
    expect(maxPossibleSessions(DEFAULT_BUDGETS, { table: withRecovery })).toBeGreaterThan(base);
  });

  it("reports an unbounded table rather than hanging or silently truncating", () => {
    // A recovery edge out of NEEDS_HUMAN re-enters the launching states with no
    // budget consumed, so no finite worst case exists. X-1 must surface that.
    const looping = tableWith([["NEEDS_HUMAN", "REPRO_AS_PREDICTED", { to: "IN_PROGRESS" }]]);
    expect(() => maxPossibleSessions(DEFAULT_BUDGETS, { table: looping })).toThrow(UnboundedWorstCaseError);
  });

  it("is sensitive to the budgets as well as the table", () => {
    const base = maxPossibleSessions(DEFAULT_BUDGETS);
    expect(
      maxPossibleSessions({ ...DEFAULT_BUDGETS, hypotheses: DEFAULT_BUDGETS.hypotheses + 3 }),
    ).toBeGreaterThan(base);
  });

  it("accepts a config whose net sessions exceed the computed worst case", () => {
    const { computedWorstCase, config } = loadConfig(validConfig());
    expect(config.budgets.sessions).toBeGreaterThan(computedWorstCase);
  });

  it("rejects at load a config whose net is at or below the computed worst case, naming both numbers", () => {
    const computed = maxPossibleSessions(DEFAULT_BUDGETS);
    expect(() => loadConfig(validConfig({ budgets: { run_spend_usd: 25, sessions: computed } }))).toThrow(
      ConfigRejectedError,
    );
    try {
      loadConfig(validConfig({ budgets: { run_spend_usd: 25, sessions: computed } }));
    } catch (err) {
      expect(String(err)).toContain(String(computed));
      expect(String(err)).toContain("worst path");
    }
  });

  it("refuses a budgets object omitting run_spend_usd — X-1 gives it no default", () => {
    expect(() => loadConfig({ ...validConfig(), budgets: {} })).toThrow();
  });

  it("refuses unknown config keys", () => {
    expect(() => loadConfig({ ...validConfig(), nope: 1 })).toThrow();
  });

  it("defaults setting_sources to empty — repo policy never loads (PRDR-051)", () => {
    expect(loadConfig(validConfig()).config.setting_sources).toEqual([]);
  });
});
