import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderStatus } from "../../src/cli/status.js";
import { effortEvidence, routeEffort, surfacesMeet, type EffortEvidence } from "../../src/kernel/effort-route.js";
import type { TransitionLine } from "../../src/schemas/records.js";
import type { Ticket } from "../../src/schemas/ticket.js";
import { readLedgerRows } from "../../src/kernel/ledger-rows.js";
import { run, type EscalationAction } from "../../src/kernel/run.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { DEFAULT_EFFORT_ROUTING } from "../../src/schemas/roles.js";
import { removeTree, writeTree } from "../helpers.js";
import { addTicket, fixGreen, implementGreen, implementRed, makeRunRepo, reviewApprove } from "./run-fixture.js";

/**
 * S-5⁸ (PRDR-328) — in `run`, a ticket's risk sets where its sessions' effort
 * starts, and evidence moves it, only up: a failed attempt raises the next one
 * a level, and a ticket beside one that escalated or was falsified in this run
 * starts a level up. Nothing goes below the role's configured level.
 */

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

async function fixture(over: { readonly effort_routing?: Record<string, string>; readonly risk?: readonly string[] } = {}): Promise<string> {
  const { root } = await makeRunRepo();
  roots.push(root);
  const file = path.join(root, ".detent", "config.json");
  const config = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  writeFileSync(file, JSON.stringify({ ...config, effort_routing: over.effort_routing ?? { ...DEFAULT_EFFORT_ROUTING }, ...(over.risk === undefined ? {} : { risk: over.risk }) }, null, 2));
  return root;
}

function events(root: string, id: string): Array<Record<string, unknown>> {
  return readFileSync(path.join(root, ".detent", "runs", id, "journal.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

const started = (root: string, id: string): Array<[unknown, unknown]> => events(root, id).filter((e) => e["event"] === "start").map((e) => [e["stage"], e["effort"]]);
const settled = (root: string, id: string): Array<[unknown, unknown]> => events(root, id).filter((e) => e["event"] === "effort_settled").map((e) => [e["stage"], e["reason"]]);
const raised = (root: string, id: string): string[] => readTicket(root, id).notes.map((n) => n.text).filter((t) => t.startsWith("effort raised"));
const go = async (root: string, backend: MockBackend): Promise<void> => {
  await run({ root, backend, prompts: PROMPTS, runId: "test", escalate: async (): Promise<EscalationAction> => ({ kind: "skip", by: "nobody" }) });
};

describe("S-5⁸ risk sets where a ticket's effort starts (PRDR-328)", () => {
  it("runs a risk-labelled ticket's implement and review sessions at max", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1", risk_label: true });
    const backend = new MockBackend({ implement: implementGreen, review: reviewApprove });
    await go(root, backend);
    expect(started(root, "t1")).toEqual([["implement", "max"], ["review", "max"]]);
    expect(settled(root, "t1")).toEqual([["implement", "risk"], ["review", "risk"]]);
    expect(backend.calls.map((c) => [c.role, c.spec.effort]), "the level the session is launched with, not only the one recorded").toEqual([["implement", "max"], ["review", "max"]]);
  }, 120_000);

  it("runs a ticket whose surface meets a glob of the config's risk list at max", async () => {
    const root = await fixture({ risk: ["src/payments/**"] });
    addTicket(root, { id: "t1" });
    await go(root, new MockBackend({ implement: implementGreen, review: reviewApprove }));
    expect(started(root, "t1")).toEqual([["implement", "max"], ["review", "max"]]);
  }, 120_000);

  it("leaves a ticket that risks nothing at its roles' levels", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    await go(root, new MockBackend({ implement: implementGreen, review: reviewApprove }));
    expect(started(root, "t1")).toEqual([["implement", "xhigh"], ["review", "xhigh"]]);
    expect(settled(root, "t1")).toEqual([["implement", "role"], ["review", "role"]]);
    expect(raised(root, "t1")).toEqual([]);
  }, 120_000);
});

describe("S-5⁸ evidence raises a ticket's effort, only up (PRDR-328)", () => {
  it("runs the attempt after a red gate one level above the one that failed, and notes the step", async () => {
    const root = await fixture({ effort_routing: { ...DEFAULT_EFFORT_ROUTING, implement: "high", blind_fix: "high" } });
    addTicket(root, { id: "t1" });
    await go(root, new MockBackend({ implement: implementRed, blind_fix: fixGreen, review: reviewApprove }));
    expect(started(root, "t1").slice(0, 2)).toEqual([["implement", "high"], ["blind_fix", "xhigh"]]);
    expect(settled(root, "t1").slice(0, 2)).toEqual([["implement", "role"], ["blind_fix", "evidence"]]);
    expect(raised(root, "t1")).toEqual(["effort raised (S-5⁸): blind_fix runs at xhigh, above its role's high, because its attempts have failed once: a red gate"]);
  }, 120_000);

  it("starts a ticket one level up when its surface meets one that escalated earlier in the run", async () => {
    const root = await fixture({ effort_routing: { ...DEFAULT_EFFORT_ROUTING, implement: "high", review: "high" } });
    addTicket(root, { id: "t-a" });
    addTicket(root, { id: "t-b" });
    const oversizedThenGreen: StageFn = (spec) => {
      if (spec.ticketId !== "t-a") return implementGreen(spec);
      const variable = JSON.parse(spec.promptVariable) as { oversized_out: string };
      writeTree(path.dirname(variable.oversized_out), { [path.basename(variable.oversized_out)]: JSON.stringify({ note: "two tickets", split: ["one", "two"] }) });
      return okResult();
    };
    await go(root, new MockBackend({ implement: oversizedThenGreen, review: reviewApprove }));
    expect(readTicket(root, "t-a").state).toBe("NEEDS_HUMAN");
    expect(started(root, "t-a")).toEqual([["implement", "high"]]);
    expect(started(root, "t-b")).toEqual([["implement", "xhigh"], ["review", "xhigh"]]);
    expect(raised(root, "t-b")).toContain("effort raised (S-5⁸): implement runs at xhigh, above its role's high, because its surface meets that of t-a, which escalated to a human");
  }, 120_000);
});

describe("S-5⁸ a neighbour counts from this run only (PRDR-328)", () => {
  it("does not raise a ticket for a neighbour's escalation in an earlier run", async () => {
    const root = await fixture({ effort_routing: { ...DEFAULT_EFFORT_ROUTING, implement: "high", review: "high" } });
    addTicket(root, { id: "t-a" });
    const oversized: StageFn = (spec) => {
      const variable = JSON.parse(spec.promptVariable) as { oversized_out: string };
      writeTree(path.dirname(variable.oversized_out), { [path.basename(variable.oversized_out)]: JSON.stringify({ note: "two tickets", split: ["one", "two"] }) });
      return okResult();
    };
    await go(root, new MockBackend({ implement: oversized }));
    expect(readTicket(root, "t-a").state).toBe("NEEDS_HUMAN");
    addTicket(root, { id: "t-b" });
    await go(root, new MockBackend({ implement: implementGreen, review: reviewApprove }));
    expect(started(root, "t-b")).toEqual([["implement", "high"], ["review", "high"]]);
  }, 120_000);
});

describe("S-5⁸ why each session ran at its level is recorded and counted (PRDR-328)", () => {
  it("names the reason on each run session's ledger row, and detent status counts sessions and cost by it", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1", risk_label: true });
    addTicket(root, { id: "t2" });
    await go(root, new MockBackend({ implement: implementGreen, review: reviewApprove }));
    expect(readLedgerRows(root).map((r) => [r.ticket, r.role, r.effort_reason])).toEqual([
      ["t1", "implement", "risk"],
      ["t1", "review", "risk"],
      ["t2", "implement", "role"],
      ["t2", "review", "role"],
    ]);
    const cost = (reason: string): string => `$${readLedgerRows(root).filter((r) => r.effort_reason === reason).reduce((usd, r) => usd + r.cost_estimate_usd, 0).toFixed(4)}`;
    expect(renderStatus(root)).toContain(`Effort (S-5⁸): 2 sessions at their role's level, ${cost("role")} · 2 sessions raised for their ticket's risk, ${cost("risk")}`);
  }, 120_000);
});

describe("S-5⁸ the evidence, from what run recorded (PRDR-328)", () => {
  const RUN = Date.parse("2026-10-02T12:00:00.000Z");
  const line = (ticket: string, event: string, to: string, at = "2026-10-02T12:30:00.000Z"): TransitionLine =>
    ({ at, ticket, generation: 0, from: "IN_PROGRESS", event, to, evidence: "", counters: {} }) as unknown as TransitionLine;
  const ticket = (id: string, surface: readonly string[], risk_label = false): Ticket => ({ id, surface, risk_label }) as unknown as Ticket;
  const facts = (lines: readonly TransitionLine[], tickets: readonly Ticket[], self: Ticket = ticket("t1", ["src/**"]), riskGlobs: readonly string[] = []): EffortEvidence =>
    effortEvidence({ role: "implement", base: "high", ticket: self, riskGlobs, lines, runSince: RUN, tickets: [self, ...tickets] });

  it("counts the ticket's own failed attempts, oldest first, and no other ticket's", () => {
    const lines = [line("t1", "GATE_RED", "BLIND_FIX"), line("t2", "GATE_RED", "BLIND_FIX"), line("t1", "REVIEW_CHANGES", "REVIEW_FIX"), line("t1", "GATE_GREEN", "IN_REVIEW")];
    expect(facts(lines, [ticket("t2", ["src/**"])]).failures).toEqual(["a red gate", "a review asking for changes"]);
  });

  it("names this run's neighbours that escalated or were falsified, and none from before the run, elsewhere, or sent back by an outage", () => {
    const lines = [
      line("t-a", "TICKET_OVERSIZED", "NEEDS_HUMAN"),
      line("t-c", "PREMISE_FALSIFIED", "DIAGNOSED"),
      line("t-d", "TICKET_OVERSIZED", "NEEDS_HUMAN", "2026-10-02T11:00:00.000Z"),
      line("t-e", "TICKET_OVERSIZED", "NEEDS_HUMAN"),
      line("t-f", "BUDGET_BREACH", "NEEDS_HUMAN"),
      line("t-f", "OUTAGE_REQUEUE", "READY"),
    ];
    const near = ["t-a", "t-c", "t-d", "t-f"].map((id) => ticket(id, ["src/auth/**"]));
    expect(facts(lines, [...near, ticket("t-e", ["docs/**"])]).troubled).toEqual(["t-a, which escalated to a human", "t-c, which was falsified"]);
  });

  it("reads a ticket as high-risk from its label or from the config's risk globs", () => {
    expect(facts([], [], ticket("t1", ["src/**"], true)).risky).toBe(true);
    expect(facts([], [], ticket("t1", ["src/**"]), ["src/payments/**"]).risky).toBe(true);
    expect(facts([], [], ticket("t1", ["docs/**"]), ["src/payments/**"]).risky).toBe(false);
  });
});

describe("S-5⁸ the routing, alone (PRDR-328)", () => {
  const at = (over: Partial<EffortEvidence>): ReturnType<typeof routeEffort> => routeEffort({ role: "implement", base: "xhigh", risky: false, failures: [], troubled: [], ...over });

  it("never routes a session below its role's level", () => {
    expect(at({ base: "max" })).toEqual({ level: "max", reason: "role" });
    expect(at({ base: "max", failures: ["a red gate"] })).toEqual({ level: "max", reason: "role" });
    expect(at({ role: "diagnose", risky: true, failures: ["a red gate"], troubled: ["t-a, which escalated to a human"] })).toEqual({ level: "xhigh", reason: "role" });
  });

  it("raises one level per failed attempt as far as max, and from a risky start not at all", () => {
    expect(at({ base: "high", failures: ["a red gate"] }).level).toBe("xhigh");
    expect(at({ base: "high", failures: ["a red gate", "a review asking for changes"] }).level).toBe("max");
    expect(at({ base: "high", failures: ["a", "b", "c", "d"] }).level).toBe("max");
    expect(at({ base: "high", risky: true, failures: ["a red gate"] })).toMatchObject({ level: "max", reason: "risk" });
    expect(at({ role: "review", base: "high", failures: ["a review asking for changes"] }).level, "a review is raised by risk and neighbours, not by failures").toBe("high");
  });

  it("raises a role routed to no level by risk, and not by a step it cannot name", () => {
    expect(at({ base: undefined })).toEqual({ level: "default", reason: "role" });
    expect(at({ base: undefined, failures: ["a red gate"] })).toEqual({ level: "default", reason: "role" });
    expect(at({ base: undefined, risky: true })).toMatchObject({ level: "max", reason: "risk" });
  });

  it("reads surfaces as globs, either way round", () => {
    expect(surfacesMeet(["src/**"], ["src/auth/login.ts"])).toBe(true);
    expect(surfacesMeet(["src/auth/**"], ["src/**"])).toBe(true);
    expect(surfacesMeet(["src/a/**"], ["src/b/**"])).toBe(false);
    expect(surfacesMeet([], ["src/**"])).toBe(false);
  });
});
