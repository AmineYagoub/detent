import type { PlanQuestion } from "../schemas/init.js";

/**
 * C-3″ (PRDR-207) — one question, asked once.
 *
 * C-3′ batches every stage's questions at PRESENT and dedups them on exact
 * text. gate-313 asked the founder which npm identity publishes Detent at
 * ANALYZE, and again — in s14's own words — at PLAN: two paid assumptions,
 * two answers. The stages that draft are handed what was already asked
 * (`open_questions`, in their inputs); this is the backstop for what still
 * slips through: two questions whose vocabularies overlap past a threshold
 * are one question, and the human sees one entry naming both ids.
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

/**
 * What a drafting stage is handed, and told, about the questions already
 * asked — only when there are any, so a root with none gets the bytes it
 * always got (S-6/C-8).
 */
export function openQuestionsInput(questions: readonly PlanQuestion[] | undefined): Record<string, unknown> {
  if (questions === undefined || questions.length === 0) return {};
  return { open_questions: questions.map((q) => ({ id: q.id, question: q.question, assumption: q.assumption })) };
}

export function openQuestionsInstruction(questions: readonly PlanQuestion[] | undefined, askedBy: string): string {
  if (questions === undefined || questions.length === 0) return "";
  return ` \`open_questions\` lists what ${askedBy} already asked the human, each with the assumption the plan proceeds on: do NOT ask any of them again, in any words; if this stage needs a different assumption, record the difference where it decides — a ticket's \`description\`, a slice's \`rationale\` (C-3″).`;
}
