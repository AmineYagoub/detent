import { describe, expect, it } from "vitest";
import { MAX_RESET_WAIT_MS, OUTAGE_BACKOFF_MS, conversationToResume, isOutage, isUsageLimit, outageWait, resetPhrase } from "../../src/schemas/backend-limit.js";

/**
 * X-8″ (PRDR-321) — how the backend's limits read, one way for both drivers
 * (ARCH-2): which stop is a usage limit, the one a session is resumed after,
 * what reset it names, and how long a driver waits for it.
 */

const NOON = new Date("2026-09-30T11:00:00Z");

describe("X-8″ a usage limit, as the runtime words one", () => {
  it("is the runtime's own \"You've hit your … limit\", whichever limit, and the older \"usage limit reached\"", () => {
    for (const said of [
      "Claude Code returned an error result: You've hit your session limit · resets 11:50am (Africa/Algiers)",
      "You’ve hit your weekly limit · resets Oct 3, 5pm",
      "You've hit your monthly spend limit.",
      "You've hit your fast limit",
      "Claude AI usage limit reached|1759240800",
    ]) {
      expect(isUsageLimit(said), said).toBe(true);
      expect(isOutage(said), `${said} is waited out as well`).toBe(true);
    }
  });

  it("is not a rate limit, an overload, a crash, or prose that mentions a limit", () => {
    for (const said of ["API Error: 429 rate limit exceeded", "API Error: 529 overloaded", "socket hang up", "the rate limits on login are in §3.2", "No conversation found with session ID: x"]) {
      expect(isUsageLimit(said), said).toBe(false);
    }
  });

  it("names its reset as it named it, for a note", () => {
    expect(resetPhrase("You've hit your session limit · resets 11:50am (Africa/Algiers)")).toBe("resets 11:50am (Africa/Algiers)");
    expect(resetPhrase("You've hit your session limit · resets 5pm (Africa/Algiers)")).toBe("resets 5pm (Africa/Algiers)");
    expect(resetPhrase("You've hit your weekly limit")).toBeNull();
  });
});

describe("X-8″ the wait before a retry", () => {
  const limit = (at: string): string => `You've hit your session limit · resets ${at} (Africa/Algiers)`;

  it("waits for a stated reset, the ladder's step for none, and hands back a reset past six hours", () => {
    expect(outageWait(limit("3pm"), 0, NOON)).toEqual({ kind: "reset", ms: (3 * 60 + 1) * 60_000, resets: "resets 3pm (Africa/Algiers)" });
    expect(outageWait("API Error: 529 overloaded", 1, NOON)).toEqual({ kind: "ladder", ms: OUTAGE_BACKOFF_MS[1] });
    const far = outageWait(limit("11pm"), 0, NOON);
    expect(far?.kind).toBe("too_long");
    expect(far?.ms).toBeGreaterThan(MAX_RESET_WAIT_MS);
  });

  it("is spent after the ladder's last step, even for a stated reset", () => {
    expect(outageWait(limit("3pm"), OUTAGE_BACKOFF_MS.length, NOON)).toBeNull();
  });
});

describe("X-8″ the conversation the next attempt carries on", () => {
  it("is the stopped session's, when a usage limit stopped it after its first turn", () => {
    expect(conversationToResume({ sessionId: "s1", turns: 3 }, true)).toBe("s1");
    expect(conversationToResume({ sessionId: "s1", turns: 3 }, false), "a crash keeps none").toBeUndefined();
  });

  it("is the one a resume carried, when that resume stopped before its first turn and the runtime had taken it", () => {
    expect(conversationToResume({ sessionId: "s1", turns: 0, resume: { sessionId: "s1" } }, true)).toBe("s1");
    expect(conversationToResume({ sessionId: "s1", turns: 0, resume: { sessionId: "s1" } }, false), "an overload before the first turn changed nothing either").toBe("s1");
    expect(conversationToResume({ sessionId: "s2", turns: 0, resume: { sessionId: "s1", refused: "No conversation found" } }, true)).toBeUndefined();
    expect(conversationToResume({ sessionId: "s1", turns: 0 }, true), "a fresh session stopped before its first turn has nothing to carry").toBeUndefined();
  });

  it("is the session's own after a refused resume launched it afresh and it ran", () => {
    expect(conversationToResume({ sessionId: "s2", turns: 4, resume: { sessionId: "s1", refused: "No conversation found" } }, true)).toBe("s2");
  });
});
