import { readFileSync } from "node:fs";
import path from "node:path";
import type { GateSlot } from "../run.js";
import { candidate, type Candidate, type Engine, type StackFacts } from "./types.js";

/**
 * package.json scripts (V-1). The project's own script names are the native
 * tooling Detent binds to; the package manager comes from the lockfile, never
 * from a preference (V-4).
 */

interface ScriptRule {
  readonly names: readonly string[];
  readonly slot: GateSlot;
  readonly rank: number;
}

const SCRIPT_RULES: readonly ScriptRule[] = [
  { names: ["test"], slot: "test", rank: 0 },
  { names: ["test:unit", "tests"], slot: "test", rank: 1 },
  { names: ["test:single", "test:one"], slot: "test_single", rank: 0 },
  { names: ["lint"], slot: "lint", rank: 0 },
  { names: ["lint:check", "eslint"], slot: "lint", rank: 1 },
  { names: ["typecheck", "type-check"], slot: "typecheck", rank: 0 },
  { names: ["tsc", "types"], slot: "typecheck", rank: 1 },
  { names: ["build"], slot: "build", rank: 0 },
  { names: ["e2e", "test:e2e"], slot: "e2e", rank: 0 },
];

export const nodeEngine: Engine = {
  name: "node-scripts",
  discover(facts: StackFacts): Candidate[] {
    if (!facts.markers.includes("package.json")) return [];
    const scripts = readScripts(path.join(facts.root, "package.json"));
    const pm = facts.pm ?? "npm";
    const out: Candidate[] = [];

    for (const rule of SCRIPT_RULES) {
      for (const name of rule.names) {
        const command = scripts[name];
        if (command === undefined) continue;
        out.push(
          candidate({
            slot: rule.slot,
            adapter: "node-scripts",
            ref: name,
            resolved: `${pm} run ${name}`,
            pm,
            config_file: "package.json",
            /*
             * Only this script's own text. Editing a sibling script is not
             * drift, which is the precision V-3's AC asks for.
             */
            config_region: `scripts.${name}=${command}`,
            rank: rule.rank,
          }),
        );
      }
    }
    return out;
  },
};

function readScripts(file: string): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { scripts?: Record<string, unknown> };
    const scripts = parsed.scripts ?? {};
    return Object.fromEntries(
      Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    /*
     * An unparseable manifest proposes nothing. Discovery is token-free and
     * must not fail the run; the missing binding surfaces as an unbound slot.
     */
    return {};
  }
}
