import { afterEach, describe, expect, it } from "vitest";
import { requeueTicket } from "../../src/kernel/plumbing.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { writeTicket, claim } from "../../src/kernel/tickets/mutations.js";
import { removeTree } from "../helpers.js";
import { addTicket, makeRunRepo } from "./run-fixture.js";
import type { State } from "../../src/schemas/states.js";

/**
 * PRDR-238 — a human may restart the attempt of a ticket that is not finished.
 *
 * B-5 skips a session that crashed, and B-5‴ made that skip discharge once
 * rather than forever. Neither says what the operator does next: a ticket whose
 * implement session was killed sits IN_PROGRESS, and C-12's requeue — the
 * documented remedy — was admissible only from NEEDS_HUMAN or BLOCKED. So the
 * remedy was gated behind the failure path it exists to short-circuit: a blind
 * fix, a research session and an informed fix, all spent on an implementation
 * that was never written, before the ticket reached a state a human could act
 * on.
 *
 * Found when a machine restart killed gate-313's take 15 mid-flight and stranded
 * t-s01-013 and t-s01-014 behind unfinished `implement start` events.
 */
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

async function fixture(): Promise<string> {
  const { root } = await makeRunRepo();
  roots.push(root);
  return root;
}

function park(root: string, id: string, state: State): void {
  addTicket(root, { id });
  writeTicket(root, { ...readTicket(root, id), state });
}

/** Every state a crash can strand a ticket in, plus the two always admitted. */
const ADMITTED: readonly State[] = [
  "DIAGNOSED",
  "IN_PROGRESS",
  "BLIND_FIX",
  "RESEARCH",
  "INFORMED_FIX",
  "REVIEW_FIX",
  "IN_REVIEW",
  "NEEDS_HUMAN",
  "BLOCKED",
];

describe("PRDR-238 requeue reaches a ticket stranded mid-ladder", () => {
  it.each(ADMITTED)("%s is requeued into a fresh generation", async (state) => {
    const root = await fixture();
    park(root, "t1", state);
    const before = readTicket(root, "t1").generations.length;

    const result = requeueTicket(root, "t1", "operator", "the session was killed; start over");

    expect(result.exitCode).toBe(0);
    const after = readTicket(root, "t1");
    expect(after.state).toBe("READY");
    /* X-8: generation N frozen, N+1 opened with zeroed counters. */
    expect(after.generations.length).toBe(before + 1);
    expect(after.generations.at(-1)!.counters.sessions).toBe(0);
  });

  /**
   * APPROVED passed the authoritative gate and a review; finalize is mechanical
   * from there and a requeue would discard verified work.
   */
  it.each(["APPROVED", "DONE"] as const)("%s is refused", async (state) => {
    const root = await fixture();
    park(root, "t1", state as State);
    const result = requeueTicket(root, "t1", "operator", "no");
    expect(result.exitCode).not.toBe(0);
    expect(readTicket(root, "t1").state).toBe(state);
  });

  /**
   * The C-12 guard does not move: widening the admissible states must not let a
   * requeue yank a ticket out from under a session that is still running.
   */
  it("refuses while the claim is held by a live process", async () => {
    const root = await fixture();
    park(root, "t1", "IN_PROGRESS");
    expect(claim(root, "t1", "w1")).toBe(true);
    const result = requeueTicket(root, "t1", "operator", "mine now", { isAlive: () => true });
    expect(result.exitCode).not.toBe(0);
    expect(readTicket(root, "t1").state).toBe("IN_PROGRESS");
  });
});
