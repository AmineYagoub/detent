import type { SessionResult } from "../sessions/backend.js";
import { conversationToResume, isUsageLimit } from "../schemas/backend-limit.js";
import { scrub } from "./scrub.js";

/**
 * X-8″ (PRDR-321) — a session a usage limit stopped, carried on by the next
 * launch of its role instead of launched again.
 *
 * Before this, a limit that stopped a session after its first turn was a crash
 * to the referee: PRDR-053 judged the half-done tree as the session's work, the
 * ladder spent a slot on it, and the headless driver waited 1, 5 and 15 minutes
 * against a window that reset hours later, then ended the run. The run logs
 * hold 58 such limits. Now the stop is recorded on the session's `end` with its
 * conversation, the run waits for the stated reset, and the next launch of the
 * role in that generation resumes the conversation (`RunJournal.
 * stoppedConversation`).
 */

/** The turns the attempt ran before this launch: the stopped half's, when the launch resumed it. */
export function turnsCarried(carried: { readonly turns: number } | null, result: SessionResult): number {
  return carried !== null && result.resume !== undefined && result.resume.refused === undefined ? carried.turns : 0;
}

/** The ticket's note for a resume the runtime would not make, or null when it made it or none was asked. */
export function refusedResumeNote(role: string, result: SessionResult): string | null {
  if (result.resume?.refused === undefined) return null;
  /* SEC-4 (PRDR-169): a runtime string, echoed into a committed note. */
  return `the runtime would not resume ${role} session ${result.resume.sessionId} (${scrub(result.resume.refused)}), so it was launched afresh (X-8″)`;
}

/** What the session's `end` records of a stop, the attempt's turns, and the refusal a stop halts the run with. */
export interface LimitStop {
  readonly end: Readonly<Record<string, unknown>>;
  readonly attemptTurns: number;
  readonly refusal: string | null;
}

/**
 * A usage limit is no failure of the session's, and what it had done is kept:
 * the conversation it stopped goes on its `end`, which the next launch reads.
 * Stopped after its first turn, the session is neither a crash to judge the
 * tree after (PRDR-053) nor one of an outage's streak (PRDR-090); the refusal
 * sends the driver to wait for the reset its message names. Stopped before its
 * first turn, it takes the refusal every such session takes, and a resumed one
 * keeps its conversation for the next launch.
 */
export function limitStop(id: string, role: string, outcome: SessionResult, turnsBefore: number): LimitStop {
  const usageLimit = !outcome.ok && isUsageLimit(outcome.rawTail);
  const toResume = outcome.ok ? undefined : conversationToResume(outcome, usageLimit);
  const attemptTurns = turnsBefore + outcome.turns;
  /* SEC-4 (PRDR-169): rawTail is the runtime's own final message. */
  const said = scrub(outcome.rawTail.slice(-300));
  return {
    end: toResume === undefined ? {} : { stopped_by_limit: { session_id: toResume, turns: attemptTurns } },
    attemptTurns,
    refusal:
      usageLimit && toResume !== undefined && outcome.turns > 0
        ? `backend limit stopped ${role} session ${toResume} for ${id} after ${String(attemptTurns)} turns; it resumes where it stopped: ${said}`
        : null,
  };
}
