import type { GateSlot } from "../run.js";
import { candidate, type Candidate, type Engine, type StackFacts } from "./types.js";

/** Cargo.toml (V-1). As with go, the manifest's existence is the signal. */

const COMMANDS: readonly (readonly [GateSlot, string, string, number])[] = [
  ["test", "cargo test", "cargo test", 0],
  ["typecheck", "cargo check", "cargo check", 0],
  ["lint", "cargo clippy", "cargo clippy --all-targets -- -D warnings", 0],
  ["build", "cargo build", "cargo build", 0],
];

export const rustEngine: Engine = {
  name: "cargo",
  discover(facts: StackFacts): Candidate[] {
    if (!facts.markers.includes("Cargo.toml")) return [];
    return COMMANDS.map(([slot, ref, resolved, rank]) =>
      candidate({
        slot,
        adapter: "cargo",
        ref,
        resolved,
        pm: null,
        config_file: "Cargo.toml",
        config_region: "exists:Cargo.toml",
        rank,
      }),
    );
  },
};
