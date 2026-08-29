/**
 * T-047 — regenerates prompts/manifest.json, the hash pin for the vendored
 * role prompts (S-7, D-9). PREPARE_AGENTS selects only from this set;
 * `agents/assignments.json` references `role@hash`, and an unknown hash fails
 * closed at load. CI regenerates and diffs, so an edited prompt cannot ship
 * without its hash moving in the same commit.
 *
 * Usage: tsx scripts/hash-prompts.ts [--check]
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROLE_IDS } from "../src/schemas/roles.js";

const ROOT = path.resolve(import.meta.dirname, "..");
export const PROMPTS_DIR = path.join(ROOT, "prompts");
export const MANIFEST_PATH = path.join(PROMPTS_DIR, "manifest.json");

export function promptHash(role: string): string {
  return createHash("sha256").update(readFileSync(path.join(PROMPTS_DIR, `${role}.md`))).digest("hex");
}

/**
 * PRDR-089: role VARIANTS — `implement.go.md` beside `implement.md`. A variant
 * is vendored, hashed and pinned exactly like a role prompt; it never adds a
 * role id (that would be an F-3 schema event) and it is only ever selected by
 * configuration, so the default set is unchanged for every project that says
 * nothing.
 */
export function variantFiles(): string[] {
  return readdirSync(PROMPTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -".md".length))
    .filter((name) => {
      const [role, ...rest] = name.split(".");
      return rest.length === 1 && (ROLE_IDS as readonly string[]).includes(role as string);
    })
    .sort();
}

export function renderManifest(): string {
  const roles = Object.fromEntries(ROLE_IDS.map((r) => [r, promptHash(r)]));
  const variants = Object.fromEntries(variantFiles().map((v) => [v, promptHash(v)]));
  return `${JSON.stringify({ schema_version: 1, roles, variants }, null, 2)}\n`;
}

function main(): void {
  const content = renderManifest();
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(MANIFEST_PATH, "utf8");
    } catch {
      /* missing counts as stale */
    }
    if (current !== content) {
      process.stderr.write("prompts/manifest.json is stale — run `npm run prompts`\n");
      process.exit(1);
    }
    return;
  }
  writeFileSync(MANIFEST_PATH, content);
  process.stdout.write("wrote prompts/manifest.json\n");
}

const invoked = process.argv[1] !== undefined && import.meta.url.endsWith(path.basename(process.argv[1]));
if (invoked) main();
