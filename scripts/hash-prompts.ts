/**
 * T-047 — regenerates prompts/manifest.json, the hash pin for the vendored
 * prompts (S-7, D-9). PREPARE_AGENTS selects only from this set;
 * `agents/assignments.json` references `role@hash`, and an unknown hash fails
 * closed at load. CI regenerates and diffs, so an edited prompt cannot ship
 * without its hash moving in the same commit.
 *
 * Usage: tsx scripts/hash-prompts.ts [--check]
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SCHEMA_VERSION } from "../src/schemas/common.js";
import { PROMPT_IDS } from "../src/schemas/roles.js";

const ROOT = path.resolve(import.meta.dirname, "..");
export const PROMPTS_DIR = path.join(ROOT, "prompts");
export const MANIFEST_PATH = path.join(PROMPTS_DIR, "manifest.json");

export function promptHash(id: string): string {
  return createHash("sha256").update(readFileSync(path.join(PROMPTS_DIR, `${id}.md`))).digest("hex");
}

/** C-4⁵ (PRDR-292): pinned by prompt, where the planner has one for each job it does. */
export function renderManifest(): string {
  const prompts = Object.fromEntries(PROMPT_IDS.map((id) => [id, promptHash(id)]));
  return `${JSON.stringify({ schema_version: SCHEMA_VERSION, prompts }, null, 2)}\n`;
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
