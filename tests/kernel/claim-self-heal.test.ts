import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { ensureRunBranch, installTrailerHook } from "../../src/kernel/git.js";
import { RunJournal } from "../../src/kernel/journal.js";
import { RefereeCore } from "../../src/kernel/referee.js";
import { claimPath } from "../../src/kernel/tickets/paths.js";
import { readTicket, isClaimed } from "../../src/kernel/tickets/readers.js";
import { loadConfig } from "../../src/kernel/worstcase.js";
import { MockBackend, okResult } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree } from "../helpers.js";
import { addTicket, makeRunRepo } from "./run-fixture.js";

/**
 * PRDR-079 (C-9) — the pool self-heals claims whose holder is verifiably
 * dead. Three live incidents shaped this: a crashed run's claim on an
 * in-flight ticket hid it from the resume pool, and the only remedy was
 * deleting the claim file by hand. The pool now breaks exactly the claims
 * `unclaim` would: readable, this host, owner pid dead.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

async function crashedRepo(): Promise<string> {
  const repo = await makeRunRepo();
  cleanups.push(() => removeTree(repo.root));
  addTicket(repo.root, { id: "t-1" });
  const backend = new MockBackend({ implement: () => okResult() });
  const loaded = loadConfig(JSON.parse(readFileSync(path.join(stateDir(repo.root), "config.json"), "utf8")));
  const journal = RunJournal.open(repo.root);
  const core = new RefereeCore(
    { root: repo.root, backend, prompts: loadPromptSet() },
    loaded,
    journal,
    ensureRunBranch(repo.root, "self-heal"),
  );
  installTrailerHook(repo.root);
  expect(core.acquire("t-1").ok).toBe(true);
  await core.attempt("t-1", "IN_PROGRESS");
  journal.close();
  /* The claim is still held and the ticket is in flight — the crash shape. */
  expect(isClaimed(repo.root, "t-1")).toBe(true);
  return repo.root;
}

function resumedCore(root: string, isAlive: (pid: number) => boolean): RefereeCore {
  const backend = new MockBackend({ implement: () => okResult() });
  const loaded = loadConfig(JSON.parse(readFileSync(path.join(stateDir(root), "config.json"), "utf8")));
  const journal = RunJournal.open(root);
  cleanups.push(() => journal.close());
  return new RefereeCore(
    { root, backend, prompts: loadPromptSet(), isAlive },
    loaded,
    journal,
    ensureRunBranch(root, "self-heal-resume"),
  );
}

describe("PRDR-079 the pool self-heals dead-owner claims", () => {
  it("a dead owner's claim releases, the ticket rejoins the pool, and the break is a note", { timeout: 60_000 }, async () => {
    const root = await crashedRepo();
    const core = resumedCore(root, () => false);
    const pool = core.pool();
    expect(pool.some((p) => p.id === "t-1")).toBe(true);
    expect(isClaimed(root, "t-1")).toBe(false);
    expect(readTicket(root, "t-1").notes.at(-1)?.text).toContain("stale claim released at resume");
    expect(core.acquire("t-1").ok).toBe(true);
  });

  it("a live owner's claim stands and its ticket stays hidden", { timeout: 60_000 }, async () => {
    const root = await crashedRepo();
    const core = resumedCore(root, () => true);
    expect(core.pool().some((p) => p.id === "t-1")).toBe(false);
    expect(isClaimed(root, "t-1")).toBe(true);
  });

  it("a foreign-host claim is never broken, dead pid or not", { timeout: 60_000 }, async () => {
    const root = await crashedRepo();
    writeFileSync(
      claimPath(root, "t-1"),
      JSON.stringify({ owner: "w1", pid: 12345, at: new Date().toISOString(), host: "another-machine" }),
    );
    const core = resumedCore(root, () => false);
    expect(core.pool().some((p) => p.id === "t-1")).toBe(false);
    expect(isClaimed(root, "t-1")).toBe(true);
  });
});
