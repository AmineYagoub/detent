import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discover } from "../../src/adapter/discover/index.js";
import { checkAll, readBindings } from "../../src/adapter/drift.js";
import { acceptTicketDrift, verifySync } from "../../src/cli/verify.js";
import { EXIT_HUMAN_GATED, EXIT_NOT_READY, EXIT_OK, run } from "../../src/kernel/run.js";
import { ensureRunBranch, ensureWorktree } from "../../src/kernel/git.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { git, removeTree, writeTree } from "../helpers.js";
import { addTicket, implementGreen, makeRunRepo, reviewApprove } from "./run-fixture.js";

/**
 * PRDR-226 — a halt with no way through.
 *
 * T-041's drift test runs without worktrees, where the root is the tree: the
 * tamper, the halt, `verifySync(root)` and the rerun all see one directory.
 * Under B-2″'s default the change lives on the ticket's branch until a merge
 * that cannot happen while the ticket is blocked, and the run branch's
 * `.detent/` is not tracked, so a worktree carries no baseline of its own.
 * `verify sync` on the root re-approved what it already had and the next run
 * halted on the same tree. gate-313, take 9, t-s01-018: exit 2 at 11:46:22 on
 * a granted change to the lint script.
 */

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

/** A granted verification change: the ticket rewrites the bound test recipe. */
const changeTheGate: StageFn = (spec) => {
  const makefile = readFileSync(path.join(spec.cwd, "Makefile"), "utf8");
  writeTree(spec.cwd, { Makefile: makefile.replace("sh scripts/test.sh", "sh scripts/test.sh # extended by t1") });
  return implementGreen(spec);
};

/** The resumed generation's session: adds to the tree it inherits, so the commit is never empty. */
const buildOn: StageFn = (spec) => {
  writeTree(spec.cwd, { [`src/again-${spec.ticketId}.txt`]: "again\n" });
  git(spec.cwd, "add", "-A");
  git(spec.cwd, "commit", "-q", "-m", `${spec.ticketId}: build on the inherited tree`);
  return okResult();
};

const worktreeRun = (root: string, implement: StageFn, runId = "drift") =>
  run({ root, backend: new MockBackend({ implement, review: reviewApprove }), prompts: PROMPTS, runId, worktree: true });

async function haltedRoot(): Promise<string> {
  const { root } = await makeRunRepo();
  roots.push(root);
  addTicket(root, { id: "t1", surface: ["src/**", "Makefile"] });
  const outcome = await worktreeRun(root, changeTheGate);
  expect(outcome.exitCode).toBe(EXIT_NOT_READY);
  expect(readTicket(root, "t1").state).toBe("BLOCKED");
  return root;
}

const testHash = (root: string): string | undefined => readBindings(root).bindings.find((b) => b.slot === "test")?.config_hash;

describe("PRDR-226 drift is judged against the base a tree started from, and accepted per ticket", () => {
  it("the halt names the verb; accepting the ticket's change, then a rerun, finishes it and re-baselines the root at the merge", async () => {
    const root = await haltedRoot();
    const before = testHash(root);
    const note = readTicket(root, "t1").notes.map((n) => n.text).join("\n");
    expect(note, "the operator is told the verb that can clear this").toContain(`detent verify sync ${root} --ticket t1`);

    const accepted = await acceptTicketDrift(root, "t1", { consent: async () => true, user: "operator" });
    expect(accepted.exitCode, accepted.messages.join(" | ")).toBe(EXIT_OK);
    expect(readTicket(root, "t1").state, "accepting requeues the ticket").toBe("READY");
    expect(existsSync(driftAcceptPath(root, "t1")), "recorded where no session can write it (PRDR-230)").toBe(true);

    const resumed = await worktreeRun(root, buildOn);
    /* Before PRDR-226: the root was clean, the sweep requeued, the gate drifted on the same tree, exit 2 again. */
    expect(resumed.exitCode, resumed.summary.reason ?? "").toBe(EXIT_OK);
    expect(readTicket(root, "t1").state).toBe("DONE");
    /* The merge carried the change, and the root's baseline followed the run branch. */
    expect(git(root, "show", "HEAD:Makefile")).toContain("extended by t1");
    expect(testHash(root)).not.toBe(before);
    expect(checkAll(readBindings(root).bindings, discover(root)).halting, "root config and baseline agree").toEqual([]);
    expect(existsSync(driftAcceptPath(root, "t1")), "the acceptance is consumed").toBe(false);
    expect(readTicket(root, "t1").notes.map((n) => n.text).join("\n")).toContain("re-baselined at merge");
  }, 120_000);

  it("`verify sync` on the ROOT finds nothing, does not requeue a ticket blocked for its own change, and the run stays human-gated", async () => {
    const root = await haltedRoot();
    const synced = await verifySync(root, { consent: async () => true });
    expect(synced.summary.drift.every((d) => d.status !== "drifted"), "the root's tree never changed").toBe(true);
    const resumed = await worktreeRun(root, buildOn);
    /* Before: requeued by the root-level sweep and halted on the same tree again (exit 2, a loop). */
    expect(resumed.exitCode, resumed.summary.reason ?? "").toBe(EXIT_HUMAN_GATED);
    expect(readTicket(root, "t1").state).toBe("BLOCKED");
  }, 120_000);
});

import { acceptDrift, bindingsForTree, discoverAtCommit, driftAcceptPath, forkCommit } from "../../src/kernel/drift-base.js";
import { writeBindings } from "../../src/adapter/drift.js";

/**
 * PRDR-230, at the seam: the baseline a tree is judged by is the CONFIG AT ITS
 * FORK COMMIT, so a root that moves on cannot move it. PRDR-226 stored the
 * root's hashes instead and this is the property it failed to hold.
 */
describe("PRDR-230 the tree's baseline is its fork commit, not whatever the root now holds", () => {
  const testHashOf = (root: string): string | undefined => readBindings(root).bindings.find((b) => b.slot === "test")?.config_hash;

  const hashIn = (dir: string): string | undefined => discover(dir).candidates.find((c) => c.slot === "test")?.config_hash;

  it("a root re-baseline does not move it; an acceptance ADDS a baseline; reverting to the fork is not a second block", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    ensureRunBranch(root, "seam");
    const tree = ensureWorktree(root, "t9");
    const original = testHashOf(root);
    expect(original).toBeDefined();

    expect(forkCommit(tree, "seam-missing-branch"), "an unresolvable run branch yields no fork").toBeNull();
    const runBranch = git(root, "rev-parse", "--abbrev-ref", "HEAD").trim();
    const fork = forkCommit(tree, runBranch);
    expect(fork, "the fork commit is derivable from the worktree alone").not.toBeNull();
    expect(discoverAtCommit(tree, fork as string)?.candidates.some((c) => c.slot === "test")).toBe(true);

    /* The root moves on — another ticket's change, accepted and merged. */
    const file = readBindings(root);
    writeBindings(root, { bindings: file.bindings.map((b) => (b.slot === "test" ? { ...b, config_hash: "b".repeat(64) } : b)), skips: [...file.skips] });
    const baseline = (): string | undefined => bindingsForTree(root, "t9", tree, runBranch).find((b) => b.slot === "test")?.config_hash;
    expect(baseline(), "the tree is still judged by what it was cut from").toBe(original);

    /* An unresolvable fork falls back to the ROOT's binding — the documented safe answer, never the tree's own. */
    expect(bindingsForTree(root, "t9", tree, "no-such-branch").find((b) => b.slot === "test")?.config_hash,
      "no fork means the root decides, not the tree").toBe("b".repeat(64));

    /* The ticket changes the recipe itself: its own change, so it drifts. */
    const makefile = readFileSync(path.join(tree, "Makefile"), "utf8");
    writeTree(tree, { Makefile: makefile.replace("sh scripts/test.sh", "sh scripts/test.sh # changed by t9") });
    const changedHash = hashIn(tree) as string;
    expect(changedHash).not.toBe(original);
    expect(checkAll(bindingsForTree(root, "t9", tree, runBranch), discover(tree)).halting.map((h) => h.slot)).toEqual(["test"]);

    /* The operator accepts THAT configuration, having executed its gates: clean. */
    acceptDrift(root, "t9", "operator", "2026-09-11T00:00:00.000Z", { test: changedHash });
    expect(baseline()).toBe(changedHash);
    expect(checkAll(bindingsForTree(root, "t9", tree, runBranch), discover(tree)).halting).toEqual([]);

    /* And reverting to exactly what the fork carries is NOT a second block. */
    writeTree(tree, { Makefile: makefile });
    expect(hashIn(tree)).toBe(original);
    expect(checkAll(bindingsForTree(root, "t9", tree, runBranch), discover(tree)).halting,
      "restoring the fork's own configuration cannot be drift").toEqual([]);

    /* Non-worktree mode reads the root's bindings untouched, exactly as before. */
    expect(bindingsForTree(root, "t9", root, runBranch).find((b) => b.slot === "test")?.config_hash).toBe("b".repeat(64));
  }, 60_000);
});

describe("PRDR-230 a worktree cut before an accepted change is judged against its own fork", () => {
  it("the stale ticket changed nothing and runs; the ticket that did change the gate was still caught", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1", surface: ["src/**", "Makefile"] });
    addTicket(root, { id: "t2", surface: ["src/**"] });
    /* t2's worktree is cut NOW, from the run branch as it stands before t1's change lands. */
    ensureRunBranch(root, "stale");
    const stale = ensureWorktree(root, "t2");
    /* The premise: t2's tree is cut with the pre-change recipe and nothing in this test writes to it. */
    expect(readFileSync(path.join(stale, "Makefile"), "utf8")).toContain("sh scripts/test.sh");
    const forkHash = testHash(root);

    /* t1 changes a bound gate's recipe: caught, blocked, and the halt names the per-ticket verb. */
    const halted = await run({ root, backend: new MockBackend({ implement: changeTheGate, review: reviewApprove }), prompts: PROMPTS, runId: "stale", worktree: true, maxTickets: 1 });
    expect(halted.exitCode, "the ticket that really changed the gate is still charged").toBe(EXIT_NOT_READY);
    expect(readTicket(root, "t1").state).toBe("BLOCKED");
    expect(readTicket(root, "t1").notes.map((n) => n.text).join("\n")).toContain("--ticket t1");

    const accepted = await acceptTicketDrift(root, "t1", { consent: async () => true, user: "operator" });
    expect(accepted.exitCode, accepted.messages.join(" | ")).toBe(EXIT_OK);
    const finished = await run({ root, backend: new MockBackend({ implement: buildOn, review: reviewApprove }), prompts: PROMPTS, runId: "stale", worktree: true, maxTickets: 1 });
    expect(finished.exitCode, finished.summary.reason ?? "").toBe(EXIT_OK);
    expect(readTicket(root, "t1").state).toBe("DONE");
    expect(git(root, "show", "HEAD:Makefile")).toContain("extended by t1");

    /*
     * The premise, asserted rather than assumed (audit of PRDR-230): the root's
     * baseline really did move past t2's fork, and judged by the root's
     * bindings — which is what every version before this one did — t2 WOULD be
     * blocked. Without this the test stays green under a mutation that stops
     * `rebaselineAccepted` moving the root at all.
     */
    expect(testHash(root), "the root re-baselined at the merge").not.toBe(forkHash);
    expect(checkAll(readBindings(root).bindings, discover(stale)).halting.map((h) => h.slot),
      "judged by the root's bindings, the untouched tree would be blocked").toEqual(["test"]);
    const resumed = await run({ root, backend: new MockBackend({ implement: implementGreen, review: reviewApprove }), prompts: PROMPTS, runId: "stale", worktree: true, maxTickets: 1 });
    /* Before PRDR-230: BLOCKED and exit 2 — judged against a root that had moved past it. */
    expect(resumed.exitCode, resumed.summary.reason ?? "").toBe(EXIT_OK);
    expect(readTicket(root, "t2").state).toBe("DONE");
    /*
     * The recipe that survives the merge is t1's, not the older one t2's tree
     * carried — which is what constrains the session, and is readable after the
     * run where the worktree is not: `mergeWorktree` removes it at DONE. The
     * pre-run read of `stale/Makefile` above is the fixture's own premise and
     * is stated as one rather than asserted.
     */
    expect(git(root, "show", "HEAD:Makefile"), "the stale tree did not drag its older recipe back onto the run branch").toContain("extended by t1");
  }, 180_000);
});
