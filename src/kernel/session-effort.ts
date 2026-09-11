import { appendNote } from "./tickets/mutations.js";

/**
 * PRDR-237 — what a session was ASKED to run at, against what it RAN at.
 *
 * S-4‴ put the routed level on the `start` event, and the sentence that
 * justified recording anything (`src/schemas/roles.ts`) is about the other
 * half: the SDK downgrades silently for a model that cannot serve a level, so
 * a configured effort must be recorded rather than assumed honoured. Recording
 * the request detects nothing; only the settled value does.
 *
 * Its own module because `referee-session.ts` is at its line ceiling and this
 * is one self-contained fact about a finished session — the same reason the
 * stage, sweep and context arms live beside it rather than inside it.
 */

export interface EffortJournal {
  readonly appendTicketEvent: (id: string, event: Record<string, unknown>) => void;
}

/**
 * `settled` undefined means no tool call reported a level — a model without
 * effort support, or a session that called no tool. Recorded as `unobserved`,
 * NEVER as agreement: a missing signal read as a matching one is the failure
 * this exists to prevent, and it is the shape a silent downgrade would take if
 * the field ever stopped arriving.
 *
 * The disagreement is also a note, and neither refuses nor retries the session
 * — PRDR-114's model fallback set that shape, and effort is the weaker signal
 * of the two.
 */
export function recordEffort(
  journal: EffortJournal,
  root: string,
  id: string,
  role: string,
  generation: number,
  at: string,
  routed: string,
  settled: string | undefined,
): void {
  journal.appendTicketEvent(id, {
    stage: role,
    event: "effort_settled",
    at,
    generation,
    routed,
    active: settled ?? "unobserved",
  });
  if (settled === undefined || routed === "default" || settled === routed) return;
  appendNote(root, id, {
    author: "kernel",
    text:
      `effort downgraded (PRDR-237): ${role} is routed to ${routed}, and the model ran the turns at ` +
      `${settled} — the SDK downgrades silently for a model that cannot serve a level`,
  });
}
