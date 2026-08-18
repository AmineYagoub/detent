import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { approveTicket, requeueTicket } from "../../src/kernel/plumbing.js";
import { EXIT_OK, run } from "../../src/kernel/run.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { claim } from "../../src/kernel/tickets/mutations.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree } from "../helpers.js";
import { addTicket, implementGreen, implementRed, makeRunRepo, noopFix, researchValid, reviewApprove } from "./run-fixture.js";

/**
 * T-055 — `approve` / `requeue` plumbing (C-12, X-3, X-8). The oracle's
 * test_validate_report_approve_requeue ports here with generation semantics —
 * the recorded M0 divergence: requeue opens generation N+1 with zeroed
 * counters, never the oracle's in-place `attempts = {}` reset.
 */

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

/** A ticket parked at NEEDS_HUMAN by a real exhausted ladder. */
async function exhausted(): Promise<string> {
  const { root } = await makeRunRepo();
  roots.push(root);
  addTicket(root, { id: "t1" });
  const backend = new MockBackend({ implement: implementRed, blind_fix: noopFix, research: researchValid, informed_fix: noopFix });
  await run({ root, backend, prompts: PROMPTS, runId: "park" });
  expect(readTicket(root, "t1").state).toBe("NEEDS_HUMAN");
  return root;
}

describe("T-055 oracle port (test_validate_report_approve_requeue, generation semantics)", () => {
  it("requeue opens generation N+1 with zeroed counters; N stays frozen with its record (X-8/D-17)", async () => {
    const root = await exhausted();
    const result = requeueTicket(root, "t1", "operator", "look at the seed row");

    expect(result.exitCode).toBe(0);
    const t1 = readTicket(root, "t1");
    expect(t1.state).toBe("READY");
    expect(t1.generations).toHaveLength(2);
    // Frozen history — NOT the oracle's attempts reset.
    expect(t1.generations[0]).toMatchObject({ outcome: "requeued" });
    expect(t1.generations[0]?.counters.blind_fix_attempts).toBe(1);
    expect(t1.generations[0]?.counters.sessions).toBe(4);
    // Fresh generation, zeroed, carrying the guidance.
    expect(t1.generations[1]?.counters.sessions).toBe(0);
    expect(t1.generations[1]?.reason).toBe("look at the seed row");
  });

  it("approve re-enters APPROVED and the kernel re-verifies on the next run — never a direct DONE", async () => {
    const root = await exhausted();
    // The human fixes the failure by hand, then approves.
    const { rmSync } = await import("node:fs");
    rmSync(path.join(root, ".fail"), { force: true });

    const result = approveTicket(root, "t1", "operator");
    expect(result.exitCode).toBe(0);
    expect(readTicket(root, "t1").state).toBe("APPROVED");

    // The next run picks APPROVED out of the resumable pool and re-verifies.
    const backend = new MockBackend({ review: reviewApprove });
    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "verify" });
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(readTicket(root, "t1").state).toBe("DONE");

    const journal = readFileSync(path.join(root, ".detent/transitions.jsonl"), "utf8");
    const lines = journal.trim().split("\n").map((l) => JSON.parse(l) as { event: string; to: string });
    const approvedAt = lines.findIndex((l) => l.event === "HUMAN_APPROVED");
    const doneAt = lines.findIndex((l) => l.to === "DONE");
    expect(doneAt).toBeGreaterThan(approvedAt);
    expect(lines[doneAt]?.event).toBe("GATE_GREEN");
  });
});

describe("T-055 X-3 legality", () => {
  it("approve from any state but NEEDS_HUMAN is refused with exit 2 naming the state", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1" }); // READY
    const result = approveTicket(root, "t1", "operator");
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain("READY");
    expect(result.message).toContain("X-3");
    expect(readTicket(root, "t1").state).toBe("READY");
  });

  it("requeue is admissible from BLOCKED as well as NEEDS_HUMAN", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1" });
    const t1 = readTicket(root, "t1");
    writeFileSync(path.join(root, ".detent/plan/t1.json"), `${JSON.stringify({ ...t1, state: "BLOCKED" }, null, 2)}\n`);

    const result = requeueTicket(root, "t1", "operator", "upstream released the fix");
    expect(result.exitCode).toBe(0);
    expect(readTicket(root, "t1").state).toBe("READY");

    // But a DONE ticket refuses.
    const t2 = { ...readTicket(root, "t1"), id: "t2", state: "DONE" as const };
    writeFileSync(path.join(root, ".detent/plan/t2.json"), `${JSON.stringify(t2, null, 2)}\n`);
    const refused = requeueTicket(root, "t2", "operator", "nope");
    expect(refused.exitCode).toBe(2);
    expect(refused.message).toContain("DONE");
  });
});

describe("T-055 claim discipline (C-12)", () => {
  it("a live claim refuses with exit 2 naming the pid and the claim's age", async () => {
    const root = await exhausted();
    claim(root, "t1", "other-worker"); // written with THIS live process's pid

    const result = approveTicket(root, "t1", "operator", { now: () => Date.now() });
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain(String(process.pid));
    expect(result.message).toMatch(/claim age \d+s/);
    expect(readTicket(root, "t1").state).toBe("NEEDS_HUMAN"); // untouched
  });

  it("a stale claim (owner dead) may be broken, recorded in transitions.jsonl with the broken pid", async () => {
    const root = await exhausted();
    // A claim owned by a pid that is certainly dead.
    writeFileSync(
      path.join(root, ".detent/claims/t1.claim"),
      JSON.stringify({ owner: "w9", pid: 999999999, at: "2026-08-18T00:00:00.000Z" }),
    );

    const result = requeueTicket(root, "t1", "operator", "resuming after crash", { isAlive: () => false });
    expect(result.exitCode).toBe(0);
    expect(readTicket(root, "t1").state).toBe("READY");

    // The operator action with the broken pid is in the journal's evidence —
    // recorded without inventing an X-3 event to carry it.
    const journal = readFileSync(path.join(root, ".detent/transitions.jsonl"), "utf8");
    const requeueLine = journal
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { event: string; evidence: string })
      .find((l) => l.event === "HUMAN_REQUEUE");
    expect(requeueLine?.evidence).toContain("broke stale claim");
    expect(requeueLine?.evidence).toContain("999999999");
  });

  it("an unreadable claim file is held-by-someone, never assumed free (R-3)", async () => {
    const root = await exhausted();
    writeFileSync(path.join(root, ".detent/claims/t1.claim"), "");
    const result = approveTicket(root, "t1", "operator");
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain("unreadable");
  });
});

describe("T-055 the golden path stays two commands", () => {
  it("a full happy-path run needs neither plumbing verb", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1" });
    const outcome = await run({ root, backend: new MockBackend({ implement: implementGreen, review: reviewApprove }), prompts: PROMPTS, runId: "golden" });
    expect(outcome.exitCode).toBe(EXIT_OK);
  });
});
