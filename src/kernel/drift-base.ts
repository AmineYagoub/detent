import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { discover } from "../adapter/discover/index.js";
import { checkAll, readBindings, writeBindings } from "../adapter/drift.js";
import type { Binding } from "../schemas/records.js";
import { runsDir } from "./journal.js";

/**
 * V-3‴ (PRDR-226) — drift is judged against the baseline a ticket's tree
 * STARTED FROM, and a change is accepted per ticket.
 *
 * Under B-2″'s worktrees a verification change lives on the ticket's branch
 * until the merge, so judging that tree against the root's baseline halted a
 * run that `verify sync` on the root could never clear: the root never sees
 * the change, and the run branch's `.detent/` is not even tracked, so a tree
 * carries no baseline of its own. Two small records under the ticket's runs
 * directory carry what the tree cannot:
 *
 * - `drift_base.json`: the root's config hashes when the ticket's worktree was
 *   first claimed — the base it branched from. Written once, so a branch that
 *   predates a later accepted change is not accused of it.
 * - `drift_accept.json`: the hashes an operator accepted for THIS ticket with
 *   `detent verify sync <root> --ticket <id>`, after the gates ran in its tree.
 *   Consumed at the merge, where the root's baseline follows the run branch.
 *
 * SEC-5 keeps its meaning: a session can write neither file (they are run
 * state under `.detent/runs`, outside every surface), and only an executed
 * re-baseline puts a hash into the second.
 */

export type Baseline = Readonly<Record<string, string>>;

const BASE_FILE = "drift_base.json";
const ACCEPT_FILE = "drift_accept.json";

interface AcceptRecord {
  readonly schema_version: 1;
  readonly by: string;
  readonly at: string;
  readonly hashes: Baseline;
}

function readHashes(file: string, key: "baseline" | "hashes"): Baseline | null {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const value = raw[key];
    if (typeof value !== "object" || value === null) return null;
    const out: Record<string, string> = {};
    for (const [slot, hash] of Object.entries(value)) if (typeof hash === "string") out[slot] = hash;
    return out;
  } catch {
    return null;
  }
}

export function readGenerationBaseline(root: string, id: string): Baseline | null {
  return readHashes(path.join(runsDir(root, id), BASE_FILE), "baseline");
}

export function readAcceptedDrift(root: string, id: string): AcceptRecord | null {
  const file = path.join(runsDir(root, id), ACCEPT_FILE);
  const hashes = readHashes(file, "hashes");
  if (hashes === null) return null;
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<AcceptRecord>;
  return { schema_version: 1, by: typeof raw.by === "string" ? raw.by : "operator", at: typeof raw.at === "string" ? raw.at : "", hashes };
}

/** The base a tree started from: written at the first claim, from the root's bindings, and never again. */
export function recordGenerationBaseline(root: string, id: string): Baseline {
  const file = path.join(runsDir(root, id), BASE_FILE);
  const existing = readGenerationBaseline(root, id);
  if (existing !== null) return existing;
  const baseline = Object.fromEntries(readBindings(root).bindings.map((b) => [b.slot, b.config_hash]));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ schema_version: 1, baseline }, null, 2)}\n`);
  return baseline;
}

/** The bindings a ticket's tree is judged by: the root's, with the tree's own base and any accepted hashes over it. */
export function bindingsForTree(root: string, id: string): Binding[] {
  const base = readGenerationBaseline(root, id) ?? {};
  const accepted = readAcceptedDrift(root, id)?.hashes ?? {};
  return readBindings(root).bindings.map((b) => {
    const hash = accepted[b.slot] ?? base[b.slot];
    return hash === undefined ? b : { ...b, config_hash: hash };
  });
}

export function acceptDrift(root: string, id: string, by: string, at: string, hashes: Baseline): void {
  const file = path.join(runsDir(root, id), ACCEPT_FILE);
  const previous = readAcceptedDrift(root, id)?.hashes ?? {};
  mkdirSync(path.dirname(file), { recursive: true });
  const record: AcceptRecord = { schema_version: 1, by, at, hashes: { ...previous, ...hashes } };
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
}

/**
 * At the merge: the run branch now carries the accepted change, so the root's
 * baseline follows the ROOT's tree — whatever the merge produced, not the
 * pre-merge worktree — and the acceptance is consumed so no later generation
 * inherits it. Returns the slots re-baselined.
 */
export function rebaselineAccepted(root: string, id: string, at: string): string[] {
  const accepted = readAcceptedDrift(root, id);
  if (accepted === null) return [];
  const file = readBindings(root);
  const checks = checkAll(file.bindings, discover(root)).checks;
  const changed: string[] = [];
  const bindings = file.bindings.map((b) => {
    const check = checks.find((c) => c.slot === b.slot);
    const current = check?.current_hash;
    if (typeof current !== "string" || current === b.config_hash) return b;
    changed.push(b.slot);
    return { ...b, config_hash: current, executed_at: at, approved_by: accepted.by };
  });
  if (changed.length > 0) writeBindings(root, { bindings, skips: [...file.skips] });
  rmSync(path.join(runsDir(root, id), ACCEPT_FILE), { force: true });
  return changed;
}

export function hasAcceptedDrift(root: string, id: string): boolean {
  return existsSync(path.join(runsDir(root, id), ACCEPT_FILE));
}
