import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArtifact } from "../schemas/common.js";
import { bindingsFileSchema, type Binding, type BindingsFile } from "../schemas/records.js";
import { stateDir, writeArtifact } from "../fs/layout.js";
import type { Candidate, Discovery } from "./discover/types.js";
import type { GateSlot } from "./run.js";

/**
 * T-027 — drift halting (V-3) and the config-region comparison it rests on.
 *
 * SEC-5: this is a security control, not a convenience. A gate redefined
 * mid-run is treated as tampering until a human re-baselines, because the
 * alternative — silently re-resolving — means a session can rewrite what
 * "passing" means and then pass.
 *
 * The comparison is region-precise: T-025 hashes only the text that determines
 * the command, so editing a neighbouring script is not a halting event.
 */

const BINDINGS_FILE = "bindings.json";

function bindingsPath(root: string): string {
  return path.join(stateDir(root), BINDINGS_FILE);
}

export function readBindings(root: string): BindingsFile {
  const file = bindingsPath(root);
  if (!existsSync(file)) return { schema_version: 1, bindings: [], skips: [] };
  const parsed = parseArtifact(bindingsFileSchema, JSON.parse(readFileSync(file, "utf8")));
  if (parsed.ok) return parsed.value;
  throw new Error(
    parsed.reason === "newer-schema"
      ? `bindings.json declares schema_version ${parsed.found}; this build supports ${parsed.supported}`
      : `bindings.json is invalid: ${parsed.issues.join("; ")}`,
  );
}

export function writeBindings(root: string, file: Omit<BindingsFile, "schema_version">): void {
  writeArtifact(root, BINDINGS_FILE, file);
}

type DriftStatus = "clean" | "drifted" | "exempt" | "vanished";

export interface DriftCheck {
  readonly slot: GateSlot;
  readonly status: DriftStatus;
  readonly stored_hash: string;
  /** `null` when the defining configuration no longer exists at all. */
  readonly current_hash: string | null;
  readonly message: string;
}

/** A stored binding matches the candidate that would be proposed for it today. */
function currentFor(binding: Binding, discovery: Discovery): Candidate | undefined {
  return discovery.candidates.find(
    (c) => c.slot === binding.slot && c.adapter === binding.adapter && c.ref === binding.ref,
  );
}

/**
 * V-3: re-resolve and compare. `provisional` bindings are exempt — C-4 has not
 * finalised them yet, so there is no baseline to have drifted from.
 */
export function checkBinding(binding: Binding, discovery: Discovery): DriftCheck {
  if (binding.status === "provisional") {
    return {
      slot: binding.slot,
      status: "exempt",
      stored_hash: binding.config_hash,
      current_hash: currentFor(binding, discovery)?.config_hash ?? null,
      message: `${binding.slot}: provisional binding, exempt from drift until bootstrap ticket #1 finalises it (C-4).`,
    };
  }

  const current = currentFor(binding, discovery);
  if (current === undefined) {
    return {
      slot: binding.slot,
      status: "vanished",
      stored_hash: binding.config_hash,
      current_hash: null,
      message:
        `${binding.slot}: the configuration defining \`${binding.resolved}\` (${binding.adapter}:${binding.ref}) ` +
        `no longer exists — verification changed, re-baseline with \`detent verify sync\`.`,
    };
  }

  if (current.config_hash !== binding.config_hash) {
    return {
      slot: binding.slot,
      status: "drifted",
      stored_hash: binding.config_hash,
      current_hash: current.config_hash,
      message:
        `${binding.slot}: verification changed — re-baseline. Stored config_hash ${binding.config_hash}, ` +
        `current ${current.config_hash} (${current.config_file}). Run \`detent verify sync\` to accept it.`,
    };
  }

  return {
    slot: binding.slot,
    status: "clean",
    stored_hash: binding.config_hash,
    current_hash: current.config_hash,
    message: `${binding.slot}: unchanged.`,
  };
}

export interface DriftReport {
  readonly checks: readonly DriftCheck[];
  readonly halting: readonly DriftCheck[];
}

export function checkAll(bindings: readonly Binding[], discovery: Discovery): DriftReport {
  const checks = bindings.map((b) => checkBinding(b, discovery));
  return { checks, halting: checks.filter((c) => c.status === "drifted" || c.status === "vanished") };
}

/** C-11: `2` is "not ready", which is what binding drift means. */
export const DRIFT_EXIT_CODE = 2;

export class DriftHaltError extends Error {
  readonly exitCode = DRIFT_EXIT_CODE;

  constructor(readonly halting: readonly DriftCheck[]) {
    super(`verification changed — re-baseline\n${halting.map((h) => `  ${h.message}`).join("\n")}`);
    this.name = "DriftHaltError";
  }
}

/**
 * Called before every gate (V-3). Throws rather than returning a flag: a caller
 * that forgets to check a boolean runs the gate anyway, and SEC-5 does not
 * tolerate that failure mode.
 */
export function assertNoDrift(bindings: readonly Binding[], discovery: Discovery): DriftReport {
  const report = checkAll(bindings, discovery);
  if (report.halting.length > 0) throw new DriftHaltError(report.halting);
  return report;
}

/**
 * C-4: bootstrap ticket #1 passed, so greenfield bindings become the baseline.
 * The hash is taken from what exists *now* — that is what "baseline" means.
 */
export function finalize(binding: Binding, discovery: Discovery): Binding {
  if (binding.status === "approved") return binding;
  const current = currentFor(binding, discovery);
  if (current === undefined) {
    throw new Error(`cannot finalise ${binding.slot}: its defining configuration no longer exists`);
  }
  return { ...binding, status: "approved", config_hash: current.config_hash };
}
