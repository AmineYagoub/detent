import type { GateSlot } from "../run.js";
import { candidate, type Candidate, type Engine, type StackFacts } from "./types.js";

/**
 * go.mod (V-1). Go's toolchain is uniform, so the module's existence is the
 * whole signal — and therefore the whole region V-3 watches.
 */

const COMMANDS: readonly (readonly [GateSlot, string, string])[] = [
  ["test", "go test", "go test ./..."],
  ["lint", "go vet", "go vet ./..."],
  ["build", "go build", "go build ./..."],
];

export const goEngine: Engine = {
  name: "go",
  discover(facts: StackFacts): Candidate[] {
    if (!facts.markers.includes("go.mod")) return [];
    return COMMANDS.map(([slot, ref, resolved]) =>
      candidate({
        slot,
        adapter: "go",
        ref,
        resolved,
        pm: null,
        config_file: "go.mod",
        config_region: "exists:go.mod",
        rank: 0,
      }),
    );
  },
};
