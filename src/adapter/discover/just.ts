import { readFileSync } from "node:fs";
import path from "node:path";
import { parseRecipes } from "./recipes.js";
import { TARGET_SLOTS } from "./make.js";
import { candidate, type Candidate, type Engine, type StackFacts } from "./types.js";

/** justfile recipes (V-1) — the same shape as make, a different runner. */

const JUSTFILES = ["justfile", "Justfile", ".justfile"];

export const justEngine: Engine = {
  name: "just",
  discover(facts: StackFacts): Candidate[] {
    const file = JUSTFILES.find((m) => facts.markers.includes(m));
    if (file === undefined) return [];

    let recipes;
    try {
      recipes = parseRecipes(readFileSync(path.join(facts.root, file), "utf8"));
    } catch {
      return [];
    }

    const out: Candidate[] = [];
    for (const [target, slot] of TARGET_SLOTS) {
      const recipe = recipes.find((r) => r.name === target);
      if (recipe === undefined) continue;
      out.push(
        candidate({
          slot,
          adapter: "just",
          ref: target,
          resolved: `just ${target}`,
          pm: null,
          config_file: file,
          config_region: recipe.block,
          rank: 0,
        }),
      );
    }
    return out;
  },
};
