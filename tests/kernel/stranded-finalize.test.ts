import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { currentGeneration } from "../../src/kernel/generations.js";
import { ensureRunBranch, ensureWorktree, worktreePath } from "../../src/kernel/git.js";
import { EXIT_OK, run } from "../../src/kernel/run.js";
import { writeTicket } from "../../src/kernel/tickets/mutations.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { git, removeTree, writeTree } from "../helpers.js";
import { addTicket, approveFixturePlan, makeRunRepo } from "./run-fixture.js";

/**
 * PRDR-217 — DONE, and nowhere.
 *
 * gate-313, take 3: the bootstrap reached DONE at 07:51:06 and finalize threw
 * one second later (PRDR-216). The ticket stayed DONE, its generation stayed
 * `in_flight`, its four commits stayed on `ticket/t-001-bootstrap`, and the
 * run branch stayed at the seed. Nothing in the next run's pool looked at a
 * DONE ticket. This fixture is the crash's aftermath, built directly.
 */

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

/** DONE with its generation in flight, a worktree with a commit, the run branch behind it. */
async function strandedRepo(): Promise<string> {
  const { root } = await makeRunRepo();
  roots.push(root);
  addTicket(root, { id: "t1" });
  ensureRunBranch(root, "stranded");
  const wt = ensureWorktree(root, "t1");
  writeTree(wt, { "src/feature-t1.txt": "done\n" });
  git(wt, "add", "-A");
  git(wt, "commit", "-q", "-m", "t1: implement");
  writeTicket(root, { ...readTicket(root, "t1"), state: "DONE" });
  approveFixturePlan(root);
  return root;
}

const runBranchTree = (root: string): string => git(root, "ls-tree", "-r", "--name-only", "HEAD");

describe("PRDR-217 a DONE ticket whose finalize crashed is finalized at the next pool", () => {
  it("merged, its worktree removed, its generation closed, and the resume on the record", async () => {
    const root = await strandedRepo();
    expect(runBranchTree(root), "the fixture's premise: the work is not on the run branch").not.toContain("src/feature-t1.txt");

    const outcome = await run({ root, backend: new MockBackend({}), prompts: PROMPTS, runId: "stranded", worktree: true });
    expect(outcome.exitCode).toBe(EXIT_OK);
    /* Before PRDR-217: exit 0 with an empty pool, and the commit never reached the run branch. */
    expect(runBranchTree(root)).toContain("src/feature-t1.txt");
    expect(existsSync(worktreePath(root, "t1"))).toBe(false);
    const ticket = readTicket(root, "t1");
    expect(ticket.state).toBe("DONE");
    expect(currentGeneration(ticket).outcome).toBe("done");
    expect(JSON.stringify(ticket.notes)).toContain("finalize resumed");
    const journal = readFileSync(path.join(root, ".detent/runs/t1/journal.jsonl"), "utf8");
    expect(journal).toContain('"event":"finalize"');
    expect(journal).toContain('"resumed":true');
  }, 60_000);

  it("a DONE ticket whose generation is CLOSED — a conflict left for a human — is not touched", async () => {
    const root = await strandedRepo();
    const ticket = readTicket(root, "t1");
    const [generation] = ticket.generations;
    writeTicket(root, { ...ticket, generations: [{ ...generation!, outcome: "done", ended_at: "2026-09-11T07:51:06.000Z" }] });
    approveFixturePlan(root);

    const outcome = await run({ root, backend: new MockBackend({}), prompts: PROMPTS, runId: "stranded", worktree: true });
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(existsSync(worktreePath(root, "t1"))).toBe(true);
    expect(runBranchTree(root)).not.toContain("src/feature-t1.txt");
  }, 60_000);
});

/** Audit of PRDR-217: the one throw finalize is allowed — B-2′'s conflict — at resume time. */
describe("audit of PRDR-217: a conflict during the resumed finalize is the human's, and the run says so", () => {
  it("closes the generation, keeps the worktree, and ends the run with the conflict as the reason", async () => {
    const root = await strandedRepo();
    /* The run branch moved on with its own `src/feature-t1.txt` — the merge cannot be automatic. */
    writeTree(root, { "src/feature-t1.txt": "someone else\n" });
    git(root, "add", "src/feature-t1.txt");
    git(root, "commit", "-q", "-m", "a conflicting change on the run branch");

    const outcome = await run({ root, backend: new MockBackend({}), prompts: PROMPTS, runId: "stranded", worktree: true });
    expect(outcome.exitCode).not.toBe(EXIT_OK);
    expect(outcome.summary.reason ?? "").toContain("conflict");
    expect(existsSync(worktreePath(root, "t1")), "the worktree and branch stay for the human (B-2′)").toBe(true);
    const ticket = readTicket(root, "t1");
    expect(ticket.state).toBe("DONE");
    expect(currentGeneration(ticket).outcome, "closed, so the next resume leaves it alone").toBe("done");
    expect(JSON.stringify(ticket.notes)).toContain("conflict");
  }, 60_000);
});
