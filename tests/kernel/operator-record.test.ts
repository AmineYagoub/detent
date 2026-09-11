import { describe, expect, it } from "vitest";
import { OPERATOR_RECORD_NOTES } from "../../src/kernel/stages/review.js";
import { SessionArm } from "../../src/kernel/referee-session.js";
import { newTicket } from "../../src/kernel/tickets/mutations.js";
import type { Ticket } from "../../src/schemas/ticket.js";
import type { SessionState } from "../../src/schemas/roles.js";

/**
 * PRDR-236 — the operator record reaches the session it is written for.
 *
 * C-12's remedy for a stopped ticket is a requeue carrying guidance.
 * `requeueTicket` records it as a ticket note and as the new generation's
 * reason, and `attemptInputs` handed the attempting session `publicTicket`,
 * which has no notes by any name. The reviewer has received the trail since
 * PRDR-080 — whose own comment lists "requeue guidance" among the operator acts
 * a session must be able to see — so the one instruction in the set was
 * delivered only to the role that is not meant to act on it.
 *
 * Found on gate-313: t-s01-012 was requeued with the reviewer's finding relayed
 * verbatim, generation 1 rebuilt it from the acceptance criteria alone, and the
 * next review opened "The requeue guidance's finding is still unaddressed".
 */
describe("PRDR-236 an attempt session receives the operator record", () => {
  function ticketWithNotes(count: number): Ticket {
    const base = newTicket({ id: "t1", type: "feature", title: "t", acceptance_criteria: ["a"] }, "2026-01-01T00:00:00.000Z");
    return {
      ...base,
      notes: Array.from({ length: count }, (_, i) => ({
        at: "2026-01-01T00:00:00.000Z",
        author: i === count - 1 ? "operator" : "kernel",
        text: i === count - 1 ? "requeued with guidance (C-12): fix the glob handling" : `note ${i}`,
      })),
    };
  }

  /** Every state the driver launches an ATTEMPT in — all four write code. */
  const ATTEMPT_STATES: readonly SessionState[] = ["IN_PROGRESS", "BLIND_FIX", "INFORMED_FIX", "REVIEW_FIX"];

  function arm(): SessionArm {
    /* Only the inputs seam is under test; the context members it reaches for are stubbed. */
    return new SessionArm({
      root: "/nonexistent",
      maybeArtifact: () => null,
      diff: () => "",
    } as never);
  }

  it.each(ATTEMPT_STATES)("%s carries the ticket's operator notes", (state) => {
    const inputs = arm().attemptInputs(ticketWithNotes(3), state, "/nonexistent");
    const record = inputs["operator_record"] as Array<{ author: string; text: string }> | undefined;
    expect(record).toBeDefined();
    expect(record!.at(-1)!.text).toContain("fix the glob handling");
  });

  it("keeps the reviewer's window, so a long ticket does not push out its own criteria", () => {
    const inputs = arm().attemptInputs(ticketWithNotes(40), "IN_PROGRESS", "/nonexistent");
    const record = inputs["operator_record"] as unknown[];
    expect(record).toHaveLength(OPERATOR_RECORD_NOTES);
  });
});
