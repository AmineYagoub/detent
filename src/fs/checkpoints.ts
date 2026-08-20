import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArtifact } from "../schemas/common.js";
import { checkpointSchema, type Checkpoint } from "../schemas/records.js";
import { stateDir } from "./layout.js";

/**
 * T-024 — content-addressed checkpoints (F-4, P9).
 *
 * P9: stale state is unconsumable. The API makes that structural rather than
 * disciplined — a stale read carries no `checkpoint` field at all, so there is
 * no data for a caller to reach for and no check for a caller to forget.
 *
 * Phases chain: each phase's input hash folds in its predecessor's, so a change
 * to an early input invalidates it and everything downstream and nothing else.
 * That is C-8's "replay from the first checkpoint whose inputs drifted", turned
 * into arithmetic instead of a rule someone has to apply.
 */

interface PhaseSpec {
  /** Filesystem-safe; it names the checkpoint file. */
  readonly phase: string;
  /** Repo-relative POSIX paths this phase reads. */
  readonly inputs: readonly string[];
}

export type Pipeline = readonly PhaseSpec[];

const PHASE_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

class UnknownPhaseError extends Error {
  constructor(readonly phase: string) {
    super(`no such phase in the pipeline: ${phase}`);
    this.name = "UnknownPhaseError";
  }
}

export function checkpointPath(root: string, phase: string): string {
  if (!PHASE_NAME.test(phase)) throw new Error(`unsafe phase name: ${phase}`);
  return path.join(stateDir(root), "state", `${phase}.json`);
}

/** A file that does not exist hashes to a marker, so creating it is drift. */
function fileDigest(root: string, rel: string): string {
  const abs = path.join(root, ...rel.split("/"));
  if (!existsSync(abs)) return "absent";
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

/**
 * The hash a phase's checkpoint is addressed by: its own inputs, folded into
 * everything upstream. Inputs are sorted, so declaration order cannot move it.
 */
export function inputsHash(root: string, pipeline: Pipeline, phase: string): string {
  const index = pipeline.findIndex((p) => p.phase === phase);
  if (index === -1) throw new UnknownPhaseError(phase);

  let carried = "";
  for (const spec of pipeline.slice(0, index + 1)) {
    const h = createHash("sha256").update(`${carried}\0${spec.phase}\n`);
    for (const rel of [...spec.inputs].sort()) h.update(`${rel}\0${fileDigest(root, rel)}\n`);
    carried = h.digest("hex");
  }
  return carried;
}

export type CheckpointRead =
  | { readonly status: "fresh"; readonly checkpoint: Checkpoint }
  | { readonly status: "stale"; readonly recorded: string; readonly expected: string }
  | { readonly status: "absent" }
  | { readonly status: "invalid"; readonly issues: readonly string[] };

/**
 * Read a checkpoint, or refuse to. Only the `fresh` branch carries data: a
 * caller cannot consume a stale checkpoint because there is nothing to consume.
 */
export function readCheckpoint(root: string, phase: string, expected: string): CheckpointRead {
  const file = checkpointPath(root, phase);
  if (!existsSync(file)) return { status: "absent" };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    return { status: "invalid", issues: [(err as Error).message] };
  }

  const parsed = parseArtifact(checkpointSchema, raw);
  if (!parsed.ok) {
    return {
      status: "invalid",
      issues: parsed.reason === "invalid" ? parsed.issues : [`schema_version ${parsed.found} is newer than ${parsed.supported}`],
    };
  }
  if (parsed.value.inputs_hash !== expected) {
    return { status: "stale", recorded: parsed.value.inputs_hash, expected };
  }
  return { status: "fresh", checkpoint: parsed.value };
}

export interface SaveOptions {
  readonly at?: string;
}

/** Persist a phase's outputs against the hash of what produced them (A-7). */
export function writeCheckpoint(
  root: string,
  phase: string,
  hash: string,
  outputs: Readonly<Record<string, unknown>>,
  opts: SaveOptions = {},
): Checkpoint {
  const checkpoint = checkpointSchema.parse({
    schema_version: 1,
    phase,
    inputs_hash: hash,
    outputs,
    at: opts.at ?? new Date().toISOString(),
  });
  const file = checkpointPath(root, phase);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(checkpoint, null, 2)}\n`);
  return checkpoint;
}

type PhaseDisposition = "reuse" | "execute";

interface PhasePlan {
  readonly phase: string;
  readonly disposition: PhaseDisposition;
  readonly hash: string;
  /** Why it must run. Absent when reused. */
  readonly reason?: "absent" | "stale" | "invalid" | "downstream";
}

export interface ResumePlan {
  readonly phases: readonly PhasePlan[];
  /** The first phase that must re-execute, or null when everything is fresh. */
  readonly replayFrom: string | null;
  readonly toExecute: readonly string[];
}

/**
 * C-8: replay from the first checkpoint whose inputs drifted. Once a phase must
 * run, every later phase runs too — its inputs include this one's outputs, so
 * its own checkpoint is stale by construction. The walk states that explicitly
 * rather than relying on the hash chain having already caught it.
 */
export function resumePlan(root: string, pipeline: Pipeline): ResumePlan {
  const phases: PhasePlan[] = [];
  let replaying = false;
  let replayFrom: string | null = null;

  for (const spec of pipeline) {
    const hash = inputsHash(root, pipeline, spec.phase);
    if (replaying) {
      phases.push({ phase: spec.phase, disposition: "execute", hash, reason: "downstream" });
      continue;
    }
    const read = readCheckpoint(root, spec.phase, hash);
    if (read.status === "fresh") {
      phases.push({ phase: spec.phase, disposition: "reuse", hash });
      continue;
    }
    replaying = true;
    replayFrom = spec.phase;
    phases.push({ phase: spec.phase, disposition: "execute", hash, reason: read.status });
  }

  return {
    phases,
    replayFrom,
    toExecute: phases.filter((p) => p.disposition === "execute").map((p) => p.phase),
  };
}

/**
 * Consume a phase's checkpoint or run it. The callback runs only when the
 * checkpoint is missing or stale, and its outputs are checkpointed against the
 * same hash that will be checked next time.
 */
export async function withCheckpoint(
  root: string,
  pipeline: Pipeline,
  phase: string,
  execute: () => Promise<Record<string, unknown>>,
  opts: SaveOptions = {},
): Promise<{ readonly outputs: Record<string, unknown>; readonly reused: boolean }> {
  const hash = inputsHash(root, pipeline, phase);
  const read = readCheckpoint(root, phase, hash);
  if (read.status === "fresh") return { outputs: { ...read.checkpoint.outputs }, reused: true };
  const outputs = await execute();
  writeCheckpoint(root, phase, hash, outputs, opts);
  return { outputs, reused: false };
}
