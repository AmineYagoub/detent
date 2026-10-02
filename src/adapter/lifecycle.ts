import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { nodeEngine } from "./discover/node.js";
import { SCHEMA_VERSION } from "../schemas/common.js";

/**
 * V-1⁷ (PRDR-233) — a project's own lifecycle scripts, approved one body at a
 * time.
 *
 * V-1⁶ (PRDR-232) runs nothing a judged tree declares: the install and every
 * gate run with `npm_config_ignore_scripts` set. The one way to lift it was the
 * run-wide `DETENT_ALLOW_LIFECYCLE_SCRIPTS`, which lifts it for every declared
 * script, a session's new ones among them. Here an operator approves a script
 * by name after seeing its body (`detent verify lifecycle`), and the approval
 * holds that body only: the record keys it by package, script and the body's
 * SHA-256, so an edited body is not approved until it is approved again.
 *
 * Suppression stays on. Detent runs each approved script itself, by name, where
 * npm would have run it: `npm run <script>` under the same environment, which
 * runs the named script and none of its own `pre` or `post` siblings. Only
 * npm's, since V-1⁶'s install is npm's alone; pnpm, yarn and bun are not
 * measured. A dependency's own install scripts stay suppressed: approving the
 * project's scripts approves nothing a dependency brings.
 *
 * The record lives under `state/`, which no session surface admits.
 */

/** What `npm install` runs of a manifest's own scripts, in npm's order. `preinstall` runs before the install, the rest after it. */
export const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall", "prepublish", "preprepare", "prepare", "postprepare", "dependencies"] as const;

export interface DeclaredScript {
  /** The package's directory, relative to the root: `.` for the root's own manifest (V-5′). */
  readonly package: string;
  readonly script: string;
  readonly body: string;
  readonly sha256: string;
}

export type ScriptStatus = "approved" | "not approved" | "edited since approved";

/** A declared script Detent did not run, and why. */
export interface NotRun {
  readonly package: string;
  readonly script: string;
  readonly status: Exclude<ScriptStatus, "approved">;
}

/** What the record approves: each `package|script` to the body hashes approved for it. */
export interface Approvals {
  readonly hashes: ReadonlyMap<string, ReadonlySet<string>>;
}

export function lifecyclePath(root: string): string {
  return path.join(stateDir(root), "state", "lifecycle.jsonl");
}

/** Whether an operator has approved any script of this project: the finer verb then supersedes the run-wide switch (V-1⁷). */
export function hasLifecycleRecord(root: string): boolean {
  return existsSync(lifecyclePath(root));
}

const slotOf = (pkg: string, script: string): string => `${pkg}|${script}`;

export const bodyHash = (body: string): string => createHash("sha256").update(body, "utf8").digest("hex");

export function readApprovals(root: string): Approvals {
  const hashes = new Map<string, Set<string>>();
  if (!hasLifecycleRecord(root)) return { hashes };
  for (const line of readFileSync(lifecyclePath(root), "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const row = JSON.parse(line) as { package?: unknown; script?: unknown; sha256?: unknown };
      if (typeof row.package !== "string" || typeof row.script !== "string" || typeof row.sha256 !== "string") continue;
      const key = slotOf(row.package, row.script);
      hashes.set(key, (hashes.get(key) ?? new Set<string>()).add(row.sha256));
    } catch {
      /* A torn last line is what a crash produces; every whole row before it still counts. */
    }
  }
  return { hashes };
}

/** Append-only: one row per script approved, with the body the operator saw and its hash. */
export function recordApprovals(root: string, scripts: readonly DeclaredScript[], at: string, by: string): void {
  if (scripts.length === 0) return;
  const rows = scripts.map((s) => JSON.stringify({ schema_version: SCHEMA_VERSION, at, package: s.package, script: s.script, sha256: s.sha256, body: s.body, approved_by: by }));
  mkdirSync(path.dirname(lifecyclePath(root)), { recursive: true });
  appendFileSync(lifecyclePath(root), `${rows.join("\n")}\n`);
}

export function statusOf(approvals: Approvals, script: DeclaredScript): ScriptStatus {
  const approved = approvals.hashes.get(slotOf(script.package, script.script));
  if (approved === undefined) return "not approved";
  return approved.has(script.sha256) ? "approved" : "edited since approved";
}

function manifestScripts(dir: string): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { scripts?: unknown };
    const scripts = parsed.scripts;
    if (typeof scripts !== "object" || scripts === null) return {};
    return Object.fromEntries(Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    /* No manifest, or one that does not parse: npm could run nothing from it either. */
    return {};
  }
}

/** The lifecycle scripts the manifest in `dir` declares: the install's, then the `pre` and `post` siblings of each gate script named. */
export function declaredScripts(dir: string, pkg: string, gateScripts: readonly string[] = []): DeclaredScript[] {
  const scripts = manifestScripts(dir);
  const names = [...INSTALL_SCRIPTS, ...gateScripts.flatMap((g) => [`pre${g}`, `post${g}`])];
  return [...new Set(names)].flatMap((script) => {
    const body = Object.hasOwn(scripts, script) ? scripts[script] : undefined;
    return body === undefined ? [] : [{ package: pkg, script, body, sha256: bodyHash(body) }];
  });
}

/** The declared scripts Detent does not run, since none of them is approved as it stands. */
export function notRunOf(declared: readonly DeclaredScript[], approvals: Approvals): NotRun[] {
  return declared.flatMap((s) => {
    const status = statusOf(approvals, s);
    return status === "approved" ? [] : [{ package: s.package, script: s.script, status }];
  });
}

/** A script name as one shell word. */
const word = (name: string): string => `'${name.replaceAll("'", "'\\''")}'`;
const runScript = (s: DeclaredScript): string => `npm run ${word(s.script)}`;

export interface InstallScripts {
  /** The approved scripts that run before the install: `preinstall`. */
  readonly before: readonly string[];
  /** The approved scripts that run after it, in npm's order. */
  readonly after: readonly string[];
  readonly notRun: readonly NotRun[];
  /** What is approved here, kept in the install's mark so a new approval installs again. Empty when nothing is. */
  readonly digest: string;
}

export function installScripts(dir: string, pkg: string, approvals: Approvals): InstallScripts {
  const declared = declaredScripts(dir, pkg);
  const approved = declared.filter((s) => statusOf(approvals, s) === "approved");
  return {
    before: approved.filter((s) => s.script === "preinstall").map(runScript),
    after: approved.filter((s) => s.script !== "preinstall").map(runScript),
    notRun: notRunOf(declared, approvals),
    digest: approved.length === 0 ? "" : bodyHash(approved.map((s) => `${s.script}:${s.sha256}`).join("\n")),
  };
}

export interface GateSiblings {
  readonly pre: string | null;
  readonly post: string | null;
}

export const NO_SIBLINGS: GateSiblings = { pre: null, post: null };

/** A bound gate, as much of it as the lifecycle reads. */
export interface GateBinding {
  readonly package: string;
  readonly adapter: string;
  readonly ref: string;
}

/** The npm script gates a package binds, by script name. */
export function npmGateScripts(pkg: string, bindings: readonly GateBinding[]): string[] {
  return bindings.filter((b) => b.package === pkg && b.adapter === nodeEngine.name).map((b) => b.ref);
}

/**
 * The approved siblings of a bound gate run as `command` in `dir`. Only an npm
 * script gate has them, and the stack's names stay in the adapter (N-1).
 */
export function siblingsOf(dir: string, binding: GateBinding, command: string, approvals: Approvals): GateSiblings {
  return binding.adapter === nodeEngine.name && command.startsWith("npm run ") ? gateSiblings(dir, binding.package, binding.ref, approvals) : NO_SIBLINGS;
}

/** The approved `pre` and `post` siblings of the gate script `script`, which `npm run` under V-1⁶ no longer runs. */
export function gateSiblings(dir: string, pkg: string, script: string, approvals: Approvals): GateSiblings {
  const declared = declaredScripts(dir, pkg, [script]);
  const approved = (name: string): string | null => {
    const s = declared.find((d) => d.script === name);
    return s !== undefined && statusOf(approvals, s) === "approved" ? runScript(s) : null;
  };
  return { pre: approved(`pre${script}`), post: approved(`post${script}`) };
}

/**
 * A gate with its approved siblings around it, as npm runs them: a red `pre`
 * is the result and the gate does not run, and `post` runs only after a green
 * gate, its red then being the result.
 */
export async function withSiblings<R extends { readonly green: boolean }>(siblings: GateSiblings, run: (command: string) => Promise<R>, gate: () => Promise<R>): Promise<R> {
  if (siblings.pre !== null) {
    const pre = await run(siblings.pre);
    if (!pre.green) return pre;
  }
  const result = await gate();
  if (!result.green || siblings.post === null) return result;
  const post = await run(siblings.post);
  return post.green ? result : post;
}

/**
 * The note a red gate's reader gets when the manifest in `dir` declares
 * lifecycle scripts Detent did not run: the install's, and the `pre` and
 * `post` of the gate scripts named. Only for npm, whose scripts are the ones
 * Detent runs on approval.
 */
export function notRunNoteFor(dir: string, pkg: string, gateScripts: readonly string[], approvals: Approvals, pm: string | null): string | null {
  if (pm !== null && pm !== "npm") return null;
  return notRunNote(notRunOf(declaredScripts(dir, pkg, gateScripts), approvals));
}

/** What the reader of a red gate is told of the declared scripts Detent did not run, or `null` when it ran every one. */
export function notRunNote(notRun: readonly NotRun[]): string | null {
  if (notRun.length === 0) return null;
  const items = notRun.map((n) => `${n.package === "." ? "" : `${n.package}: `}${n.script} (${n.status})`);
  return (
    `Detent did not run these declared lifecycle scripts, which it runs only once an operator approves each body (V-1⁷): ${items.join(", ")}. ` +
    "An operator approves one with `detent verify lifecycle --approve <script>`, adding `--package <dir>` for a package's own."
  );
}
