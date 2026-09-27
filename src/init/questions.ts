/**
 * C-3‴ (PRDR-207) — one question, asked once.
 *
 * gate-313 asked the founder which npm identity publishes Detent at ANALYZE,
 * and again, in s14's own words, at PLAN: two paid assumptions, two answers.
 * Two questions whose vocabularies overlap past a threshold are one question.
 *
 * C-3⁗, C-4⁵ (PRDR-292): no planning stage asks now. DECIDE asks the founder,
 * and uses `similarQuestions` to refuse a question the decision log already
 * answers; what a pack leaves open, PLAN reports as a spec defect. PRESENT's
 * merge of the stages' questions went with its question list (C-7‴,
 * PRDR-296).
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
