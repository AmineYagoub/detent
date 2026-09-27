/**
 * C-4⁗′ (PRDR-118) — one relaunch for an artifact its validator refused.
 *
 * PRDR-116 gave the plan REVIEW a second attempt carrying the validator's own
 * words, because a sound review was thrown away over one wrong token. The
 * lesson was applied one level too low: the review's artifact is the simplest
 * one planning produces, while the SLICE and PLAN artifacts are the strictest
 * and by far the most expensive — and they had no second attempt at all.
 *
 * That asymmetry is survivable for a single-pass plan and not for a sliced
 * one. A twenty-slice product asks for thirty to sixty independent strict
 * artifacts; at a one-percent chance of a stray key in any of them, better
 * than a third of runs abort hours in. So every artifact an `init` session
 * writes gets one relaunch, the validator's issue in its inputs, before
 * anything follows from its failure. This serves AUDIT's survey and claim
 * briefs, DECIDE, WRITE, VALIDATE's rounds, SLICE and PLAN's drafts. The plan
 * review relaunches by its own loop in `plan-review.ts`, which also reads a
 * synonym for its verdict (C-4⁗).
 */

export interface RetriedAttempt<T> {
  readonly value: T | null;
  readonly issue: string | null;
}

export interface RetryDeps {
  /** What to tell the session about the attempt that just failed. */
  readonly stage: string;
  readonly note?: ((text: string) => void) | undefined;
}

/**
 * Run `attempt` once; if it yields no value, run it again with the reason the
 * first one failed, so the session is told what the validator refused rather
 * than guessing. Returns the second issue when both fail, and the caller says
 * what follows: most fail their phase, and AUDIT records the claim unverified
 * and goes on (C-2¹¹).
 */
export async function withOneRelaunch<T>(
  deps: RetryDeps,
  attempt: (previous: { readonly issue: string } | null) => Promise<RetriedAttempt<T>>,
): Promise<RetriedAttempt<T>> {
  const first = await attempt(null);
  if (first.value !== null) return first;

  deps.note?.(`${deps.stage} artifact unusable (${first.issue}) — relaunching once with the validator's own words (C-4⁗′)`);
  const second = await attempt({ issue: first.issue ?? "unusable" });
  if (second.value === null) {
    deps.note?.(`${deps.stage} artifact unusable again (${second.issue})`);
  }
  return second;
}

/**
 * The `previous_attempt` block for an artifact refused for what it SAYS: a quote
 * that is not in its document, an item settled twice (C-2¹¹, C-2¹²). Unlike
 * `previousAttemptInput`, it does not tell the session its content was sound.
 */
export function refusedAttemptInput(previous: { readonly issue: string } | null, what: string): Record<string, unknown> {
  if (previous === null) return {};
  return {
    previous_attempt: {
      issue: previous.issue,
      note: `Your previous ${what} was refused for the issue above. Fix what it names, and write the whole ${what} again in exactly the \`expected_output\` shape.`,
    },
  };
}

/** The `previous_attempt` block a relaunched session receives. Shared so both stages say the same thing. */
export function previousAttemptInput(previous: { readonly issue: string } | null, what: string): Record<string, unknown> {
  if (previous === null) return {};
  return {
    previous_attempt: {
      issue: previous.issue,
      note: `Your previous ${what} was refused for the issue above. Write it again in EXACTLY the \`expected_output\` shape — same keys, no extras. The content of the previous attempt was sound to keep; only its shape was refused.`,
    },
  };
}
