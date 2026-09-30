import { describe, expect, it } from "vitest";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { ClaudeCodeBackend } from "../../src/sessions/sdk.js";

/**
 * S-6″ (PRDR-320) — a session's result says at which lifetime it ran and what
 * it wrote to the cache at each, summed from the usage its assistant messages
 * carried. The SDK streams one message per content block, and blocks of one
 * response share its id and its usage, so each response is counted once.
 */

function spec(cacheTtl?: "5m" | "1h"): SessionSpec {
  return {
    role: "audit",
    ticketId: "init",
    promptPrefix: "p",
    promptVariable: "{}",
    cwd: "/tmp",
    artifactOut: "/tmp/audit.json",
    allowedTools: [],
    permissionMode: "",
    model: "claude-opus-5-5",
    ...(cacheTtl === undefined ? {} : { cacheTtl }),
  };
}

const usage = (w5: number, w1: number) => ({
  input_tokens: 5,
  output_tokens: 1,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: w5 + w1,
  cache_creation: { ephemeral_5m_input_tokens: w5, ephemeral_1h_input_tokens: w1 },
});

/** A fake SDK stream: two responses, the first split across two content blocks, then a result. */
function streaming(capture: { env?: Record<string, string> }) {
  return (({ options }: { options: { env?: Record<string, string> } }): AsyncIterable<unknown> => {
    capture.env = options.env ?? {};
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: "assistant", message: { id: "msg_1", usage: usage(1200, 0), content: [{ type: "thinking" }] } };
        yield { type: "assistant", message: { id: "msg_1", usage: usage(1200, 0), content: [{ type: "tool_use" }] } };
        yield { type: "assistant", message: { id: "msg_2", usage: usage(300, 40), content: [{ type: "text" }] } };
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          num_turns: 2,
          total_cost_usd: 0.02,
          usage: { input_tokens: 10, output_tokens: 2 },
          modelUsage: { "claude-opus-5-5": { inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 0, cacheCreationInputTokens: 1540, costUSD: 0.02 } },
          result: "ok",
        };
      },
    };
  }) as never;
}

describe("S-6″ a session's result says its cache lifetime and its writes at each", () => {
  it("sums each response's writes once, by lifetime, and names the lifetime the session was given", async () => {
    const capture: { env?: Record<string, string> } = {};
    const backend = new ClaudeCodeBackend({ policy: { surface: ["**"], protectedGlobs: [], workRoot: "/tmp" }, queryFn: streaming(capture) });
    const result = await backend.run(spec("5m"));
    expect(result.cacheTtl).toBe("5m");
    expect(result.cacheWrites, "msg_1 once, then msg_2").toEqual({ "5m": 1500, "1h": 40 });
    expect(capture.env?.["CLAUDE_CODE_PROMPT_CACHE_TTL"], "and the session was launched with it").toBe("5m");
  });

  it("a session whose stream breaks still says what it wrote before it broke, since those writes were billed", async () => {
    const breaking = (() => ({
      async *[Symbol.asyncIterator]() {
        yield { type: "assistant", message: { id: "msg_1", usage: usage(900, 0), content: [{ type: "thinking" }] } };
        throw new Error("socket hang up");
      },
    })) as never;
    const backend = new ClaudeCodeBackend({ policy: { surface: ["**"], protectedGlobs: [], workRoot: "/tmp" }, queryFn: breaking });
    const result = await backend.run(spec("5m"));
    expect(result.ok).toBe(false);
    expect([result.cacheTtl, result.cacheWrites]).toEqual(["5m", { "5m": 900, "1h": 0 }]);
  });

  it("a session given no lifetime ran at one hour, and says so", async () => {
    const backend = new ClaudeCodeBackend({ policy: { surface: ["**"], protectedGlobs: [], workRoot: "/tmp" }, queryFn: streaming({}) });
    expect((await backend.run(spec())).cacheTtl).toBe("1h");
  });
});
