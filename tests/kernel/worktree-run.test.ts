import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXIT_OK, run } from "../../src/kernel/run.js";
import { stateDir } from "../../src/fs/layout.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree } from "../helpers.js";
import { addTicket, implementGreen, makeRunRepo, reviewApprove } from "./run-fixture.js";

/** B-2″ (PRDR-182) — the run path in the configuration PRDR-145b made the default. */

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

/**
 * B-2″ (PRDR-182) — a whole run, in the DEFAULT worktree mode.
 *
 * Every end-to-end test in this suite runs non-worktree, where the work root and
 * the project root coincide. This one runs the default: worktree creation, the
 * claim base taken inside it, the merge back, and `finalizeDone`.
 *
 * What it does NOT prove, stated because a reader would otherwise assume it:
 * that the artifact is WRITABLE under the containment guard. `MockBackend`
 * writes artifacts with `fs` directly and never runs the PreToolUse hook, so
 * reverting PRDR-180 leaves this test green — verified. The guard boundary is
 * covered by `session-policy.test.ts`, against the spec the session arm builds;
 * whether the two agree in a live session is a question only a live session
 * answers, and no test in this repository can stand in for that.
 */
describe("B-2″ a run completes in worktree mode, the default", () => {
  it("implements, reviews and finishes a ticket with its artifact written", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-1" });

    const outcome = await run({
      root,
      backend: new MockBackend({ implement: implementGreen, review: reviewApprove }),
      prompts: PROMPTS,
      runId: "worktree-e2e",
      worktree: true,
    });

    expect(outcome.exitCode, "a worktree run must finish like any other").toBe(EXIT_OK);
    expect(readTicket(root, "t-1").state).toBe("DONE");
    expect(
      existsSync(path.join(stateDir(root), "runs", "t-1", "review.json")),
      "the reviewer's verdict must have been writable from inside the worktree",
    ).toBe(true);
  }, 60_000);
});
