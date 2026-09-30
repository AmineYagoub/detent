import { describe, expect, it } from "vitest";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { ClaudeCodeBackend, RESUME_PROMPT } from "../../src/sessions/sdk.js";
import { knownPrice } from "../../src/sessions/prices.js";

/**
 * X-8″ (PRDR-321) — the SDK backend resumes the conversation a usage limit
 * stopped, launches afresh when the runtime will not resume it, and keeps
 * what a stopped session spent instead of recording it at $0.
 *
 * The fakes stream what 2.1.285 streams, as a live probe recorded it: every
 * message names the session, an error result arrives before the SDK throws,
 * and a resume of a conversation the runtime does not have fails before its
 * first turn with "No conversation found with session ID".
 */

const LIMIT = "Claude Code returned an error result: You've hit your session limit · resets 3pm (Africa/Algiers)";

function spec(over: Partial<SessionSpec> = {}): SessionSpec {
  return {
    role: "implement",
    ticketId: "t1",
    promptPrefix: "the role prompt",
    promptVariable: '{"inputs":{}}',
    cwd: "/tmp",
    artifactOut: "/tmp/out.json",
    allowedTools: ["Read"],
    permissionMode: "",
    model: "claude-opus-5-5",
    ...over,
  };
}

type Call = { prompt: string; options: { resume?: string } };
type Script = (call: Call) => AsyncIterable<unknown>;

function backendOf(script: Script, calls: Call[] = []): ClaudeCodeBackend {
  const queryFn = ((call: Call) => {
    calls.push(call);
    return script(call);
  }) as never;
  return new ClaudeCodeBackend({ policy: { surface: ["**"], protectedGlobs: [], workRoot: "/tmp" }, queryFn });
}

const assistant = (id: string, usage: Record<string, unknown>, model = "claude-opus-5-5", session = "sess-1") => ({
  type: "assistant",
  session_id: session,
  message: { id, model, usage, content: [{ type: "text", text: "…" }] },
});

const success = (session: string, turns = 2) => ({
  type: "result",
  session_id: session,
  subtype: "success",
  is_error: false,
  num_turns: turns,
  total_cost_usd: 0.02,
  usage: { input_tokens: 10, output_tokens: 5 },
  modelUsage: { "claude-opus-5-5": { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.02 } },
  result: "done",
});

/** What the runtime streams when it will not resume a conversation, then the SDK's throw. */
const noConversation = (id: string): Script =>
  () => ({
    async *[Symbol.asyncIterator]() {
      yield { type: "result", session_id: id, subtype: "error_during_execution", is_error: true, num_turns: 0, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } };
      throw new Error(`Claude Code returned an error result: No conversation found with session ID: ${id}`);
    },
  });

describe("X-8″ the backend resumes a stopped conversation", () => {
  it("resumes with the session's id and a prompt to carry on, not the task's prompt", async () => {
    const calls: Call[] = [];
    const backend = backendOf(
      () => ({
        async *[Symbol.asyncIterator]() {
          yield { type: "system", subtype: "init", session_id: "sess-1" };
          yield assistant("m1", { input_tokens: 2, output_tokens: 9 });
          yield success("sess-1", 1);
        },
      }),
      calls,
    );
    const result = await backend.run(spec({ resume: { sessionId: "sess-1" } }));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options.resume).toBe("sess-1");
    expect(calls[0]?.prompt).toBe(RESUME_PROMPT);
    expect([result.ok, result.sessionId, result.resume]).toEqual([true, "sess-1", { sessionId: "sess-1" }]);
  });

  it("launches afresh, with the task's own prompt, when the runtime has no such conversation, and says why", async () => {
    const calls: Call[] = [];
    let n = 0;
    const backend = backendOf((call) => {
      n += 1;
      if (n === 1) return noConversation(call.options.resume ?? "")(call);
      return {
        async *[Symbol.asyncIterator]() {
          yield assistant("m1", { input_tokens: 2, output_tokens: 9 }, "claude-opus-5-5", "sess-2");
          yield success("sess-2");
        },
      };
    }, calls);
    const result = await backend.run(spec({ resume: { sessionId: "sess-1" } }));
    expect(calls.map((c) => c.options.resume)).toEqual(["sess-1", undefined]);
    expect(calls[1]?.prompt).toBe('the role prompt\n\n{"inputs":{}}');
    expect(result.ok).toBe(true);
    expect(result.sessionId).toBe("sess-2");
    expect(result.resume?.sessionId).toBe("sess-1");
    expect(result.resume?.refused).toContain("No conversation found with session ID: sess-1");
  });

  it("returns a resume the limit stopped again before its first turn as it is, for its driver to wait out", async () => {
    const calls: Call[] = [];
    const backend = backendOf(
      () => ({
        async *[Symbol.asyncIterator]() {
          yield { type: "system", subtype: "init", session_id: "sess-1" };
          throw new Error(LIMIT);
        },
      }),
      calls,
    );
    const result = await backend.run(spec({ resume: { sessionId: "sess-1" } }));
    expect(calls).toHaveLength(1);
    expect([result.ok, result.turns, result.resume]).toEqual([false, 0, { sessionId: "sess-1" }]);
    expect(result.rawTail).toContain("session limit");
  });
});

describe("X-8″ a stopped session's spend is kept", () => {
  it("prices the usage its streamed messages carried when no result arrived, each response once, as a lower bound", async () => {
    const opus = { input_tokens: 10, output_tokens: 400, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 3000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 3000 } };
    const backend = backendOf(() => ({
      async *[Symbol.asyncIterator]() {
        yield assistant("m1", { ...opus, output_tokens: 100 });
        yield assistant("m1", opus);
        yield assistant("m2", { input_tokens: 5, output_tokens: 50, cache_read_input_tokens: 23_000, cache_creation_input_tokens: 800 });
        yield { type: "assistant", session_id: "sess-1", message: { id: "note", model: "<synthetic>", usage: { input_tokens: 0, output_tokens: 0 }, content: [] } };
        throw new Error(LIMIT);
      },
    }));
    const result = await backend.run(spec());
    const p = knownPrice("claude-opus-5-5");
    if (p === undefined) throw new Error("no price for Opus 5.5");
    const expected = (10 * p.input + 400 * p.output + 20_000 * p.cacheRead + 3000 * p.write1h + (5 * p.input + 50 * p.output + 23_000 * p.cacheRead + 800 * p.write5m)) / 1e6;
    expect(result.costEstimateUsd).toBeCloseTo(expected, 12);
    expect(result.costEstimateUsd).toBeGreaterThan(0);
    expect([result.inputTokens, result.outputTokens, result.cacheReadInputTokens, result.cacheCreationInputTokens]).toEqual([15, 450, 43_000, 3800]);
    expect(Object.keys(result.perModel ?? {})).toEqual(["claude-opus-5-5"]);
    expect([result.ok, result.crashed, result.sessionId]).toEqual([false, true, "sess-1"]);
    expect(result.rawTail).toContain("resets 3pm (Africa/Algiers)");
  });

  it("keeps the runtime's own error result, its side requests included, when one arrived before the SDK threw", async () => {
    const backend = backendOf(() => ({
      async *[Symbol.asyncIterator]() {
        yield assistant("m1", { input_tokens: 2, output_tokens: 16 }, "claude-sonnet-5-5");
        yield {
          type: "result",
          session_id: "sess-1",
          subtype: "error_max_turns",
          is_error: true,
          num_turns: 2,
          total_cost_usd: 0.0037163,
          usage: { input_tokens: 2, output_tokens: 137 },
          modelUsage: {
            "claude-sonnet-5-5": { inputTokens: 2, outputTokens: 137, cacheReadInputTokens: 854, cacheCreationInputTokens: 473, costUSD: 0.0027273 },
            "claude-haiku-4-5-20251001": { inputTokens: 919, outputTokens: 14, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.000989 },
          },
        };
        throw new Error("Claude Code returned an error result: Reached maximum number of turns (1)");
      },
    }));
    const result = await backend.run(spec({ model: "claude-sonnet-5-5" }));
    expect(result.costEstimateUsd).toBe(0.0037163);
    expect(result.turns).toBe(2);
    expect(Object.keys(result.perModel ?? {}).sort()).toEqual(["claude-haiku-4-5-20251001", "claude-sonnet-5-5"]);
    expect([result.ok, result.crashed]).toEqual([false, true]);
  });

  it("still records $0 for a limit that arrives before any token is spent", async () => {
    const backend = backendOf(() => ({
      async *[Symbol.asyncIterator]() {
        yield { type: "system", subtype: "init", session_id: "sess-9" };
        throw new Error(LIMIT);
      },
    }));
    const result = await backend.run(spec());
    expect([result.costEstimateUsd, result.turns, result.crashed, result.sessionId]).toEqual([0, 0, true, "sess-9"]);
  });

  it("prices a write the usage does not split at five minutes, and a model it does not know at the cheapest price", async () => {
    const backend = backendOf(() => ({
      async *[Symbol.asyncIterator]() {
        yield assistant("m1", { input_tokens: 1000, output_tokens: 1000, cache_creation_input_tokens: 1000 }, "claude-opus-9");
        throw new Error("socket hang up");
      },
    }));
    const result = await backend.run(spec({ model: "" }));
    const haiku = knownPrice("claude-haiku-4-5-20251001");
    if (haiku === undefined) throw new Error("no price for Haiku 4.5");
    expect(result.costEstimateUsd).toBeCloseTo((1000 * haiku.input + 1000 * haiku.output + 1000 * haiku.write5m) / 1e6, 12);
  });
});
