import type { Counters, Generation, Ticket } from "../schemas/ticket.js";

/**
 * T-015 — attempt generations (X-8, D-17).
 *
 * HUMAN_REQUEUE opens a new generation: every X-1 counter restarts at zero
 * while prior generations remain immutable history on the ticket. This is the
 * one deliberate divergence from the Python oracle, which reset `attempts` in
 * place and discarded the record (PRD §13).
 */

export const ZERO_COUNTERS: Counters = Object.freeze({
  blind_fix_attempts: 0,
  informed_fix_attempts: 0,
  review_fix_attempts: 0,
  research_sessions: 0,
  hypotheses: 0,
  sessions: 0,
});

export class FrozenGenerationError extends Error {
  constructor(readonly index: number) {
    super(`generation ${index} is closed history and cannot be mutated`);
    this.name = "FrozenGenerationError";
  }
}

export function currentGeneration(ticket: Pick<Ticket, "generations">): Generation {
  const last = ticket.generations.at(-1);
  if (last === undefined) throw new Error("ticket has no generations; A-1 requires at least one");
  return last;
}

export function currentCounters(ticket: Pick<Ticket, "generations">): Counters {
  return currentGeneration(ticket).counters;
}

/** Close the current generation and open the next with zeroed counters. */
export function openGeneration(
  ticket: Pick<Ticket, "generations">,
  opts: { readonly at: string; readonly reason?: string },
): Generation[] {
  const closing = currentGeneration(ticket);
  const closed: Generation = {
    ...closing,
    outcome: "requeued",
    ended_at: opts.at,
  };
  const opened: Generation = {
    index: closed.index + 1,
    counters: { ...ZERO_COUNTERS },
    outcome: "in_flight",
    started_at: opts.at,
    ...(opts.reason === undefined ? {} : { reason: opts.reason }),
  };
  return [...ticket.generations.slice(0, -1), closed, opened];
}

/**
 * Writing to any generation but the last is a programming error, not a
 * recoverable state: prior generations are the record X-8 exists to preserve.
 */
export function withCurrentCounters(
  generations: readonly Generation[],
  index: number,
  counters: Counters,
): Generation[] {
  if (index !== generations.length - 1) throw new FrozenGenerationError(index);
  const current = generations[index];
  if (current === undefined) throw new FrozenGenerationError(index);
  return [...generations.slice(0, -1), { ...current, counters }];
}

/** Cumulative totals across every generation — what dossiers and `status` show. */
export function cumulativeCounters(ticket: Pick<Ticket, "generations">): Counters {
  return ticket.generations.reduce<Counters>(
    (acc, g) => ({
      blind_fix_attempts: acc.blind_fix_attempts + g.counters.blind_fix_attempts,
      informed_fix_attempts: acc.informed_fix_attempts + g.counters.informed_fix_attempts,
      review_fix_attempts: acc.review_fix_attempts + g.counters.review_fix_attempts,
      research_sessions: acc.research_sessions + g.counters.research_sessions,
      hypotheses: acc.hypotheses + g.counters.hypotheses,
      sessions: acc.sessions + g.counters.sessions,
    }),
    { ...ZERO_COUNTERS },
  );
}
