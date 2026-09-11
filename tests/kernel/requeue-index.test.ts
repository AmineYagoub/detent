import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requeueTicket } from "../../src/kernel/plumbing.js";
import { EXIT_HUMAN_GATED, EXIT_OK, run } from "../../src/kernel/run.js";
import { worktreePath } from "../../src/kernel/git.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { git, removeTree, writeTree } from "../helpers.js";
import { addTicket, implementGreen, makeRunRepo, reviewApprove } from "./run-fixture.js";

/**
 * PRDR-214, end to end in the default worktree mode: generation 0 stages a
 * foreign path and falsifies; the operator requeues; generation 1 must not
 * inherit what generation 0 staged — not in its index, not in its commit.
 *
 * gate-313's bootstrap did exactly this, and three review-fix rounds later the
 * probe file was in the ticket's commit.
 */

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

/** Probes the tools: stages a file outside the surface, then falsifies. */
const stageThenFalsify: StageFn = (spec) => {
  writeTree(spec.cwd, { "tmp_check/probe.txt": "probe\n" });
  git(spec.cwd, "add", "tmp_check/probe.txt");
  const variable = JSON.parse(spec.promptVariable) as { falsified_out: string };
  writeTree(path.dirname(variable.falsified_out), { [path.basename(variable.falsified_out)]: JSON.stringify({ note: "probing" }) });
  return okResult();
};

describe("PRDR-214 a requeued generation inherits nothing the falsified one staged", () => {
  it("generation 1's index and commit carry no path generation 0 staged, and the settle is on the record", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1" });

    const gen0 = await run({ root, backend: new MockBackend({ implement: stageThenFalsify, review: reviewApprove }), prompts: PROMPTS, runId: "gen0", worktree: true });
    expect(gen0.exitCode).toBe(EXIT_HUMAN_GATED);
    const wt = worktreePath(root, "t1");
    expect(git(wt, "diff", "--cached", "--name-only"), "the fixture's premise: the probe is staged when the human looks").toContain("tmp_check/probe.txt");

    expect(requeueTicket(root, "t1", "tester", "drop the probe").message).toContain("→ READY");
    const gen1 = await run({ root, backend: new MockBackend({ implement: implementGreen, review: reviewApprove }), prompts: PROMPTS, runId: "gen1", worktree: true });
    expect(gen1.exitCode).toBe(EXIT_OK);
    expect(readTicket(root, "t1").state).toBe("DONE");

    /* Before PRDR-214: the probe rode generation 1's `git add -A && git commit` into the run branch. */
    /* The root sits on the run branch, which the second run resumed rather than re-created. */
    const tree = git(root, "ls-tree", "-r", "--name-only", "HEAD");
    expect(tree).toContain("src/feature-t1.txt");
    expect(tree).not.toContain("tmp_check/probe.txt");

    const journal = readFileSync(path.join(root, ".detent/runs/t1/journal.jsonl"), "utf8");
    const settle = journal.split("\n").filter((l) => l.includes('"event":"worktree"'));
    expect(settle.length).toBeGreaterThan(0);
    expect(settle.join("\n")).toContain('"unstaged":["tmp_check/probe.txt"]');
    expect(settle.join("\n")).toContain('"parked":["tmp_check/probe.txt"]');
  }, 60_000);
});
