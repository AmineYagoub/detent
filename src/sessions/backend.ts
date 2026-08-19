import { createHash } from "node:crypto";
import type { RoleId } from "../schemas/roles.js";
import type { GuardPolicy } from "./guard.js";

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
  /** Advisory until T-046 wires real enforcement (S-2/S-3). */
  readonly allowedTools: readonly string[];
  /** S-1: `"plan"` for the read-only roles, empty otherwise. */
  readonly permissionMode: "" | "plan";
  /** Model routing per role; empty means the backend's default. */
  readonly model: string;
  /** X-1 `turns_per_stage`. */
  readonly maxTurns: number;
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
export interface ModelTokenUsage {
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
}

export interface SessionBackend {
  readonly name: string;
  run(spec: SessionSpec): Promise<SessionResult>;
  /** S-5: bootstrap fails when installed != pinned. The mock is version-free. */
  checkVersion(pinned: string): Promise<void>;
}

/**
 * The vendored prompt set, as the kernel is allowed to see it (S-7). Loading
 * and hash verification live in `sessions/prompts.ts`; the kernel receives the
 * loaded set through this seam and never reads prompt files itself — ARCH-1's
 * zone permits the kernel only this module.
 */
export interface PromptSet {
  readonly prompts: Readonly<Record<RoleId, string>>;
  /** sha256 hex per role, matching prompts/manifest.json. */
  readonly hashes: Readonly<Record<RoleId, string>>;
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
