import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MARKERS, discover } from "../adapter/discover/index.js";
import { checkAll, currentFor, readBindings, writeBindings } from "../adapter/drift.js";
import { stateDir } from "../fs/layout.js";
import type { Binding } from "../schemas/records.js";
import { git } from "./git.js";

/**
 * V-3⁗ (PRDR-230) — a ticket's tree is judged against the commit its branch was
 * CUT FROM, and the acceptance of a change lives where no session can reach.
 *
 * Under B-2″'s worktrees a verification change lives on the ticket's branch
 * until the merge, so judging that tree against the ROOT's current baseline
 * halted a run the root could never clear (PRDR-226). PRDR-226's answer was a
 * per-ticket STORED hash, and it was wrong twice: it holds whatever the root
 * held at the instant it was written, and its write-once guard keys on a file
 * that did not exist for worktrees cut before it shipped — so on gate-313 it
 * was written late, against a root that had already accepted another ticket's
 * lint change, and t-s01-003 was blocked for a change the run branch made.
 *
 * The base is a COMMIT. `git merge-base HEAD <run branch>` names the tree the
 * ticket was cut from: derivable by any build at any time, immune to a late
 * write, and naming a tree nothing can edit. Verified equal to the
 * long-standing `claim_base.json` sha on all four of gate-313's worktrees.
 *
 * Reading the fork's configuration by discovering in the tree at claim time was
 * considered and refused: that base would come from a directory the session
 * writes, and it coincides with the branch point only when the first claim IS
 * the creation claim — the very coincidence that broke here.
 */

export type Baseline = Readonly<Record<string, string>>;

interface AcceptRecord {
  readonly schema_version: 1;
  readonly by: string;
  readonly at: string;
  readonly hashes: Baseline;
}

/**
 * PRDR-230: under `state/`, never under the ticket's runs directory.
 *
 * `runsDir(root, id)` is the session's `artifactRoot`, which the containment
 * guard admits for mutation so a session can produce its artifact — so a
 * session that weakened its own gate could also write the record accepting the
 * weakening (SEC-5). Observed: `guardToolUse("Write", …drift_accept.json)`
 * answered `allow` under the production policy. No surface and no artifact root
 * reaches `state/`.
 */
export function driftAcceptPath(root: string, id: string): string {
  return path.join(stateDir(root), "state", "drift-accepts", `${id}.json`);
}

/** The commit a ticket's branch was cut from; null when git cannot say, which falls back to the root's baseline. */
export function forkCommit(workDir: string, runBranch: string): string | null {
  try {
    const sha = git(workDir, "merge-base", "HEAD", runBranch).trim();
    return sha === "" ? null : sha;
  } catch {
    return null;
  }
}

/**
 * The fork's configuration, read by the ORDINARY discovery so both sides of the
 * comparison come from one implementation. `gatherFacts` scans root-level
 * marker files, so materialising those blobs out of the commit is faithful for
 * every adapter that binds from a root marker; a config the fork keeps
 * elsewhere yields no candidate, which falls back to the root's binding rather
 * than to a weaker answer.
 */
export function discoverAtCommit(workDir: string, sha: string): ReturnType<typeof discover> | null {
  let dir: string | null = null;
  try {
    dir = mkdtempSync(path.join(tmpdir(), "detent-fork-"));
    for (const name of git(workDir, "ls-tree", "--name-only", sha).split("\n").map((l) => l.trim())) {
      if (name === "" || !MARKERS.includes(name)) continue;
      try {
        writeFileSync(path.join(dir, name), git(workDir, "show", `${sha}:${name}`));
      } catch {
        /* A marker that is a tree, or unreadable at this commit: absent, so it yields no candidate. */
      }
    }
    return discover(dir);
  } catch {
    return null;
  } finally {
    if (dir !== null) rmSync(dir, { recursive: true, force: true });
  }
}

export function readAcceptedDrift(root: string, id: string): AcceptRecord | null {
  const file = driftAcceptPath(root, id);
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<AcceptRecord>;
    const hashes: Record<string, string> = {};
    for (const [slot, hash] of Object.entries(raw.hashes ?? {})) if (typeof hash === "string") hashes[slot] = hash;
    return { schema_version: 1, by: typeof raw.by === "string" ? raw.by : "operator", at: typeof raw.at === "string" ? raw.at : "", hashes };
  } catch {
    return null;
  }
}

/**
 * The bindings a ticket's tree is judged by: the root's, with each slot's hash
 * replaced by what the FORK carried, and by what an operator accepted for this
 * ticket over that. A slot the fork does not define keeps the root's hash, so
 * a tree that AUTHORED a bound gate's config must still match what an operator
 * executed. Non-worktree mode returns the root's bindings untouched.
 */
export function bindingsForTree(root: string, id: string, workDir: string, runBranch: string): Binding[] {
  const file = readBindings(root);
  if (path.resolve(workDir) === path.resolve(root)) return [...file.bindings];
  const accepted = readAcceptedDrift(root, id)?.hashes ?? {};
  const sha = forkCommit(workDir, runBranch);
  const fork = sha === null ? null : discoverAtCommit(workDir, sha);
  return file.bindings.map((b) => {
    const hash = accepted[b.slot] ?? (fork === null ? undefined : currentFor(b, fork)?.config_hash);
    return hash === undefined ? b : { ...b, config_hash: hash };
  });
}

export function acceptDrift(root: string, id: string, by: string, at: string, hashes: Baseline): void {
  const file = driftAcceptPath(root, id);
  const previous = readAcceptedDrift(root, id)?.hashes ?? {};
  mkdirSync(path.dirname(file), { recursive: true });
  const record: AcceptRecord = { schema_version: 1, by, at, hashes: { ...previous, ...hashes } };
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
}

/**
 * At the merge: the run branch now carries the accepted change, so the root's
 * baseline follows the ROOT's tree — whatever the merge produced — and the
 * acceptance is consumed so no later generation inherits it.
 */
export function rebaselineAccepted(root: string, id: string, at: string): string[] {
  const accepted = readAcceptedDrift(root, id);
  if (accepted === null) return [];
  const file = readBindings(root);
  const checks = checkAll(file.bindings, discover(root)).checks;
  const changed: string[] = [];
  const bindings = file.bindings.map((b) => {
    const current = checks.find((c) => c.slot === b.slot)?.current_hash;
    if (typeof current !== "string" || current === b.config_hash) return b;
    changed.push(b.slot);
    return { ...b, config_hash: current, executed_at: at, approved_by: accepted.by };
  });
  if (changed.length > 0) writeBindings(root, { bindings, skips: [...file.skips] });
  rmSync(driftAcceptPath(root, id), { force: true });
  return changed;
}

export function hasAcceptedDrift(root: string, id: string): boolean {
  return existsSync(driftAcceptPath(root, id));
}
