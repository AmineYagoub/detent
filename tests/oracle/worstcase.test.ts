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
  it("computes the worst path from the table rather than quoting it", () => {
    // Regression pin, not a spec constant: X-1 states the figure is computed and
    // never quoted. If a table edit moves this, that is the signal, not a bug.
    expect(maxPossibleSessions(DEFAULT_BUDGETS)).toBe(14);
  });

  it("DEFECT PIN — the X-1 default net (14) does not exceed the computed worst case (14)", () => {
    // X-1 asserts `sessions_net > computed` and its informative note quotes 12.
    // The graph walk finds 14 via the APPROVED close-check re-entering the
    // ladder, which X-2 explicitly permits. The shipped default is therefore
    // unloadable. Pinned here so the fix is deliberate rather than incidental.
    const computed = maxPossibleSessions(DEFAULT_BUDGETS);
    expect(computed).toBe(14);
    expect(DEFAULT_BUDGETS.sessions).toBe(14);
    expect(DEFAULT_BUDGETS.sessions > computed).toBe(false);
    expect(() => loadConfig(validConfig({ budgets: { run_spend_usd: 25 } }))).toThrow(ConfigRejectedError);
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
