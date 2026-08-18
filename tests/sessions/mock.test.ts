import { describe, expect, it } from "vitest";
import { fullPrompt, prefixHash, type SessionSpec } from "../../src/sessions/backend.js";
import type { SessionBackend } from "../../src/sessions/backend.js";
import { MockBackend, okResult } from "../../src/sessions/mock.js";

/**
 * T-040 — the mock backend (oracle `ticket:role:n` scripting + call recording).
 *
 * `test_extra.py::test_smoke_mock_backend` ports here at the backend level:
 * the oracle smoked via a CLI verb asserting "smoke OK" and parsed telemetry;
 * the property is that an un-scripted session succeeds with parsed telemetry.
 * The CLI smoke verb itself is `doctor`'s and lands at T-050.
 */

function spec(over: Partial<SessionSpec> = {}): SessionSpec {
  return {
    role: "implement",
    ticketId: "t1",
    promptPrefix: "== ROLE ==\nimplementer",
    promptVariable: '{"inputs":{}}',
    cwd: "/nowhere",
    artifactOut: "/nowhere/implement.json",
    allowedTools: [],
    permissionMode: "",
    model: "",
    maxTurns: 30,
    ...over,
  };
}

describe("T-040 oracle smoke (test_smoke_mock_backend)", () => {
  it("an un-scripted session defaults to success with parsed telemetry", async () => {
    const backend = new MockBackend();
    const result = await backend.run(spec());
    expect(result.ok).toBe(true);
    expect(result.telemetryParsed).toBe(true);
    expect(result.inputTokens + result.outputTokens).toBeGreaterThan(0);
    /** The interface takes the pin; the mock ignores it (version-free). */
    const asBackend: SessionBackend = backend;
    await expect(asBackend.checkVersion("anything")).resolves.toBeUndefined();
  });
});

describe("T-040 scripting semantics (oracle parity)", () => {
  it("ticket-scoped keys outrank role keys", async () => {
    const backend = new MockBackend({
      "t1:review": () => okResult({ turns: 11 }),
      review: () => okResult({ turns: 99 }),
    });
    expect((await backend.run(spec({ role: "review", ticketId: "t1" }))).turns).toBe(11);
    expect((await backend.run(spec({ role: "review", ticketId: "t2" }))).turns).toBe(99);
  });

  it("per-key occurrence counters make review:0 then review:1 scriptable", async () => {
    const backend = new MockBackend({
      "review:0": () => okResult({ turns: 1 }),
      "review:1": () => okResult({ turns: 2 }),
    });
    expect((await backend.run(spec({ role: "review" }))).turns).toBe(1);
    expect((await backend.run(spec({ role: "review" }))).turns).toBe(2);
    /** Exhausted numbered scripts fall through to the default. */
    expect((await backend.run(spec({ role: "review" }))).ok).toBe(true);
  });

  it("a numbered ticket-scoped key counts independently of the bare role key", async () => {
    const backend = new MockBackend({
      "t1:informed_fix": () => okResult({ turns: 5 }),
      "t2:informed_fix": () => okResult({ turns: 6 }),
    });
    expect((await backend.run(spec({ role: "informed_fix", ticketId: "t1" }))).turns).toBe(5);
    expect((await backend.run(spec({ role: "informed_fix", ticketId: "t2" }))).turns).toBe(6);
  });

  it("records every launch in order, with the full spec (call recording)", async () => {
    const backend = new MockBackend();
    await backend.run(spec({ role: "implement", ticketId: "t1" }));
    await backend.run(spec({ role: "review", ticketId: "t1" }));
    await backend.run(spec({ role: "implement", ticketId: "t2" }));
    expect(backend.calls.map((c) => [c.ticketId, c.role])).toEqual([
      ["t1", "implement"],
      ["t1", "review"],
      ["t2", "implement"],
    ]);
    expect(backend.callsFor("t1")).toHaveLength(2);
    expect(backend.rolesLaunched().filter((r) => r === "implement")).toHaveLength(2);
    expect(backend.calls[0]?.spec.artifactOut).toBe("/nowhere/implement.json");
  });

  it("a scripted stage can report unparsable telemetry — S-4's breaker input", async () => {
    const backend = new MockBackend({ implement: () => okResult({ telemetryParsed: false }) });
    expect((await backend.run(spec())).telemetryParsed).toBe(false);
  });
});

describe("T-040 spec helpers", () => {
  it("fullPrompt is prefix + variable; prefixHash depends only on the prefix (S-6)", () => {
    const a = spec({ promptVariable: "A" });
    const b = spec({ promptVariable: "B" });
    expect(fullPrompt(a)).toBe("== ROLE ==\nimplementer\n\nA");
    expect(prefixHash(a)).toBe(prefixHash(b));
    expect(prefixHash(spec({ promptPrefix: "other" }))).not.toBe(prefixHash(a));
  });
});
