import type { CacheLifetime } from "../schemas/cache-lifetime.js";
import type { ModelTokenUsage } from "./backend.js";
import { CHEAPEST_PRICE, knownPrice } from "./prices.js";

/**
 * S-6″, X-8″ (PRDR-320, PRDR-321) — the usage a session's responses carried,
 * read off the stream rather than the result.
 *
 * The SDK streams one assistant message per content block, and the blocks of
 * one response share its id and its usage, so a response is counted once, by
 * id, whichever of its blocks arrived last. What a response wrote to the cache
 * is known when it starts, so a response cut off mid-way still carries it.
 * Its output is not: a block's usage counts the output streamed so far, so a
 * figure summed here is a lower bound, which is what a session that died
 * before its result message leaves.
 */
interface ResponseUsage {
  readonly model: string;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
  readonly writes5m: number;
  readonly writes1h: number;
}

/** What a session spent by the stream's count, in `SessionResult`'s fields. */
export interface StreamSpend {
  readonly costEstimateUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly perModel?: Readonly<Record<string, ModelTokenUsage>>;
}

const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

interface StreamedUsage {
  readonly input_tokens?: unknown;
  readonly output_tokens?: unknown;
  readonly cache_read_input_tokens?: unknown;
  readonly cache_creation_input_tokens?: unknown;
  readonly cache_creation?: { readonly ephemeral_5m_input_tokens?: unknown; readonly ephemeral_1h_input_tokens?: unknown };
}

export class StreamUsage {
  private readonly byResponse = new Map<string, ResponseUsage>();

  /** Reads an SDK message; anything but an assistant message with an id and a usage is ignored. */
  add(message: unknown): void {
    const m = message as { type?: unknown; message?: { id?: unknown; model?: unknown; usage?: StreamedUsage } };
    if (m.type !== "assistant" || typeof m.message?.id !== "string" || m.message.usage === undefined) return;
    const u = m.message.usage;
    this.byResponse.set(m.message.id, {
      model: typeof m.message.model === "string" ? m.message.model : "",
      input: count(u.input_tokens),
      output: count(u.output_tokens),
      cacheRead: count(u.cache_read_input_tokens),
      cacheCreation: count(u.cache_creation_input_tokens),
      writes5m: count(u.cache_creation?.ephemeral_5m_input_tokens),
      writes1h: count(u.cache_creation?.ephemeral_1h_input_tokens),
    });
  }

  /** What the responses wrote to the cache at each lifetime. */
  cacheWrites(): Record<CacheLifetime, number> {
    let fiveMinutes = 0;
    let oneHour = 0;
    for (const u of this.byResponse.values()) {
      fiveMinutes += u.writes5m;
      oneHour += u.writes1h;
    }
    return { "5m": fiveMinutes, "1h": oneHour };
  }

  /**
   * X-8″ (PRDR-321): what the responses spent, priced per model at list
   * prices. A write the usage does not split by lifetime is priced at five
   * minutes, the cheaper, and a model the table does not know at the cheapest
   * price it does, so the figure stays a lower bound. A `<synthetic>` message
   * is Claude Code's own note of a limit or an error, not a request, and
   * carries no usage worth a price.
   */
  spent(): StreamSpend {
    const perModel = new Map<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; costUSD: number }>();
    for (const u of this.byResponse.values()) {
      if (u.model === "<synthetic>") continue;
      const price = knownPrice(u.model) ?? CHEAPEST_PRICE;
      const unsplit = Math.max(0, u.cacheCreation - u.writes5m - u.writes1h);
      const cost =
        (u.input * price.input + u.output * price.output + u.cacheRead * price.cacheRead + (u.writes5m + unsplit) * price.write5m + u.writes1h * price.write1h) / 1e6;
      const key = u.model === "" ? "unknown" : u.model;
      const was = perModel.get(key) ?? { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 };
      perModel.set(key, {
        inputTokens: was.inputTokens + u.input,
        outputTokens: was.outputTokens + u.output,
        cacheReadInputTokens: was.cacheReadInputTokens + u.cacheRead,
        cacheCreationInputTokens: was.cacheCreationInputTokens + u.cacheCreation,
        costUSD: was.costUSD + cost,
      });
    }
    const all = [...perModel.values()];
    const sum = (pick: (m: (typeof all)[number]) => number): number => all.reduce((acc, m) => acc + pick(m), 0);
    return {
      costEstimateUsd: sum((m) => m.costUSD),
      inputTokens: sum((m) => m.inputTokens),
      outputTokens: sum((m) => m.outputTokens),
      cacheReadInputTokens: sum((m) => m.cacheReadInputTokens),
      cacheCreationInputTokens: sum((m) => m.cacheCreationInputTokens),
      ...(perModel.size === 0 ? {} : { perModel: Object.fromEntries(perModel) }),
    };
  }
}
