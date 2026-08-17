import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PARITY, ORACLE_TEST_COUNT, milestoneOf, statusOf } from "./parity.map.js";
import { OUTPUTS, longestChain, parsePlan } from "../../scripts/parity.js";

describe("T-018 oracle parity report (M0 exit)", () => {
  it("covers all 52 oracle tests exactly once — zero unmapped, zero duplicated", () => {
    expect(PARITY).toHaveLength(ORACLE_TEST_COUNT);
    expect(new Set(PARITY.map((e) => e.oracle)).size).toBe(ORACLE_TEST_COUNT);
  });

  it("every entry names a closing ticket, and every green entry names its TypeScript home", () => {
    for (const e of PARITY) {
      expect(e.ticket, e.oracle).toMatch(/^T-\d{3}$/);
      if (statusOf(e) === "green") expect(e.ts, `${e.oracle} is green but has no TS home`).toBeTruthy();
      else expect(e.ts, `${e.oracle} is pending but claims a TS home`).toBeUndefined();
    }
  });

  it("M0 exit threshold: at least 22 green", () => {
    const green = PARITY.filter((e) => statusOf(e) === "green");
    expect(green.length).toBeGreaterThanOrEqual(22);
  });

  it("every green entry's TypeScript home is a test file that exists and names its ticket", () => {
    for (const e of PARITY) {
      if (e.ts === undefined) continue;
      const src = readFileSync(e.ts, "utf8");
      expect(src.length, e.ts).toBeGreaterThan(0);
      expect(src, `${e.ts} does not reference ${e.ticket}`).toContain(e.ticket);
    }
  });

  it("the status vocabulary needs four values — one oracle test closes after M2", () => {
    // R-2 assumed {green, pending-M1, pending-M2}. test_mode1_stub_detected maps
    // to greenfield/brownfield detection, which is C-1's job at T-060 (M3).
    const later = PARITY.filter((e) => statusOf(e) === "pending-later");
    expect(later.map((e) => e.oracle)).toEqual(["test_extra.py::test_mode1_stub_detected"]);
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
