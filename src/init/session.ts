import { mkdirSync } from "node:fs";
import path from "node:path";
import { type RoleId } from "../schemas/roles.js";
import {
  artifactWriteRule,
  stablePrefix,
  type PromptSet,
  type SessionBackend,
  type SessionResult,
  type SessionSpec,
} from "../sessions/backend.js";
import { toolsForRole } from "../sessions/guard.js";

/**
 * Session launching for the `init` pipeline.
 *
 * Simpler than the run loop's: init has no ticket, no per-generation counters,
 * and no gates between stages — so there is nothing to charge and nothing to
 * re-verify. What it keeps is S-1's role discipline (the planner is read-only,
 * so it runs in plan mode with no write tools) and S-6's stable prefix.
 *
 * `init` sessions are budgeted by C-3a's tool-call ceiling rather than by
 * X-1's per-ticket session count, which is scoped to ticket/generation and has
 * no meaning here.
 */

export interface InitSessionDeps {
  readonly root: string;
  readonly backend: SessionBackend;
  readonly prompts: PromptSet;
  readonly maxTurns: number;
  readonly rulesText?: string;
  /** X-6/S-3 docs domains for research-capable init sessions. */
  readonly docsDomains?: readonly string[];
}

export interface InitSessionRequest {
  readonly role: RoleId;
  readonly inputs: Record<string, unknown>;
  /** Absolute path the session writes its artifact to. */
  readonly artifactOut: string;
  /** C-3a: research capability for planning questions. */
  readonly withWeb?: boolean;
}

function initSessionSpec(deps: InitSessionDeps, request: InitSessionRequest): SessionSpec {
  const preamble = JSON.stringify(
    { phase: "init", non_negotiables: "Only artifacts count. Write exactly the artifact named below (P2)." },
    null,
    2,
  );
  return {
    role: request.role,
    /* No ticket exists during init; the id names the pipeline for the journal. */
    ticketId: "init",
    promptPrefix: stablePrefix(deps.prompts.prompts[request.role], deps.rulesText ?? "(no rules file)", preamble),
    promptVariable: JSON.stringify({ inputs: request.inputs, artifact_out: request.artifactOut }, null, 2),
    cwd: deps.root,
    artifactOut: request.artifactOut,
    /**
     * S-1′ (PRDR-067): the read-only surface plus exactly one write rule —
     * the session's own artifact. Plan mode would deny the write the
     * C-3/A-contract demands; read-only-ness is the allowlist plus the hook.
     */
    allowedTools: [
      ...(request.withWeb === true
        ? toolsForRole("research", deps.docsDomains ?? [])
        : toolsForRole(request.role, deps.docsDomains ?? [])),
      artifactWriteRule(request.artifactOut),
    ],
    permissionMode: "",
    model: "",
    maxTurns: deps.maxTurns,
  };
}

export async function launchInitSession(deps: InitSessionDeps, request: InitSessionRequest): Promise<SessionResult> {
  mkdirSync(path.dirname(request.artifactOut), { recursive: true });
  const result = await deps.backend.run(initSessionSpec(deps, request));
  if (!result.ok) {
    /*
     * T-140: a failed session must fail its phase WITH the reason — before
     * this, a crashed analyst (PRDR-053 wrap) surfaced as the misleading
     * "produced no analysis artifact".
     */
    throw new Error(
      `${request.role} session failed${result.rawTail === "" ? "" : `: ${result.rawTail.slice(-300)}`}`,
    );
  }
  return result;
}
