import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SCRATCH_OUTPUT_LIMIT, SCRATCH_TIME_LIMIT_MS, SCRATCH_TOOL, type Sandbox, type ScratchGrant } from "../sessions/sandbox.js";

/**
 * S-1‴, S-1⁗ (PRDR-285) — a VALIDATE round's scratch directory, where its
 * reviewers' simulations run (specification decision 7).
 *
 * One directory per round, under the system's temporary directory: outside the
 * repository and `.detent/`, so nothing a script writes is committed or read by
 * a later phase, and removed once the round's reviewers are done, whatever they
 * did. Only their findings leave the round. With no sandbox the round says why
 * and runs its reviewers as it always did, reading every invariant.
 */

/** What a reviewer is told of its round's sandbox, or null when it has none. */
export function simulationInput(grant: ScratchGrant | null): Readonly<Record<string, unknown>> | null {
  if (grant === null) return null;
  return {
    tool: SCRATCH_TOOL,
    interpreters: grant.interpreters.map((i) => ({ name: i.name, version: i.version })),
    time_limit_seconds: SCRATCH_TIME_LIMIT_MS / 1000,
    output_limit_bytes: SCRATCH_OUTPUT_LIMIT,
  };
}

/** Said once, when a validation's first round has a sandbox: which interpreters, at which versions (non-goal: the machine's own). */
export function offeredNote(sandbox: Sandbox): string | null {
  if (sandbox.kind === "off") return null;
  const which = sandbox.interpreters.map((i) => `${i.name} ${i.version}`).join(" and ");
  return `VALIDATE: each round's reviewers may run simulations in a scratch directory macOS's Seatbelt sandboxes, with ${which} (S-1⁗)`;
}

/** Why a scratch directory under the system's temporary directory would not be outside the repository, or null when it would. */
function notOutside(root: string): string | null {
  let tmp: string;
  try {
    tmp = realpathSync(tmpdir());
  } catch (err) {
    return `the system's temporary directory, ${tmpdir()}, cannot be used: ${(err as Error).message}`;
  }
  const rel = path.relative(realpathSync(root), tmp);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return `the system's temporary directory, ${tmp}, is inside the repository, and a scratch directory there would be in it`;
}

/** Runs `body`, a round's reviews, with the round's scratch directory, or with none and the round saying why. */
export async function withRoundScratch<T>(
  root: string,
  round: number,
  sandbox: Sandbox,
  note: ((text: string) => void) | undefined,
  body: (grant: ScratchGrant | null) => Promise<T>,
): Promise<T> {
  const why = sandbox.kind === "off" ? sandbox.reason : notOutside(root);
  if (sandbox.kind === "off" || why !== null) {
    note?.(`VALIDATE round ${String(round)}: no reviewer can run a simulation, since ${why ?? ""}, so the invariants the pack states are read and not run (S-1⁗)`);
    return await body(null);
  }
  const dir = mkdtempSync(path.join(realpathSync(tmpdir()), "detent-scratch-"));
  try {
    return await body({ dir, exec: sandbox.exec, interpreters: sandbox.interpreters });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
