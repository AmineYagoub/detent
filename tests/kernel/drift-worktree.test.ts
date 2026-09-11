import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discover } from "../../src/adapter/discover/index.js";
import { checkAll, readBindings } from "../../src/adapter/drift.js";
import { acceptTicketDrift, verifySync } from "../../src/cli/verify.js";
import { EXIT_HUMAN_GATED, EXIT_NOT_READY, EXIT_OK, run } from "../../src/kernel/run.js";
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
    expect(existsSync(path.join(root, ".detent/runs/t1/drift_accept.json"))).toBe(true);

    const resumed = await worktreeRun(root, buildOn);
    /* Before PRDR-226: the root was clean, the sweep requeued, the gate drifted on the same tree, exit 2 again. */
    expect(resumed.exitCode, resumed.summary.reason ?? "").toBe(EXIT_OK);
    expect(readTicket(root, "t1").state).toBe("DONE");
    /* The merge carried the change, and the root's baseline followed the run branch. */
    expect(git(root, "show", "HEAD:Makefile")).toContain("extended by t1");
    expect(testHash(root)).not.toBe(before);
    expect(checkAll(readBindings(root).bindings, discover(root)).halting, "root config and baseline agree").toEqual([]);
    expect(existsSync(path.join(root, ".detent/runs/t1/drift_accept.json")), "the acceptance is consumed").toBe(false);
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

import { recordGenerationBaseline, bindingsForTree, acceptDrift } from "../../src/kernel/drift-base.js";
import { writeBindings } from "../../src/adapter/drift.js";

/**
 * PRDR-226, at the seam: the base a tree is judged by is FROZEN at branch
 * creation, so a change the root accepts for another ticket after this tree
 * branched cannot be charged to this one. This is the "predates" guarantee,
 * proved directly rather than through the serial driver that rarely produces it.
 */
describe("PRDR-226 the generation baseline is what the tree branched from", () => {
  const testHashOf = (root: string): string | undefined => readBindings(root).bindings.find((b) => b.slot === "test")?.config_hash;

  it("records the root's hashes once, and a later root re-baseline does not move it", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    const original = testHashOf(root);
    expect(recordGenerationBaseline(root, "t9")["test"]).toBe(original);
    expect(original).toBeDefined();

    const file = readBindings(root);
    writeBindings(root, { bindings: file.bindings.map((b) => (b.slot === "test" ? { ...b, config_hash: "b".repeat(64) } : b)), skips: [...file.skips] });
    /* The root moved on; the tree's base is still what it started from. */
    expect(bindingsForTree(root, "t9").find((b) => b.slot === "test")?.config_hash).toBe(original);

    /* An operator's acceptance for THIS ticket overlays the base — nothing else does. */
    acceptDrift(root, "t9", "operator", "2026-09-11T00:00:00.000Z", { test: "c".repeat(64) });
    expect(bindingsForTree(root, "t9").find((b) => b.slot === "test")?.config_hash).toBe("c".repeat(64));
  });
});
