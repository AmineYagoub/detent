import { writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { sweepStaleClaims, unclaimTicket } from "../../src/kernel/plumbing.js";
import { claimPath } from "../../src/kernel/tickets/paths.js";
import { readTicket, isClaimed } from "../../src/kernel/tickets/readers.js";
import { claim } from "../../src/kernel/tickets/mutations.js";
import { removeTree } from "../helpers.js";
import { addTicket, makeRunRepo } from "../kernel/run-fixture.js";

/**
 * PRDR-078 — `detent unclaim` (C-12): the explicit release for claims whose
 * owner died in a state approve/requeue cannot legally touch. The live runs
 * hit this three times (a crashed run's claim on an in-flight ticket blocks
 * the resume pool) and the only remedy was deleting the claim file by hand.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

async function repoWithTicket(): Promise<string> {
  const repo = await makeRunRepo();
  cleanups.push(() => removeTree(repo.root));
  addTicket(repo.root, { id: "t-1" });
  return repo.root;
}

function plantClaim(root: string, id: string, pid: number): void {
  expect(claim(root, id, "w1")).toBe(true);
  writeFileSync(claimPath(root, id), JSON.stringify({ owner: "w1", pid, at: new Date().toISOString() }));
}

describe("PRDR-078 unclaim releases only verifiably dead owners", () => {
  it("a dead owner's claim releases, with the break recorded as a note", async () => {
    const root = await repoWithTicket();
    plantClaim(root, "t-1", 4_059_991);
    const result = unclaimTicket(root, "t-1", "operator", { isAlive: () => false });
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("released stale claim");
    expect(isClaimed(root, "t-1")).toBe(false);
    const note = readTicket(root, "t-1").notes.at(-1);
    expect(note?.text).toContain("claim released");
    expect(note?.author).toBe("operator");
  });

  it("a live owner refuses, naming the pid, and the claim stands", async () => {
    const root = await repoWithTicket();
    plantClaim(root, "t-1", 4_059_992);
    const result = unclaimTicket(root, "t-1", "operator", { isAlive: () => true });
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain("4059992");
    expect(isClaimed(root, "t-1")).toBe(true);
  });

  it("an unreadable claim stays held-by-someone (R-3)", async () => {
    const root = await repoWithTicket();
    expect(claim(root, "t-1", "w1")).toBe(true);
    writeFileSync(claimPath(root, "t-1"), "");
    const result = unclaimTicket(root, "t-1", "operator", { isAlive: () => false });
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain("unreadable");
    expect(isClaimed(root, "t-1")).toBe(true);
  });

  it("no claim is an OK no-op", async () => {
    const root = await repoWithTicket();
    const result = unclaimTicket(root, "t-1", "operator");
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("no claim");
  });

  it("--stale sweeps dead owners and leaves live ones", async () => {
    const root = await repoWithTicket();
    addTicket(root, { id: "t-2" });
    plantClaim(root, "t-1", 111);
    plantClaim(root, "t-2", 222);
    const result = sweepStaleClaims(root, "operator", { isAlive: (pid) => pid === 222 });
    expect(result.exitCode).toBe(0);
    expect(isClaimed(root, "t-1")).toBe(false);
    expect(isClaimed(root, "t-2")).toBe(true);
    expect(result.message).toContain("released stale claim");
    expect(result.message).toContain("222");
  });
});
