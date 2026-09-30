import type { RoleId } from "./roles.js";

/**
 * S-6″ (PRDR-320) — the prompt cache's lifetime, per kind of session.
 *
 * S-6 asked the backend for its extended lifetime on every session, and on a
 * subscription Claude Code picks one hour anyway: every one of the 38.9M
 * tokens tabachir's test run wrote to the cache was written at one hour, $8 a
 * million on Opus 5.5 against $5 at five minutes. A request more than five
 * minutes after the one before it rewrites its whole prefix at five minutes, so
 * which lifetime is cheaper depends on the gaps between a session's requests,
 * and those differ by what the session does, not by its role: the `audit`
 * role's survey wants an hour and its claim checks five minutes. A kind is the
 * role and its task.
 *
 * Measured from tabachir's 231 session transcripts (the gaps between a
 * session's requests; the cost at five minutes estimated from them, a gap over
 * five minutes priced as a rewrite of the prefix):
 *
 * | Kind | Sessions | Gaps: median, 99th percentile | Five-minute cache |
 * |---|---|---|---|
 * | AUDIT's claim checks, `audit`/`verify_claims` | 153 | 12 s, 137 s | −17.2% |
 * | VALIDATE's writer, `spec_write`/`fix` | 1 | 4 s, 223 s | −16.6% |
 * | WRITE, `spec_write`/`write` | 3 | 9 s, 203 s | −6.5% |
 * | AUDIT's triage, `audit`/`triage` | 1 | 4 s, 854 s | −2.6% |
 * | VALIDATE's reviewers, `spec_review`/`review` | 35 | 6 s, 864 s | +11.4% |
 * | AUDIT's survey, `audit`/`survey` | 4 | 6 s, 1,066 s | +12.7% |
 * | DECIDE, `spec_write`/`decide` | 1 | 4 s, 1,279 s | +12.1% |
 *
 * A kind gets five minutes only where its 99th-percentile gap is under four
 * minutes, so the triage keeps an hour though five minutes measured 2.6%
 * cheaper on it: one of its fifteen gaps was 854 seconds. The kinds no
 * transcript measured keep an hour: VALIDATE's `verify` rounds, SLICE, PLAN,
 * `plan_review` and every `run` role. `scripts/cache-gaps.ts` measures a
 * project's transcripts again, and a kind whose gaps move is moved with them.
 */
export const CACHE_LIFETIMES = ["5m", "1h"] as const;

export type CacheLifetime = (typeof CACHE_LIFETIMES)[number];

/** S-6″: the kinds measured to want five minutes, by role and task; every other kind gets one hour. */
export const FIVE_MINUTE_KINDS: Readonly<Partial<Record<RoleId, readonly string[]>>> = {
  audit: ["verify_claims"],
  spec_write: ["write", "fix"],
};

/** A 99th-percentile gap at or past this is too close to five minutes to risk rewriting the prefix. */
export const FIVE_MINUTE_P99_CEILING_S = 240;

/**
 * S-6″: the lifetime a session of `role` doing `task` gets. A session that
 * names no task, as every `run` role's does, gets one hour, as S-6 gave every
 * session.
 */
export function cacheLifetime(role: RoleId, task: string | undefined): CacheLifetime {
  return task !== undefined && (FIVE_MINUTE_KINDS[role] ?? []).includes(task) ? "5m" : "1h";
}
