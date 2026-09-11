import path from "node:path";
import { readlinkSync, realpathSync } from "node:fs";
import picomatch from "picomatch";
import { SPAWN_TOOLS } from "../fs/hook-files.js";
import { commandOf, readGitRm, type GitRmReading } from "./git-rm.js";

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

/**
 * D-28″ (PRDR-215): the spawn names the guard refuses, re-exported from their
 * dependency-free home so every reader of the decision finds them here. The
 * denial itself is in `guardToolUse`: a spawn names no path, so the guard
 * abstained, and the platform grants `Agent` without consulting `allowedTools`
 * — gate-313's review-fix sessions each ran a sub-agent outside the turn
 * ceiling and outside anything the ledger can name.
 */
export { SPAWN_TOOLS };

export interface GuardPolicy {


  /** The ticket's declared surface plus the artifact-out area. */
  readonly surface: readonly string[];
  /** SEC-3: ticket/criteria/config self-modification is always denied. */
  readonly protectedGlobs: readonly string[];
  /** The work root; anything resolving outside it is denied. */
  readonly workRoot: string;
  /**
   * B-2″ (PRDR-180): the one directory a session may write OUTSIDE its work
   * root — where its own artifact goes.
   *
   * `artifactOut` is always `<root>/.detent/runs/<ticket>/…` while `workRoot`
   * is the per-ticket worktree, and worktrees are the default. So the artifact
   * every review, diagnose and research session is required to produce resolved
   * to a sibling of its work root and was denied as an escape — in the default
   * configuration. Every test missed it by running non-worktree, where the two
   * paths coincide.
   *
   * Deliberately ONE directory and not "the project root": granting the root
   * would let a session write the operator's own checkout, which is the harm
   * B-2″ made worktrees the default to prevent.
   */
  readonly artifactRoot?: string;
}

export interface GuardDecision {
  /**
   * S-2‴ (PRDR-122): `abstain` is not `allow`. The SDK evaluates permissions in
   * a fixed order — hooks, then deny rules, then ask rules, then the mode, then
   * the ALLOW RULES — and a hook that says `allow` ends that evaluation. So
   * answering `allow` for a tool this guard does not govern silently overrode
   * `allowedTools`: every `Bash` call was permitted despite the allowlist
   * granting only `Bash(git add:*)` and `Bash(git commit:*)`, because a bash
   * call names no path and fell through to the old blanket allow. Abstaining
   * returns the decision to the allowlist, where it belongs.
   */
  readonly decision: "allow" | "deny" | "abstain";
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
const MUTATING_TOOLS: ReadonlySet<string> = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/**
 * PRDR-205: the artifact a session is TOLD against the one it HAS.
 *
 * The k draws of one review are told one path, so their first turns are
 * byte-identical and the prompt cache (S-6) serves every draw but the first;
 * each draw's file is its own. A mutating call naming the told path is carried
 * out at the actual one — rewritten BEFORE the guard judges it, so containment
 * is decided on the file that will actually be written. Reads are untouched
 * (S-2‴), and any other path is judged exactly as before.
 */
export interface ArtifactAlias {
  readonly told: string;
  readonly actual: string;
}

export function carryArtifact(toolName: string, toolInput: unknown, alias: ArtifactAlias, workRoot: string): Record<string, unknown> | null {
  if (!MUTATING_TOOLS.has(toolName)) return null;
  const target = pathOf(toolInput);
  if (target === null || path.resolve(workRoot, target) !== path.resolve(workRoot, alias.told)) return null;
  const record = toolInput as Record<string, unknown>;
  const key = ["file_path", "path", "notebook_path"].find((k) => typeof record[k] === "string") ?? "file_path";
  return { ...record, [key]: alias.actual };
}

/**
 * The path relative to this session's artifact directory, or `null` when it is
 * not inside one. Resolved on both sides for the same reason the work-root
 * check is (PRDR-180).
 */
function artifactRelative(artifactRoot: string, resolveReal: (p: string) => string, absolute: string): string | null {
  try {
    const rel = path.relative(resolveReal(artifactRoot), resolveReal(absolute));
    return rel.startsWith("..") || path.isAbsolute(rel) ? null : rel;
  } catch {
    /* An artifact root that cannot be resolved is not an artifact root; fall through to the deny. */
    return null;
  }
}

/**
 * S-2⁗ (PRDR-127): where a path actually LANDS, with symbolic links followed.
 *
 * `path.resolve` normalises `..` lexically and follows nothing, so the guard
 * used to judge the path a session typed rather than the file it would open.
 *
 * Two things make this more than a `realpathSync` call. A `Write` usually names
 * a file that does not exist yet, and `realpath` throws on those — so this walks
 * up to the nearest ancestor that DOES exist, resolves that, and rejoins the
 * segments below it. And a path with no existing ancestor at all resolves to its
 * lexical form, because a tree that is not on disk has no links to follow; that
 * is what keeps the oracle hook tests meaningful against their fictional root.
 *
 * It does not throw. An unresolvable path degrades to the lexical answer, which
 * is exactly the pre-existing behaviour rather than a new way to fail.
 */
export function realpathNearest(target: string, maxHops = 40): string {
  const absolute = path.resolve(target);
  const trailing: string[] = [];
  const below = (base: string): string => (trailing.length === 0 ? base : path.join(base, ...[...trailing].reverse()));
  let current = absolute;
  let hops = 0;
  for (;;) {
    try {
      return below(realpathSync.native(current));
    } catch {
      /* not resolvable as it stands — it may still be a link, or not exist at all */
    }
    /**
     * A DANGLING link still names a destination. `realpathSync` throws on one,
     * and stopping here would fall back to the lexical path — which is a hole,
     * not a degradation: the Write tool creates parent directories, so a link
     * to a not-yet-existing directory OUTSIDE the worktree would be created and
     * written to. It is read manually and followed.
     */
    let link: string | null = null;
    try {
      link = readlinkSync(current);
    } catch {
      link = null;
    }
    if (link !== null) {
      /* A cycle of links resolves to nothing on any filesystem; stop and let the boundary judge. */
      if (hops >= maxHops) return below(current);
      hops += 1;
      current = path.resolve(path.dirname(current), link);
      continue;
    }
    const parent = path.dirname(current);
    if (parent === current) return absolute;
    trailing.push(path.basename(current));
    current = parent;
  }
}

/**
 * The PreToolUse decision (oracle `pretooluse_guard.py`, S-2″). Deny-by-default
 * outside the declared surface FOR MUTATION; protected denies mutation always
 * (SEC-3 is immutability, not unreadability); the worktree bounds every tool,
 * reads included (P7). Surface expansion is a KERNEL decision — the guard only
 * points at the lever (SEC-3).
 *
 * S-2⁗ (PRDR-127): every one of those checks runs on the RESOLVED destination.
 * A symbolic link inside the worktree used to walk past all three — the
 * boundary, the surface, and the SEC-3 protected globs, which is an
 * immutability bypass. The destination is what is judged, never the mechanism:
 * a link pointing somewhere the session may already write stays allowed,
 * because refusing links as a class would refuse `node_modules/.bin` and every
 * monorepo workspace link.
 *
 * `resolveReal` is a parameter so the decision stays testable without a
 * filesystem — production passes nothing, tests inject identity or a fake map.
 */
export function guardToolUse(
  toolName: string,
  toolInput: unknown,
  policy: GuardPolicy,
  resolveReal: (p: string) => string = realpathNearest,
): GuardDecision {
  /* D-28″ (PRDR-215): a spawn names no path; it is refused before the path judgement, for every role. */
  if ((SPAWN_TOOLS as readonly string[]).includes(toolName)) {
    return {
      decision: "deny",
      reason:
        `DENY: ${toolName} would spawn a billable session outside the ledger — a session does its own work, ` +
        "and a billable session exists only through the metered path (D-28).",
    };
  }
  /* S-3⁵ (PRDR-213): the one Bash verb that names paths is judged on them. */

  if (toolName === "Bash") {
    const reading = readGitRm(commandOf(toolInput));
    if (reading !== null) return judgeGitRm(reading, policy, resolveReal);
  }
  const target = pathOf(toolInput);
  /**
   * A tool call naming no path is not this guard's business — it governs WHERE
   * a mutation lands. Abstaining hands it back to the allowlist rather than
   * granting it, which is what an `allow` here did.
   */
  if (target === null) return { decision: "abstain", reason: "no path in tool input — the allowlist decides" };

  const root = path.resolve(policy.workRoot);
  const absolute = path.resolve(root, target);

  /**
   * B-2″ (PRDR-180): the session's own artifact directory, judged FIRST.
   *
   * `artifactOut` is under the project root while `workRoot` is the per-ticket
   * worktree, and worktrees are the default — so the artifact every review,
   * diagnose and research session must produce resolved to a sibling of its
   * work root and was denied by the containment check below. In the default
   * configuration. Every test missed it by running non-worktree, where the two
   * paths coincide.
   *
   * Lexically first and then resolved, matching the containment check: a
   * symlink into the artifact area is judged on its real destination.
   */
  if (policy.artifactRoot !== undefined) {
    const artifactRoot = path.resolve(policy.artifactRoot);
    const lexical = path.relative(artifactRoot, absolute);
    if (!lexical.startsWith("..") && !path.isAbsolute(lexical)) {
      const real = artifactRelative(artifactRoot, resolveReal, absolute);
      if (real === null) {
        return { decision: "deny", reason: `DENY: ${target} resolves through a symbolic link out of this session's artifact area.` };
      }
      return MUTATING_TOOLS.has(toolName)
        ? { decision: "allow", reason: `${real} is this session's own artifact area (B-2″)` }
        : { decision: "abstain", reason: `${real} is this session's artifact area; the allowlist decides (S-2″)` };
    }
  }

  /* Lexical `..` is refused before any filesystem work, exactly as before. */
  const typed = path.relative(root, absolute);
  if (typed.startsWith("..") || path.isAbsolute(typed)) {
    return { decision: "deny", reason: `DENY: ${target} is outside the worktree.` };
  }

  /**
   * BOTH sides are resolved. On macOS `/tmp` is itself a link to `/private/tmp`,
   * so comparing a resolved target against an unresolved root would report every
   * temp-directory worktree as an escape — a fix noisier than the bug.
   */
  let rel: string;
  try {
    rel = path.relative(resolveReal(root), resolveReal(absolute));
  } catch (err) {
    /* Containment that cannot be established is not containment that passed. */
    return {
      decision: "deny",
      reason: `DENY: ${typed} could not be resolved to a real path (${(err as Error).message}) — containment cannot be established.`,
    };
  }
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { decision: "deny", reason: `DENY: ${typed} resolves through a symbolic link to a path outside the worktree.` };
  }
  if (!MUTATING_TOOLS.has(toolName)) {
    /* Inside the worktree and not a mutation: bounded by P7 above, granted by the allowlist. */
    return { decision: "abstain", reason: `${rel} is inside the worktree; the allowlist decides (S-2″)` };
  }
  /* Where the two disagree, the human is told which path the verdict is about. */
  const via = rel === typed ? "" : ` (reached through a symbolic link from ${typed})`;
  if (matchAny(rel, policy.protectedGlobs)) {
    return {
      decision: "deny",
      reason: `DENY: ${rel} is protected${via} (protected globs and ticket criteria are immutable to sessions — SEC-3).`,
    };
  }
  if (!matchAny(rel, policy.surface)) {
    return {
      decision: "deny",
      reason:
        `DENY: ${rel} is outside this ticket's declared surface${via}. If genuinely required, request a surface ` +
        `expansion with a one-line justification by writing surface_request.json at the path given in your inputs (SEC-3).`,
    };
  }
  return { decision: "allow", reason: `${rel} is inside the declared surface` };
}


/**
 * S-3⁵ (PRDR-213): a `git rm` is judged where a Write to each of its paths
 * would be — the same boundary, protection and surface, one path at a time —
 * and one refused path refuses the call. What cannot be read is refused too:
 * this guard abstains on a call that names no path (S-2‴), and this one does.
 */
function judgeGitRm(reading: GitRmReading, policy: GuardPolicy, resolveReal: (p: string) => string): GuardDecision {
  if (!reading.ok) {
    return {
      decision: "deny",
      reason:
        `DENY: a \`git rm\` the guard cannot read is refused — ${reading.detail}. One simple command, plain paths ` +
        "one per token; the options read are -f, -q, --cached and -- (no -r, no globs, no shell syntax) (S-3⁵).",
    };
  }
  for (const target of reading.paths) {
    const verdict = guardToolUse("Write", { file_path: target }, policy, resolveReal);
    if (verdict.decision !== "allow") return { decision: "deny", reason: verdict.reason };
  }
  return { decision: "allow", reason: `git rm ${reading.paths.join(" ")}: every path is inside the declared surface (S-3⁵)` };
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
  /** PRDR-211: where the session works — the scoped gate runs THERE, not in the root. */
  readonly cwd?: string;
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
  runScopedGate: (command: string, cwd?: string) => Promise<{ readonly green: boolean; readonly outputTail: string }>,
): Promise<StopGateDecision> {
  if (input.stopHookActive) {
    return { decision: "allow", reason: "stop-hook continuation already active; the kernel judges from here" };
  }
  if (input.gateCmd === null || input.gateCmd.trim() === "" || READ_ONLY_STAGES.has(input.stage)) {
    return { decision: "allow", reason: "no stop gate for this stage" };
  }
  const result = await runScopedGate(input.gateCmd, input.cwd);
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

const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"] as const;
const WRITE_TOOLS = ["Read", "Grep", "Glob", "Edit", "Write"] as const;

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
  /* S-3⁵ (PRDR-213): three verbs — the guard judges `git rm` per pathspec (judgeGitRm). */
  return [...WRITE_TOOLS, "Bash(git add:*)", "Bash(git rm:*)", "Bash(git commit:*)"];
}
