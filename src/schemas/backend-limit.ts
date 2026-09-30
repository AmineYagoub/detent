/**
 * PRDR-112, PRDR-185, PRDR-189, PRDR-321 — how the backend says it is out or
 * limited, and how long either driver waits for it, read one way by both
 * (ARCH-2). Moved here from `init/session.ts` and `kernel/driver.ts` when
 * `run` came to need the reset `init` had read since PRDR-189; `schemas/` is
 * the one layer both drivers and the SDK backend may import.
 */

/** PRDR-112: 1, 5, 15 minutes; the retry itself is the probe, and a crashed retry costs $0. */
export const OUTAGE_BACKOFF_MS: readonly number[] = [60_000, 300_000, 900_000];

/**
 * PRDR-185: a backend outage is waited out, not fatal.
 *
 * A session limit is the most ordinary interruption on a subscription plan, and
 * it is an OUTAGE — nothing about the work was wrong, the transport was briefly
 * unavailable. `kernel/driver.ts` has known that since PRDR-112: it backs off
 * 1, 5, 15 minutes and halts only on consecutive outages with no progress
 * between them. `init` had none of it, so four limit hits across one live
 * planning run each ended the command and needed a human to notice and restart.
 * ARCH-2: a control on one driver belongs on both.
 *
 * The message is matched rather than a typed error because the SDK returns a
 * limit as an error RESULT, not an exception — the same shape S-4 already reads
 * for crashes. Narrow on purpose: a phrase that does not match simply fails as
 * before, which is the harmless direction.
 */
const OUTAGE_MARKERS: readonly RegExp[] = [
  /session limit/i,
  /rate limit/i,
  /overloaded/i,
  /\b429\b/,
  /service unavailable/i,
  /\b50[0-9]\b.*(error|unavailable)/i,
];

export function isOutage(text: string): boolean {
  /* X-8″ (PRDR-321): every account limit the runtime names, a weekly or a monthly spend limit as well as a session limit. */
  return OUTAGE_MARKERS.some((re) => re.test(text)) || isUsageLimit(text);
}

/**
 * PRDR-189: a usage limit names its own reset time — wait until THAT.
 *
 * PRDR-185's ladder is 1, 5, 15 minutes, which is right for a transient
 * outage and wrong for a usage window: observed live, the three retries
 * exhausted in 21 minutes against a limit that reset hours later, and the run
 * died having done everything correctly. The message carries the answer —
 * "resets 10:30pm (Africa/Algiers)" — and PRDR-185's own acceptance criteria
 * said the operator should be told "until when" while the code never read it.
 *
 * The ZONE is not decoration. Africa/Algiers is UTC+1 year-round and this
 * machine was on CEST (UTC+2) when the limit hit, so reading "10:30pm" as local
 * time would wait an hour early and fail again — a retry that looks like it
 * honoured the reset and did not. The current time is taken IN the named zone
 * and the delta computed there, which needs no date arithmetic.
 *
 * D-13 (PRDR-261): the MINUTES are optional, because the backend does not
 * always send them. PRDR-189 read one of the two formats it emits and this
 * doc-block claimed both. The live message that killed an init was
 * "You've hit your session limit · resets 5pm (Africa/Algiers)" — no ":MM", no
 * match, `null`, and the 1/5/15 ladder ran against a window that reset four
 * hours later. Every test that reached here used 10:30pm or 5:20pm, so the
 * whole no-minutes family was untested and the gap read as intent.
 *
 * A TIME is still required, and that is what the second guard is for. With the
 * colon optional the pattern would otherwise accept any bare integer after the
 * word: "resets 5 minutes from now" reads as 05:00 — a sixteen-hour sleep —
 * and "resets 2026-09-17T17:00:00Z" reads the "20" of the year as 20:00. A
 * real reset states minutes or a meridiem. Neither means this is not a clock,
 * and the function says nothing, which sends the caller back to the ladder.
 */
export function msUntilReset(message: string, now: Date = new Date()): number | null {
  const m = /resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([A-Za-z]+\/[A-Za-z_]+)\))?/i.exec(message);
  if (m === null) return null;
  if (m[2] === undefined && m[3] === undefined) return null;
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  const meridiem = m[3]?.toLowerCase();
  let hour = Number(m[1]);
  if (meridiem === "pm" && hour !== 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;

  let hereNow: string;
  try {
    hereNow = new Intl.DateTimeFormat("en-GB", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      ...(m[4] === undefined ? {} : { timeZone: m[4] }),
    }).format(now);
  } catch {
    /* An unknown zone is not a parse failure; fall back to this machine's clock. */
    hereNow = new Intl.DateTimeFormat("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit" }).format(now);
  }
  const [nowHour, nowMinute] = hereNow.split(":").map(Number) as [number, number];
  let deltaMinutes = hour * 60 + minute - (nowHour * 60 + nowMinute);
  /* Already past in that zone means the next occurrence is tomorrow. */
  if (deltaMinutes <= 0) deltaMinutes += 24 * 60;
  /* A minute past the stated time, so a clock a few seconds behind does not retry early. */
  return deltaMinutes * 60_000 + 60_000;
}

/**
 * The longest this will wait for a named reset before handing the decision
 * back. A usage window resets within hours; a wait longer than this is more
 * likely a misparse or a clock problem than a real reset, and an operator would
 * rather be told than discover a command that slept until tomorrow.
 */
export const MAX_RESET_WAIT_MS = 6 * 60 * 60_000;


/**
 * X-8″ (PRDR-321): the runtime's own words for an account limit, the one stop a
 * session is resumed after. Its template is "You've hit your ${…} limit": a
 * session limit, a weekly or a fast one, a monthly spend limit. The run logs
 * hold 58 of them, every one "You've hit your session limit · resets …".
 * Older runtimes said "usage limit reached". A rate limit (429) or an overload
 * is an outage and is waited out, but it stopped nothing a resume would keep.
 */
export function isUsageLimit(text: string): boolean {
  return /you(?:'|\u2019)ve hit your\b[^\n]{0,60}?\blimit\b/iu.test(text) || /usage limit reached/iu.test(text);
}

/** The reset a limit names, as it names it — "resets 11:50am (Africa/Algiers)" — for a note; null when it names none. */
export function resetPhrase(message: string): string | null {
  return /resets\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?(?:\s*\([A-Za-z]+\/[A-Za-z_]+\))?/iu.exec(message)?.[0] ?? null;
}

/** What a driver does before it tries again: the ladder's step, the stated reset, or nothing because the reset is too far off. */
export type OutageWait =
  | { readonly kind: "ladder"; readonly ms: number }
  | { readonly kind: "reset"; readonly ms: number; readonly resets: string }
  | { readonly kind: "too_long"; readonly ms: number; readonly resets: string };

/**
 * X-8″ (PRDR-321): the wait before retry `step` (0-based) after `message`, or
 * null when the ladder is spent. A stated reset wins over the ladder (PRDR-189),
 * up to `MAX_RESET_WAIT_MS`; past it the driver hands the decision back.
 */
export function outageWait(message: string, step: number, now: Date = new Date()): OutageWait | null {
  const ladder = OUTAGE_BACKOFF_MS[step];
  if (ladder === undefined) return null;
  const ms = msUntilReset(message, now);
  const resets = resetPhrase(message);
  if (ms === null || resets === null) return { kind: "ladder", ms: ladder };
  return ms > MAX_RESET_WAIT_MS ? { kind: "too_long", ms, resets } : { kind: "reset", ms, resets };
}

/**
 * X-8″ (PRDR-321): the conversation the next attempt resumes after `failed`,
 * or undefined to launch it afresh. A usage limit that stopped a session after
 * its first turn keeps that session's conversation. An attempt that stopped
 * before its first turn changed nothing, so the one it resumed, if the runtime
 * took it, is resumed again. Anything else starts afresh, as it always has: a
 * crash can leave a conversation in a state no one has seen.
 */
export function conversationToResume(
  failed: { readonly sessionId?: string; readonly turns: number; readonly resume?: { readonly sessionId: string; readonly refused?: string } },
  usageLimit: boolean,
): string | undefined {
  if (failed.turns > 0) return usageLimit ? failed.sessionId : undefined;
  return failed.resume !== undefined && failed.resume.refused === undefined ? failed.resume.sessionId : undefined;
}
