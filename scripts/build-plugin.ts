import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { type RoleId } from "../src/schemas/roles.js";
import { toolsForRole } from "../src/sessions/guard.js";
import { loadPromptSet } from "../src/sessions/prompts.js";

/**
 * T-112/T-113 — renders the committed plugin artifacts:
 *
 * - `agents/<role>.md` — the vendored role subagents. The body is the
 *   S-7-pinned prompt byte-for-byte (loadPromptSet verifies every pin before a
 *   single file renders, so an edited prompt cannot ship under a stale hash);
 *   the frontmatter derives from the same sources the SDK backend uses —
 *   `toolsForRole` for the S-3′ surface, `READ_ONLY_ROLES` for the permission
 *   mode — one truth, three skins (SDK options, plugin frontmatter, this
 *   file). No `maxTurns`: X-1″ (PRDR-106) deleted the turn ceiling.
 * - `hooks/dist/detent-hook.cjs` — the D-21 hook bundle: self-contained CJS so
 *   it runs under bare `node` from any user project cwd, with no dependency on
 *   the project's node_modules (the hook must work wherever the plugin is
 *   enabled, not just in this checkout).
 *
 * Usage: `npm run plugin` (tsx scripts/build-plugin.ts). Staleness is enforced
 * by tests/plugin/{agents,hook}.test.ts, which rebuild in memory and compare —
 * an edit to any input that is not accompanied by a regenerate fails CI.
 */

const ROOT = path.resolve(import.meta.dirname, "..");

/** The four roles the plan vendors at MP1 (T-112). */
export const PLUGIN_AGENT_ROLES = ["diagnose", "implement", "review", "research"] as const satisfies readonly RoleId[];
export type PluginAgentRole = (typeof PLUGIN_AGENT_ROLES)[number];

/**
 * Delegation descriptions are plugin-authored surface text, not pinned prompt
 * content — kept colon-free so the quoted YAML scalar stays trivial.
 */
const DESCRIPTIONS: Record<PluginAgentRole, string> = {
  diagnose:
    "Detent diagnose role (S-1, read-only). Analyzes one verification failure and produces a hypothesis artifact. Spawned by the Detent loop - not for general use.",
  implement:
    "Detent implement role (S-1). Implements one ticket inside its declared write surface and commits the diff. Spawned by the Detent loop - not for general use.",
  review:
    "Detent review role (S-1, read-only). Reviews one diff against its acceptance criteria and produces a verdict artifact. Spawned by the Detent loop - not for general use.",
  research:
    "Detent research role (S-1, read-only, web-enabled). Investigates one verified failure and produces a research brief. Spawned by the Detent loop - not for general use.",
};

/**
 * X-6/S-3: the research surface's domain-scoped WebFetch rules need the docs
 * domains, which still have no config home (PRDR-062) — so the vendored
 * frontmatter ships the domain-less surface (WebSearch only). Narrower than
 * the SDK path can grant, never wider; the frontmatter widens when PRDR-062
 * lands a home.
 *
 * No `permissionMode` key: T-114's live load proved the platform IGNORES it
 * for plugin agents (a WARN per file per session) — the read-only surface for
 * `READ_ONLY_ROLES` rides the `tools` allowlist alone here, and the SDK path
 * still sets the real permission mode (sdk.ts). Dead config does not ship.
 */
export function renderAgent(role: PluginAgentRole, prompt: string): string {
  const header = [
    "---",
    `name: detent-${role}`,
    `description: "${DESCRIPTIONS[role]}"`,
    `tools: ${toolsForRole(role, []).join(", ")}`,
    "disallowedTools: Task",
    "---",
    "",
  ].join("\n");
  return header + prompt;
}

export async function renderHookBundle(): Promise<string> {
  const result = await build({
    entryPoints: [path.join(ROOT, "src", "plugin", "hook-entry.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    write: false,
    absWorkingDir: ROOT,
    outfile: path.join(ROOT, "hooks", "dist", "detent-hook.cjs"),
    logLevel: "silent",
  });
  const text = result.outputFiles[0]?.text;
  if (text === undefined) throw new Error("esbuild produced no output for the hook bundle");
  return text;
}

export async function buildAll(): Promise<void> {
  const set = loadPromptSet();
  mkdirSync(path.join(ROOT, "agents"), { recursive: true });
  for (const role of PLUGIN_AGENT_ROLES) {
    writeFileSync(path.join(ROOT, "agents", `${role}.md`), renderAgent(role, set.prompts[role]));
  }
  mkdirSync(path.join(ROOT, "hooks", "dist"), { recursive: true });
  writeFileSync(path.join(ROOT, "hooks", "dist", "detent-hook.cjs"), await renderHookBundle());
}

const invoked = process.argv[1] !== undefined && import.meta.url.endsWith(path.basename(process.argv[1]));
if (invoked) {
  buildAll()
    .then(() => process.stdout.write("wrote agents/*.md and hooks/dist/detent-hook.cjs\n"))
    .catch((err: unknown) => {
      process.stderr.write(`${(err as Error).message}\n`);
      process.exit(1);
    });
}
