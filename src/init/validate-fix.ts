import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { STATE_DIR } from "../fs/layout.js";
import { noteUnitComplete } from "../kernel/ledger.js";
import type { Outcome } from "./validate-checks.js";
import { changedFiles, fixBatch, type RoundDeps, type ToFix } from "./validate-round.js";
import { rollback, snapshot, type Snapshot } from "./write-tree.js";

/**
 * C-2²⁴ (PRDR-314) — VALIDATE's writer, in batches.
 *
 * C-2¹⁴ gave one writer session every finding of a round. Tabachir's first
 * two reviews reported 23 findings each, so its first round would have handed
 * one session some 600, and one fix among them that left the checker red
 * would have undone them all. The findings are independent edits, each with
 * its exact fix, so a round's are cut into batches of at most
 * `VALIDATE_FIX_BATCH`, as few as that allows and as even as can be, and each
 * batch is a writer session checked as the round's writer was (`fixBatch`).
 * The batches run one after another, each on the pack the one before left,
 * since two writers editing one document would lose each other's edits. A
 * batch whose fixes fail the checks is undone alone. One whose account is
 * unusable twice, or whose session fails, undoes every batch of the round and
 * fails the phase, and the reviews the round kept (C-2²³) answer the re-run.
 */
export const VALIDATE_FIX_BATCH = 20;

/** `items` in order, cut into as few runs of at most `size` as that allows, their lengths differing by one at most. */
export function fixBatches<T>(items: readonly T[], size: number = VALIDATE_FIX_BATCH): T[][] {
  const count = Math.ceil(items.length / size);
  const batches: T[][] = [];
  for (let b = 0, at = 0; b < count; b += 1) {
    const take = Math.ceil((items.length - at) / (count - b));
    batches.push(items.slice(at, at + take));
    at += take;
  }
  return batches;
}

export interface Fixed {
  readonly outcome: ReadonlyMap<string, Outcome>;
  /** The pack's documents the fixes changed, which stand. */
  readonly changed: readonly string[];
  /** The diff of those changes, repo-relative; null when nothing changed. */
  readonly diff: string | null;
  /** Whether every batch's fixes stand: false when one left the checker red, and its fixes were undone. */
  readonly stood: boolean;
}

/**
 * The writer labelled `label`, a round or the checker's: each of `batches` one
 * session, one after another. What changed is read from where the first
 * began, and so is the diff the next round verifies. A batch that stands is a
 * unit of work (X-1⁵).
 */
export async function fixFindings(deps: RoundDeps, label: string, batches: readonly (readonly ToFix[])[], source: "checker" | "review"): Promise<Fixed> {
  const before = snapshot(deps.root, []);
  if (batches.length > 1) {
    const count = batches.reduce((n, batch) => n + batch.length, 0);
    deps.note?.(`VALIDATE's writer, ${label}: ${String(count)} findings in ${String(batches.length)} batches of at most ${String(VALIDATE_FIX_BATCH)}, one after another (C-2²⁴)`);
  }
  const outcome = new Map<string, Outcome>();
  let stood = true;
  try {
    for (const [i, batch] of batches.entries()) {
      const stage = batches.length === 1 ? `VALIDATE's writer, ${label}` : `VALIDATE's writer, ${label}, batch ${String(i + 1)} of ${String(batches.length)}`;
      const fixed = await fixBatch(deps, stage, batch, source);
      for (const [id, left] of fixed.outcome) outcome.set(id, left);
      stood &&= fixed.stood;
      if (fixed.stood) noteUnitComplete(deps.root);
    }
  } catch (err) {
    rollback(deps.root, before);
    throw err;
  }
  const changed = changedFiles(deps.root, before);
  return { outcome, changed, diff: changed.length === 0 ? null : writeDiff(deps.root, label, before, changed), stood };
}

/** Where the diff of the writer labelled `label` is kept, repo-relative: the next round's reviewers read it, and so does a round that carries on after a stop. */
export function diffPath(label: string): string {
  return `${STATE_DIR}/state/validate/${label.replace(/[^a-z0-9]+/giu, "-").toLowerCase()}.diff`;
}

/**
 * The diff of one writer's changes, for the next round's reviewers: the
 * snapshot's bytes and the tree's, side by side under `.detent/`, compared by
 * `git diff --no-index`, which exits 1 when they differ.
 */
function writeDiff(root: string, label: string, before: Snapshot, changed: readonly string[]): string {
  const rel = diffPath(label);
  const file = path.join(root, ...rel.split("/"));
  const work = file.replace(/\.diff$/u, "");
  rmSync(work, { recursive: true, force: true });
  for (const side of ["before", "after"]) mkdirSync(path.join(work, side), { recursive: true });
  for (const rel of changed) {
    const was = before.files.get(rel);
    const now = path.join(root, ...rel.split("/"));
    const put = (side: string, bytes: Buffer): void => {
      const to = path.join(work, side, ...rel.split("/"));
      mkdirSync(path.dirname(to), { recursive: true });
      writeFileSync(to, bytes);
    };
    if (was !== undefined) put("before", was);
    if (existsSync(now)) put("after", readFileSync(now));
  }
  let text: string;
  try {
    text = execFileSync("git", ["diff", "--no-index", "--no-color", "--", "before", "after"], { cwd: work, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const { status, stdout } = err as { status?: unknown; stdout?: unknown };
    if (status !== 1 || typeof stdout !== "string") throw err;
    text = stdout;
  }
  rmSync(work, { recursive: true, force: true });
  writeFileSync(file, text);
  return rel;
}
