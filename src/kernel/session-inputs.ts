import type { Ticket } from "../schemas/ticket.js";
import type { SessionState } from "../schemas/roles.js";
import { publicTicket } from "./referee-context.js";
import { operatorRecord } from "./stages/review.js";

/**
 * T-104's input assembly, lifted out of the session arm — what a driver-launched
 * ATTEMPT is given, and nothing else. The reviewer's set is assembled separately
 * and deliberately (`stages/review.ts`), where widening it is a visible diff.
 */

/** The context members the inputs reach for; narrow so this module imports no arm. */
export interface InputContext {
  readonly root: string;
  readonly maybeArtifact: (id: string, name: string) => unknown;
  readonly diff: (workDir: string) => string;
}

/**
 * PRDR-236: `operator_record` is added HERE, around the switch rather than in
 * each of its branches, so a fifth attempt state inherits it instead of having
 * to remember it — the argument PRDR-169 made for scrubbing at the seam.
 *
 * C-12's remedy for a stopped ticket is a requeue carrying guidance, recorded
 * as a ticket note and as the new generation's reason, and no attempt session
 * had ever been shown it: `publicTicket` carries no notes under any name. The
 * reviewer has had the trail since PRDR-080 — whose own comment lists requeue
 * guidance among the operator acts a session must see. Of the three it lists,
 * guidance is the one that is an INSTRUCTION rather than a fact, and it was
 * delivered only to the role not meant to act on it.
 *
 * Every one of these roles writes code, so a grant or a guidance binds all of
 * them equally; the window and shape are the reviewer's own, so there is one
 * definition of the record rather than two that can drift.
 */
export function attemptInputs(
  ctx: InputContext,
  ticket: Ticket,
  state: SessionState,
  workDir: string,
): Record<string, unknown> {
  return { ...attemptBody(ctx, ticket, state, workDir), operator_record: operatorRecord(ticket) };
}

function attemptBody(ctx: InputContext, ticket: Ticket, state: SessionState, workDir: string): Record<string, unknown> {
  switch (state) {
    case "IN_PROGRESS":
      return { ticket: publicTicket(ticket, ctx.root) };
    case "INFORMED_FIX":
      return { ...fixInputs(ctx, ticket, workDir), research: ctx.maybeArtifact(ticket.id, "research.json") };
    case "REVIEW_FIX":
      return { ...fixInputs(ctx, ticket, workDir), review: ctx.maybeArtifact(ticket.id, "review.json") };
    default:
      return fixInputs(ctx, ticket, workDir);
  }
}

export function fixInputs(ctx: InputContext, ticket: Ticket, workDir: string): Record<string, unknown> {
  return {
    ticket: publicTicket(ticket, ctx.root),
    failure: ctx.maybeArtifact(ticket.id, "last_failure.json"),
    hypothesis: ctx.maybeArtifact(ticket.id, "hypothesis.json"),
    diff: ctx.diff(workDir),
  };
}
