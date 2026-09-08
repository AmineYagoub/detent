import { execFileSync } from "node:child_process";
import type { Options, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { fullPrompt, type SessionBackend, type SessionResult, type SessionSpec } from "./backend.js";
import { guardToolUse, stopGate, type GuardPolicy } from "./guard.js";
import { buildSessionEnv } from "./env.js";

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
  /** Test seam (PRDR-114): the SDK's `query`, injectable so the fallback can be exercised without a backend. */
  readonly queryFn?: (args: { prompt: string; options: Options }) => AsyncIterable<unknown>;
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
            const payload = input as { tool_name?: unknown; tool_input?: unknown };
            const decision = guardToolUse(
              typeof payload.tool_name === "string" ? payload.tool_name : "",
              payload.tool_input,
              policy,
            );
            /**
             * S-2‴ (PRDR-122): an abstention omits `permissionDecision`
             * entirely, so the SDK carries on to its deny/ask/allow rules. A
             * hook that answered `allow` ended the evaluation and overrode
             * `allowedTools`.
             */
            return {
              hookSpecificOutput: {
                hookEventName: "PreToolUse" as const,
                ...(decision.decision === "abstain" ? {} : { permissionDecision: decision.decision }),
                permissionDecisionReason: decision.reason,
              },
            };
          },
        ],
      },
    ],
  };
}

function buildStopHook(config: SdkBackendConfig, role: string): NonNullable<Options["hooks"]> {
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
    /**
     * SEC-4′ (PRDR-133): the allowlist is APPLIED here, and this line is the
     * whole control. `buildSessionEnv` existed, was tested and was green, and
     * had no production caller — the SDK inherits `process.env` when `env` is
     * omitted, so every session held the operator's cloud credentials, deploy
     * keys and tokens while SEC-4 said they "never cross into a session".
     * `git commit -m "$AWS_SECRET_ACCESS_KEY"` matches the prefix allowlist.
     * It also carries S-6's extended cache header, which had likewise never
     * been requested by any run.
     */
    env: buildSessionEnv(),
    permissionMode: spec.permissionMode === "plan" ? "plan" : "default",
    allowedTools: [...spec.allowedTools],
    /**
     * S-3′ (PRDR-121): the optional symbol server, when the adapter granted
     * one. Its READ tools are in `allowedTools`; nothing else it exposes is
     * reachable, and `assertNoEditingTools` refuses an allowlist that tries.
     */
    ...(spec.mcpServers === undefined ? {} : { mcpServers: spec.mcpServers as NonNullable<Options["mcpServers"]> }),
    /** X-1″ (PRDR-106): no ceiling unless a caller sets one — only the doctor probe does. */
    ...(spec.maxTurns === undefined ? {} : { maxTurns: spec.maxTurns }),
    ...(spec.model === "" ? {} : { model: spec.model }),
    hooks: {
      /** S-2′: the per-ticket policy wins; construction policy is the fallback. */
      ...buildPreToolUseHook(spec.policy ?? config.policy),
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

  /**
   * S-4 (PRDR-181): telemetry is present only when it carries USAGE, not merely
   * a `modelUsage` key.
   *
   * `total_cost_usd` plus an EMPTY `modelUsage: {}` satisfied this and parsed as
   * telemetry present with zero tokens — a partial or truncated result message
   * became a ledger row of $0 and a session the spend ceiling never saw. S-4's
   * circuit breaker exists for exactly the shape that arrives half-formed, and
   * the tests only covered telemetry entirely ABSENT or a hand-injected
   * `telemetryParsed: false`, neither of which is this.
   */
  const usageEntries = Object.keys(m.modelUsage ?? {}).length;
  const hasTelemetry = m.total_cost_usd !== undefined && (usageEntries > 0 || m.usage !== undefined);
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

/**
 * PRDR-114: the runtime's own "this model does not exist here" — a version
 * that predates the model, a plan without it, a typo in the routing. Matched
 * on the runtime's wording because that is the only signal it gives; a real
 * session never produces one of these with work behind it, so the turn bound
 * keeps a genuine crash from being mistaken for an unavailable model.
 */
export function isModelUnavailable(result: SessionResult): boolean {
  if (result.ok || result.turns > 1) return false;
  return /does not support this model|model[^\n]{0,80}(not found|not available|not supported|unavailable|invalid)|unsupported model|invalid model|no such model/i.test(
    result.rawTail,
  );
}

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

  /** PRDR-114: models this runtime has already refused — one $0 crash per model per run, never per session. */
  private readonly unavailable = new Map<string, string>();

  /**
   * PRDR-114: a routed model the runtime cannot serve is not a crashed
   * session. The first refusal costs one $0 attempt; the session then runs on
   * the runtime default and says so in `modelFallback`, and every later
   * launch of that model skips straight to the fallback.
   */
  async run(spec: SessionSpec): Promise<SessionResult> {
    if (spec.model !== "") {
      const known = this.unavailable.get(spec.model);
      if (known !== undefined) {
        const fallback = await this.runOnce({ ...spec, model: "" });
        return { ...fallback, modelFallback: { requested: spec.model, reason: known } };
      }
      const first = await this.runOnce(spec);
      if (!isModelUnavailable(first)) return first;
      const reason = first.rawTail.trim().slice(0, 200);
      this.unavailable.set(spec.model, reason);
      const fallback = await this.runOnce({ ...spec, model: "" });
      return { ...fallback, modelFallback: { requested: spec.model, reason } };
    }
    return await this.runOnce(spec);
  }

  private async runOnce(spec: SessionSpec): Promise<SessionResult> {
    const query = this.config.queryFn ?? (await import("@anthropic-ai/claude-agent-sdk")).query;
    let result: SessionResult | null = null;
    let observedTurns = 0;
    let mcpFailures: { name: string; status: string }[] | null = null;
    try {
      const stream = query({ prompt: fullPrompt(spec), options: buildOptions(spec, this.config) });
      for await (const message of stream) {
        /**
         * S-3‴ (PRDR-123): the init message is the only per-session truth
         * about whether a configured MCP server actually attached. Probing the
         * binary answers a different question — it can exist while this
         * session's server never connected — and a session that quietly lost
         * its symbol tools looked identical to one that never had them.
         * `pending` is not failure: startup is non-blocking.
         */
        if ((message as { type?: string }).type === "system") {
          const servers = (message as { mcp_servers?: { name?: unknown; status?: unknown }[] }).mcp_servers;
          if (Array.isArray(servers)) {
            const bad = servers
              .filter((s) => typeof s.status === "string" && s.status !== "connected" && s.status !== "pending")
              .map((s) => ({ name: String(s.name ?? "?"), status: String(s.status) }));
            if (bad.length > 0) mcpFailures = bad;
          }
        }
        if ((message as { type?: string }).type === "assistant") observedTurns += 1;
        if ((message as { type?: string }).type === "result") {
          result = parseResultMessage(message);
        }
      }
    } catch (err) {
      /*
       * PRDR-053: an SDK throw (max-turns, transport death) is a CRASHED
       * session, not a run-killing exception — zeroed telemetry recorded as a
       * flagged lower bound, `ok: false`, and the kernel's own gates judge
       * the tree from here (T-140: the live t-100 session hit `maxTurns` and
       * the raw throw took the whole run down as exit 1).
       *
       * PRDR-072 amendment: `num_turns` carries the OBSERVED assistant-turn
       * count from the stream — the wrap zeroes only what it truly lost
       * (cost, tokens). A maxTurns crash thus reports its real turns and
       * marches; only a session that died before its first assistant turn
       * reads as a refusal, and the referee halts the run on those alone.
       */
      /*
       * X-1″ (PRDR-106): sessions carry no turn ceiling any more, so a throw
       * here is a crash — transport death, or the doctor probe's own
       * one-turn bound — never a budget event.
       */
      return parseResultMessage({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        num_turns: observedTurns,
        total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0 },
        result: (err as Error).message,
      });
    }
    /* A stream that ended with no result message is the absent-telemetry case. */
    const out = result ?? parseResultMessage({});
    return mcpFailures === null ? out : { ...out, mcpFailures };
  }
}
