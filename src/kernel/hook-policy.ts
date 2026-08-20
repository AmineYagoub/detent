import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HOOK_STAGE_FILE, HOOK_SURFACE_FILE, stateDir } from "../fs/layout.js";

/**
 * T-120/T-121 — the referee's half of the plugin containment hook (D-21,
 * D-27, D-28, S-2′).
 *
 * The plugin hook (src/plugin/hook.ts, bundled) is deny-only and reads two
 * files at the session cwd; THIS module is the only writer. While a claim is
 * in flight the driver session's policy is published with an EMPTY surface —
 * the driver sequences, never edits (D-27) — plus the D-28 ambient-bypass
 * denies: `Task` (a spawn outside the metered `attempt` tool) and any Bash
 * command containing a bound verification command (gates run only through the
 * referee's gate tool, where classification and the flake filter live).
 *
 * Every file carries `expires_at_ms` = claim time + the X-1 wall-clock
 * ceiling: a crashed driver cannot leave a repo's ordinary sessions denied
 * forever — the hook treats an expired policy as absent, and C-9's stale
 * claim reclaim re-publishes on resume.
 */

export interface ClaimPolicyInput {
  readonly ticketId: string;
  readonly protectedGlobs: readonly string[];
  readonly gateCommands: readonly string[];
  readonly expiresAtMs: number;
}

/**
 * D-28's ambient billable spawn tools, by every name the platform has shipped
 * them under: `Task` (classic subagent launcher), `Agent` (its successor),
 * `TaskCreate` (background-task spawn). T-124's live leg found a build whose
 * print-mode sessions expose only the newer names — an exact-match list
 * pinned to "Task" alone guarded yesterday's platform. Reads/controls
 * (TaskGet/TaskOutput/TaskStop) spawn nothing and stay allowed.
 */
const BILLABLE_SPAWN_TOOLS = ["Task", "Agent", "TaskCreate"] as const;

/** The one-shot Stop nudge (T-120's re-feed; official precedent: ralph-wiggum). */
export const RUN_REFEED_TEXT =
  "Detent run in flight: tickets are still claimable or claimed. Continue the loop — " +
  "call the referee's `next` tool and proceed with the next legal move; end the session " +
  "only when the pool is empty and the outcome has been presented. " +
  "(This gate fires once; the referee re-verifies everything regardless — P2.)";

export function publishClaimPolicy(root: string, input: ClaimPolicyInput): void {
  writeJson(path.join(stateDir(root), HOOK_SURFACE_FILE), {
    schema_version: 1,
    ticket_id: input.ticketId,
    driver: true,
    surface: [],
    protected: [...input.protectedGlobs],
    deny_tools: [...BILLABLE_SPAWN_TOOLS],
    deny_bash_containing: [...input.gateCommands],
    expires_at_ms: input.expiresAtMs,
  });
}

export function clearClaimPolicy(root: string): void {
  rmSync(path.join(stateDir(root), HOOK_SURFACE_FILE), { force: true });
}

/**
 * Run-scoped loop persistence: written while work remains (pool non-empty or
 * a claim in flight), removed the moment neither holds — so a completed or
 * human-gated run stops cleanly, and a mid-run stop gets one deterministic
 * nudge. `gate_cmd` stays null on the driver path; the worker-style red/green
 * stop gate is a different producer of the same file shape.
 */
export function refreshRunRefeed(root: string, active: boolean, expiresAtMs: number): void {
  const file = path.join(stateDir(root), HOOK_STAGE_FILE);
  if (!active) {
    rmSync(file, { force: true });
    return;
  }
  writeJson(file, {
    schema_version: 1,
    stage: "driver",
    gate_cmd: null,
    run_refeed: RUN_REFEED_TEXT,
    expires_at_ms: expiresAtMs,
  });
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
