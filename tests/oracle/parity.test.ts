import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PARITY, ORACLE_TEST_COUNT, LANDED_THROUGH, hasLanded, milestoneOf, statusOf } from "./parity.map.js";
import { OUTPUTS, longestChain, parsePlan } from "../../scripts/parity.js";

describe("T-018 oracle parity report (M0 exit)", () => {
  it("covers all 52 oracle tests exactly once — zero unmapped, zero duplicated", () => {
    expect(PARITY).toHaveLength(ORACLE_TEST_COUNT);
    expect(new Set(PARITY.map((e) => e.oracle)).size).toBe(ORACLE_TEST_COUNT);
  });

  it("every entry names a closing ticket", () => {
    for (const e of PARITY) expect(e.ticket, e.oracle).toMatch(/^T-\d{3}$/);
  });

  it("the ratchet: every entry of a landed milestone is green — no gaps behind the line", () => {
    // One direction only. Above the line, entries go green ticket by ticket
    // (M2 lands mid-milestone); a green entry's honesty is enforced by the
    // ts-home check below, which requires a real test file citing the ticket.
    for (const e of PARITY) {
      if (hasLanded(milestoneOf(e.ticket))) {
        expect(statusOf(e), `${e.oracle} (${e.ticket}) sits behind LANDED_THROUGH but is not green`).toBe("green");
      }
    }
  });

  it("M0 exit threshold: at least 22 green", () => {
    const green = PARITY.filter((e) => statusOf(e) === "green");
    expect(green.length).toBeGreaterThanOrEqual(22);
  });

  it("M1 exit threshold: zero pending-M1 (T-020 and T-022 close all five)", () => {
    expect(PARITY.filter((e) => statusOf(e) === "pending-M1")).toEqual([]);
    expect(LANDED_THROUGH).toBe("M1");
  });

  it("the full oracle suite is ported — all 52 green, zero pending (mode-1 closed with the M3 back half)", () => {
    // The last pending entry, test_mode1_stub_detected (T-060), went green when
    // the init back half (T-064..T-068) made greenfield detection meaningful:
    // a PRD-only non-git folder is caught and `detent init` returns 2.
    expect(PARITY.filter((e) => statusOf(e) === "green")).toHaveLength(ORACLE_TEST_COUNT);
    expect(PARITY.filter((e) => statusOf(e) !== "green")).toEqual([]);
  });

  it("every green entry's TypeScript home is a test file that exists and names its ticket", () => {
    for (const e of PARITY) {
      if (e.ts === undefined) continue;
      const src = readFileSync(e.ts, "utf8");
      expect(src.length, e.ts).toBeGreaterThan(0);
      expect(src, `${e.ts} does not reference ${e.ticket}`).toContain(e.ticket);
    }
  });

  it("the status vocabulary needed four values — mode-1 closes in M3, past the {green,M1,M2} range", () => {
    // R-2 assumed {green, pending-M1, pending-M2}. test_mode1_stub_detected maps
    // to greenfield/brownfield detection, whose closing ticket T-060 is M3 — so
    // a three-value vocabulary could never have labelled it while it was still
    // pending. The entry is green now, but that structural fact is permanent.
    const mode1 = PARITY.find((e) => e.oracle === "test_extra.py::test_mode1_stub_detected");
    expect(mode1?.ticket).toBe("T-060");
    expect(milestoneOf("T-060")).toBe("M3");
  });

  it("the checked-in PARITY.md and critical-path.md are not stale", () => {
    for (const { file, content } of OUTPUTS()) {
      expect(readFileSync(file, "utf8"), `${file} is stale — run \`npm run parity\``).toBe(content);
    }
  });
});

describe("T-018 derived critical path (§2)", () => {
  const tickets = parsePlan(readFileSync("docs/implementation-plan.md", "utf8"));

  it("parses every ticket in the plan", () => {
    expect(tickets).toHaveLength(56);
  });

  it("every dependency references a ticket that exists, and the graph is acyclic", () => {
    expect(() => longestChain(tickets)).not.toThrow();
  });

  it("the chain is a real path: each step is a declared dependency of the next", () => {
    const chain = longestChain(tickets);
    const byId = new Map(tickets.map((t) => [t.id, t]));
    for (let i = 1; i < chain.length; i += 1) {
      expect(byId.get(chain[i]!)!.deps, `${chain[i]} does not depend on ${chain[i - 1]}`).toContain(chain[i - 1]!);
    }
    expect(chain).toHaveLength(17);
  });

  it("the terminal ticket is the one nothing else gates", () => {
    const chain = longestChain(tickets);
    expect(chain.at(-1)).toBe("T-084");
  });
});
