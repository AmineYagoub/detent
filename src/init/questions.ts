import type { PlanQuestion } from "../schemas/init.js";

/**
 * C-3‴ (PRDR-207) — one question, asked once.
 *
 * C-3′ batches every stage's questions at PRESENT and dedups them on exact
 * text. gate-313 asked the founder which npm identity publishes Detent at
 * ANALYZE, and again — in s14's own words — at PLAN: two paid assumptions,
 * two answers. This is the backstop for what slipped through: two questions
 * whose vocabularies overlap past a threshold are one question, and the human
 * sees one entry naming both ids.
 *
 * C-3⁗, C-4⁵ (PRDR-292): no planning stage asks now. DECIDE asks the founder,
 * and uses `similarQuestions` to refuse a question the decision log already
 * answers; what a pack leaves open, PLAN reports as a spec defect.
 *
 * Tokens are lowercase runs of letters and digits at least four long — long
 * enough to drop "which", "the", "and", "for", "npm", short enough to keep
 * "identity", "publishes", "marketplace", "credential". Jaccard over the sets.
 * gate-313's pair scores well above the threshold; its two other founder
 * questions, both beginning "Which …", score well below it.
 */
export const QUESTION_SIMILARITY = 0.5;

export function questionTokens(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []));
}

export function similarQuestions(a: string, b: string): boolean {
  const ta = questionTokens(a);
  const tb = questionTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared) >= QUESTION_SIMILARITY;
}

/** A batched question, with the ids of the questions it absorbed. */
export type PresentQuestion = PlanQuestion & { readonly also?: readonly string[] };

/**
 * Keep the first of each near-duplicate pair; the later one's id rides on it.
 * Order is preserved. Audit of PRDR-207: a kept question is blocking if ANY
 * question it absorbed was — a merge that dropped the flag would silence the
 * AWAIT_INFO the absorbed question would have raised.
 */
export function mergeSimilar(questions: readonly PlanQuestion[]): PresentQuestion[] {
  const kept: { q: PlanQuestion; also: string[] }[] = [];
  for (const q of questions) {
    const twin = kept.find((k) => similarQuestions(k.q.question, q.question));
    if (twin === undefined) kept.push({ q, also: [] });
    else {
      twin.also.push(q.id);
      if (q.blocking) twin.q = { ...twin.q, blocking: true };
    }
  }
  return kept.map(({ q, also }) => (also.length === 0 ? q : { ...q, also }));
}
