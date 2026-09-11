import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXIT_HUMAN_GATED, EXIT_OK, run } from "../../src/kernel/run.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { MockBackend, type StageFn } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree, writeTree } from "../helpers.js";
import { addTicket, implementGreen, makeRunRepo, reviewApprove } from "./run-fixture.js";

/**
 * PRDR-225 — a signal with no author.
 *
 * PRDR-072 clears a stale ARTIFACT before every launch so an earlier round's
 * output cannot impersonate this session's. The signal files were not cleared:
 * a `falsified.json` written in a stage that never consumes one (gate-313's
 * t-s01-004 review-fix) survived a requeue and was consumed against the next
 * generation's implementer, which had written nothing — PREMISE_FALSIFIED on a
 * signal it did not author.
 */
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

const PROMPTS = loadPromptSet();

/** Writes a falsification signal in the implement stage, then builds for real. */
const falsifyThenBuild: StageFn = (spec) => {
  const v = JSON.parse(spec.promptVariable) as { falsified_out: string };
  writeTree(path.dirname(v.falsified_out), { [path.basename(v.falsified_out)]: JSON.stringify({ note: "this session's own premise is wrong" }) });
  return implementGreen(spec);
};

describe("PRDR-225 a stale signal is cleared before a fresh launch", () => {
  it("a falsified.json left from a prior generation does not falsify a session that wrote none", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1" });
    /* The aftermath: a signal file in the ticket's runs dir before this run launches anything. */
    writeTree(path.join(root, ".detent/runs/t1"), { "falsified.json": JSON.stringify({ note: "stale, from a review-fix session two generations ago" }) });

    const outcome = await run({ root, backend: new MockBackend({ implement: implementGreen, review: reviewApprove }), prompts: PROMPTS, runId: "stale" });
    /* Before PRDR-225: the stale file is consumed against this fresh implement — exit 10, PREMISE_FALSIFIED. */
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(readTicket(root, "t1").state).toBe("DONE");
  }, 60_000);

  it("a signal the launching session DOES write still falsifies", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1" });
    const outcome = await run({ root, backend: new MockBackend({ implement: falsifyThenBuild, review: reviewApprove }), prompts: PROMPTS, runId: "own" });
    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    expect(readTicket(root, "t1").state).toBe("NEEDS_HUMAN");
    /* Consumed and removed, exactly as before — the signal was this session's. */
    expect(existsSync(path.join(root, ".detent/runs/t1/falsified.json"))).toBe(false);
  }, 60_000);
});
