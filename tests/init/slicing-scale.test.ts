import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildPipeline } from "../../src/init/pipeline.js";
import { runInit } from "../../src/init/machine.js";
import { MockBackend, okResult } from "../../src/sessions/mock.js";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { allTickets, readTicket } from "../../src/kernel/tickets/readers.js";
import { ANALYSIS, BUDGETS, LONE_CANDIDATE, PROMPTS, repo } from "./plan-fixture.js";

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
  expected_tickets: PER_SLICE,
  rationale: "",
}));

/** A planner that drafts a full slice each time, chaining the first ticket to the previous slice's last. */
function scaledPlanner(seen: { stage: string; kb: number }[]) {
  return (spec: SessionSpec) => {
    const inputs = (JSON.parse(spec.promptVariable) as { inputs: Record<string, unknown> }).inputs;
    const stage = String(inputs["stage"] ?? "ANALYZE");
    seen.push({ stage: stage === "REVIEW_PLAN" ? `REVIEW:${String(inputs["scope"])}` : stage, kb: spec.promptVariable.length / 1024 });

    let artifact: object;
    if (spec.artifactOut.endsWith("slices.json")) artifact = { schema_version: 1, slices: SLICES, questions: [] };
    else if (spec.artifactOut.endsWith("plan-draft.json")) {
      const id = (inputs["slice"] as { id: string }).id;
      const index = (inputs["plan_index"] as { id: string }[] | undefined) ?? [];
      const previous = index.length > 0 ? [index[index.length - 1]!.id] : [];
      artifact = {
        schema_version: 1,
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
          risk_label: false,
        })),
        questions: [],
      };
    } else if (spec.artifactOut.endsWith("plan-review.json")) artifact = { schema_version: 1, verdict: "approve", findings: [] };
    else artifact = ANALYSIS(null);

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
  expected_tickets: 2,
  rationale: "",
}));

/** As above, but it dies on one named slice — a crashed session, a tripped ceiling, a dropped connection. */
function fragilePlanner(drafted: string[], dieOn: string | null) {
  return (spec: SessionSpec) => {
    const inputs = (JSON.parse(spec.promptVariable) as { inputs: Record<string, unknown> }).inputs;
    let artifact: object;
    if (spec.artifactOut.endsWith("slices.json")) artifact = { schema_version: 1, slices: TEN, questions: [] };
    else if (spec.artifactOut.endsWith("plan-draft.json")) {
      const id = (inputs["slice"] as { id: string }).id;
      drafted.push(id);
      if (id === dieOn) throw new Error("simulated session failure");
      artifact = {
        schema_version: 1,
        tickets: [{ id: `t-${id}-001`, type: "feature", title: id, description: "", acceptance_criteria: ["x"], non_goals: [], surface: ["src/**"], depends_on: [], risk_label: false }],
        questions: [],
      };
    } else if (spec.artifactOut.endsWith("plan-review.json")) artifact = { schema_version: 1, verdict: "approve", findings: [] };
    else artifact = ANALYSIS(null);
    writeFileSync(spec.artifactOut, `${JSON.stringify(artifact)}\n`);
    return okResult();
  };
}

describe("C-2‴ at product scale", () => {
  it("plans twenty-five slices into five hundred tickets and writes a graph `run` can execute", async () => {
    const root = repo(LONE_CANDIDATE);
    const seen: { stage: string; kb: number }[] = [];
    const backend = new MockBackend({ planner: scaledPlanner(seen) });

    const result = await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));
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
     * ANALYZE, one SLICE, one draft and one review per slice, one whole review.
     */
    const count = (stage: string): number => seen.filter((s) => s.stage === stage).length;
    expect(count("PLAN")).toBe(N_SLICES);
    expect(count("REVIEW:slice")).toBe(N_SLICES);
    expect(count("REVIEW:whole")).toBe(1);
    expect(seen).toHaveLength(2 + N_SLICES * 2 + 1);

    /**
     * The whole-plan review carries every ticket, so its input grows with the
     * product while every other stage stays slice-sized. It is the first thing
     * that will strain a context window, and this is the tripwire.
     */
    const widest = (stage: string): number => Math.max(...seen.filter((s) => s.stage === stage).map((s) => s.kb));
    /**
     * PRDR-160: every number below was measured through this test's own
     * instrumentation, at 500 tickets, on one machine. The prior figures were
     * recorded from nothing reproducible and were wrong by a third.
     *
     *   stage          this fixture   prior shape   bound   % of bound
     *   ANALYZE            1.51 KB       1.51 KB      —         —
     *   SLICE              8.00 KB       8.00 KB    < 50       16%
     *   PLAN             106.64 KB     106.64 KB   < 150     71.1%
     *   REVIEW:slice     125.39 KB     116.25 KB   < 200     62.7%
     *   REVIEW:whole     484.11 KB     255.59 KB   < 600     80.7%
     *
     * "Prior shape" is this fixture with `description: ""`, a single "it works"
     * criterion and no non-goals — the content PRDR-143 replaced. Reproduce it
     * by making those three edits and re-running. Note that PLAN does not move
     * between the two: its payload is titles and ids, which PRDR-143 did not
     * change.
     */
    expect(widest("SLICE")).toBeLessThan(50);
    /** 71.1% of its bound. The next content increase reaches it before REVIEW:whole reaches 600. */
    expect(widest("PLAN")).toBeLessThan(150);
    /**
     * PRDR-160: the second-largest payload, and it was asserted by nothing —
     * in the file that calls itself the tripwire. Only REVIEW:whole was
     * re-baselined when the fixture grew, so this one grew 8% unwatched.
     */
    expect(widest("REVIEW:slice")).toBeLessThan(200);
    /**
     * PRDR-143: ~484 KB is roughly 120k tokens of JSON in one prompt variable.
     *
     * The number is recorded rather than merely raised, because it is a
     * PRODUCT limit and not a test parameter: the whole-plan review is the one
     * stage whose input grows with the entire product, and at this scale it is
     * approaching what a single session can hold. The gate's own plan is ~205
     * tickets (~200 KB), so there is headroom today. Making the review
     * incremental — or scoping it to the slices a finding names — is the real
     * answer, and it belongs with PRDR-144.
     */
    expect(widest("REVIEW:whole")).toBeLessThan(600);
  }, 120_000);

  it("a failure nine slices in costs those nine slices nothing: the re-run re-plans the one that died and the ones after it", async () => {
    const root = repo(LONE_CANDIDATE);

    const first: string[] = [];
    await expect(
      runInit(root, buildPipeline({ root, backend: new MockBackend({ planner: fragilePlanner(first, "s07") }), prompts: PROMPTS, budgets: BUDGETS })),
    ).rejects.toThrow(/simulated session failure/);
    expect(first).toEqual(["s01", "s02", "s03", "s04", "s05", "s06", "s07"]);

    const second: string[] = [];
    const result = await runInit(
      root,
      buildPipeline({ root, backend: new MockBackend({ planner: fragilePlanner(second, null) }), prompts: PROMPTS, budgets: BUDGETS }),
    );

    /** The six slices that finished are reused from their caches; analysis and slicing from their checkpoints. */
    expect(second).toEqual(["s07", "s08", "s09", "s10"]);
    expect(result.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
    expect(allTickets(root)).toHaveLength(10);
  }, 120_000);
});
