/**
 * X-8″ (PRDR-321) — Anthropic's list prices, per million tokens, for pricing a
 * session's usage when the runtime reported no cost for it: a session whose
 * stream broke before its result message arrived. The runtime prices every
 * session it finishes, side requests included, and its figure stays the one
 * the ledger keeps; this prices only what the streamed messages carried.
 *
 * Opus 5.5 reads its cache at 0.05 of its input price where the others read
 * at 0.1. A five-minute write costs 1.25 of the input price and a one-hour
 * write 2 (S-6″). Checked against `scripts/cache-gaps.ts`, whose one-hour
 * prices matched tabachir's recorded costs within 1.5%.
 */
export interface ModelPrice {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly write5m: number;
  readonly write1h: number;
}

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, write5m: 5, write1h: 8 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, write5m: 6.25, write1h: 10 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, write5m: 2.5, write1h: 4 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, write5m: 2.5, write1h: 4 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, write5m: 1.25, write1h: 2 },
};

/** A model's prices, by its name or its dated id (`claude-haiku-4-5-20251001`); undefined for a model the table does not know. */
export function knownPrice(model: string): ModelPrice | undefined {
  const exact = Object.hasOwn(MODEL_PRICES, model) ? MODEL_PRICES[model] : undefined;
  if (exact !== undefined) return exact;
  const base = /^(.*)-\d{8}$/u.exec(model)?.[1];
  return base !== undefined && Object.hasOwn(MODEL_PRICES, base) ? MODEL_PRICES[base] : undefined;
}

/** The cheapest price the table knows, for a model it does not, so a figure priced with it stays a lower bound. */
export const CHEAPEST_PRICE: ModelPrice = MODEL_PRICES["claude-haiku-4-5"] ?? { input: 1, output: 5, cacheRead: 0.1, write5m: 1.25, write1h: 2 };
