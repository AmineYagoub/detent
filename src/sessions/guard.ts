import path from "node:path";
import picomatch from "picomatch";

/**
 * T-046 — the containment guard (S-2/D-21, SEC-3), as pure decision functions.
 *
 * The oracle enforced these at the hook layer via subprocess scripts reading
 * `active_surface.json`; the SDK backend registers them as in-process
 * `PreToolUse` and `Stop` hook callbacks, which D-21 makes the normative
 * layer — hooks run before allow rules, so S-3's allowlists cannot shadow
 * them. The decisions themselves are pure and identical, which is what lets
 * the seven oracle hook tests port without a live session.
 */

export interface GuardPolicy {
  /** The ticket's declared surface plus the artifact-out area. */
  readonly surface: readonly string[];
  /** SEC-3: ticket/criteria/config self-modification is always denied. */
  readonly protectedGlobs: readonly string[];
  /** The work root; anything resolving outside it is denied. */
  readonly workRoot: string;
}

export interface GuardDecision {
  readonly decision: "allow" | "deny";
  readonly reason: string;
}

/**
 * The oracle's match semantics: a pattern matches itself, its directory form,
 * and its children; `dir/**` also matches the bare directory. picomatch is the
 * one glob engine (R-6); the conveniences are layered explicitly.
 */
export function matchAny(rel: string, patterns: readonly string[]): boolean {
  const clean = rel.replace(/^\.\//, "");
  for (const raw of patterns) {
    const p = String(raw).replace(/^\.\//, "");
    const bare = p.replace(/\/\*\*$/, "").replace(/\/$/, "");
    if (clean === bare) return true;
    if (picomatch.isMatch(clean, p, { dot: true })) return true;
    if (picomatch.isMatch(clean, `${bare}/**`, { dot: true })) return true;
  }
  return false;
}

/** Where a tool call is trying to act, if it names a path at all. */
export function pathOf(toolInput: unknown): string | null {
  if (typeof toolInput !== "object" || toolInput === null) return null;
  const record = toolInput as Record<string, unknown>;
  const candidate = record["file_path"] ?? record["path"] ?? record["notebook_path"];
  return typeof candidate === "string" && candidate !== "" ? candidate : null;
}

/**
 * S-2″ (PRDR-068): the tools whose path'd calls MUTATE. Surface and protected
 * containment governs exactly these; everything else with a path is a read,
 * bounded by the worktree alone — a session that cannot read its own
 * specification cannot implement it (T-140's empty-diff lesson).
 */
export const MUTATING_TOOLS: ReadonlySet<string> = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/**
 * The PreToolUse decision (oracle `pretooluse_guard.py`, S-2″). Deny-by-default
 * outside the declared surface FOR MUTATION; protected denies mutation always
 * (SEC-3 is immutability, not unreadability); the worktree bounds every tool,
 * reads included (P7). Surface expansion is a KERNEL decision — the guard only
 * points at the lever (SEC-3).
 */
export function guardToolUse(toolName: string, toolInput: unknown, policy: GuardPolicy): GuardDecision {
  const target = pathOf(toolInput);
  /**
   * A tool call naming no path (or a malformed one) is allowed here: bricking
   * the session gains nothing, and the kernel re-runs full gates regardless (P2).
   */
  if (target === null) return { decision: "allow", reason: "no path in tool input" };

  const rel = path.relative(path.resolve(policy.workRoot), path.resolve(policy.workRoot, target));
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { decision: "deny", reason: `DENY: ${target} is outside the worktree.` };
  }
  if (!MUTATING_TOOLS.has(toolName)) {
    return { decision: "allow", reason: `${rel} read inside the worktree (S-2″)` };
  }
  if (matchAny(rel, policy.protectedGlobs)) {
    return {
      decision: "deny",
      reason: `DENY: ${rel} is protected (protected globs and ticket criteria are immutable to sessions — SEC-3).`,
    };
  }
  if (!matchAny(rel, policy.surface)) {
    return {
      decision: "deny",
      reason:
        `DENY: ${rel} is outside this ticket's declared surface. If genuinely required, request a surface ` +
        `expansion with a one-line justification by writing surface_request.json at the path given in your inputs (SEC-3).`,
    };
  }
  return { decision: "allow", reason: `${rel} is inside the declared surface` };
}

/*
 * ---------------------------------------------------------------------------
 * Stop gate (oracle `stop_gate.py`) — an accelerant, never the authority (P2).
 */

/** S-1's read-only roles have no stop gate: they produce artifacts, not diffs. */
export const READ_ONLY_STAGES: ReadonlySet<string> = new Set(["planner", "diagnose", "research", "review"]);

export interface StopGateInput {
  readonly stage: string;
  readonly gateCmd: string | null;
  /** True when this stop is already a stop-hook continuation — the loop guard. */
  readonly stopHookActive: boolean;
}

export interface StopGateDecision {
  readonly decision: "allow" | "block";
  readonly reason: string;
}

/**
 * Decide whether the session may end. The scoped gate is executed by the
 * injected runner so the decision stays pure and the seven oracle semantics —
 * red blocks, green allows, read-only stages exempt, `stop_hook_active`
 * breaks hook-induced loops — are testable without a session.
 */
export async function stopGate(
  input: StopGateInput,
  runScopedGate: (command: string) => Promise<{ readonly green: boolean; readonly outputTail: string }>,
): Promise<StopGateDecision> {
  if (input.stopHookActive) {
    return { decision: "allow", reason: "stop-hook continuation already active; the kernel judges from here" };
  }
  if (input.gateCmd === null || input.gateCmd.trim() === "" || READ_ONLY_STAGES.has(input.stage)) {
    return { decision: "allow", reason: "no stop gate for this stage" };
  }
  const result = await runScopedGate(input.gateCmd);
  if (result.green) return { decision: "allow", reason: "scoped gate green" };
  return {
    decision: "block",
    reason: `GATE RED — the stage cannot end while verification fails.\n$ ${input.gateCmd}\n${result.outputTail.slice(-1500)}`,
  };
}

/*
 * ---------------------------------------------------------------------------
 * Tool surfaces per role (S-3): the surface, never the containment.
 */

export const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"] as const;
export const WRITE_TOOLS = ["Read", "Grep", "Glob", "Edit", "Write"] as const;

/**
 * X-6/S-3: research adds WebSearch plus a domain-scoped WebFetch rule per
 * configured docs domain. The `WebFetch(domain:…)` specifier form is composed
 * here and VERIFIED against the pinned backend by `doctor` (T-050) — an
 * unrecognized form must fail loudly there, never no-op silently (PRDR-050).
 * The domains parameter has no config home yet — that gap is PRDR-062.
 */
export function researchTools(docsDomains: readonly string[]): string[] {
  return [...READ_ONLY_TOOLS, "WebSearch", ...docsDomains.map((d) => `WebFetch(domain:${d})`)];
}

export function toolsForRole(role: string, docsDomains: readonly string[] = []): string[] {
  if (role === "research") return researchTools(docsDomains);
  if (READ_ONLY_STAGES.has(role)) return [...READ_ONLY_TOOLS];
  return [...WRITE_TOOLS, "Bash(git add:*)", "Bash(git commit:*)"];
}
