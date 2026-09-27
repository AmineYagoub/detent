import { createHash } from "node:crypto";
import type { PromptId, RoleId } from "../schemas/roles.js";
import type { GuardPolicy } from "./guard.js";
import type { ScratchGrant } from "./sandbox.js";

/**
 * T-040 — the SessionBackend seam (ARCH-1, D-19).
 *
 * This interface is the kernel's ONLY session-facing surface: the kernel
 * builds a spec, receives artifacts-on-disk plus telemetry back, and decides
 * everything else itself. The R-5 lint zones enforce that `src/kernel/**`
 * imports nothing from `src/sessions/**` beyond this file.
 *
 * A backend never applies events, never writes ticket state, and its `ok` is
 * process-level success — NOT gate success, which only the kernel's own gate
 * run may establish (P2).
 */

export interface SessionSpec {
  readonly role: RoleId;
  readonly ticketId: string;
  /** Stable per role within a run, byte-identical (S-6). */
  readonly promptPrefix: string;
  /** Per-ticket variable suffix. */
  readonly promptVariable: string;
  readonly cwd: string;
  /** Where the session writes its artifact. Artifacts are the interface (P2). */
  readonly artifactOut: string;
  /** What the session may use without asking: its role's tools and rules (S-1), enforced beside the D-21 hook. */
  readonly allowedTools: readonly string[];
  /**
   * C-4⁵ (PRDR-292): the built-in tools the session has at all. `allowedTools`
   * grants without asking and removes nothing: in the default mode the platform
   * grants read-only Bash whatever it names, and planner sessions ran it 2,846
   * times in the planning audit. S-1⁵ (PRDR-302): absent, the SDK backend
   * derives it from `allowedTools` (`builtinTools`), so every session has the
   * built-in tools its role names and no others; a spec names its own only
   * where its role's set is fixed by name, as the planning roles' is.
   */
  readonly tools?: readonly string[];
  /** S-1′: `"plan"` for an artifact-less session (doctor's smoke), empty otherwise: a read-only role writes its artifact. */
  readonly permissionMode: "" | "plan";
  /** Model routing per role; empty means the backend's default. */
  readonly model: string;
  /**
   * PRDR-197: the effort this role is routed to, or absent for the runtime's
   * own default. Absent means the options are what they were before the knob
   * existed — that invisibility is the point of the default.
   */
  readonly effort?: string;
  /**
   * X-1″ (PRDR-106): no ceiling by default. The referee and init never set
   * one; the doctor probe bounds itself to a single turn, and that is the
   * only caller that does.
   */
  readonly maxTurns?: number;
  /**
   * S-2′/D-21: the PER-TICKET containment policy for this session's hook —
   * the ticket's declared surface plus the artifact area, resolved against
   * this session's work root. Absent (init sessions, fixtures), the backend
   * falls back to its construction-time policy. Found missing by T-140's
   * self-build preparation: without it every live worker session ran under
   * the backend's one fixed policy, and D-21's per-ticket surface never
   * reached the hook.
   */
  readonly policy?: GuardPolicy;
  /**
   * S-3⁸ (PRDR-121): MCP servers this session may call, by name. Only ever the
   * optional symbol-intelligence server, and only its READ tools — the
   * allowlist is what grants them, and `assertNoEditingTools` refuses any tool
   * that would write outside the D-21 hook's sight.
   */
  readonly mcpServers?: Readonly<Record<string, unknown>>;
  /**
   * S-1⁗ (PRDR-285): a VALIDATE reviewer's scratch directory, and the
   * interpreters the sandbox offers there. Present, the backend serves the
   * session one more tool beside any server above, the one that runs a script
   * in that directory, sandboxed (`SCRATCH_TOOL`). Only a `spec_review`
   * session ever carries it: `src/init/session.ts` refuses it to every other
   * role, and the referee's session arm never sets it.
   */
  readonly scratch?: ScratchGrant;
}

/**
 * S-1′ (PRDR-067): the ONE write rule an artifact-producing read-only session
 * gets — its own `artifact_out`, in the backend's gitignore-style specifier
 * syntax (`//` = absolute path). S-3's mechanism, S-3's arbiter: a backend
 * that stops recognizing the form is a `doctor` failure, never a silent
 * no-op. Composed here on the kernel-visible seam so both spec builders
 * (init and the referee's session arm) share one spelling.
 */
export function artifactWriteRule(absArtifactPath: string): string {
  return `Write(/${absArtifactPath})`;
}

export function fullPrompt(spec: SessionSpec): string {
  return `${spec.promptPrefix}\n\n${spec.promptVariable}`;
}

/** S-6's per-role prefix identity, as recorded for cache-hit accounting. */
export function prefixHash(spec: SessionSpec): string {
  return createHash("sha256").update(spec.promptPrefix).digest("hex").slice(0, 16);
}

/**
 * Telemetry per S-4, in the shape the ledger records. Cost is the backend's
 * client-side estimate, named accordingly (PRDR-052). `telemetryParsed: false`
 * is the S-4 circuit breaker — the kernel treats it as budget-breaching.
 */
interface ModelTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly costUSD: number;
}

export interface SessionResult {
  /** Process-level success. NOT gate success. */
  readonly ok: boolean;
  readonly telemetryParsed: boolean;
  readonly costEstimateUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly turns: number;
  readonly rawTail: string;
  /**
   * PRDR-053: the backend zeroes telemetry when its process crashes. Zeroed is
   * not absent — the ledger records a flagged lower bound, never free work.
   */
  readonly crashed?: boolean;
  /**
   * PRDR-052: the per-model breakdown is the token source of record — it
   * includes nested-agent tokens and the response that crossed a budget
   * ceiling, both of which the cumulative fields exclude.
   */
  readonly perModel?: Readonly<Record<string, ModelTokenUsage>>;
  /**
   * PRDR-114: the routed model was unavailable on this runtime and the
   * session ran on the runtime default instead. `requested` is what the
   * config asked for; `models` on the ledger row says what actually ran.
   */
  readonly modelFallback?: { readonly requested: string; readonly reason: string };
  /**
   * PRDR-237: the effort the turns actually ran at, as the containment hook saw
   * it — the SDK's level AFTER any silent downgrade. Absent is UNOBSERVED,
   * never "it matched what was routed", and has THREE causes, not the two this
   * block used to name: a model without effort support, a session that called
   * no tool, and a session that DID report a level and then died on the wire —
   * the crash path composes its result before the observed level is attached,
   * so S-4′'s shape and "no effort support" are indistinguishable here.
   */
  readonly effort?: string;
  /**
   * S-3‴ (PRDR-123): configured MCP servers this session did NOT get. Absent
   * means the session reported nothing either way — never read as success.
   */
  readonly mcpFailures?: readonly { readonly name: string; readonly status: string }[];
}

export interface SessionBackend {
  readonly name: string;
  run(spec: SessionSpec): Promise<SessionResult>;
  /**
   * S-5: bootstrap fails when installed != pinned — an equality on the version
   * TOKEN both halves parse the same way (PRDR-260), not on the CLI's whole
   * banner. The mock is version-free.
   */
  checkVersion(pinned: string): Promise<void>;
}

/**
 * The vendored prompt set, as the kernel is allowed to see it (S-7). Loading
 * and hash verification live in `sessions/prompts.ts`; the kernel receives the
 * loaded set through this seam and never reads prompt files itself — ARCH-1's
 * zone permits the kernel only this module.
 */
export interface PromptSet {
  /** C-4⁵ (PRDR-292): by prompt, where the planner has one for each job it does. */
  readonly prompts: Readonly<Record<PromptId, string>>;
  /** sha256 hex per prompt, matching prompts/manifest.json. */
  readonly hashes: Readonly<Record<PromptId, string>>;
}

/**
 * S-6's prefix shape: role prompt + rules + bindings preamble, byte-identical
 * within a run. Part of the seam contract so the kernel and the SDK backend
 * (T-046) share one construction.
 */
export function stablePrefix(rolePrompt: string, rulesText: string, bindingsPreamble: string): string {
  return [
    `== ROLE ==\n${rolePrompt.trim()}`,
    `== RULES ==\n${rulesText.trim()}`,
    `== VERIFICATION BINDINGS ==\n${bindingsPreamble.trim()}`,
  ].join("\n\n");
}

/**
 * The prefix's third part: what every run session is told about the gates.
 * V-5′ (PRDR-295): the root's by slot, as before packages, and each other
 * package's under `packages`, only where there is one, so a project with one
 * package keeps a byte-identical prefix (S-6).
 */
export function bindingsPreamble(
  bindings: readonly { readonly package: string; readonly slot: string; readonly resolved: string }[],
  protectedGlobs: readonly string[],
): string {
  const bySlot = (pkg: string): Record<string, string> => Object.fromEntries(bindings.filter((b) => b.package === pkg).map((b) => [b.slot, b.resolved]));
  const others = [...new Set(bindings.map((b) => b.package).filter((pkg) => pkg !== "."))];
  return JSON.stringify(
    {
      bindings: bySlot("."),
      ...(others.length === 0 ? {} : { packages: Object.fromEntries(others.map((pkg) => [pkg, bySlot(pkg)])) }),
      protected: protectedGlobs,
      non_negotiables: "Only artifacts and exit codes count (P2).",
    },
    null,
    2,
  );
}
