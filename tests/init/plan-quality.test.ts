import { describe, expect, it } from "vitest";
import { runInit } from "../../src/init/machine.js";
import { buildPipeline } from "../../src/init/pipeline.js";
import { allTickets, readTicket } from "../../src/kernel/tickets/readers.js";
import { writeTicket } from "../../src/kernel/tickets/mutations.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { ANALYSIS, BUDGETS, DRAFT, LONE_CANDIDATE, PROMPTS, planner, repo } from "./plan-fixture.js";

/**
 * Planning QUALITY, as distinct from the pipeline's mechanics: the planner
 * sizes against its budget (PRDR-081), a changed prompt re-derives the phase
 * (PRDR-082), the plan faces its own review (PRDR-084), and `--replan` means a
 * fresh planning session that protects finished work (PRDR-085).
 */

describe("PRDR-081 the planner sizes against the budget that will execute it", () => {
  it("PLAN receives session_budget: the implement turns, wall clock, and generation ceiling", async () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({ planner: planner(ANALYSIS(null), DRAFT(["t-100"])) });
    await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    const planCall = backend.calls.find((c) => {
      const variable = JSON.parse(c.spec.promptVariable) as { inputs?: Record<string, unknown> };
      return variable.inputs?.["expected_output"] !== undefined && variable.inputs?.["bound_slots"] !== undefined;
    });
    expect(planCall, "no PLAN session launched").toBeDefined();
    const inputs = (JSON.parse(planCall!.spec.promptVariable) as { inputs: Record<string, unknown> }).inputs;
    expect(inputs["session_budget"]).toEqual({
      implement_turns: BUDGETS.turns_per_stage,
      ticket_wall_clock_minutes: Math.round(BUDGETS.ticket_wall_clock_ms / 60_000),
      sessions_per_generation: BUDGETS.sessions,
    });
  });
});

describe("PRDR-082 a changed prompt invalidates its phase checkpoint (C-8)", () => {
  it("PLAN's digest moves when the planner prompt changes, and not when another role's does", () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({});
    const ctx = {
      outputs: {
        ANALYZE: { analysis: { summary: "s" } },
        DETERMINE_VERIFICATION: { bindings: [{ slot: "test", resolved: "npm test" }] },
      },
    };
    const digestWith = (hashes: Record<string, string>): string => {
      const handlers = buildPipeline({
        root,
        backend,
        prompts: { ...PROMPTS, hashes: { ...PROMPTS.hashes, ...hashes } },
        budgets: BUDGETS,
      });
      const plan = handlers.find((h) => h.phase === "PLAN");
      if (plan === undefined) throw new Error("no PLAN handler");
      return plan.digest(ctx as never);
    };

    const base = digestWith({});
    expect(digestWith({ planner: "0".repeat(64) }), "planner change must re-derive").not.toBe(base);
    expect(digestWith({ review: "0".repeat(64) }), "an unrelated role must NOT re-derive").toBe(base);
  });
});

describe("PRDR-084 the plan gets its own D-6 review", () => {
  const inputsOf = (backend: MockBackend, artifact: string): Record<string, unknown>[] =>
    backend.calls
      .filter((c) => c.spec.artifactOut.endsWith(artifact))
      .map((c) => (JSON.parse(c.spec.promptVariable) as { inputs: Record<string, unknown> }).inputs);

  it("a drafted plan is reviewed by a fresh session against the closed criteria", async () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({ planner: planner(ANALYSIS(null), DRAFT(["t-100"])) });
    await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    const reviews = inputsOf(backend, "plan-review.json");
    expect(reviews, "no REVIEW_PLAN session launched").toHaveLength(1);
    expect(reviews[0]?.["stage"]).toBe("REVIEW_PLAN");
    expect(reviews[0]?.["plan"]).toBeDefined();
    expect(reviews[0]?.["session_budget"]).toBeDefined();
  });

  it("approve writes the draft as-is — exactly one drafting session", async () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({ planner: planner(ANALYSIS(null), DRAFT(["t-100", "t-200"])) });
    await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    expect(inputsOf(backend, "plan-draft.json")).toHaveLength(1);
    expect(allTickets(root).map((t) => t.id).sort()).toEqual(["t-100", "t-200"]);
  });

  it("changes buys exactly ONE revision, and the findings reach the redraft", async () => {
    const root = repo(LONE_CANDIDATE);
    const changes = {
      schema_version: 1,
      verdict: "changes",
      findings: [{ tag: "sizing", finding: "t-100 spans three subsystems", ticket: "t-100" }],
    };
    const backend = new MockBackend({ planner: planner(ANALYSIS(null), DRAFT(["t-100"]), changes) });
    await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    const drafts = inputsOf(backend, "plan-draft.json");
    /** One original + one revision. Never a third: PLAN_REVISIONS is 1 (D-24's argument). */
    expect(drafts).toHaveLength(2);
    expect(drafts[0]?.["review_findings"], "the first draft has no findings yet").toBeUndefined();
    expect(drafts[1]?.["review_findings"]).toEqual(changes.findings);
  });
});

describe("PRDR-086 plan_docs scopes planning to the increment", () => {
  it("narrows discovery to the declared slice, leaving the rest of the docs unread", async () => {
    const root = repo({
      ...LONE_CANDIDATE,
      "docs/prd/01-everything.md": "# the whole product\n",
      "docs/design/adr-001.md": "# a decision\n",
      "docs/slices/slice-01.md": "# just this slice\n",
    });
    const backend = new MockBackend({ planner: planner(ANALYSIS(null), DRAFT(["t-100"])) });
    await runInit(
      root,
      buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS, planDocs: ["docs/slices/*.md"] }),
    );

    const analyze = backend.calls
      .map((c) => (JSON.parse(c.spec.promptVariable) as { inputs: Record<string, unknown> }).inputs)
      .find((i) => i["docs"] !== undefined && i["expected_output"] !== undefined);
    expect(analyze?.["docs"], "only the slice reaches the planner").toEqual(["docs/slices/slice-01.md"]);
  });

  it("empty plan_docs keeps the full C-2 discovery", async () => {
    const root = repo({ ...LONE_CANDIDATE, "docs/prd/01-everything.md": "# the whole product\n" });
    const backend = new MockBackend({ planner: planner(ANALYSIS(null), DRAFT(["t-100"])) });
    await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    const analyze = backend.calls
      .map((c) => (JSON.parse(c.spec.promptVariable) as { inputs: Record<string, unknown> }).inputs)
      .find((i) => i["docs"] !== undefined && i["expected_output"] !== undefined);
    expect(analyze?.["docs"]).toEqual(expect.arrayContaining(["PRD.md", "docs/prd/01-everything.md"]));
  });
});

describe("PRDR-085 --replan means a fresh planning session", () => {
  it("DONE tickets are preserved, and tickets the new plan drops are removed", async () => {
    const root = repo(LONE_CANDIDATE);
    const first = new MockBackend({ planner: planner(ANALYSIS(null), DRAFT(["t-100", "t-200", "t-300"])) });
    await runInit(root, buildPipeline({ root, backend: first, prompts: PROMPTS, budgets: BUDGETS }));
    expect(allTickets(root).map((t) => t.id).sort()).toEqual(["t-100", "t-200", "t-300"]);

    /* t-100 finished; the others never started. */
    writeTicket(root, { ...readTicket(root, "t-100"), state: "DONE" });

    /* A replan that no longer contains t-200/t-300 — and re-drafts t-100. */
    const second = new MockBackend({ planner: planner(ANALYSIS(null), DRAFT(["t-100", "t-400"])) });
    await runInit(root, buildPipeline({ root, backend: second, prompts: PROMPTS, budgets: BUDGETS }), { replan: true });

    const after = allTickets(root);
    expect(after.map((t) => t.id).sort()).toEqual(["t-100", "t-400"]);
    /* DONE work is never re-planned back to READY. */
    expect(after.find((t) => t.id === "t-100")?.state).toBe("DONE");
  });

  it("refuses while a ticket is in flight, before spending anything", async () => {
    const root = repo(LONE_CANDIDATE);
    const first = new MockBackend({ planner: planner(ANALYSIS(null), DRAFT(["t-100"])) });
    await runInit(root, buildPipeline({ root, backend: first, prompts: PROMPTS, budgets: BUDGETS }));
    writeTicket(root, { ...readTicket(root, "t-100"), state: "IN_PROGRESS" });

    const second = new MockBackend({ planner: planner(ANALYSIS(null), DRAFT(["t-999"])) });
    const result = await runInit(root, buildPipeline({ root, backend: second, prompts: PROMPTS, budgets: BUDGETS }), {
      replan: true,
    });

    expect(result.exitCode).toBe(2);
    expect(result.messages.join(" ")).toContain("t-100 (IN_PROGRESS)");
    expect(second.calls, "refused BEFORE any session launched").toHaveLength(0);
    expect(allTickets(root).map((t) => t.id)).toEqual(["t-100"]);
  });
});
