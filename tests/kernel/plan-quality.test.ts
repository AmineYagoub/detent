import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderStatus } from "../../src/cli/status.js";
import { stateDir, writeArtifact } from "../../src/fs/layout.js";
import { detentBuild } from "../../src/kernel/build.js";
import { ZERO_COUNTERS } from "../../src/kernel/generations.js";
import { ticketOutcomes, totals } from "../../src/kernel/outcomes.js";
import { planQuality } from "../../src/kernel/plan-quality.js";
import { run } from "../../src/kernel/run.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import type { LedgerRow, TransitionLine } from "../../src/schemas/records.js";
import { STATES, type Event, type State } from "../../src/schemas/states.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree, tmpTree, writeTree } from "../helpers.js";
import { addTicket, approveFixturePlan, implementGreen, implementRed, makeRunRepo, noopFix, researchValid, reviewApprove } from "./run-fixture.js";

/**
 * PRDR-297 (N-5″) — plans are measured by how they run.
 *
 * D-33 keeps a planning mechanism for the run-time outcome it moves, and
 * September judged 79 of them by reviewer finding counts, which its own
 * experiments showed track the reviewer. Nothing counted an outcome. These
 * replay a recorded run's `transitions.jsonl` and ledger, written here line by
 * line as `run` writes them, and hold every figure per ticket, per slice and
 * per plan.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

const at = (hhmm: string): string => `2026-09-27T${hhmm}:00.000Z`;

/** One transition line, as `appendTransition` writes it. */
function line(ticket: string, generation: number, hhmm: string, from: State, event: Event, to: State): TransitionLine {
  return { at: at(hhmm), ticket, generation, from, event, to, evidence: "recorded", counters: { ...ZERO_COUNTERS } };
}

function row(ticket: string, role: string, usd: number, phase?: string): LedgerRow {
  return {
    at: at("12:00"),
    ticket,
    generation: 0,
    role,
    cost_estimate_usd: usd,
    input_tokens: 10,
    output_tokens: 10,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    turns: 3,
    models: [],
    ...(phase === undefined ? {} : { phase }),
  };
}

/**
 * The run: t1 and t2 through review on their first claim, t2 by a blind fix
 * and a round of changes; t3 falsified, stopped for a human, requeued and
 * DONE in its second generation; t4 waiting on a dependency, then over budget;
 * t5 too large for one session; t6 stopped by an outage, which the pool
 * returned, and DONE on its next claim.
 */
const TRANSITIONS: readonly TransitionLine[] = [
  line("t1", 0, "10:00", "READY", "CLAIMED", "IN_PROGRESS"),
  line("t2", 0, "10:00", "READY", "CLAIMED", "IN_PROGRESS"),
  line("t3", 0, "10:00", "READY", "CLAIMED", "IN_PROGRESS"),
  line("t4", 0, "10:00", "READY", "CLAIMED", "IN_PROGRESS"),
  line("t5", 0, "10:00", "READY", "CLAIMED", "IN_PROGRESS"),
  line("t6", 0, "10:00", "READY", "CLAIMED", "IN_PROGRESS"),
  line("t6", 0, "10:02", "IN_PROGRESS", "GATE_RED", "NEEDS_HUMAN"),
  line("t5", 0, "10:03", "IN_PROGRESS", "TICKET_OVERSIZED", "NEEDS_HUMAN"),
  line("t3", 0, "10:05", "IN_PROGRESS", "PREMISE_FALSIFIED", "NEEDS_HUMAN"),
  line("t4", 0, "10:08", "IN_PROGRESS", "DEPENDENCY_DISCOVERED", "READY"),
  line("t1", 0, "10:10", "IN_PROGRESS", "GATE_GREEN", "IN_REVIEW"),
  line("t1", 0, "10:15", "IN_REVIEW", "REVIEW_APPROVE", "APPROVED"),
  line("t1", 0, "10:16", "APPROVED", "GATE_GREEN", "DONE"),
  line("t2", 0, "10:20", "IN_PROGRESS", "GATE_RED", "BLIND_FIX"),
  line("t6", 0, "10:30", "NEEDS_HUMAN", "OUTAGE_REQUEUE", "READY"),
  line("t2", 0, "10:30", "BLIND_FIX", "GATE_GREEN", "IN_REVIEW"),
  line("t2", 0, "10:35", "IN_REVIEW", "REVIEW_CHANGES", "REVIEW_FIX"),
  line("t6", 1, "10:40", "READY", "CLAIMED", "IN_PROGRESS"),
  line("t2", 0, "10:45", "REVIEW_FIX", "GATE_GREEN", "IN_REVIEW"),
  line("t2", 0, "10:50", "IN_REVIEW", "REVIEW_APPROVE", "APPROVED"),
  line("t6", 1, "10:50", "IN_PROGRESS", "GATE_GREEN", "IN_REVIEW"),
  line("t2", 0, "10:51", "APPROVED", "GATE_GREEN", "DONE"),
  line("t6", 1, "10:55", "IN_REVIEW", "REVIEW_APPROVE", "APPROVED"),
  line("t6", 1, "10:56", "APPROVED", "GATE_GREEN", "DONE"),
  line("t3", 0, "11:00", "NEEDS_HUMAN", "HUMAN_REQUEUE", "READY"),
  line("t3", 1, "11:05", "READY", "CLAIMED", "IN_PROGRESS"),
  line("t3", 1, "11:15", "IN_PROGRESS", "GATE_GREEN", "IN_REVIEW"),
  line("t3", 1, "11:20", "IN_REVIEW", "REVIEW_APPROVE", "APPROVED"),
  line("t3", 1, "11:21", "APPROVED", "GATE_GREEN", "DONE"),
  line("t4", 1, "12:00", "READY", "CLAIMED", "IN_PROGRESS"),
  line("t4", 1, "12:30", "IN_PROGRESS", "BUDGET_BREACH", "NEEDS_HUMAN"),
];

const LEDGER: readonly LedgerRow[] = [
  row("init", "planner", 3, "PLAN"),
  row("t1", "implement", 0.5),
  row("t1", "review", 0.25),
  row("t2", "implement", 1),
  row("t2", "blind_fix", 0.4),
  row("t2", "review", 0.6),
  row("t2", "review_fix", 0.3),
  row("t3", "implement", 0.2),
  row("t3", "implement", 0.8),
  row("t3", "review", 0.3),
  row("t4", "implement", 0.1),
  row("t4", "implement", 2),
  row("t5", "implement", 0.05),
  row("t6", "implement", 0),
  row("t6", "implement", 0.7),
  row("t6", "review", 0.2),
];

const PACK = "b".repeat(64);
const minutes = (n: number): number => n * 60_000;

/** A root holding what the run recorded, the plan it ran and the approval that named what made it. */
function recorded(transitions: string, extra: Record<string, string> = {}): string {
  const root = tmpTree();
  roots.push(root);
  writeTree(root, {
    ".detent/transitions.jsonl": transitions,
    ".detent/ledger.jsonl": `${LEDGER.map((r) => JSON.stringify(r)).join("\n")}\n`,
    ".detent/plan/plan.json": `${JSON.stringify({
      schema_version: SCHEMA_VERSION,
      tickets: ["t1", "t2", "t3", "t4", "t5", "t6"],
      slices: [
        { id: "s01", title: "catalog", tickets: ["t1", "t2", "t3"] },
        { id: "s02", title: "billing", tickets: ["t4", "t5"] },
      ],
    })}\n`,
    ".detent/plan/approval.json": `${JSON.stringify({
      schema_version: SCHEMA_VERSION,
      approved_by: "the operator",
      at: at("09:00"),
      plan_hash: "a".repeat(64),
      builds: ["3.1.0+aaaaaaaaaaaa", "3.1.0+bbbbbbbbbbbb"],
      pack_hash: PACK,
    })}\n`,
    ...extra,
  });
  return root;
}

const RECORDED = `${TRANSITIONS.map((l) => JSON.stringify(l)).join("\n")}\n`;

describe("PRDR-297: a recorded run's transitions and ledger, replayed into its outcomes (N-5″)", () => {
  it("counts each ticket's escalations, falsifications by cause, breaches, first generation, review rounds, cost and time at work", () => {
    const got = ticketOutcomes(["t1", "t2", "t3", "t4", "t5", "t6"], TRANSITIONS, LEDGER);
    const none = { premise: 0, oversized: 0, dependency: 0 };
    const usd = (n: number): number => expect.closeTo(n, 10) as unknown as number;
    expect(got).toEqual([
      { ticket: "t1", done: true, first_generation: true, escalations: 0, falsified: none, budget_breaches: 0, review_rounds: 1, cost_usd: usd(0.75), work_ms: minutes(16) },
      { ticket: "t2", done: true, first_generation: true, escalations: 0, falsified: none, budget_breaches: 0, review_rounds: 2, cost_usd: usd(2.3), work_ms: minutes(51) },
      /* Five minutes' work before it stopped and sixteen after its requeue: its waits on a human and in the pool are not counted. */
      { ticket: "t3", done: true, first_generation: false, escalations: 1, falsified: { ...none, premise: 1 }, budget_breaches: 0, review_rounds: 1, cost_usd: usd(1.3), work_ms: minutes(21) },
      { ticket: "t4", done: false, first_generation: false, escalations: 1, falsified: { ...none, dependency: 1 }, budget_breaches: 1, review_rounds: 0, cost_usd: usd(2.1), work_ms: minutes(38) },
      { ticket: "t5", done: false, first_generation: false, escalations: 1, falsified: { ...none, oversized: 1 }, budget_breaches: 0, review_rounds: 0, cost_usd: usd(0.05), work_ms: minutes(3) },
      /* The outage's stop and the generation its requeue opened are not the ticket's (PRDR-112). */
      { ticket: "t6", done: true, first_generation: true, escalations: 0, falsified: none, budget_breaches: 0, review_rounds: 1, cost_usd: usd(0.9), work_ms: minutes(18) },
    ]);
  });

  it("counts a ticket still at work when the figures were taken: not done, though its gate went green, and at work only to its last line", () => {
    const lines = [
      line("t7", 0, "10:00", "READY", "CLAIMED", "IN_PROGRESS"),
      line("t7", 0, "10:10", "IN_PROGRESS", "GATE_GREEN", "IN_REVIEW"),
      line("t7", 0, "10:15", "IN_REVIEW", "REVIEW_CHANGES", "REVIEW_FIX"),
    ];
    expect(ticketOutcomes(["t7"], lines, [])).toEqual([
      {
        ticket: "t7",
        done: false,
        first_generation: false,
        escalations: 0,
        falsified: { premise: 0, oversized: 0, dependency: 0 },
        budget_breaches: 0,
        review_rounds: 1,
        cost_usd: 0,
        work_ms: minutes(15),
      },
    ]);
  });

  it("sums them per slice and per plan, with the builds that made the plan and its pack", () => {
    const root = recorded(RECORDED);
    const quality = planQuality(root);
    expect(quality?.made).toEqual({ builds: ["3.1.0+aaaaaaaaaaaa", "3.1.0+bbbbbbbbbbbb"], pack_hash: PACK });
    expect(quality?.plan).toEqual({
      tickets: 6,
      done: 4,
      first_generation: 3,
      escalations: 3,
      falsified: { premise: 1, oversized: 1, dependency: 1 },
      budget_breaches: 1,
      review_rounds: 5,
      cost_usd: expect.closeTo(7.4, 10) as unknown as number,
      work_ms: minutes(147),
    });
    expect(quality?.slices.map((s) => [s.id, s.tickets, s.done, s.first_generation, s.escalations, s.review_rounds, s.work_ms])).toEqual([
      ["s01", 3, 3, 2, 1, 4, minutes(88)],
      ["s02", 2, 0, 0, 2, 0, minutes(41)],
    ]);
    expect(quality?.slices[1]?.falsified).toEqual({ premise: 0, oversized: 1, dependency: 1 });
    expect(quality?.slices[0]?.cost_usd).toBeCloseTo(4.35, 10);
    expect(quality?.outside, "t6 is in no slice, as a bootstrap is not").toMatchObject({ tickets: 1, done: 1, first_generation: 1, work_ms: minutes(18) });
    expect(quality?.outside?.cost_usd).toBeCloseTo(0.9, 10);
    expect(quality?.unreadable).toBe(0);
    expect(totals(quality?.tickets ?? [])).toEqual(quality?.plan);
  });

  it("does not count init's spend, or any ticket the plan does not hold", () => {
    const root = recorded(`${RECORDED}${JSON.stringify(line("gone", 0, "13:00", "READY", "CLAIMED", "IN_PROGRESS"))}\n`);
    const quality = planQuality(root);
    expect(quality?.tickets.map((t) => t.ticket)).toEqual(["t1", "t2", "t3", "t4", "t5", "t6"]);
    expect(quality?.plan.cost_usd, "init's $3 is planning's, which PRESENT and status report by phase").toBeCloseTo(7.4, 10);
  });

  it("recovers what a torn line holds whole, and counts what it cannot read", () => {
    const [first, second, ...rest] = TRANSITIONS.map((l) => JSON.stringify(l));
    /* A write torn at the separator leaves two whole lines on one; the next is torn mid-object. */
    const torn = `${first ?? ""}${second ?? ""}\n{"at":"2026-09-27T\n${JSON.stringify({ not: "a transition" })}\n${rest.join("\n")}\n`;
    const quality = planQuality(recorded(torn));
    expect(quality?.plan.done, "every DONE is still read").toBe(4);
    expect(quality?.plan.work_ms).toBe(minutes(147));
    expect(quality?.unreadable, "the glued pair's line, the fragment, and the object that is not a transition").toBe(3);
    expect(renderStatus(recorded(torn)), "and status says so").toContain("  3 lines of transitions.jsonl could not be read, and are not counted.");
  });

  it("names no build where the approval was given before builds were recorded", () => {
    const root = recorded(RECORDED);
    const file = path.join(stateDir(root), "plan", "approval.json");
    const older = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    delete older["builds"];
    delete older["pack_hash"];
    writeTree(root, {
      ".detent/plan/approval.json": `${JSON.stringify(older)}\n`,
      /* What PRESENT recorded since is not what the approval was given for. */
      ".detent/plan/presentation.json": `${JSON.stringify({ schema_version: SCHEMA_VERSION, presentation: "p", plan_hash: "a".repeat(64), spec_defects: 0, check_failures: 0, builds: ["3.1.0+cccccccccccc"], pack_hash: null })}\n`,
    });
    expect(planQuality(root)?.made).toBeNull();
    expect(renderStatus(root)).toContain("the builds that made it are not recorded");
  });

  it("has nothing to say where there is no plan", () => {
    const root = tmpTree();
    roots.push(root);
    expect(planQuality(root)).toBeNull();
  });
});

describe("PRDR-297: `detent status` shows the outcomes, per plan and per slice, and what each phase cost (N-5″)", () => {
  it("lists the plan's figures, what made it, each slice's, and init's spend by phase, with no internal state name", () => {
    const text = renderStatus(recorded(RECORDED));
    expect(text).toContain("Run-time outcomes (N-5″) — reported, and nothing stops for them:");
    expect(text).toContain(
      "  plan  6 tickets: 4 done, 3 in their first generation · 3 escalated to you · falsified: 1 premise, 1 oversized, 1 dependency · 1 budget breach · 5 review rounds · $7.4000 · 2h 27m at work",
    );
    expect(text).toContain(`        made by 3.1.0+aaaaaaaaaaaa, 3.1.0+bbbbbbbbbbbb, from pack ${PACK.slice(0, 12)}`);
    expect(text).toContain("  s01  catalog — 3 tickets: 3 done, 2 in their first generation · 1 escalated to you");
    expect(text).toContain("  s02  billing — 2 tickets: 0 done, 0 in their first generation · 2 escalated to you");
    expect(text).toContain("  outside any slice — 1 ticket: 1 done, 1 in their first generation");
    /* The last criterion: what each specification phase and planning cost, with no cap. */
    expect(text).toContain("What `init` has spent on this root, by phase — reported, and nothing stops for it (X-1, C-7‴):");
    expect(text).toMatch(/^ {2}planning {3}\$3\.0000 {2}1 session$/mu);
    for (const state of STATES) expect(text, `status leaked ${state}`).not.toContain(state);
  });

  it("says why, and still lists the tickets, where the ledger cannot be read", () => {
    const root = recorded(RECORDED, { ".detent/ledger.jsonl": `${JSON.stringify({ not: "a row" })}\n` });
    const text = renderStatus(root);
    expect(text).toContain("Run-time outcomes and spend are not shown:");
    expect(text).toContain("not a ledger row");
  });
});

describe("PRDR-297: a run ends by recording the plan's outcomes (N-5″)", () => {
  it("appends them to the run's journal with the build that ran it, as the figures status shows", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1" });
    addTicket(root, { id: "t2" });
    writeArtifact(root, "plan/plan.json", { tickets: ["t1", "t2"], slices: [{ id: "s01", title: "all", tickets: ["t1", "t2"] }] });
    approveFixturePlan(root);
    const backend = new MockBackend({
      "t1:implement": implementGreen,
      "t2:implement": implementRed,
      blind_fix: noopFix,
      research: researchValid,
      informed_fix: noopFix,
      review: reviewApprove,
    });
    await run({ root, backend, prompts: loadPromptSet(), runId: "quality" });

    const journal = readFileSync(path.join(stateDir(root), "runs", "run", "journal.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const last = journal.at(-1) ?? {};
    expect(last["event"], "the record is the run's last word, as its config is its first").toBe("plan_quality");
    expect(last["run_build"]).toBe(detentBuild());
    const quality = planQuality(root);
    expect(last["plan"]).toEqual(quality?.plan);
    expect(quality?.tickets.find((t) => t.ticket === "t1")).toMatchObject({ done: true, first_generation: true, escalations: 0, review_rounds: 1 });
    expect(quality?.tickets.find((t) => t.ticket === "t2")).toMatchObject({ done: false, escalations: 1 });
  }, 60_000);
});
