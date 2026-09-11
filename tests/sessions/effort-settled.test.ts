import { describe, expect, it } from "vitest";
import { buildPreToolUseHook } from "../../src/sessions/sdk.js";
import { STRUCTURAL_PROTECTED } from "../../src/schemas/common.js";
import type { GuardPolicy } from "../../src/sessions/guard.js";

/**
 * PRDR-237 — the effort a session RAN at, not the one it was asked for.
 *
 * PRDR-235 records the routed level at `start`. The sentence that justified
 * recording it at all is about the other half: "the SDK downgrades silently for
 * a model that cannot serve one, which is why a configured effort is recorded
 * per session rather than assumed to have been honoured" (schemas/roles.ts).
 * Recording the request does not detect a downgrade; reading what the model
 * settled on does.
 *
 * The SDK publishes it on every tool-context hook input as `effort.level`,
 * documented as the active level "after any silent downgrade for the selected
 * model" (sdk.d.ts:185-189). Detent runs a PreToolUse hook on every tool call
 * and read `tool_name` and `tool_input` off that input, dropping the rest.
 */
const POLICY: GuardPolicy = { surface: ["**"], protectedGlobs: [...STRUCTURAL_PROTECTED, "AGENTS.md"], workRoot: "/wt" };

function fire(hooks: ReturnType<typeof buildPreToolUseHook>, effort?: { level: string }): Promise<unknown> {
  const callback = hooks.PreToolUse?.[0]?.hooks[0];
  expect(callback).toBeDefined();
  return callback!(
    { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/wt/a.ts" }, tool_use_id: "x", ...(effort ? { effort } : {}) } as never,
    undefined,
    { signal: new AbortController().signal },
  );
}

describe("PRDR-237 the hook reports the effort the turn actually ran at", () => {
  it("reports the active level from the hook input", async () => {
    const seen: string[] = [];
    await fire(buildPreToolUseHook(POLICY, undefined, (level) => seen.push(level)), { level: "high" });
    expect(seen).toEqual(["high"]);
  });

  /* A model without effort support sends no field; that is unobserved, never agreement. */
  it("reports nothing when the input carries no effort", async () => {
    const seen: string[] = [];
    await fire(buildPreToolUseHook(POLICY, undefined, (level) => seen.push(level)));
    expect(seen).toEqual([]);
  });

  /* Every tool call carries it; the session's level is one fact, not one per call. */
  it("reports the first level only, across many tool calls", async () => {
    const seen: string[] = [];
    const hooks = buildPreToolUseHook(POLICY, undefined, (level) => seen.push(level));
    await fire(hooks, { level: "high" });
    await fire(hooks, { level: "high" });
    expect(seen).toEqual(["high"]);
  });

  /* Containment is unaffected: the observer must not change a decision. */
  it("still denies a protected write while observing", async () => {
    const hooks = buildPreToolUseHook(POLICY, undefined, () => {});
    const callback = hooks.PreToolUse?.[0]?.hooks[0];
    const out = (await callback!(
      { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "/wt/AGENTS.md" }, tool_use_id: "x", effort: { level: "max" } } as never,
      undefined,
      { signal: new AbortController().signal },
    )) as { hookSpecificOutput?: { permissionDecision?: string } };
    expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
  });
});
