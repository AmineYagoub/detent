import { describe, expect, it } from "vitest";
import { PLAN_REVIEW_SAMPLES } from "../../src/init/plan-review.js";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runInit } from "../../src/init/machine.js";
import { MockBackend, okResult } from "../../src/sessions/mock.js";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { allTickets, readTicket } from "../../src/kernel/tickets/readers.js";
import { CLEAN_AUDIT, planningPipeline, BUDGETS, LONE_CANDIDATE, PROMPTS, repo } from "./plan-fixture.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";

/**
 * C-2‴ at the size it was built for.
 *
 * The unit tests prove the mechanism on two slices; nothing there would catch
 * a graph that only degenerates at scale — a cycle introduced by capstone
 * blockers across twenty-five slices, a blocker naming a ticket that was
 * renamed, an id scheme that collides at three digits. This rehearses a
 * five-hundred-ticket product end to end and checks the written graph is one
 * `run` can actually execute: every blocker resolves, and a topological sort
 * consumes every ticket, which is the same thing as saying there is no cycle.
 */

const N_SLICES = 25;
const PER_SLICE = 20;

const SLICES = Array.from({ length: N_SLICES }, (_, i) => ({
  id: `s${String(i + 1).padStart(2, "0")}`,
  title: `slice ${i + 1}`,
  goal: "it works end to end",
  requirement_ids: [`R${i + 1}`],
  baseline_items: i === 0 ? ["PB-001", "PB-012"] : [],
  docs: ["PRD.md"],
  depends_on: i === 0 ? [] : [`s${String(i).padStart(2, "0")}`],
  rationale: "",
}));

/** What a slice's first ticket names so the slice's requirement ids and baseline items are covered (A-1⁷). */
const covers = (inputs: Record<string, unknown>): { requirement_ids: string[]; baseline_ids: string[] } => {
  const slice = inputs["slice"] as { requirement_ids: string[]; baseline_items: string[] };
  return { requirement_ids: slice.requirement_ids, baseline_ids: slice.baseline_items };
};

/** A planner that drafts a full slice each time, chaining the first ticket to the previous slice's last. */
function scaledPlanner(seen: { stage: string; kb: number }[]) {
  return (spec: SessionSpec) => {
    const inputs = (JSON.parse(spec.promptVariable) as { inputs: Record<string, unknown> }).inputs;
    const stage = String(inputs["stage"]);
    seen.push({ stage: stage === "REVIEW_PLAN" ? `REVIEW:${String(inputs["scope"])}` : stage, kb: spec.promptVariable.length / 1024 });

    let artifact: object;
    if (spec.artifactOut.endsWith("slices.json")) artifact = { schema_version: SCHEMA_VERSION, slices: SLICES };
    else if (spec.artifactOut.endsWith("plan-draft.json")) {
      const id = (inputs["slice"] as { id: string }).id;
      const index = (inputs["plan_index"] as { id: string }[] | undefined) ?? [];
      const previous = index.length > 0 ? [index[index.length - 1]!.id] : [];
      artifact = {
        schema_version: SCHEMA_VERSION,
        tickets: Array.from({ length: PER_SLICE }, (_, j) => ({
          id: `t-${id}-${String(j + 1).padStart(3, "0")}`,
          type: "feature",
          title: `${id} ticket ${j + 1}: wire the ${id} handler and its persistence path`,
          /**
           * PRDR-143: REALISTIC content. These carried `description: ""` and a
           * single "it works" criterion, and the assertion below is described
           * by this file as "the tripwire" for the largest paid session in the
           * product. The `< 400 KB` bound passed only because the fixture
           * carried nothing; a tripwire calibrated on a payload the product
           * cannot produce is not a tripwire.
           *
           * PRDR-160: the numbers that were here — 171.9 KB empty, 465 KB
           * realistic — were wrong, and the file gave two different values for
           * the same measurement. See the table at the assertions below, which
           * records what this fixture actually produces.
           */
          description:
            `Implement the ${id} handler so the request path terminates in a persisted record, ` +
            "including the validation the interface contract names and the error mapping the caller expects.",
          acceptance_criteria: [
            "the handler persists a record and returns its id",
            "an invalid payload is rejected with the mapped error, not a 500",
            "the persistence path is covered by a test that fails without it",
          ],
          non_goals: ["no migration of existing records", "no changes to the public schema"],
          surface: ["src/**", "tests/**"],
          depends_on: j === 0 ? previous : [`t-${id}-${String(j).padStart(3, "0")}`],
          /* PRDR-293: the first ticket carries the slice's ids and baseline items, as A-1⁷'s coverage check asks. */
          ...(j === 0 ? covers(inputs) : {}),
          risk_label: false,
        })),
      };
    } else if (spec.artifactOut.endsWith("plan-review.json")) artifact = { schema_version: SCHEMA_VERSION, verdict: "approve", findings: [] };
    else throw new Error(`the planner was asked for ${spec.artifactOut}, which no planning stage writes`);

    writeFileSync(spec.artifactOut, `${JSON.stringify(artifact)}\n`);
    return okResult();
  };
}

/** A smaller pack, for the crash-and-resume rehearsal. */
const TEN = Array.from({ length: 10 }, (_, i) => ({
  id: `s${String(i + 1).padStart(2, "0")}`,
  title: `slice ${i + 1}`,
  goal: "g",
  requirement_ids: [`R${i + 1}`],
  baseline_items: [],
  docs: ["PRD.md"],
  depends_on: i === 0 ? [] : [`s${String(i).padStart(2, "0")}`],
  rationale: "",
}));

/** As above, but it dies on one named slice — a crashed session, a tripped ceiling, a dropped connection. */
function fragilePlanner(drafted: string[], dieOn: string | null) {
  return (spec: SessionSpec) => {
    const inputs = (JSON.parse(spec.promptVariable) as { inputs: Record<string, unknown> }).inputs;
    let artifact: object;
    if (spec.artifactOut.endsWith("slices.json")) artifact = { schema_version: SCHEMA_VERSION, slices: TEN };
    else if (spec.artifactOut.endsWith("plan-draft.json")) {
      const id = (inputs["slice"] as { id: string }).id;
      drafted.push(id);
      if (id === dieOn) throw new Error("simulated session failure");
      artifact = {
        schema_version: SCHEMA_VERSION,
        tickets: [{ id: `t-${id}-001`, type: "feature", title: id, description: "", acceptance_criteria: ["x"], non_goals: [], surface: ["src/**"], depends_on: [], ...covers(inputs), risk_label: false }],
      };
    } else if (spec.artifactOut.endsWith("plan-review.json")) artifact = { schema_version: SCHEMA_VERSION, verdict: "approve", findings: [] };
    else throw new Error(`the planner was asked for ${spec.artifactOut}, which no planning stage writes`);
    writeFileSync(spec.artifactOut, `${JSON.stringify(artifact)}\n`);
    return okResult();
  };
}

describe("C-2‴ at product scale", () => {
  it("plans twenty-five slices into five hundred tickets and writes a graph `run` can execute", async () => {
    const root = repo(LONE_CANDIDATE);
    const seen: { stage: string; kb: number }[] = [];
    const backend = new MockBackend({ audit: CLEAN_AUDIT,  planner: scaledPlanner(seen) });

    const result = await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));
    expect(result.interrupt?.interrupt).toBe("AWAIT_APPROVAL");

    const tickets = allTickets(root);
    expect(tickets).toHaveLength(N_SLICES * PER_SLICE);

    /** Every blocker names a ticket that exists — a dangling one deadlocks the pool forever. */
    const ids = new Set(tickets.map((t) => t.id));
    for (const t of tickets) for (const b of t.blockers) expect(ids.has(b), `${t.id} is blocked on unknown ${b}`).toBe(true);

    /** No cycle: a topological sort must consume every ticket, or some are unreachable for the whole run. */
    const indegree = new Map(tickets.map((t) => [t.id, t.blockers.length]));
    const unblocks = new Map<string, string[]>();
    for (const t of tickets) for (const b of t.blockers) unblocks.set(b, [...(unblocks.get(b) ?? []), t.id]);
    const queue = tickets.filter((t) => t.blockers.length === 0).map((t) => t.id);
    let drained = 0;
    while (queue.length > 0) {
      const id = queue.shift() as string;
      drained += 1;
      for (const next of unblocks.get(id) ?? []) {
        const left = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, left);
        if (left === 0) queue.push(next);
      }
    }
    expect(drained, "the blocker graph contains a cycle").toBe(tickets.length);

    /** Slice order survives: the last slice's first ticket cannot be claimed at the start. */
    expect(readTicket(root, "t-s25-001").blockers.length).toBeGreaterThan(0);
    expect(readTicket(root, "t-s01-001").blockers).toEqual([]);

    const plan = JSON.parse(readFileSync(path.join(root, ".detent", "plan", "plan.json"), "utf8")) as {
      slices: { id: string; tickets: string[] }[];
      tickets: string[];
    };
    expect(plan.slices).toHaveLength(N_SLICES);
    expect(plan.slices.flatMap((s) => s.tickets)).toHaveLength(N_SLICES * PER_SLICE);
    expect(plan.tickets).toHaveLength(N_SLICES * PER_SLICE);

    /**
     * The session count and the input growth are the run's real cost, so they
     * are asserted rather than left to be discovered on a paid run: one
     * SLICE, and one draft and its reviews per slice.
     */
    const count = (stage: string): number => seen.filter((s) => s.stage === stage).length;
    expect(count("PLAN")).toBe(N_SLICES);
    /* C-4⁗″: k draws per slice — the cost this ticket buys, made visible at scale. */
    expect(count("REVIEW:slice")).toBe(N_SLICES * PLAN_REVIEW_SAMPLES);
    /* PRDR-293: no session reads the plan as one thing; code's checks across the plan stand in its place. */
    expect(count("REVIEW:whole")).toBe(0);
    /**
     * C-4⁗″ (PRDR-200): the price, in one number.
     *
     * SLICE + (PLAN + k reviews) per slice. At twenty-five slices that is 101
     * sessions; the whole-plan review made it 102 until PRDR-293 deleted it. A
     * slice that needs no revision costs four sessions, which is the cost of
     * not handing the reviser findings no second read saw, and it belongs in
     * the test that exists to price product scale. A plan that passes A-1⁷'s
     * checks buys no redraft, so this fixture, whose drafts pass, prices none.
     */
    expect(seen).toHaveLength(1 + N_SLICES * (1 + PLAN_REVIEW_SAMPLES));

    /**
     * No stage carries every ticket in full since PRDR-293 deleted the
     * whole-plan review, which did, and grew with the product to 484 KB here.
     * What still grows with the product is the index of earlier tickets a
     * slice's draft and review are handed, so the widest payloads are theirs,
     * and this is the tripwire.
     */
    const widest = (stage: string): number => Math.max(...seen.filter((s) => s.stage === stage).map((s) => s.kb));
    /**
     * PRDR-160: every number below was measured through this test's own
     * instrumentation, at 500 tickets, on one machine; PRDR-293 measured them
     * again when it deleted the whole-plan review's row (484.11 KB of a 600 KB
     * bound).
     *
     *   stage          this fixture   bound   % of bound
     *   SLICE              7.42 KB    < 50       14.8%
     *   PLAN             106.17 KB   < 150       70.8%
     *   REVIEW:slice     127.10 KB   < 200       63.6%
     *
     * PRDR-143 gave this fixture realistic content — a description, three
     * criteria, two non-goals — where it had carried an empty description and a
     * single "it works" criterion. PLAN's index holds each earlier ticket's id,
     * title, surface and what it provides, which that content does not reach.
     */
    expect(widest("SLICE")).toBeLessThan(50);
    /** 70.8% of its bound: the payload nearest its bound. */
    expect(widest("PLAN")).toBeLessThan(150);
    /**
     * PRDR-160: this payload was asserted by nothing — in the file that calls
     * itself the tripwire — and grew 8% unwatched when the fixture grew.
     */
    expect(widest("REVIEW:slice")).toBeLessThan(200);
  }, 120_000);

  it("a failure nine slices in costs those nine slices nothing: the re-run re-plans the one that died and the ones after it", async () => {
    const root = repo(LONE_CANDIDATE);

    const first: string[] = [];
    await expect(
      runInit(root, planningPipeline({ root, backend: new MockBackend({ audit: CLEAN_AUDIT,  planner: fragilePlanner(first, "s07") }), prompts: PROMPTS, budgets: BUDGETS })),
    ).rejects.toThrow(/simulated session failure/);
    expect(first).toEqual(["s01", "s02", "s03", "s04", "s05", "s06", "s07"]);

    const second: string[] = [];
    const result = await runInit(
      root,
      planningPipeline({ root, backend: new MockBackend({ audit: CLEAN_AUDIT,  planner: fragilePlanner(second, null) }), prompts: PROMPTS, budgets: BUDGETS }),
    );

    /** The six slices that finished are reused from their caches; analysis and slicing from their checkpoints. */
    expect(second).toEqual(["s07", "s08", "s09", "s10"]);
    expect(result.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
    expect(allTickets(root)).toHaveLength(10);
  }, 120_000);
});
