import { describe, expect, it } from "vitest";
import { ClaudeCodeBackend, isModelUnavailable } from "../../src/sessions/sdk.js";
import type { SessionSpec } from "../../src/sessions/backend.js";

/**
 * PRDR-114 — a routed model the runtime cannot serve is a configuration
 * fact, not a crashed session. Observed live: `claude-fable-5-1` on runtime
 * 2.1.191 returned "does not support this model", counted as a crash.
 */

const REFUSAL = "Claude Code returned an error result: API Error: 400 Claude Code 2.1.191 does not support this model; version 2.1.251 or later is required";

function spec(model: string): SessionSpec {
  return {
    role: "review",
    ticketId: "t1",
    promptPrefix: "p",
    promptVariable: "{}",
    cwd: "/tmp",
    artifactOut: "/tmp/review.json",
    allowedTools: [],
    permissionMode: "plan",
    model,
  };
}

/** A fake SDK: refuses the named models the way the runtime does, answers "ok" otherwise. */
function fakeQuery(unavailable: readonly string[]): { query: NonNullable<ConstructorParameters<typeof ClaudeCodeBackend>[0]["queryFn"]>; calls: string[] } {
  const calls: string[] = [];
  const query = ({ options }: { prompt: string; options: { model?: string } }): AsyncIterable<unknown> => {
    const model = options.model ?? "";
    calls.push(model);
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: "assistant" };
        if (unavailable.includes(model)) throw new Error(REFUSAL);
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          num_turns: 1,
          total_cost_usd: 0.01,
          usage: { input_tokens: 10, output_tokens: 1 },
          modelUsage: { [model === "" ? "runtime-default" : model]: { inputTokens: 10, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.01 } },
          result: "ok",
        };
      },
    };
  };
  return { query: query as never, calls };
}

describe("PRDR-114 model fallback", () => {
  it("recognises the runtime's refusal on a work-free session, and nothing else", () => {
    const base = { telemetryParsed: true, costEstimateUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
    expect(isModelUnavailable({ ...base, ok: false, crashed: true, turns: 1, rawTail: REFUSAL })).toBe(true);
    expect(isModelUnavailable({ ...base, ok: false, crashed: true, turns: 1, rawTail: "model claude-x not found" })).toBe(true);
    /* A real crash after real work is a crash. */
    expect(isModelUnavailable({ ...base, ok: false, crashed: true, turns: 40, rawTail: REFUSAL })).toBe(false);
    expect(isModelUnavailable({ ...base, ok: false, crashed: true, turns: 1, rawTail: "usage limit reached" })).toBe(false);
    expect(isModelUnavailable({ ...base, ok: true, turns: 1, rawTail: "ok" })).toBe(false);
  });

  it("falls back to the runtime default once, then skips straight to it for the rest of the run", async () => {
    const fake = fakeQuery(["claude-fable-5-1"]);
    const backend = new ClaudeCodeBackend({ policy: { surface: ["**"], protectedGlobs: [], workRoot: "/tmp" }, queryFn: fake.query });

    const first = await backend.run(spec("claude-fable-5-1"));
    expect(first.ok).toBe(true);
    expect(first.modelFallback).toEqual({ requested: "claude-fable-5-1", reason: REFUSAL.slice(0, 200) });
    expect(fake.calls).toEqual(["claude-fable-5-1", ""]);

    const second = await backend.run(spec("claude-fable-5-1"));
    expect(second.ok).toBe(true);
    expect(second.modelFallback?.requested).toBe("claude-fable-5-1");
    /** No second $0 crash: the model is remembered as unavailable for the run. */
    expect(fake.calls).toEqual(["claude-fable-5-1", "", ""]);

    const served = await backend.run(spec("claude-opus-5"));
    expect(served.ok).toBe(true);
    expect(served.modelFallback).toBeUndefined();
  });
});
