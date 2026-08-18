import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXIT_HUMAN_GATED, run } from "../../src/kernel/run.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { buildOptions, buildPreToolUseHook, parseResultMessage, type SdkBackendConfig } from "../../src/sessions/sdk.js";
import { removeTree, writeTree } from "../helpers.js";
import { addTicket, implementGreen, makeRunRepo, reviewApprove } from "../kernel/run-fixture.js";

/**
 * T-046 — the SDK backend, everything decidable without a live session:
 * option construction (the two load-bearing security lines), the hook wiring,
 * and telemetry parsing over the SDK's documented result shapes. Transport is
 * exercised by doctor's smoke and the M2 exit under R-10's key gate.
 */

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

const CONFIG: SdkBackendConfig = {
  policy: { surface: ["src/**"], protectedGlobs: ["AGENTS.md"], workRoot: "/wt" },
};

function spec(over: Partial<SessionSpec> = {}): SessionSpec {
  return {
    role: "implement",
    ticketId: "t1",
    promptPrefix: "prefix",
    promptVariable: "{}",
    cwd: "/wt",
    artifactOut: "/wt/.detent/runs/t1/implement.json",
    allowedTools: ["Edit", "Write"],
    permissionMode: "",
    model: "",
    maxTurns: 30,
    ...over,
  };
}

describe("T-046 option construction (S-1, D-21, D-22)", () => {
  it("settingSources is the EMPTY SET — repository policy can never load (PRDR-051)", () => {
    const options = buildOptions(spec(), CONFIG);
    expect(options.settingSources).toEqual([]);
    // Not undefined: undefined would mean the SDK default, which enables
    // project scope resolving against the repository under work.
    expect(Object.hasOwn(options, "settingSources")).toBe(true);
  });

  it("the guard is wired as a PreToolUse hook, and canUseTool is absent (PRDR-050)", () => {
    const options = buildOptions(spec(), CONFIG);
    expect(options.hooks?.PreToolUse).toHaveLength(1);
    expect("canUseTool" in options).toBe(false);
  });

  it("read-only roles run plan mode; write roles run default", () => {
    expect(buildOptions(spec({ permissionMode: "plan" }), CONFIG).permissionMode).toBe("plan");
    expect(buildOptions(spec(), CONFIG).permissionMode).toBe("default");
  });

  it("model routing passes through only when set; turn ceiling always does (X-1)", () => {
    expect("model" in buildOptions(spec(), CONFIG)).toBe(false);
    expect(buildOptions(spec({ model: "haiku" }), CONFIG).model).toBe("haiku");
    expect(buildOptions(spec({ maxTurns: 7 }), CONFIG).maxTurns).toBe(7);
  });

  it("the hook callback denies a protected write with the reason in the decision shape", async () => {
    const hooks = buildPreToolUseHook(CONFIG.policy);
    const [matcher] = hooks.PreToolUse ?? [];
    const callback = matcher?.hooks[0];
    expect(callback).toBeDefined();
    const output = (await callback!(
      { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "/wt/AGENTS.md" }, tool_use_id: "x" } as never,
      undefined,
      { signal: new AbortController().signal },
    )) as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
    expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput?.permissionDecisionReason).toContain("protected");
  });
});

describe("T-046 telemetry parsing (S-4, PRDR-052/053)", () => {
  const SUCCESS = {
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 4,
    total_cost_usd: 0.12,
    usage: { input_tokens: 900, output_tokens: 80 },
    modelUsage: {
      "claude-opus-5": { inputTokens: 1000, outputTokens: 100, cacheReadInputTokens: 400, cacheCreationInputTokens: 50, costUSD: 0.1 },
      "claude-haiku-4-5": { inputTokens: 200, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.02 },
    },
    result: "done",
  };

  it("reads the per-model breakdown as the token source of record — not the cumulative usage field", () => {
    const parsed = parseResultMessage(SUCCESS);
    expect(parsed.telemetryParsed).toBe(true);
    // 1200 ≠ the cumulative field's 900: the breakdown includes what usage excludes.
    expect(parsed.inputTokens).toBe(1200);
    expect(parsed.outputTokens).toBe(120);
    expect(parsed.cacheReadInputTokens).toBe(400);
    expect(parsed.costEstimateUsd).toBe(0.12);
    expect(parsed.turns).toBe(4);
    expect(Object.keys(parsed.perModel ?? {})).toHaveLength(2);
  });

  it("budget-exceeded results read the breakdown, which includes the response that crossed the ceiling", () => {
    const parsed = parseResultMessage({ ...SUCCESS, subtype: "error_max_budget_usd", is_error: true });
    expect(parsed.ok).toBe(false);
    expect(parsed.inputTokens).toBe(1200); // never the omitting cumulative field
  });

  it("absent telemetry trips the breaker flag (S-4)", () => {
    const parsed = parseResultMessage({ type: "result", subtype: "success", is_error: false });
    expect(parsed.telemetryParsed).toBe(false);
  });

  it("a crash result with ZEROED telemetry is not absent and not free — flagged for the ledger (PRDR-053)", () => {
    const parsed = parseResultMessage({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      num_turns: 0,
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
      modelUsage: {},
    });
    expect(parsed.telemetryParsed).toBe(true); // zeroed ≠ absent
    expect(parsed.crashed).toBe(true);
  });
});

describe("T-046 surface requests through the loop (oracle test_surface_request_grant_and_deny)", () => {
  it("a legitimate request is granted and logged; a protected request is denied", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1" });
    addTicket(root, { id: "t2" });

    const requesting =
      (target: string): StageFn =>
      (spec) => {
        const variable = JSON.parse(spec.promptVariable) as { surface_request_out: string };
        writeTree(path.dirname(variable.surface_request_out), {
          [path.basename(variable.surface_request_out)]: JSON.stringify({ path: target, justification: "needed" }),
        });
        return implementGreen(spec);
      };

    const backend = new MockBackend({
      "t1:implement": requesting("docs/extra.md"),
      "t2:implement": requesting("AGENTS.md"), // protected (config)
      review: reviewApprove,
    });
    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "sr" });
    expect(outcome.exitCode).toBe(0);

    const t1 = readTicket(root, "t1");
    expect(t1.surface).toContain("docs/extra.md");
    expect(t1.notes.map((n) => n.text).join(" ")).toContain("surface granted: docs/extra.md");

    const t2 = readTicket(root, "t2");
    expect(t2.surface).not.toContain("AGENTS.md");
    expect(t2.notes.map((n) => n.text).join(" ")).toContain("surface DENIED: AGENTS.md");
    expect(outcome.exitCode).toBe(0); // a denied expansion is not an escalation
  });
});

describe("T-046 the S-4 breaker end to end (oracle test_unparsable_telemetry_is_budget_breaching)", () => {
  it("a session whose telemetry cannot be parsed is budget-breaching → NEEDS_HUMAN", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1" });
    const backend = new MockBackend({ implement: () => okResult({ telemetryParsed: false }) });
    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "tele" });
    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    expect(readTicket(root, "t1").state).toBe("NEEDS_HUMAN");
    expect(readTicket(root, "t1").notes.map((n) => n.text).join(" ")).toContain("telemetry unparsable");
  });
});
