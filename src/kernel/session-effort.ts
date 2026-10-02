import type { EffortReason } from "../schemas/roles.js";
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
 * stage, sweep and context arms live beside it rather than inside it. S-4⁵
 * (PRDR-299): `init`'s sessions record the same event and say the same words,
 * from here (`src/init/session.ts`), so the two drivers cannot drift apart.
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
 * of the two. The note has a THIRD suppressor beside the unobserved case above:
 * a role routed to `"default"` never produces one, however far the model
 * settles below it.
 *
 * PRDR-263: that suppressor no longer covers a default install. `detent init`
 * wrote `effort_routing: {}` until then, so this branch could not execute at
 * all and the detector was documentation rather than a control; it now writes a
 * level for all eight roles and the note is reachable. A role still routes to
 * `"default"` on a config predating that ticket, or one that deletes the key.
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
  reason: EffortReason,
): void {
  /* S-5⁸ (PRDR-328): why the session was routed where it was, beside what it ran at. */
  journal.appendTicketEvent(id, { stage: role, event: "effort_settled", at, generation, ...settledLevels(routed, settled), reason });
  const downgrade = effortDowngrade(role, routed, settled);
  if (downgrade !== null) appendNote(root, id, { author: "kernel", text: downgrade });
}

/**
 * S-4⁵ (PRDR-299): what both drivers record of a finished session's effort,
 * `init` through its note seam since it has no ticket to note (ARCH-2). The
 * level asked for and the level run, with an unobserved one named as such.
 */
export function settledLevels(routed: string, settled: string | undefined): { readonly routed: string; readonly active: string } {
  return { routed, active: settled ?? "unobserved" };
}

/**
 * PRDR-114's other half, said the same way by both drivers (S-4⁵): the routed
 * model the runtime could not serve. `reason` is a runtime string, scrubbed by
 * the caller (SEC-4); the ledger row's `models` says what ran instead.
 */
export function modelFallback(role: string, requested: string, reason: string): string {
  return `model fallback (PRDR-114): ${role} is routed to ${requested}, unavailable on this runtime (${reason}) — ran on the runtime default`;
}

/** What is said when the levels disagree, and null under the three suppressors above. */
export function effortDowngrade(role: string, routed: string, settled: string | undefined): string | null {
  if (settled === undefined || routed === "default" || settled === routed) return null;
  return (
    `effort downgraded (PRDR-237): ${role} is routed to ${routed}, and the model ran the turns at ` +
    `${settled} — the SDK downgrades silently for a model that cannot serve a level`
  );
}
