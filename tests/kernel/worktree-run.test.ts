import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXIT_OK, run } from "../../src/kernel/run.js";
import { stateDir } from "../../src/fs/layout.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { git, removeTree, writeTree } from "../helpers.js";
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

/**
 * PRDR-228 — run state that shipped. t-s01-007's blind-fix session wrote its
 * artifact to the worktree-relative `.detent/runs/...`, the guard allowed it,
 * finalize staged it, and the merge put it in the product.
 */
describe("PRDR-228 a session's relative runs write never reaches the run branch", () => {
  it("the feature merges; the artifact written into the worktree's .detent/runs does not", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    /* gate-313's shape: the run branch tracks no .detent at all, so a worktree has no .detent/.gitignore to hide a stray write. */
    git(root, "rm", "-q", "--cached", ".detent/.gitignore");
    git(root, "commit", "-q", "-m", "greenfield: the run branch tracks no .detent");
    addTicket(root, { id: "t-1" });
    /* The live shape: the artifact lands in the tree and the session commits only its feature; finalize is what staged the artifact. */
    const leaky: StageFn = (spec) => {
      writeTree(spec.cwd, { ".detent/runs/t-1/implement.json": "{\"leaked\": true}\n", "src/feature-t-1.txt": "done\n" });
      git(spec.cwd, "add", "src/feature-t-1.txt");
      git(spec.cwd, "commit", "-q", "-m", "t-1: implement");
      return okResult();
    };
    const outcome = await run({ root, backend: new MockBackend({ implement: leaky, review: reviewApprove }), prompts: PROMPTS, runId: "leak", worktree: true });
    expect(outcome.exitCode, outcome.summary.reason ?? "").toBe(EXIT_OK);
    const tree = git(root, "ls-tree", "-r", "--name-only", "HEAD");
    expect(tree).toContain("src/feature-t-1.txt");
    /* Before PRDR-228: `.detent/runs/t-1/implement.json` was in the tree. */
    expect(tree).not.toContain(".detent/runs");
  }, 60_000);
});
