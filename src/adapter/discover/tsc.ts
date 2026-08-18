import { candidate, type Candidate, type Engine, type PackageManager, type StackFacts } from "./types.js";

/**
 * tsconfig.json ⇒ `tsc --noEmit` (V-1). Rank 1: a project that declares its own
 * `typecheck` script has said how it wants to be type-checked, and this is the
 * inference used only when it has not.
 */

const EXEC: Record<PackageManager, string> = {
  npm: "npx",
  pnpm: "pnpm exec",
  yarn: "yarn",
  bun: "bunx",
};

export const tscEngine: Engine = {
  name: "tsc",
  discover(facts: StackFacts): Candidate[] {
    const config = facts.markers.find((m) => m === "tsconfig.json");
    if (config === undefined) return [];
    const exec = EXEC[facts.pm ?? "npm"];
    return [
      candidate({
        slot: "typecheck",
        adapter: "tsc",
        ref: "tsc --noEmit",
        resolved: `${exec} tsc --noEmit`,
        pm: facts.pm,
        config_file: config,
        /*
         * The command follows from the file existing, not from its contents:
         * editing `strict` changes what typecheck *reports*, not what runs.
         */
        config_region: `exists:${config}`,
        rank: 1,
      }),
    ];
  },
};
