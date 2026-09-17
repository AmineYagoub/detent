import { describe, expect, it } from "vitest";
import { buildPipeline } from "../../src/init/pipeline.js";
import { runInit } from "../../src/init/machine.js";
import { msUntilReset } from "../../src/init/session.js";
import { MockBackend, outageResult, type StageFn } from "../../src/sessions/mock.js";
import { ANALYSIS, BUDGETS, DRAFT, LONE_CANDIDATE, PROMPTS, planner, repo } from "./plan-fixture.js";

/**
 * D-13 (PRDR-261) — the reset the backend actually states.
 *
 * PRDR-189 taught `init` to wait until the reset a usage limit names, and read
 * one of the two formats the backend emits. `tests/init/stages.test.ts` covers
 * `10:30pm` four times over and `tests/sessions/sdk.test.ts` carries the only
 * other reset literal in the suite, `5:20pm`, without ever calling this
 * function. The whole no-minutes family was untested, so when a live limit said
 * `resets 5pm (Africa/Algiers)` the parse returned null, the 1/5/15 ladder ran
 * against a window four hours out, and twenty-one sessions died against it.
 *
 * Two of the five below PASS on HEAD and are named as regression guards rather
 * than counted as falsification: the `17:00` case pins the new guard as a
 * conjunction, and the not-a-clock case is what keeps an optional colon from
 * reading a duration or a year as an hour.
 */
describe("D-13 a reset that states its hour and no minutes", () => {
  const HOURLY = "Claude Code returned an error result: You've hit your session limit · resets 5pm (Africa/Algiers)";
  /** 13:00 in Algiers, which is UTC+1 all year — four hours before a 17:00 reset there. */
  const at = (iso: string): Date => new Date(iso);

  it("reads the hour when the message carries no minutes", () => {
    const ms = msUntilReset(HOURLY, at("2026-09-08T12:00:00Z"));
    expect(ms, "13:00 Algiers to 17:00 Algiers is a time, not silence").not.toBeNull();
    expect(Number.isNaN(ms), "a number, not the NaN an absent capture group yields").toBe(false);
    expect(Math.round((ms as number) / 60_000), "240 minutes plus the one-minute margin").toBe(241);
  });

  /** Regression guard, not falsification: this passes on HEAD. Without it the new guard can be written with `||`. */
  it("still reads an hour whose minutes ARE stated and whose meridiem is not", () => {
    const ms = msUntilReset("resets 17:00 (Africa/Algiers)", at("2026-09-08T12:00:00Z"));
    expect(ms, "minutes or a meridiem — either is enough, and this one has minutes").not.toBeNull();
    expect(Math.round((ms as number) / 60_000)).toBe(241);
  });

  it("keeps midnight and noon apart with the minutes absent", () => {
    const when = at("2026-09-08T12:00:00Z");
    const midnight = msUntilReset("resets 12am (Africa/Algiers)", when);
    const noon = msUntilReset("resets 12pm (Africa/Algiers)", when);
    expect(midnight, "midnight is stated, so it parses").not.toBeNull();
    expect(noon, "and so is noon").not.toBeNull();
    expect(Math.round((midnight as number) / 60_000), "13:00 to 00:00 tomorrow").toBe(661);
    expect(Math.round((noon as number) / 60_000), "13:00 to 12:00 tomorrow").toBe(1381);
    expect(midnight, "and each matches what the ':00' form returns on HEAD").toBe(msUntilReset("resets 12:00am (Africa/Algiers)", when));
    expect(noon).toBe(msUntilReset("resets 12:00pm (Africa/Algiers)", when));
  });

  /** Regression guard, not falsification: this passes on HEAD. It is what makes the minutes-or-meridiem guard load-bearing. */
  it("says nothing about a number that is not a clock time", () => {
    const when = at("2026-09-08T12:00:00Z");
    expect(msUntilReset("resets 5 minutes from now", when), "a duration is not 05:00").toBeNull();
    expect(msUntilReset("resets 2026-09-17T17:00:00Z", when), "a date is not 20:00").toBeNull();
    expect(msUntilReset("resets 5", when), "a bare number is not a time").toBeNull();
  });

  it("waits the stated hour rather than the ladder, and names a real number", async () => {
    const root = repo(LONE_CANDIDATE);
    let calls = 0;
    const waits: number[] = [];
    const notes: string[] = [];
    const flaky: StageFn = (spec) => {
      calls += 1;
      if (calls === 1) return outageResult(HOURLY);
      return planner(ANALYSIS(null), DRAFT(["t-100"]))(spec);
    };
    const handlers = buildPipeline({
      root,
      backend: new MockBackend({ planner: flaky }),
      prompts: PROMPTS,
      budgets: BUDGETS,
      note: (t: string) => notes.push(t),
      now: () => at("2026-09-08T12:00:00Z"),
      sleep: async (ms: number) => {
        waits.push(ms);
      },
    });
    await runInit(root, handlers);

    expect(waits[0], "the stated reset, not the ladder's first minute and not NaN").toBe(14_460_000);
    expect(notes.join(" "), "the operator is told which kind of wait this is").toContain("for the stated reset");
    expect(notes.join(" "), "and never 'waiting NaN min'").not.toContain("NaN");
  }, 30_000);
});
