import { execFileSync } from "node:child_process";
import type { Options, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { fullPrompt, type SessionBackend, type SessionResult, type SessionSpec } from "./backend.js";
import { guardToolUse, stopGate, type GuardPolicy } from "./guard.js";

/**
 * T-046 — the Claude Agent SDK backend (S-1…S-6, D-21, D-22).
 *
 * Everything decidable without a live session is a pure function here —
 * option construction, the hook wiring, telemetry parsing — and is what the
 * test suite covers. The live transport (`query()` itself) is exercised by
 * `doctor`'s smoke session and the M2 exit run under R-10's key gate; per the
 * plan, only transport is live-risk.
 */

export interface SdkBackendConfig {
  readonly policy: GuardPolicy;
  /** X-6/S-3 docs domains for research roles. No config home yet: PRDR-062. */
  readonly docsDomains?: readonly string[];
  /** The scoped gate the Stop hook runs (S-2's continuation accelerant). */
  readonly runScopedGate?: (command: string) => Promise<{ green: boolean; outputTail: string }>;
  readonly gateCmd?: string | null;
}

/**
 * D-21: the guard is a PreToolUse hook — the only layer the backend runs on
 * EVERY tool call, ahead of deny/ask/mode/allow. `canUseTool` is deliberately
 * absent from the options this module builds: a callback there would be
 * skipped for exactly the writing tools S-3 grants (the shadowing failure).
 */
export function buildPreToolUseHook(policy: GuardPolicy): NonNullable<Options["hooks"]> {
  return {
    PreToolUse: [
      {
        hooks: [
          async (input) => {
            const toolInput = (input as { tool_input?: unknown }).tool_input;
            const decision = guardToolUse(toolInput, policy);
            return {
              hookSpecificOutput: {
                hookEventName: "PreToolUse" as const,
                permissionDecision: decision.decision,
                permissionDecisionReason: decision.reason,
              },
            };
          },
        ],
      },
    ],
  };
}

export function buildStopHook(config: SdkBackendConfig, role: string): NonNullable<Options["hooks"]> {
  const runScopedGate = config.runScopedGate;
  if (runScopedGate === undefined) return {};
  return {
    Stop: [
      {
        hooks: [
          async (input) => {
            const active = Boolean((input as { stop_hook_active?: unknown }).stop_hook_active);
            const decision = await stopGate(
              { stage: role, gateCmd: config.gateCmd ?? null, stopHookActive: active },
              runScopedGate,
            );
            if (decision.decision === "allow") return { continue: true };
            return { decision: "block" as const, reason: decision.reason };
          },
        ],
      },
    ],
  };
}

/**
 * The full option set for one session. Two lines are load-bearing security
 * decisions with their own regression tests:
 *
 * - `settingSources: []` (D-22/PRDR-051): the SDK's default enables project
 *   scope, which resolves against the repository under work — a committed
 *   settings file could add allow rules. Empty means no user, project, or
 *   local settings file contributes anything to a Detent session.
 * - `hooks.PreToolUse` (D-21/PRDR-050): containment that allow rules cannot
 *   shadow.
 */
export function buildOptions(spec: SessionSpec, config: SdkBackendConfig): Options {
  return {
    cwd: spec.cwd,
    settingSources: [],
    permissionMode: spec.permissionMode === "plan" ? "plan" : "default",
    allowedTools: [...spec.allowedTools],
    maxTurns: spec.maxTurns,
    ...(spec.model === "" ? {} : { model: spec.model }),
    hooks: {
      ...buildPreToolUseHook(config.policy),
      ...buildStopHook(config, spec.role),
    },
  };
}

/*
 * ---------------------------------------------------------------------------
 * Telemetry (S-4, PRDR-052/053)
 */

interface ModelUsageLike {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadInputTokens?: number;
  readonly cacheCreationInputTokens?: number;
  readonly costUSD?: number;
}

/**
 * S-4's field discipline, applied at the parse: the per-model breakdown is the
 * token source of record (it includes nested-agent tokens and the response
 * that crossed a budget ceiling; the cumulative `usage` field excludes both);
 * cost is the client-side estimate; a result whose telemetry fields are absent
 * trips the breaker; a crash result with ZEROED fields is not absent and not
 * free — it is flagged so the ledger records a lower bound (PRDR-053).
 */
export function parseResultMessage(message: unknown): SessionResult {
  const m = message as Partial<SDKResultMessage> & { modelUsage?: Record<string, ModelUsageLike> };
  const ok = m.is_error !== true;

  const hasTelemetry = m.total_cost_usd !== undefined && (m.modelUsage !== undefined || m.usage !== undefined);
  if (!hasTelemetry) {
    return {
      ok,
      telemetryParsed: false,
      costEstimateUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      turns: 0,
      rawTail: "",
    };
  }

  const perModelEntries = Object.entries(m.modelUsage ?? {});
  const sum = (pick: (u: ModelUsageLike) => number | undefined): number =>
    perModelEntries.reduce((acc, [, u]) => acc + (pick(u) ?? 0), 0);

  const fromBreakdown = perModelEntries.length > 0;
  const usage = (m.usage ?? {}) as { input_tokens?: number; output_tokens?: number };

  const inputTokens = fromBreakdown ? sum((u) => u.inputTokens) : (usage.input_tokens ?? 0);
  const outputTokens = fromBreakdown ? sum((u) => u.outputTokens) : (usage.output_tokens ?? 0);
  const cost = m.total_cost_usd ?? 0;

  const zeroed = cost === 0 && inputTokens === 0 && outputTokens === 0;
  const crashed = m.subtype === "error_during_execution" && zeroed;

  const perModel =
    perModelEntries.length === 0
      ? {}
      : {
          perModel: Object.fromEntries(
            perModelEntries.map(([model, u]) => [
              model,
              {
                inputTokens: u.inputTokens ?? 0,
                outputTokens: u.outputTokens ?? 0,
                cacheReadInputTokens: u.cacheReadInputTokens ?? 0,
                cacheCreationInputTokens: u.cacheCreationInputTokens ?? 0,
                costUSD: u.costUSD ?? 0,
              },
            ]),
          ),
        };

  return {
    ok,
    telemetryParsed: true,
    costEstimateUsd: cost,
    inputTokens,
    outputTokens,
    cacheReadInputTokens: fromBreakdown ? sum((u) => u.cacheReadInputTokens) : 0,
    cacheCreationInputTokens: fromBreakdown ? sum((u) => u.cacheCreationInputTokens) : 0,
    turns: m.num_turns ?? 0,
    rawTail: typeof (m as { result?: unknown }).result === "string" ? ((m as { result: string }).result.slice(-2000)) : "",
    ...(crashed ? { crashed: true } : {}),
    ...perModel,
  };
}

/*
 * ---------------------------------------------------------------------------
 * The live backend (transport — exercised under R-10's key gate only)
 */

export class ClaudeCodeBackend implements SessionBackend {
  readonly name = "claude-code";

  constructor(private readonly config: SdkBackendConfig) {}

  async checkVersion(pinned: string): Promise<void> {
    let installed: string;
    try {
      installed = execFileSync("claude", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch {
      throw new Error(`claude CLI not found on PATH; install the pinned version (${pinned}) — S-5`);
    }
    if (!installed.includes(pinned)) {
      throw new Error(`backend version mismatch (S-5): pinned=${pinned} installed=${installed}`);
    }
  }

  async run(spec: SessionSpec): Promise<SessionResult> {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const stream = query({ prompt: fullPrompt(spec), options: buildOptions(spec, this.config) });
    let result: SessionResult | null = null;
    for await (const message of stream) {
      if ((message as { type?: string }).type === "result") {
        result = parseResultMessage(message);
      }
    }
    /* A stream that ended with no result message is the absent-telemetry case. */
    return result ?? parseResultMessage({});
  }
}
