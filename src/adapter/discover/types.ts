import { createHash } from "node:crypto";
import type { GateSlot } from "../run.js";
import { GATE_SLOTS } from "../run.js";

/**
 * T-025 — the shape discovery produces (V-1, C-2).
 *
 * Discovery is deterministic and token-free: it reads the project's own
 * manifests and proposes candidate bindings. It never executes anything —
 * V-1's execution step is T-026's, and P4 means a candidate is a guess until
 * then.
 */

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface Candidate {
  readonly slot: GateSlot;
  /** Which engine proposed it. Becomes V-2's `adapter`. */
  readonly adapter: string;
  /** The native reference: a script name, a make target, a tool. */
  readonly ref: string;
  /** The literal command, before invocation-time normalization (T-028). */
  readonly resolved: string;
  readonly pm: PackageManager | null;
  /** Repo-relative POSIX path of the file that defines it. */
  readonly config_file: string;
  /**
   * The smallest canonical text that determines `resolved`. V-3 compares this
   * region, not the whole file, so editing an unrelated script is not drift.
   * Engines whose command follows from a file merely *existing* record
   * `exists:<file>`; engines that read a value record the value.
   */
  readonly config_region: string;
  readonly config_hash: string;
  /** Lower wins within a slot. Ties are the ambiguity V-1 refuses to guess at. */
  readonly rank: number;
}

export interface StackFacts {
  readonly root: string;
  /** Repo-relative POSIX paths of every manifest, lockfile and marker found. */
  readonly markers: readonly string[];
  readonly pm: PackageManager | null;
}

export interface Discovery {
  readonly schema_version: number;
  readonly stack: {
    readonly markers: readonly string[];
    readonly pm: PackageManager | null;
  };
  readonly candidates: readonly Candidate[];
}

export interface Engine {
  readonly name: string;
  /** Pure: same tree in, same candidates out (N-2). */
  discover(facts: StackFacts): Candidate[];
}

export function regionHash(region: string): string {
  return createHash("sha256").update(region).digest("hex");
}

/** Build a candidate with its region hash derived rather than passed in. */
export function candidate(input: Omit<Candidate, "config_hash">): Candidate {
  return { ...input, config_hash: regionHash(input.config_region) };
}

const SLOT_ORDER = new Map<GateSlot, number>(GATE_SLOTS.map((s, i) => [s, i]));

/** Total order over candidates, so the emitted JSON cannot vary. */
export function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    (SLOT_ORDER.get(a.slot) ?? 99) - (SLOT_ORDER.get(b.slot) ?? 99) ||
    a.rank - b.rank ||
    a.adapter.localeCompare(b.adapter) ||
    a.ref.localeCompare(b.ref) ||
    a.resolved.localeCompare(b.resolved)
  );
}

/**
 * C-3b's "exactly one plausible candidate". Plausibility is the best rank in
 * the slot: a declared `typecheck` script and an inferred `tsc --noEmit` are
 * not two opinions, they are a preference and a fallback. Two candidates at the
 * same rank genuinely are two opinions, and V-1 refuses to guess between them.
 */
export function plausible(candidates: readonly Candidate[], slot: GateSlot): Candidate[] {
  const forSlot = candidates.filter((c) => c.slot === slot);
  if (forSlot.length === 0) return [];
  const best = Math.min(...forSlot.map((c) => c.rank));
  return forSlot.filter((c) => c.rank === best).sort(compareCandidates);
}

/**
 * N-2 serialization determinism: keys sorted at every depth, so `discovery.json`
 * is byte-identical across process invocations whatever order the engines ran
 * in or the filesystem listed in.
 */
export function serializeDiscovery(discovery: Discovery): string {
  return `${stableStringify(discovery)}\n`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
