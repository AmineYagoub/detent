import { readFileSync } from "node:fs";
import path from "node:path";
import type { GateSlot } from "../run.js";
import { parseRecipes } from "./recipes.js";
import { candidate, type Candidate, type Engine, type StackFacts } from "./types.js";

/** Makefile targets (V-1). The recipe block is the region V-3 watches. */

export const TARGET_SLOTS: readonly (readonly [string, GateSlot])[] = [
  ["test", "test"],
  ["test-single", "test_single"],
  ["lint", "lint"],
  ["typecheck", "typecheck"],
  ["build", "build"],
  ["e2e", "e2e"],
];

const MAKEFILES = ["Makefile", "makefile", "GNUmakefile"];

export const makeEngine: Engine = {
  name: "make",
  discover(facts: StackFacts): Candidate[] {
    const file = MAKEFILES.find((m) => facts.markers.includes(m));
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
          adapter: "make",
          ref: target,
          resolved: `make ${target}`,
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
