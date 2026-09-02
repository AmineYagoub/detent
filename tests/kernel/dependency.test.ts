import { describe, expect, it } from "vitest";
import { DEPENDENCY_RELEASE_CAP, resolveMissing } from "../../src/kernel/dependency.js";
import { ZERO_COUNTERS } from "../../src/kernel/generations.js";
import type { Ticket } from "../../src/schemas/ticket.js";

/**
 * X-4′ (PRDR-111) — resolving a falsification's `missing` paths against the
 * plan's surfaces. Found by t-112 on the certification gate: its AC needed a
 * status display t-154 builds, the planner declared no edge, and the
 * falsification became a human stop somebody had to remember to clear.
 */

function ticket(id: string, over: Partial<Ticket> = {}): Ticket {
  return {
    schema_version: 1,
    id,
    type: "feature",
    title: id,
    description: "",
    acceptance_criteria: ["x"],
    non_goals: [],
    surface: [],
    blockers: [],
    waits_on: [],
    links: [],
    priority: 0,
    risk_label: false,
    state: "READY",
    generations: [{ index: 0, counters: { ...ZERO_COUNTERS }, outcome: "in_flight", started_at: "2026-01-01T00:00:00.000Z" }],
    notes: [],
    ...over,
  } as Ticket;
}

describe("X-4′ resolveMissing", () => {
  const self = ticket("t-a", { surface: ["src/a/**"], state: "IN_PROGRESS" });
  const b = ticket("t-b", { surface: ["src/b/**"] });
  const c = ticket("t-c", { surface: ["src/c/**"], state: "DONE" });

  it("names the ticket whose surface owns the path", () => {
    expect(resolveMissing([self, b, c], self, ["src/b/lib.ts"]).owners).toEqual(["t-b"]);
  });

  it("a DONE owner is not an owner — the path should exist, so the falsification stands", () => {
    const r = resolveMissing([self, b, c], self, ["src/c/lib.ts"]);
    expect(r.owners).toEqual([]);
    expect(r.reason).toContain("no ticket's surface owns src/c/lib.ts");
  });

  it("never names itself, and a path nobody owns is a human's", () => {
    const r = resolveMissing([self, b], self, ["src/a/own.ts", "src/zzz/none.ts"]);
    expect(r.owners).toEqual([]);
    expect(r.reason).toContain("src/a/own.ts");
    expect(r.reason).toContain("src/zzz/none.ts");
  });

  it("an owner that depends on this ticket would deadlock, so it is not an owner", () => {
    const d = ticket("t-d", { surface: ["src/d/**"], blockers: ["t-b"] });
    const bOnA = ticket("t-b", { surface: ["src/b/**"], waits_on: ["t-a"] });
    const r = resolveMissing([self, bOnA, d], self, ["src/d/report.ts"]);
    expect(r.owners).toEqual([]);
    expect(r.reason).toContain("depends on this ticket");
  });

  it("all named paths must resolve — one unowned path makes the whole signal a human's", () => {
    expect(resolveMissing([self, b], self, ["src/b/lib.ts", "src/zzz/none.ts"]).owners).toEqual([]);
  });

  it("caps releases per ticket", () => {
    const gens = Array.from({ length: DEPENDENCY_RELEASE_CAP + 1 }, (_, i) => ({
      index: i,
      counters: { ...ZERO_COUNTERS },
      outcome: "blocked" as const,
      reason: `waiting on t-b for src/b/${i}.ts (X-4′)`,
      started_at: "2026-01-01T00:00:00.000Z",
    }));
    const tired = ticket("t-a", { surface: ["src/a/**"], generations: gens });
    const r = resolveMissing([tired, b], tired, ["src/b/lib.ts"]);
    expect(r.owners).toEqual([]);
    expect(r.reason).toContain("cap");
  });
});
