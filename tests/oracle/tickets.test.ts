import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  allTickets,
  countsByState,
  isClaimed,
  readTicket,
  ready,
  resumable,
  TicketInvalidError,
  TicketNotFoundError,
} from "../../src/kernel/tickets/readers.js";
import {
  appendNote,
  claim,
  createTicket,
  linkDiscovered,
  readClaim,
  release,
  writeTicket,
} from "../../src/kernel/tickets/mutations.js";
import { ticketPath } from "../../src/kernel/tickets/paths.js";
import { openGeneration } from "../../src/kernel/generations.js";

let root: string;
beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), "detent-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const mk = (id: string, over: Partial<Parameters<typeof createTicket>[1]> = {}) =>
  createTicket(root, { id, type: "feature", title: id, acceptance_criteria: ["works"], ...over });

describe("T-017 ticket store (A-1, R-3)", () => {
  it("schema is enforced on write — an invalid ticket never reaches disk", () => {
    const t = mk("t-1");
    expect(() => writeTicket(root, { ...t, acceptance_criteria: [] })).toThrow();
    expect(readTicket(root, "t-1").acceptance_criteria).toEqual(["works"]);
  });

  it("rejects a ticket file that is corrupt or newer-schema, naming the ticket", () => {
    mk("t-1");
    writeFileSync(ticketPath(root, "t-1"), JSON.stringify({ schema_version: 99, id: "t-1" }));
    expect(() => readTicket(root, "t-1")).toThrow(TicketInvalidError);
    expect(() => readTicket(root, "nope")).toThrow(TicketNotFoundError);
  });

  it("ready() respects dependencies — a blocker must be DONE", () => {
    mk("t-1");
    mk("t-2", { blockers: ["t-1"] });
    expect(ready(root).map((t) => t.id)).toEqual(["t-1"]);
    writeTicket(root, { ...readTicket(root, "t-1"), state: "DONE" });
    expect(ready(root).map((t) => t.id)).toEqual(["t-2"]);
  });

  it("C-4 bootstrap: every ticket blocked on #1 is unclaimable until #1 is DONE", () => {
    mk("t-1");
    for (const id of ["t-2", "t-3", "t-4"]) mk(id, { blockers: ["t-1"] });
    expect(ready(root).map((t) => t.id)).toEqual(["t-1"]);
    writeTicket(root, { ...readTicket(root, "t-1"), state: "DONE" });
    expect(ready(root).map((t) => t.id)).toEqual(["t-2", "t-3", "t-4"]);
  });

  it("ready() excludes claimed tickets", () => {
    mk("t-1");
    expect(ready(root)).toHaveLength(1);
    expect(claim(root, "t-1", "worker-a")).toBe(true);
    expect(isClaimed(root, "t-1")).toBe(true);
    expect(ready(root)).toHaveLength(0);
    release(root, "t-1");
    expect(ready(root)).toHaveLength(1);
  });

  it("a claim records its owner and pid", () => {
    mk("t-1");
    claim(root, "t-1", "worker-a");
    expect(readClaim(root, "t-1")).toMatchObject({ owner: "worker-a", pid: process.pid });
  });

  it("atomic claim: exactly one of 8 genuinely concurrent processes wins (R-3)", async () => {
    mk("t-1");
    const run = promisify(execFile);
    const racer = path.resolve(import.meta.dirname, "../fixtures/claim-racer.ts");
    const tsx = path.resolve(import.meta.dirname, "../../node_modules/.bin/tsx");
    const barrier = path.join(root, "go");

    /**
     * Start all 8 first; each spins until the barrier appears, so the claim
     * attempts overlap rather than running one after another.
     */
    const children = Array.from({ length: 8 }, (_, i) =>
      run(tsx, [racer, root, "t-1", `worker-${i}`, barrier], { encoding: "utf8" }),
    );
    await new Promise((r) => setTimeout(r, 1500));
    writeFileSync(barrier, "");

    const results = (await Promise.all(children)).map((r) => r.stdout);
    expect(results.filter((r) => r === "won")).toHaveLength(1);
    expect(results.filter((r) => r === "lost")).toHaveLength(7);
    expect(readClaim(root, "t-1")?.owner).toMatch(/^worker-\d$/);
  }, 60_000);

  it("notes are append-only", () => {
    mk("t-1");
    appendNote(root, "t-1", { author: "kernel", text: "first" });
    appendNote(root, "t-1", { author: "kernel", text: "second" });
    expect(readTicket(root, "t-1").notes.map((n) => n.text)).toEqual(["first", "second"]);
  });

  it("discovered_from links both ends (X-5 quarantine, X-6 upstream bug)", () => {
    mk("t-1");
    const child = linkDiscovered(root, "t-1", {
      id: "t-9", type: "bug", title: "flaky test", acceptance_criteria: ["stable"],
    });
    expect(child.links).toContainEqual({ rel: "discovered_from", ref: "t-1" });
    /** The back-link is not `discovered_from`: t-1 was not discovered from t-9. */
    expect(readTicket(root, "t-1").links).toContainEqual({ rel: "related", ref: "t-9" });
  });

  it("plan/approval.json is C-7's record, not a ticket — the pool ignores it (F-1)", () => {
    mk("t-1");
    writeFileSync(
      path.join(root, ".detent", "plan", "approval.json"),
      JSON.stringify({ schema_version: 1, approved_by: "u", at: "2026-08-18T00:00:00.000Z", plan_hash: "a".repeat(64) }),
    );
    expect(allTickets(root).map((t) => t.id)).toEqual(["t-1"]);
  });

  it("generations survive a round trip, including frozen history (X-8)", () => {
    const t = mk("t-1");
    const spent = { ...t.generations[0]!.counters, blind_fix_attempts: 1, sessions: 4 };
    const withHistory = openGeneration(
      { generations: [{ ...t.generations[0]!, counters: spent }] },
      { at: "2026-08-17T12:00:00.000Z", reason: "try again" },
    );
    writeTicket(root, { ...t, generations: withHistory });
    const reloaded = readTicket(root, "t-1");
    expect(reloaded.generations).toHaveLength(2);
    expect(reloaded.generations[0]!.counters.sessions).toBe(4);
    expect(reloaded.generations[0]!.outcome).toBe("requeued");
    expect(reloaded.generations[1]!.counters.sessions).toBe(0);
    expect(reloaded.generations[1]!.reason).toBe("try again");
  });

  it("resumable() is every non-terminal in-flight ticket (C-9)", () => {
    mk("t-1");
    writeTicket(root, { ...mk("t-2"), state: "BLIND_FIX" });
    writeTicket(root, { ...mk("t-3"), state: "DONE" });
    expect(resumable(root).map((t) => t.id)).toEqual(["t-2"]);
    expect(countsByState(root)).toEqual({ READY: 1, BLIND_FIX: 1, DONE: 1 });
  });

  it("an empty store is empty, not an error", () => {
    expect(allTickets(root)).toEqual([]);
    expect(ready(root)).toEqual([]);
  });
});
