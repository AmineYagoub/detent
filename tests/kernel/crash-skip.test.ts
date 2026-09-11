import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXIT_ERROR, run, type RunOptions } from "../../src/kernel/run.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { MockBackend, type StageFn } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree } from "../helpers.js";
import { addTicket, implementGreen, makeRunRepo, noopFix, reviewApprove, reviewChanges } from "./run-fixture.js";

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

async function fixture(): Promise<string> {
  const { root } = await makeRunRepo();
  roots.push(root);
  return root;
}

function opts(root: string, backend: MockBackend, over: Partial<RunOptions> = {}): RunOptions {
  return { root, backend, prompts: PROMPTS, runId: "test", ...over };
}

/**
 * PRDR-234 — the crash skip is once per GENERATION, not once per lifetime.
 *
 * B-5 skips the launch that crashed: the budget was charged before it, so a
 * killed session may not silently relaunch. `unfinished` decides that by
 * counting `start` against `end`, and the skip appends `skipped_after_crash`
 * — neither tally moves, so the condition that fired the skip is still true
 * after it and every later launch of that role in that generation is skipped
 * too.
 *
 * B-5′ (PRDR-131) read that same sentence in the PRD and fixed the SCOPE, so a
 * requeue clears it. Within one generation the imbalance is untouched.
 *
 * It hid because the ladder normally moves ON after a skip — `blind_fix` to
 * research to `informed_fix`, which is what the crash-resume test above pins.
 * The role the ladder RE-ENTERS is REVIEW_FIX, and nothing covered it. On
 * gate-313 that cost t-s01-012 two of its three review-fix rounds against a
 * tree nobody had touched, and halted the run on a NEEDS_HUMAN whose finding
 * was never once handed to a running fixer.
 */
describe("PRDR-234 a re-entered role runs again after its skip", () => {
  it("REVIEW_FIX launches a real session on its second entry in the same generation", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });

    /** Changes twice, then approves — so the ladder enters REVIEW_FIX twice. */
    let reviews = 0;
    const reviewTwiceThenApprove: StageFn = (spec) => {
      reviews += 1;
      return reviews <= 2 ? reviewChanges(spec) : reviewApprove(spec);
    };
    const crashingFix: StageFn = () => {
      throw new Error("simulated crash");
    };

    /* 1. Green implementation, review asks for changes, the fix session dies. */
    const first = new MockBackend({
      implement: implementGreen,
      review: reviewTwiceThenApprove,
      review_fix: crashingFix,
    });
    expect((await run(opts(root, first))).exitCode).toBe(EXIT_ERROR);
    expect(first.rolesLaunched().filter((r) => r === "review_fix")).toHaveLength(1);

    /*
     * 2. Resume in the SAME generation. The crashed launch is skipped once —
     *    B-5, and it must stay — the review runs again, asks for changes a
     *    second time, and the ladder RE-ENTERS REVIEW_FIX. That second entry
     *    is a launch B-5 has no claim on: nothing crashed it.
     */
    const second = new MockBackend({
      implement: implementGreen,
      review: reviewTwiceThenApprove,
      review_fix: noopFix,
    });
    await run(opts(root, second));

    const journal = readFileSync(path.join(root, ".detent/runs/t1/journal.jsonl"), "utf8");
    const skips = journal.split("\n").filter((l) => l.includes("skipped_after_crash"));

    /* Skipped exactly once — not zero (B-5 holds), not twice (PRDR-234). */
    expect(skips).toHaveLength(1);
    expect(second.rolesLaunched()).toContain("review_fix");
  });

  /**
   * The counter is what the ladder spends, so a skipped launch must not cost a
   * round. `review_fix_attempts` is consumed on ENTRY to REVIEW_FIX, before the
   * launch the skip then swallows.
   */
  it("does not spend the review-fix ceiling on launches that never happen", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });

    const crashingFix: StageFn = () => {
      throw new Error("simulated crash");
    };
    const first = new MockBackend({ implement: implementGreen, review: reviewChanges, review_fix: crashingFix });
    expect((await run(opts(root, first))).exitCode).toBe(EXIT_ERROR);

    /* Every later review asks for changes: the ladder must reach the ceiling
     * having actually run a fixer for each round it charged. */
    const second = new MockBackend({ implement: implementGreen, review: reviewChanges, review_fix: noopFix });
    await run(opts(root, second));

    const ticket = readTicket(root, "t1");
    const rounds = ticket.generations.at(-1)!.counters.review_fix_attempts;
    const launched = [...first.rolesLaunched(), ...second.rolesLaunched()].filter((r) => r === "review_fix");

    /* One launch was legitimately lost to the crash; the rest must be real. */
    expect(launched.length).toBeGreaterThanOrEqual(rounds - 1);
  });
});
