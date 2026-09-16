import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXIT_OK, run } from "../../src/kernel/run.js";
import { ensureWorktree, worktreePath } from "../../src/kernel/git.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { git, removeTree, writeTree } from "../helpers.js";
import { addTicket, implementGreen, makeRunRepo, reviewApprove } from "./run-fixture.js";

/** B-2′ (PRDR-244) — a merge conflict is a run outcome, not a backend outage. */

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

/**
 * B-2′ (PRDR-244) — the conflict must not report success.
 *
 * `finalizeDone` already aborts the merge, keeps the worktree and its branch,
 * notes the ticket and throws a typed error naming the conflicted paths. The
 * driver then re-threw that as `DriverRefusal`, which is PRDR-112's BACKEND
 * OUTAGE route: it slept, continued, found the pool empty because the ticket is
 * DONE, and `finish()` reported `pending` from NEEDS_HUMAN and BLOCKED only —
 * so the run returned EXIT_OK with the work sitting unmerged on a branch.
 *
 * The shape reproduced here is the one gate-313 actually hits: a worktree that
 * outlived its generation (a machine restart, then a requeue) while the run
 * branch moved past its base. `ensureWorktree` reuses an existing worktree, so
 * the stale branch is what `finalizeDone` merges.
 */
describe("B-2′ a worktree merge conflict ends the run", () => {
  it("exits non-zero and names the conflict rather than reporting success", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-1" });

    const wt = ensureWorktree(root, "t-1");
    writeTree(wt, { "src/calc.py": "def totals(x):\n    return sum(x) + 1\n" });
    git(wt, "add", "-A");
    git(wt, "commit", "-q", "-m", "t-1: earlier generation's work");

    writeTree(root, { "src/calc.py": "def totals(x):\n    return sum(x) + 2\n" });
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "the run branch moves past the worktree's base");

    const waits: number[] = [];
    const outcome = await run({
      root,
      backend: new MockBackend({ implement: implementGreen, review: reviewApprove }),
      prompts: PROMPTS,
      runId: "worktree-conflict",
      worktree: true,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });

    expect(outcome.exitCode, "a conflicting merge must not report success").not.toBe(EXIT_OK);
    expect(waits, "a conflict is not a backend outage and must not enter the backoff").toEqual([]);
    expect(outcome.summary.reason ?? "", "the summary must name the conflict for the operator").toMatch(
      /conflicts.*src\/calc\.py/s,
    );
    expect(
      existsSync(worktreePath(root, "t-1")),
      "the worktree must survive for the human to resolve",
    ).toBe(true);
    expect(
      git(root, "rev-parse", "--verify", "refs/heads/ticket/t-1").trim(),
      "the ticket branch must survive for the human to resolve",
    ).not.toBe("");
    expect(readTicket(root, "t-1").state, "the work was implemented, gated and reviewed — only integration failed").toBe(
      "DONE",
    );
    expect(
      existsSync(path.join(root, "src", "feature-t-1.txt")),
      "the run branch must not carry the unmerged work",
    ).toBe(false);
  }, 60_000);
});
