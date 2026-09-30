import type { CacheLifetime } from "../schemas/cache-lifetime.js";

/**
 * S-6″ (PRDR-320) — the usage a session's responses carried, read off the
 * stream rather than the result.
 *
 * The SDK streams one assistant message per content block, and the blocks of
 * one response share its id and its usage, so a response is counted once, by
 * id, whichever of its blocks arrived last. What a response wrote to the cache
 * is known when it starts, so a response cut off mid-way still carries it.
 */
interface ResponseUsage {
  readonly writes5m: number;
  readonly writes1h: number;
}

const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

export class StreamUsage {
  private readonly byResponse = new Map<string, ResponseUsage>();

  /** Reads an SDK message; anything but an assistant message with an id and a usage is ignored. */
  add(message: unknown): void {
    const m = message as { type?: unknown; message?: { id?: unknown; usage?: { cache_creation?: { ephemeral_5m_input_tokens?: unknown; ephemeral_1h_input_tokens?: unknown } } } };
    if (m.type !== "assistant" || typeof m.message?.id !== "string" || m.message.usage === undefined) return;
    const split = m.message.usage.cache_creation;
    this.byResponse.set(m.message.id, { writes5m: count(split?.ephemeral_5m_input_tokens), writes1h: count(split?.ephemeral_1h_input_tokens) });
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
}
