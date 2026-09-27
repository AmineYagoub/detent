import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLAN_REVIEW_SAMPLES } from "../../src/init/plan-review.js";
import { stateDir } from "../../src/fs/layout.js";
import { runInit } from "../../src/init/machine.js";
import { allTickets, readTicket } from "../../src/kernel/tickets/readers.js";
import { writeTicket } from "../../src/kernel/tickets/mutations.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { CLEAN_AUDIT, planningPipeline, APPROVE_PLAN, BUDGETS, DRAFT, LONE_CANDIDATE, ONE_SLICE, PROMPTS, planner, repo } from "./plan-fixture.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";

/**
 * Planning QUALITY, as distinct from the pipeline's mechanics: the planner
 * sizes against its budget (PRDR-081), a changed prompt re-derives the phase
 * (PRDR-082), the plan faces its own review (PRDR-084), and `--replan` means a
 * fresh planning session that protects finished work (PRDR-085).
 */

describe("PRDR-081 the planner sizes against the budget that will execute it", () => {
  it("PLAN receives session_budget: the implement turns, wall clock, and generation ceiling", async () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({ audit: CLEAN_AUDIT,  planner: planner(DRAFT(["t-100"])) });
    await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

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

describe("PRDR-101 the drafted non_goals reach the written ticket", () => {
  /**
   * The draft always carried `non_goals`; the createTicket call in plan.ts did
   * not copy it, and the schema defaults it to `[]`. So every ticket in every
   * plan reached the implementer and the reviewer with its boundaries stripped,
   * silently, because an empty list is legal. Measured on Detent's own plan:
   * the draft had them on 65 of 65 tickets, the written plan on 1 of 66.
   *
   * No test caught it because the shared fixture drafts `non_goals: []`. This
   * one drafts a non-empty list on purpose.
   */
  it("a non-empty non_goals survives the draft-to-ticket write", async () => {
    const root = repo(LONE_CANDIDATE);
    const draft = DRAFT(["t-100"]) as { tickets: { non_goals: string[] }[] };
    draft.tickets[0]!.non_goals = ["not the CLI wiring — that is t-101", "no persistence"];
    const backend = new MockBackend({ audit: CLEAN_AUDIT,  planner: planner(draft) });
    await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    expect(readTicket(root, "t-100").non_goals).toEqual([
      "not the CLI wiring — that is t-101",
      "no persistence",
    ]);
  });

  it("an honestly empty non_goals stays empty, not undefined", async () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({ audit: CLEAN_AUDIT,  planner: planner(DRAFT(["t-100"])) });
    await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));
    expect(readTicket(root, "t-100").non_goals).toEqual([]);
  });
});

describe("PRDR-082 a changed prompt invalidates its phase checkpoint (C-8)", () => {
  it("PLAN's digest moves when the planner prompt changes, and not when another role's does", () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({ audit: CLEAN_AUDIT, });
    const ctx = {
      outputs: {
        DETERMINE_VERIFICATION: { bindings: [{ slot: "test", resolved: "npm test" }] },
      },
    };
    const digestWith = (hashes: Record<string, string>): string => {
      const handlers = planningPipeline({
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
    const backend = new MockBackend({ audit: CLEAN_AUDIT,  planner: planner(DRAFT(["t-100"])) });
    await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    const reviews = inputsOf(backend, "plan-review.json");
    /* C-4⁗″: the review is DRAWN k times; this test's subject is that a fresh session gets the plan. */
    expect(reviews, "no REVIEW_PLAN session launched").toHaveLength(PLAN_REVIEW_SAMPLES);
    expect(reviews[0]?.["stage"]).toBe("REVIEW_PLAN");
    expect(reviews[0]?.["plan"]).toBeDefined();
    expect(reviews[0]?.["session_budget"]).toBeDefined();
  });

  it("approve writes the draft as-is — exactly one drafting session", async () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({ audit: CLEAN_AUDIT,  planner: planner(DRAFT(["t-100", "t-200"])) });
    await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    expect(inputsOf(backend, "plan-draft.json")).toHaveLength(1);
    expect(allTickets(root).map((t) => t.id).sort()).toEqual(["t-100", "t-200"]);
  });

  it("changes buys exactly ONE revision, and the findings reach the redraft", async () => {
    const root = repo(LONE_CANDIDATE);
    const changes = {
      schema_version: SCHEMA_VERSION,
      verdict: "changes",
      findings: [{ tag: "sizing", finding: "t-100 spans three subsystems", ticket: "t-100" }],
    };
    const backend = new MockBackend({ audit: CLEAN_AUDIT,  planner: planner(DRAFT(["t-100"]), changes) });
    await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    const drafts = inputsOf(backend, "plan-draft.json");
    /** One original + one revision. Never a third: PLAN_REVISIONS is 1 (D-24's argument). */
    expect(drafts).toHaveLength(2);
    expect(drafts[0]?.["review_findings"], "the first draft has no findings yet").toBeUndefined();
    expect(drafts[1]?.["review_findings"]).toEqual(changes.findings);
  });
});

describe("PRDR-088 init sessions are metered and leave a trail", () => {
  const rows = (root: string): Record<string, unknown>[] => {
    const file = path.join(stateDir(root), "ledger.jsonl");
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  };

  it("every init session writes an S-4 ledger row against the run ceiling", async () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({ audit: CLEAN_AUDIT,  planner: planner(DRAFT(["t-100"])) });
    await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    const ledger = rows(root);
    /** SLICE, PLAN and REVIEW_PLAN all bill; none of them used to. */
    expect(ledger.length, "init spend must reach the ledger").toBe(backend.calls.length);
    expect(ledger.every((r) => r["ticket"] === "init")).toBe(true);
    expect(ledger.map((r) => r["role"])).toContain("planner");
  });

  it("a failed init session leaves turns and the backend tail to diagnose it", async () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({ audit: CLEAN_AUDIT, 
      planner: () => ({ ...okResult(), ok: false, turns: 30, rawTail: "hit the turn ceiling" }),
    });
    await expect(
      runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS })),
    ).rejects.toThrow(/planner session failed/);

    const journal = readFileSync(path.join(stateDir(root), "runs", "init", "journal.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    /* PRDR-281: AUDIT's survey ends first, and well; the failure is the planner's. */
    const end = journal.find((e) => e["event"] === "end" && e["stage"] === "planner");
    expect(end?.["ok"]).toBe(false);
    expect(end?.["turns"], "turn count distinguishes exhaustion from refusal").toBe(30);
    expect(String(end?.["tail"])).toContain("turn ceiling");
  });

  /**
   * X-1⁵ (PRDR-191) replaces what this pair used to assert. A consumed TOTAL
   * gated every init launch, which is the failure mode the amendment names:
   * it fired on a run that had done nothing wrong. Both directions are asserted
   * because a control that stops firing must be shown to have stopped, and the
   * one that replaced it must be shown to fire.
   */
  it("a total already consumed no longer gates init (X-1⁵)", async () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({ audit: CLEAN_AUDIT,  planner: planner(DRAFT(["t-100"])) });
    mkdirSync(stateDir(root), { recursive: true });
    writeFileSync(
      path.join(stateDir(root), "ledger.jsonl"),
      `${JSON.stringify({ at: "2026-08-28T00:00:00.000Z", ticket: "init", generation: 0, role: "planner", cost_estimate_usd: 999, input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, turns: 1 })}\n`,
    );

    await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));
    expect(backend.calls.length, "a run resuming against history has completed nothing to be judged on").toBeGreaterThan(0);
  });

  /**
   * PRDR-265: the pair above and below used to be "the old control no longer
   * gates, the new one does". Both halves now say the same thing about the
   * route and differ in what they measure, which is the point — the advisory
   * total and the breaker are two figures about the same money, and neither
   * decides whether init continues. The breaker still has to FIRE, because a
   * count nobody is told is not a count.
   */
  it("spend with no slice completing is announced, and init runs on (X-1⁵)", async () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({ audit: CLEAN_AUDIT,  planner: planner(DRAFT(["t-100"])) });
    /*
     * A floor below one mock session's own $0.001 estimate. PRDR-281: AUDIT's
     * completion is the first unit, so what follows it is measured against its
     * cost times the multiple; a multiple this small leaves the floor to govern.
     */
    const budgets = {
      ...BUDGETS,
      spend_without_progress_floor_usd: 0.0001,
      spend_without_progress_sessions: 0.001,
      spend_without_progress_multiple: 0.001,
    };
    const notes: string[] = [];

    await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets, note: (t) => notes.push(t) }));
    expect(notes.join(" "), "money leaving with no slice finishing is still worth saying").toMatch(/no-progress breaker/);
    expect(
      notes.filter((t) => t.includes("no-progress breaker")),
      "and said ONCE for the episode, not on every launch after the first",
    ).toHaveLength(1);
    expect(backend.calls.length, "every launch proceeds — the figure orders nothing").toBeGreaterThan(1);
  });
});

describe("PRDR-087 a stale approval re-presents; it does not re-plan", () => {
  it("hand-edited tickets re-run PRESENT only — SLICE and PLAN are reused", async () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({ audit: CLEAN_AUDIT,  planner: planner(DRAFT(["t-100"])) });
    const deps = { root, backend, prompts: PROMPTS, budgets: BUDGETS };

    await runInit(root, planningPipeline(deps));
    writeFileSync(
      path.join(stateDir(root), "plan", "approval.json"),
      JSON.stringify({ schema_version: SCHEMA_VERSION, approved_by: "u", at: "2026-08-28T00:00:00.000Z", plan_hash: "stale" }),
    );

    const before = backend.calls.length;
    const again = await runInit(root, planningPipeline(deps));

    /**
     * The whole point: approving must not silently derive a DIFFERENT plan
     * from the one presented. Planning is a model act, so a re-derivation is
     * a new plan — and no model session may run here at all.
     */
    expect(backend.calls.length, "no planner session may re-run").toBe(before);
    expect(again.reused).toEqual(expect.arrayContaining(["SLICE", "PLAN"]));
    /* PRESENT ran and interrupted at AWAIT_APPROVAL — an interrupted phase is
     * deliberately not checkpointed, so it reports as the replay point rather
     * than as executed. */
    expect(again.replayedFrom).toBe("PRESENT");
    expect(again.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
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
    const backend = new MockBackend({ audit: CLEAN_AUDIT,  planner: planner(DRAFT(["t-100"])) });
    await runInit(
      root,
      planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS, planDocs: ["docs/slices/*.md"] }),
    );

    const analyze = backend.calls
      .map((c) => (JSON.parse(c.spec.promptVariable) as { inputs: Record<string, unknown> }).inputs)
      .find((i) => i["docs"] !== undefined && i["expected_output"] !== undefined);
    expect(analyze?.["docs"], "only the slice reaches the planner").toEqual(["docs/slices/slice-01.md"]);
  });

  it("empty plan_docs keeps the full C-2 discovery", async () => {
    const root = repo({ ...LONE_CANDIDATE, "docs/prd/01-everything.md": "# the whole product\n" });
    const backend = new MockBackend({ audit: CLEAN_AUDIT,  planner: planner(DRAFT(["t-100"])) });
    await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    const analyze = backend.calls
      .map((c) => (JSON.parse(c.spec.promptVariable) as { inputs: Record<string, unknown> }).inputs)
      .find((i) => i["docs"] !== undefined && i["expected_output"] !== undefined);
    expect(analyze?.["docs"]).toEqual(expect.arrayContaining(["PRD.md", "docs/prd/01-everything.md"]));
  });
});

describe("PRDR-085 --replan means a fresh planning session", () => {
  it("DONE tickets are preserved, and tickets the new plan drops are removed", async () => {
    const root = repo(LONE_CANDIDATE);
    const first = new MockBackend({ audit: CLEAN_AUDIT,  planner: planner(DRAFT(["t-100", "t-200", "t-300"])) });
    await runInit(root, planningPipeline({ root, backend: first, prompts: PROMPTS, budgets: BUDGETS }));
    expect(allTickets(root).map((t) => t.id).sort()).toEqual(["t-100", "t-200", "t-300"]);

    /* t-100 finished; the others never started. */
    writeTicket(root, { ...readTicket(root, "t-100"), state: "DONE" });

    /* A replan that no longer contains t-200/t-300 — and re-drafts t-100. */
    const second = new MockBackend({ audit: CLEAN_AUDIT,  planner: planner(DRAFT(["t-100", "t-400"])) });
    await runInit(root, planningPipeline({ root, backend: second, prompts: PROMPTS, budgets: BUDGETS }), { replan: true });

    const after = allTickets(root);
    expect(after.map((t) => t.id).sort()).toEqual(["t-100", "t-400"]);
    /* DONE work is never re-planned back to READY. */
    expect(after.find((t) => t.id === "t-100")?.state).toBe("DONE");
  });

  it("refuses while a ticket is in flight, before spending anything", async () => {
    const root = repo(LONE_CANDIDATE);
    const first = new MockBackend({ audit: CLEAN_AUDIT,  planner: planner(DRAFT(["t-100"])) });
    await runInit(root, planningPipeline({ root, backend: first, prompts: PROMPTS, budgets: BUDGETS }));
    writeTicket(root, { ...readTicket(root, "t-100"), state: "IN_PROGRESS" });

    const second = new MockBackend({ audit: CLEAN_AUDIT,  planner: planner(DRAFT(["t-999"])) });
    const result = await runInit(root, planningPipeline({ root, backend: second, prompts: PROMPTS, budgets: BUDGETS }), {
      replan: true,
    });

    expect(result.exitCode).toBe(2);
    expect(result.messages.join(" ")).toContain("t-100 (IN_PROGRESS)");
    expect(second.calls, "refused BEFORE any session launched").toHaveLength(0);
    expect(allTickets(root).map((t) => t.id)).toEqual(["t-100"]);
  });
});

/**
 * PRDR-197 — ARCH-2 on the init side.
 *
 * `driver-parity.test.ts` asserts the loop routes effort, and it passed while
 * `cli/init.ts` was not passing `effortRouting` at all — so the knob worked on
 * one driver and was dead on the other, which is the asymmetry that ticket's
 * own criteria warn about. Found by auditing, not by a test, which is why this
 * one exists. Asserted on the SPEC a session was launched with.
 */
describe("PRDR-197 init routes effort to its own sessions", () => {
  it("carries the routed effort onto the planner's session spec", async () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({ audit: CLEAN_AUDIT,  planner: planner(DRAFT(["t-100"])) });
    await runInit(
      root,
      planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS, effortRouting: { planner: "xhigh" } }),
    );
    const launched = backend.calls.filter((c) => c.role === "planner");
    expect(launched.length).toBeGreaterThan(0);
    expect(launched[0]?.spec.effort).toBe("xhigh");
  });

  it("carries none when the role is not routed, so the default stays invisible", async () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({ audit: CLEAN_AUDIT,  planner: planner(DRAFT(["t-100"])) });
    await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));
    expect(backend.calls[0]?.spec.effort).toBeUndefined();
  });
});

/**
 * PRDR-268 — a revision round is drafted against what the LAST round left.
 *
 * HEAD passes `review.findings` on every iteration of the loop, so round two
 * receives byte-identical inputs to round one and `drafted = await …` throws
 * round one away. `draftPlan` also deletes the prior artifact ("a stale draft
 * is an echo chamber, not an input"), so there is no implicit channel either.
 * PRDR-084's "a second bite adds cost without adding information" is therefore
 * true by construction. Moving `reviewPlan` inside the loop is what makes a
 * second round a revision rather than a re-roll.
 */
describe("PRDR-268 a revision round sees what the round before it left", () => {
  const FIRST = [{ tag: "sizing", finding: "t-100 spans three subsystems", ticket: "t-100" }];
  const SECOND = [{ tag: "dependency", finding: "t-100 depends on nothing that exists", ticket: "t-100" }];

  const inputsOf = (backend: MockBackend, artifact: string): Record<string, unknown>[] =>
    backend.calls
      .filter((c) => c.spec.artifactOut.endsWith(artifact))
      .map((c) => (JSON.parse(c.spec.promptVariable) as { inputs: Record<string, unknown> }).inputs);

  /** The k sampled draws all report FIRST so it recurs; every read after them answers in turn, k to a round (PRDR-269). */
  const staged = (afterSample: readonly object[]): StageFn => {
    let reviews = 0;
    return (spec) => {
      let artifact: object;
      if (spec.artifactOut.endsWith("plan-review.json")) {
        reviews += 1;
        const nth = reviews - PLAN_REVIEW_SAMPLES;
        artifact =
          nth <= 0
            ? { schema_version: SCHEMA_VERSION, verdict: "changes", findings: FIRST }
            : (afterSample[nth - 1] ?? APPROVE_PLAN);
      } else if (spec.artifactOut.endsWith("plan-draft.json")) artifact = DRAFT(["t-100"]);
      else if (spec.artifactOut.endsWith("slices.json")) artifact = ONE_SLICE;
      else throw new Error(`the planner was asked for ${spec.artifactOut}, which no planning stage writes`);
      writeFileSync(spec.artifactOut, `${JSON.stringify(artifact)}\n`);
      return okResult();
    };
  };

  const changes = (findings: readonly object[]): object => ({ schema_version: SCHEMA_VERSION, verdict: "changes", findings });

  it("the third draft carries the SECOND review's findings, never the first's again", async () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({ audit: CLEAN_AUDIT,  planner: staged([changes(SECOND), changes(SECOND)]) });
    await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS, revisionRounds: 2 }));

    const drafts = inputsOf(backend, "plan-draft.json");
    expect(drafts, "original + two revisions").toHaveLength(3);
    expect(drafts[1]?.["review_findings"], "round one answers the sampled review").toEqual(FIRST);
    expect(drafts[2]?.["review_findings"], "round two answers what round one LEFT").toEqual(SECOND);
  });

  it("a round whose review comes back clean stops the loop instead of paying for another draft", async () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({ audit: CLEAN_AUDIT,  planner: staged([APPROVE_PLAN]) });
    await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS, revisionRounds: 2 }));

    expect(inputsOf(backend, "plan-draft.json"), "the second round is not bought").toHaveLength(2);
    expect(inputsOf(backend, "plan-review.json"), "both reviews sampled (PRDR-269)").toHaveLength(PLAN_REVIEW_SAMPLES * 2);
  });

  it("a review that never produced a usable verdict leaves the slice marked unreviewed", async () => {
    const root = repo(LONE_CANDIDATE);
    /** `reach` is not a tag: every draw and its one relaunch are unusable, so each `reviewPlan` yields null and the sample has no reads. */
    const unusable = { schema_version: SCHEMA_VERSION, verdict: "changes", findings: [{ tag: "reach", finding: "x", ticket: "t-100" }] };
    const backend = new MockBackend({ audit: CLEAN_AUDIT,  planner: staged(Array.from({ length: PLAN_REVIEW_SAMPLES * 2 }, () => unusable)) });
    await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS, revisionRounds: 2 }));

    const cached = JSON.parse(readFileSync(path.join(stateDir(root), "state", "plan", "s01.json"), "utf8")) as { reviewed: boolean };
    expect(cached.reviewed, "no verdict is not a passed review").toBe(false);
  });

  it("at the default of one round the sequence is two drafts and two sampled reviews", async () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({ audit: CLEAN_AUDIT,  planner: staged([changes(SECOND)]) });
    await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    expect(inputsOf(backend, "plan-draft.json")).toHaveLength(2);
    expect(inputsOf(backend, "plan-review.json"), "PRDR-269 sampled the second review too").toHaveLength(PLAN_REVIEW_SAMPLES * 2);
  });
});

/**
 * PRDR-269 — the post-revision review is the only unsampled one.
 *
 * `sampleReviewPlan` filters the findings a revision is PAID to chase; the
 * in-loop `reviewPlan` hands the findings a HUMAN is asked to act on straight
 * through, one unreplicated read, every element labelled `after-revision` — a
 * label whose doc-block says "survived a revision that was paid to remove it".
 * `revisionOutcome` reports survived = 0 on every slice measured live, so the
 * population that reaches the human is its `introduced` bucket under a name
 * that claims the opposite.
 */
describe("PRDR-269 what survived a revision is told apart from what the revision introduced", () => {
  const HANDED = { tag: "sizing", finding: "t-100 spans three subsystems", ticket: "t-100" };
  const NEW_A = { tag: "dependency", finding: "t-100 depends on nothing that exists", ticket: "t-100" };
  const NEW_B = { tag: "coverage", finding: "t-100 leaves R2 unplanned", ticket: "t-100" };

  /** The sampled draws all report HANDED so it recurs; the reads after them answer one per draw (PRDR-269). */
  const afterRevision = (perDraw: readonly (readonly object[])[]): StageFn => {
    let reviews = 0;
    return (spec) => {
      let artifact: object;
      if (spec.artifactOut.endsWith("plan-review.json")) {
        reviews += 1;
        const nth = reviews - PLAN_REVIEW_SAMPLES;
        artifact =
          nth <= 0
            ? { schema_version: SCHEMA_VERSION, verdict: "changes", findings: [HANDED] }
            : { schema_version: SCHEMA_VERSION, verdict: "changes", findings: perDraw[nth - 1] ?? [] };
      } else if (spec.artifactOut.endsWith("plan-draft.json")) artifact = DRAFT(["t-100"]);
      else if (spec.artifactOut.endsWith("slices.json")) artifact = ONE_SLICE;
      else throw new Error(`the planner was asked for ${spec.artifactOut}, which no planning stage writes`);
      writeFileSync(spec.artifactOut, `${JSON.stringify(artifact)}\n`);
      return okResult();
    };
  };

  const everyDraw = (findings: readonly object[]): readonly (readonly object[])[] =>
    Array.from({ length: PLAN_REVIEW_SAMPLES }, () => findings);

  const heldOf = (root: string): { readonly held?: string; readonly tag: string }[] =>
    (JSON.parse(readFileSync(path.join(stateDir(root), "state", "plan", "s01.json"), "utf8")) as {
      remaining: { readonly held?: string; readonly tag: string }[];
    }).remaining;

  const tags = (root: string, kind: string): string[] =>
    heldOf(root)
      .filter((f) => f.held === kind)
      .map((f) => f.tag)
      .sort();

  it("a finding the revision was handed and did not remove is `after-revision`", async () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({ audit: CLEAN_AUDIT,  planner: afterRevision(everyDraw([HANDED, NEW_A, NEW_B])) });
    await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    expect(tags(root, "after-revision"), "only what was handed to the revision and came back").toEqual(["sizing"]);
  });

  it("a finding that did not exist when the revision was paid is `introduced`, not `after-revision`", async () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({ audit: CLEAN_AUDIT,  planner: afterRevision(everyDraw([HANDED, NEW_A, NEW_B])) });
    await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    expect(tags(root, "introduced"), "reproduced on the revised draft, but no revision failed to fix them").toEqual(["coverage", "dependency"]);
  });

  it("a post-revision finding one draw of three saw travels as `seen-once`, not as leftover", async () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({ audit: CLEAN_AUDIT,  planner: afterRevision([[HANDED, NEW_A], [HANDED], [HANDED]]) });
    await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    expect(tags(root, "seen-once"), "below the threshold on the revised draft, and not discarded").toEqual(["dependency"]);
    expect(tags(root, "after-revision"), "what all three draws saw still survived").toEqual(["sizing"]);
  });

  it("the post-revision review is drawn PLAN_REVIEW_SAMPLES times, like the one before the revision", async () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({ audit: CLEAN_AUDIT,  planner: afterRevision(everyDraw([HANDED])) });
    await runInit(root, planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    const reviews = backend.calls.filter((c) => c.spec.artifactOut.endsWith("plan-review.json"));
    expect(reviews, "both reviews sampled, not one of two").toHaveLength(PLAN_REVIEW_SAMPLES * 2);
  });
});
