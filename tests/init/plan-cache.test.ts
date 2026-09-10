import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildPipeline } from "../../src/init/pipeline.js";
import type { Budgets } from "../../src/schemas/budgets.js";
import type { PhaseHandler } from "../../src/init/machine.js";
import { runInit, sliceCacheDir } from "../../src/init/machine.js";
import { ANALYSIS, APPROVE_PLAN, BUDGETS, PROMPTS, repo } from "./plan-fixture.js";
import { okResult } from "../../src/sessions/mock.js";
import { DOCS, MockBackend, R, TWO_SLICES, scriptedPlanner, sliceOf, twoSliceDraft } from "./slicing-fixture.js";

/**
 * C-8 inside PLAN — what the slice cache will and will not reuse.
 *
 * Split from `slicing.test.ts`, which answers a different question: how a
 * product is planned slice by slice. This one answers what a re-run PAYS FOR,
 * which is the property every key-formula bug in this layer has broken —
 * PRDR-118's cascading ANALYZE digest, PRDR-186's spend cap in the key, and
 * PRDR-200's field the writer knew and the schema did not.
 */

describe("C-8 the slice cache: what a re-run reuses, and what it re-pays for", () => {
  it("C-8 inside PLAN: an unchanged slice is reused from its cache when another slice's documents move; --replan re-plans every slice", async () => {
    const root = repo(DOCS);
    const log: string[] = [];
    const notes: string[] = [];
    const backend = new MockBackend({ planner: scriptedPlanner({ draft: twoSliceDraft, review: () => APPROVE_PLAN }, log) });
    const handlers = buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS, note: (t) => notes.push(t) });

    await runInit(root, handlers);
    expect(log).toEqual(["ANALYZE", "SLICE", "PLAN:s01", ...R("s01"), "PLAN:s02", ...R("s02"), "REVIEW:whole"]);
    expect(existsSync(path.join(sliceCacheDir(root), "s01.json"))).toBe(true);

    /** Only the billing document changes: s01 read nothing that moved. */
    writeFileSync(path.join(root, "prd-billing.md"), "# billing, revised\n");
    log.splice(0);
    notes.splice(0);
    await runInit(root, handlers);
    expect(log).toEqual(["ANALYZE", "SLICE", "PLAN:s02", ...R("s02"), "REVIEW:whole"]);
    expect(notes.join("\n")).toContain("s01 skeleton: reused — nothing it read has changed (C-8)");

    /** C-8′: a replan is a fresh planning session — the cache is wiped, every slice drafted again. */
    log.splice(0);
    await runInit(root, handlers, { replan: true });
    expect(log).toEqual(["ANALYZE", "SLICE", "PLAN:s01", ...R("s01"), "PLAN:s02", ...R("s02"), "REVIEW:whole"]);
  });

  /**
   * C-8 (PRDR-186) — raising the SPEND CAP must not discard the plan.
   *
   * `sliceKey` hashed the whole `budgets` object, so `run_spend_usd` was in the
   * key: on a live run five slices deep, raising the cap to let the run finish
   * invalidated every cached slice and re-paid for them — roughly $70 thrown
   * away by an operational decision that cannot change what a plan should say.
   * The key covers `sessionBudget()` now, which is exactly the three values
   * that reach the prompt. A budget the planner DOES read still invalidates.
   */
  it("a changed spend cap reuses every slice; a changed session budget does not", async () => {
    const root = repo(DOCS);
    const log: string[] = [];
    const notes: string[] = [];
    const backend = new MockBackend({ planner: scriptedPlanner({ draft: twoSliceDraft, review: () => APPROVE_PLAN }, log) });
    const build = (budgets: Budgets): PhaseHandler[] =>
      buildPipeline({ root, backend, prompts: PROMPTS, budgets, note: (t) => notes.push(t) });

    await runInit(root, build(BUDGETS));
    expect(log).toContain("PLAN:s01");

    /**
     * A document edit is what forces PLAN to run again — the phase digest holds
     * no budgets — and it is only then that the slice keys are consulted. That
     * is the live situation exactly: the run died mid-PLAN, so the phase had no
     * checkpoint, and every slice key was re-derived against the new cap.
     */
    writeFileSync(path.join(root, "prd-billing.md"), "# billing, revised once\n");
    log.splice(0);
    notes.splice(0);
    await runInit(root, build({ ...BUDGETS, run_spend_usd: BUDGETS.run_spend_usd * 2 }));
    expect(log, "raising the cap must not re-plan a slice that read nothing new").not.toContain("PLAN:s01");
    expect(notes.join("\n")).toContain("s01 skeleton: reused — nothing it read has changed (C-8)");

    /* But `turns_per_stage` reaches the prompt as `session_budget`, so it must. */
    writeFileSync(path.join(root, "prd-billing.md"), "# billing, revised twice\n");
    log.splice(0);
    await runInit(root, build({ ...BUDGETS, turns_per_stage: BUDGETS.turns_per_stage + 5 }));
    expect(log, "a budget the planner reads still invalidates the slice").toContain("PLAN:s01");
  }, 30_000);

  /**
   * F-3′ (PRDR-137): the cache advertises itself as a validated trust boundary
   * — "a shape this does not recognise is a miss, not a crash" — and validated
   * 3 of the 11 fields it casts to `DraftedTicket`. `sliceKey` hashes what the
   * slice READ, not the code that read it, so a cache from an older build still
   * matches its key and was a HIT that crashed `init` mid-PLAN with
   * `TypeError: t.provides is not iterable`.
   */
  /**
   * C-4⁗″ (PRDR-200): the OTHER side of the same trust boundary.
   *
   * The test below pins that a cache missing REQUIRED fields must miss. This
   * one pins that a cache missing an ADDITIVE one must still HIT — because the
   * failure it guards against was nearly shipped. `churn` was written into the
   * cache before it was added to `sliceCacheSchema`, which is strict, so every
   * slice planned before this build would have failed to parse, missed, and
   * re-planned at full price to add a measurement. PRDR-196's comment on the
   * `revision` field one line above records that exact lesson, and it was
   * reintroduced anyway while that comment was on screen.
   */
  /**
   * C-4⁗″ (PRDR-200): the writer and the schema must agree, in BOTH directions.
   *
   * `churn` was written into the cache before it was added to
   * `sliceCacheSchema`, which is strict — so a cache this build wrote, this
   * build could not read, and every slice would have missed and re-planned at
   * full price on the next run. PRDR-196's comment on the `revision` field one
   * line above records that exact lesson; it was reintroduced anyway.
   *
   * Both halves are one property and are asserted as one: what this build
   * writes it reads, and what an older build wrote it still reads. The first
   * half was written once in a form that passed while asserting nothing — with
   * no document moved, every phase replays from its checkpoint, PLAN never
   * runs, and `not.toContain("PLAN:s01")` is vacuously true. Moving s02's
   * document is what makes PLAN execute and read s01's cache at all.
   */
  it("the writer and the cache schema agree: what this build writes it reads, and an older shape still hits", async () => {
    const root = repo(DOCS);
    const log: string[] = [];
    const notes: string[] = [];
    const handlers = (): ReturnType<typeof buildPipeline> =>
      buildPipeline({ root, backend: new MockBackend({ planner: scriptedPlanner({ draft: twoSliceDraft, review: () => APPROVE_PLAN }, log) }), prompts: PROMPTS, budgets: BUDGETS, note: (t) => notes.push(t) });
    const cacheFile = path.join(sliceCacheDir(root), "s01.json");
    const replan = async (): Promise<void> => {
      writeFileSync(path.join(root, "prd-billing.md"), `# billing ${String(log.length)}\n`);
      log.splice(0);
      notes.splice(0);
      await runInit(root, handlers());
      expect(log, "s02 moved, so PLAN ran and s01's cache was READ").toContain("PLAN:s02");
    };

    await runInit(root, handlers());
    expect(JSON.parse(readFileSync(cacheFile, "utf8"))["churn"], "this build writes it").toBeDefined();

    await replan();
    expect(log, "a field the writer knows and the schema does not is a MISS").not.toContain("PLAN:s01");
    expect(notes.join("\n")).toContain("s01 skeleton: reused — nothing it read has changed (C-8)");

    /* And the forward direction: the shape every slice cached before this build carries. */
    const cached = JSON.parse(readFileSync(cacheFile, "utf8")) as Record<string, unknown>;
    delete cached["churn"];
    writeFileSync(cacheFile, JSON.stringify(cached));
    await replan();
    expect(log, "an additive field defaults; an older cache must not re-plan").not.toContain("PLAN:s01");
  }, 30_000);

  it("a cache whose tickets are missing the fields it casts to is a MISS, not a crash", async () => {
    const root = repo(DOCS);
    const handlers = (): ReturnType<typeof buildPipeline> =>
      buildPipeline({ root, backend: new MockBackend({ planner: scriptedPlanner({ draft: twoSliceDraft, review: () => APPROVE_PLAN }, []) }), prompts: PROMPTS, budgets: BUDGETS });
    await runInit(root, handlers());

    const cacheFile = path.join(sliceCacheDir(root), "s01.json");
    const cached = JSON.parse(readFileSync(cacheFile, "utf8")) as { tickets: Record<string, unknown>[] };
    /* An older build's shape: the ids are there, the contract fields are not. */
    cached.tickets = cached.tickets.map((t) => ({ id: t["id"], depends_on: t["depends_on"], slice: t["slice"] }));
    writeFileSync(cacheFile, JSON.stringify(cached));

    /* A miss re-plans the slice; it must not throw. */
    await expect(runInit(root, handlers())).resolves.toBeDefined();
  });

  it("C-8‴: a re-analysis does not re-plan slices whose own documents never moved", async () => {
    const root = repo(DOCS);
    let summary = "the first analysis";
    const log: string[] = [];
    const backend = new MockBackend({
      planner: (spec) => {
        const inputs = (JSON.parse(spec.promptVariable) as { inputs: Record<string, unknown> }).inputs;
        let artifact: object;
        if (spec.artifactOut.endsWith("slices.json")) artifact = TWO_SLICES;
        else if (spec.artifactOut.endsWith("plan-draft.json")) {
          log.push(`PLAN:${sliceOf(inputs)}`);
          artifact = twoSliceDraft(inputs);
        } else if (spec.artifactOut.endsWith("plan-review.json")) artifact = APPROVE_PLAN;
        else artifact = { ...ANALYSIS(null), summary };
        writeFileSync(spec.artifactOut, `${JSON.stringify(artifact)}\n`);
        return okResult();
      },
    });
    const handlers = () => buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS });
    await runInit(root, handlers());
    expect(log).toEqual(["PLAN:s01", "PLAN:s02"]);

    /**
     * Editing one slice's document re-runs ANALYZE, and ANALYZE is a model act
     * — its prose differs every time. While the whole analysis was in every
     * slice's cache key, that drift re-planned the entire product for a typo.
     */
    log.splice(0);
    summary = "the second analysis, worded differently";
    writeFileSync(path.join(root, "prd-billing.md"), "# billing, revised\n");
    await runInit(root, handlers());
    expect(log).toEqual(["PLAN:s02"]);
  });
});
