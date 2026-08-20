import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { HOOK_STAGE_FILE, HOOK_SURFACE_FILE } from "../fs/hook-files.js";
import { guardToolUse, pathOf, stopGate } from "../sessions/guard.js";

/**
 * T-113 — the D-21 containment hook in plugin form (S-2′, SEC-6, D-29).
 *
 * The oracle enforced containment via subprocess hooks reading
 * `active_surface.json`; the headless driver registers the same decisions as
 * in-process SDK callbacks (sdk.ts). This module is the third skin over the
 * ONE decision implementation — `guardToolUse`/`stopGate` from
 * sessions/guard.ts — shipped as the plugin's `hooks/hooks.json` command
 * (bundled by scripts/build-plugin.ts into `hooks/dist/detent-hook.cjs`).
 * Deterministic `command` hooks only: the platform's `prompt`/`agent` hook
 * types are P2-forbidden for containment.
 *
 * Protocol (current hooks contract): payload JSON on stdin; a decision is JSON
 * on stdout with exit 0 — `hookSpecificOutput.permissionDecision: "deny"` for
 * PreToolUse, `{decision: "block"}` for Stop; silence means no opinion, so an
 * allow never widens what permission rules would refuse (D-29: the hook can
 * only narrow).
 *
 * One deliberate deviation from the oracle: an ABSENT surface file allows.
 * The oracle installed its hook per worker session, so absence there was a
 * misconfiguration and failed closed; the plugin hook is ambient in every
 * session of a user who enabled the plugin, so absence means "no Detent
 * attempt is in flight". A PRESENT but unreadable surface still fails closed
 * (P5) — a declared surface that cannot be honored must deny.
 *
 * Trust boundary, recorded per SEC-6/research A.4.2: both files are repo
 * content, so a hostile repo can plant them. The surface file can only
 * NARROW (this hook emits deny or silence, never an allow), which is safe.
 * The stage file makes the Stop hook execute `gate_cmd` in the project cwd —
 * exactly the capability a repo already has via its own settings-file hooks
 * on the same events, per the platform's documented trust posture, so Detent
 * widens nothing; the referee must still write AND clear these files
 * per-attempt so a stale `stage.json` cannot outlive its session (MP2
 * wiring, T-120/T-121).
 */

interface HookPayload {
  readonly hook_event_name?: unknown;
  readonly tool_name?: unknown;
  readonly tool_input?: unknown;
  readonly cwd?: unknown;
  readonly stop_hook_active?: unknown;
}

/**
 * The oracle's 900 s stop-gate timeout — equal to `gate_timeout_ms`'s X-1
 * default. A literal, not an import: the bundle stays free of the zod-backed
 * schema layer, and the hook is config-blind by design — the referee re-runs
 * the authoritative gate with the configured ceiling regardless (P2).
 */
const GATE_TIMEOUT_MS = 900_000;

function payloadCwd(payload: HookPayload): string {
  return typeof payload.cwd === "string" && payload.cwd !== "" ? payload.cwd : process.cwd();
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function denyJson(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}

/** An `expires_at_ms` in the past makes a policy file ABSENT, not broken (crash hygiene). */
function expired(doc: { expires_at_ms?: unknown } | null, nowMs: number): boolean {
  return typeof doc?.expires_at_ms === "number" && nowMs > doc.expires_at_ms;
}

function commandOf(toolInput: unknown): string {
  if (typeof toolInput !== "object" || toolInput === null) return "";
  const command = (toolInput as Record<string, unknown>)["command"];
  return typeof command === "string" ? command : "";
}

interface SurfaceDoc {
  readonly driver?: unknown;
  readonly surface?: unknown;
  readonly protected?: unknown;
  readonly deny_tools?: unknown;
  readonly deny_bash_containing?: unknown;
  readonly expires_at_ms?: unknown;
}

/** The PreToolUse decision; `null` means silence (no opinion — never an explicit allow). */
function decidePreToolUse(payload: HookPayload, nowMs: number): string | null {
  const cwd = payloadCwd(payload);
  let raw: string;
  try {
    raw = readFileSync(path.join(cwd, ".detent", HOOK_SURFACE_FILE), "utf8");
  } catch {
    /* Absent surface: no Detent attempt in flight — the ambient hook stays silent. */
    return null;
  }
  let cfg: SurfaceDoc | null;
  try {
    cfg = JSON.parse(raw) as SurfaceDoc | null;
  } catch {
    return denyJson(
      `DENY: ${path.join(".detent", HOOK_SURFACE_FILE)} exists but is unreadable — a declared surface that cannot be honored fails closed (P5).`,
    );
  }
  if (expired(cfg, nowMs)) return null;

  /** T-121 (D-28): ambient billable/verification bypasses, denied by tool. */
  const tool = typeof payload.tool_name === "string" ? payload.tool_name : "";
  if (strings(cfg?.deny_tools).includes(tool)) {
    return denyJson(
      `DENY: ${tool} is denied while a Detent run is active — \`attempt\` is the sole billable path; an ambient spawn bypasses the ledger (D-28).`,
    );
  }
  if (tool === "Bash") {
    const command = commandOf(payload.tool_input);
    const hit = strings(cfg?.deny_bash_containing).find((entry) => entry !== "" && command.includes(entry));
    if (hit !== undefined) {
      return denyJson(
        `DENY: this command matches the bound verification command \`${hit}\`. Gates run only through the referee's gate tool — classification and flake filtering live there (D-28/V-2).`,
      );
    }
  }

  /** T-120 (D-27): a driver policy denies every path'd call — sequencing only. */
  if (cfg?.driver === true) {
    if (pathOf(payload.tool_input) === null) return null;
    return denyJson(
      "DENY: the driver sequences, never edits (D-27). A Detent claim is active; every change happens " +
        "through referee-admitted sessions, and state flows through referee tools alone.",
    );
  }

  const decision = guardToolUse(tool, payload.tool_input, {
    surface: strings(cfg?.surface),
    protectedGlobs: strings(cfg?.protected),
    workRoot: cwd,
  });
  return decision.decision === "allow" ? null : denyJson(decision.reason);
}

/** Executes the scoped gate for the Stop decision (the oracle's `subprocess.run`). */
function runScopedGate(command: string, cwd: string): { green: boolean; outputTail: string } {
  const result = spawnSync(command, {
    shell: true,
    cwd,
    encoding: "utf8",
    timeout: GATE_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const merged = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return { green: result.status === 0, outputTail: merged.slice(-1500) };
}

/**
 * The Stop decision. Absent or unreadable stage file allows: the stop gate is
 * an accelerant, never the authority — the referee re-runs the full gate after
 * session end (P2), which is also why a timed-out gate blocks (red until
 * proven green) without risk of a loop: `stop_hook_active` breaks the second
 * pass.
 */
async function decideStop(payload: HookPayload, nowMs: number): Promise<string | null> {
  const cwd = payloadCwd(payload);
  let stage = "";
  let gateCmd: string | null = null;
  let refeed = "";
  let parsed: { stage?: unknown; gate_cmd?: unknown; run_refeed?: unknown; expires_at_ms?: unknown } | null;
  try {
    parsed = JSON.parse(readFileSync(path.join(cwd, ".detent", HOOK_STAGE_FILE), "utf8")) as typeof parsed;
    stage = typeof parsed?.stage === "string" ? parsed.stage : "";
    gateCmd = typeof parsed?.gate_cmd === "string" ? parsed.gate_cmd : null;
    refeed = typeof parsed?.run_refeed === "string" ? parsed.run_refeed : "";
  } catch {
    return null;
  }
  if (expired(parsed, nowMs)) return null;
  const stopHookActive = Boolean(payload.stop_hook_active);
  /**
   * T-120 loop persistence: while the referee says work remains, ending the
   * session gets one deterministic nudge back into the loop (the re-feed
   * pattern; `stop_hook_active` bounds it to a single firing).
   */
  if (refeed !== "" && !stopHookActive) {
    return JSON.stringify({ decision: "block", reason: refeed });
  }
  const decision = await stopGate({ stage, gateCmd, stopHookActive }, async (command) => runScopedGate(command, cwd));
  return decision.decision === "allow" ? null : JSON.stringify({ decision: "block", reason: decision.reason });
}

/**
 * Full hook turn: raw stdin in, printable decision (or null for silence) out.
 * Malformed input is silence, mirroring the oracle — bricking the session
 * gains nothing and the referee re-verifies regardless (P2).
 */
export async function handleHookInput(raw: string, nowMs: number = Date.now()): Promise<string | null> {
  let payload: HookPayload;
  try {
    payload = JSON.parse(raw) as HookPayload;
  } catch {
    return null;
  }
  if (payload === null || typeof payload !== "object") return null;
  if (payload.hook_event_name === "PreToolUse") return decidePreToolUse(payload, nowMs);
  if (payload.hook_event_name === "Stop") return decideStop(payload, nowMs);
  return null;
}
