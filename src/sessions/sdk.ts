import { execFileSync } from "node:child_process";
import type { Options, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { fullPrompt, type SessionBackend, type SessionResult, type SessionSpec } from "./backend.js";
import { guardToolUse, stopGate, type GuardPolicy, carryArtifact, type ArtifactAlias } from "./guard.js";
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
  readonly runScopedGate?: (command: string, cwd?: string) => Promise<{ green: boolean; outputTail: string }>;
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
/**
 * PRDR-237: `onEffort` receives the level the turn actually ran at, ONCE.
 *
 * PRDR-235 recorded the level that was ASKED for, and the sentence justifying
 * that record (`schemas/roles.ts`) is about the other half: the SDK downgrades
 * silently for a model that cannot serve a level, so a configured effort must
 * be recorded rather than assumed honoured. Recording the request detects
 * nothing. The SDK publishes the settled value on every tool-context hook input
 * as `effort.level` — "after any silent downgrade for the selected model" — and
 * this hook, which sees every tool call a session makes, read `tool_name` and
 * `tool_input` off that input and dropped the rest.
 *
 * Reported once because it is one fact about the session, not one per call, and
 * a callback per tool call would put a journal write on the containment path.
 * A model without effort support sends no field and nothing is reported: the
 * caller records that as unobserved, never as agreement — the failure this
 * exists to prevent is a missing signal read as a matching one.
 *
 * Observation only in the narrow sense that the callback's RETURN value is
 * discarded — NOT in the sense that it cannot affect the decision. It runs
 * before `guardToolUse` and is not caught, so a throwing observer rejects the
 * call before the guard decides, and the guard's `policy` is in its lexical
 * scope. The production observer is a field assignment (`runOnce`) and the test
 * attaches a benign one; nothing fences a hostile one. `buildStopHook` and
 * `carryArtifact` share the shape. Observer isolation is not a property this
 * hook holds today, and no D-21 test supplies a hostile observer.
 */
export function buildPreToolUseHook(
  policy: GuardPolicy,
  alias?: ArtifactAlias,
  onEffort?: (level: string) => void,
): NonNullable<Options["hooks"]> {
  let reported = false;
  return {
    PreToolUse: [
      {
        hooks: [
          async (input) => {
            const payload = input as { tool_name?: unknown; tool_input?: unknown; effort?: { level?: unknown } };
            const level = payload.effort?.level;
            if (!reported && typeof level === "string" && level !== "" && onEffort !== undefined) {
              reported = true;
              onEffort(level);
            }
            const toolName = typeof payload.tool_name === "string" ? payload.tool_name : "";
            /* PRDR-205: a write to the path the session was told is carried out at the file it has. */
            const carried = alias === undefined ? null : carryArtifact(toolName, payload.tool_input, alias, policy.workRoot);
            const decision = guardToolUse(toolName, carried ?? payload.tool_input, policy);
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
                ...(carried !== null && decision.decision === "allow" ? { updatedInput: carried } : {}),
              },
            };
          },
        ],
      },
    ],
  };
}

function buildStopHook(config: SdkBackendConfig, role: string, cwd: string): NonNullable<Options["hooks"]> {
  const runScopedGate = config.runScopedGate;
  if (runScopedGate === undefined) return {};
  return {
    Stop: [
      {
        hooks: [
          async (input) => {
            const active = Boolean((input as { stop_hook_active?: unknown }).stop_hook_active);
            /* PRDR-211: the scoped gate runs where the session works — the worktree, since B-2″ — not in the root. */
            const decision = await stopGate(
              { stage: role, gateCmd: config.gateCmd ?? null, stopHookActive: active, cwd },
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
/** PRDR-237: `onEffort` is handed to the containment hook, the one layer that sees the settled level. */
export function buildOptions(spec: SessionSpec, config: SdkBackendConfig, onEffort?: (level: string) => void): Options {
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
    /**
     * C-4⁗⁵ (PRDR-210): a session someone is waiting on streams its events, so
     * the wait can end when the first response BEGINS — the moment its first
     * turn's prompt is cached — rather than when the turn completes. Requested
     * only then: nothing else reads the events, and a session nobody waits on
     * gets the stream it always had.
     */
    ...(spec.onFirstResponse === undefined ? {} : { includePartialMessages: true }),
    /**
     * PRDR-197: effort where a role is routed to one.
     *
     * Omitted entirely otherwise, so a project that configures nothing gets the
     * options it got before the key existed — the SDK's own defaults, `high`
     * with adaptive thinking.
     */
    ...(spec.effort === undefined || spec.effort === "" ? {} : { effort: spec.effort as NonNullable<Options["effort"]> }),
    hooks: {
      /** S-2′: the per-ticket policy wins; construction policy is the fallback. */
      ...buildPreToolUseHook(
        spec.policy ?? config.policy,
        spec.artifactTold === undefined ? undefined : { told: spec.artifactTold, actual: spec.artifactOut },
        onEffort,
      ),
      ...buildStopHook(config, spec.role, spec.cwd),
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
   *
   * PRDR-248: that fix closed the `modelUsage` branch and left the flat field
   * at `!== undefined`, which is the key-presence test it had just moved away
   * from — so `usage: {}`, `usage: null` and an object carrying only keys this
   * parser never reads all still counted. The two keys read off a flat usage
   * are `input_tokens` and `output_tokens` (the non-breakdown path hardcodes
   * both cache figures to 0), so a usage carrying neither bounds nothing.
   *
   * PRESENCE of those fields, never a non-zero value: PRDR-053 requires a crash
   * to report telemetry ZEROED rather than absent, and the live backend mints
   * `{ input_tokens: 0, output_tokens: 0 }` on a transport death. A value check
   * would read every crash as absent and lose the `crashed` flag.
   */
  const usageEntries = Object.keys(m.modelUsage ?? {}).length;
  const usage = (m.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
  const usageCarriesTokens = typeof usage.input_tokens === "number" || typeof usage.output_tokens === "number";
  const hasTelemetry = m.total_cost_usd !== undefined && (usageEntries > 0 || usageCarriesTokens);
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
      /**
       * PRDR-187: the REASON survives, even when the telemetry does not.
       *
       * This branch is about absent telemetry, and it discarded `result` along
       * with it — so a session limit arriving before any tokens were spent
       * produced `ok: false` with an empty tail, and the operator was told
       * "planner session failed" with nothing after the colon. PRDR-185's
       * outage retry reads that message, so it could not fire either: the one
       * shape it exists for was the one shape it could not see.
       *
       * PRDR-181 caused this. Before it, `total_cost_usd` with an empty
       * `modelUsage` counted as telemetry, so the tail was populated by the
       * path below; tightening the check correctly moved this shape here, and
       * here threw the reason away. Telemetry absence is not a reason to
       * discard the reason.
       */
      rawTail: typeof (m as { result?: unknown }).result === "string" ? (m as { result: string }).result.slice(-2000) : "",
    };
  }

  const perModelEntries = Object.entries(m.modelUsage ?? {});
  const sum = (pick: (u: ModelUsageLike) => number | undefined): number =>
    perModelEntries.reduce((acc, [, u]) => acc + (pick(u) ?? 0), 0);

  const fromBreakdown = perModelEntries.length > 0;

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
    /** PRDR-237: the level the turns actually ran at; null means no tool call reported one. */
    let settledEffort: string | null = null;
    /** C-4⁗⁵ (PRDR-210): said once, on the first frame that proves a response is under way. */
    let responded = false;
    const respond = (): void => {
      if (responded) return;
      responded = true;
      spec.onFirstResponse?.();
    };
    try {
      const stream = query({
        prompt: fullPrompt(spec),
        options: buildOptions(spec, this.config, (level) => {
          settledEffort = level;
        }),
      });
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
        /**
         * C-4⁗⁵ (PRDR-210): `message_start` is the API's first streaming event
         * for a turn — the response has begun, and the prompt that produced it
         * is cached from here. PRDR-204 fired on the completed `assistant`
         * frame, which on gate-313 arrived after the 60 s wait on three slices
         * of fourteen because the reviewer's first turn was a long generation.
         * The `assistant` frame remains the signal for a stream without events.
         */
        if (
          (message as { type?: string }).type === "stream_event" &&
          (message as { event?: { type?: string } }).event?.type === "message_start"
        ) {
          respond();
        }
        if ((message as { type?: string }).type === "assistant") {
          observedTurns += 1;
          respond();
        }
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
    const observed = settledEffort === null ? out : { ...out, effort: settledEffort };
    return mcpFailures === null ? observed : { ...observed, mcpFailures };
  }
}
