/**
 * C-4⁗′ (PRDR-118) — one relaunch for every strict planning artifact.
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
 * than a third of runs abort hours in. This makes the attempt uniform: one
 * relaunch, the validator's issue in the inputs, and only then a failure.
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
 * than guessing. Returns the second issue when both fail — the caller decides
 * whether that is fatal (SLICE, PLAN) or merely advisory (a review).
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
    deps.note?.(`${deps.stage} artifact unusable again (${second.issue}) — the phase fails (P2)`);
  }
  return second;
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
