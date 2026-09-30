import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { STATE_DIR } from "../fs/layout.js";
import { noteUnitComplete } from "../kernel/ledger.js";
import { readLedgerRows } from "../kernel/ledger-rows.js";
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

/**
 * C-2²⁷ (PRDR-323) — the order the writer takes a round's findings in, and
 * where its batches are cut.
 *
 * C-2²⁴ cut them in the order `mergeFindings` gives, the areas' order.
 * Reviewers of different areas quote the same text: on tabachir's first round
 * 134 of the 379 findings shared their first place with another, and cut in
 * the areas' order 22 of those places fell in two or more of the 19 batches,
 * each batch's writer editing a place without seeing what another would ask of
 * it. The first batch already held a minor, and the seventeenth was the last
 * to hold a blocker, so a batch the checks undid took blockers down with
 * minors, and no ledger row said what the minors cost.
 *
 * Findings that share a first place, the same file and line, are one group,
 * split only when it holds more than a batch, and a group's most severe
 * finding goes first. Groups go most severe first, then by file and line, and
 * batches are cut on group boundaries, as few as that allows, each near an
 * even share of what is left. A minor at a blocker's place goes with the
 * blocker, one edit then settling the place. The minors that share a place
 * with no blocker or major come last, in batches of their own: they are cut
 * apart from the rest, so their batches' ledger rows are what they cost, at
 * the price of one batch more than cutting all of them together may take.
 */
const SEVERITY_ORDER: Readonly<Record<string, number>> = { blocker: 0, major: 1, minor: 2 };

const severityOf = (f: ToFix): number => SEVERITY_ORDER[String(f["severity"])] ?? Object.keys(SEVERITY_ORDER).length;

/** A finding's first place: its file and line, or null for one that names none. */
function firstPlace(f: ToFix): { readonly file: string; readonly line: number } | null {
  const places = f["places"];
  const first: unknown = Array.isArray(places) ? places[0] : undefined;
  if (typeof first !== "object" || first === null) return null;
  const { file, line } = first as { file?: unknown; line?: unknown };
  return typeof file === "string" && typeof line === "number" ? { file, line } : null;
}

/** A finding's group: its first place, or the finding alone where it names none. */
function placeKey(f: ToFix): string {
  const place = firstPlace(f);
  return place === null ? `\u0000${f.id}` : `${place.file}\u0000${String(place.line)}`;
}

const isMinor = (f: ToFix): boolean => f["severity"] === "minor";

/** How many batches of at most `size` whole `units` need, in order: the greedy count, which is the fewest. */
function fewestBatches<T>(units: readonly (readonly T[])[], size: number): number {
  let count = 0;
  let room = 0;
  for (const unit of units) {
    if (count > 0 && unit.length <= room) room -= unit.length;
    else {
      count += 1;
      room = size - unit.length;
    }
  }
  return count;
}

/**
 * `units` in order, cut on their boundaries into as few batches of at most
 * `size` as that allows. Each batch aims at an even share of what is left: it
 * takes the unit that crosses its share when that lands nearer the share, or
 * when stopping short would leave more than the batches after it can hold.
 */
function cutOnBoundaries<T>(units: readonly (readonly T[])[], size: number): T[][] {
  const count = fewestBatches(units, size);
  const batches: T[][] = [];
  let at = 0;
  let left = units.reduce((n, unit) => n + unit.length, 0);
  for (let b = 0; b < count; b += 1) {
    const share = Math.ceil(left / (count - b));
    const batch: T[] = [];
    for (let unit = units[at]; unit !== undefined; unit = units[at]) {
      const next = batch.length + unit.length;
      if (batch.length > 0 && next > size) break;
      const nearer = next <= share || next - share < share - batch.length;
      if (batch.length > 0 && !nearer && fewestBatches(units.slice(at), size) <= count - b - 1) break;
      batch.push(...unit);
      at += 1;
    }
    batches.push(batch);
    left -= batch.length;
  }
  return batches;
}

/** C-2²⁷ (PRDR-323): a round's findings as the writer's batches, a place's together and the most severe first. */
export function writerBatches<T extends ToFix>(findings: readonly T[], size: number = VALIDATE_FIX_BATCH): T[][] {
  const groups = new Map<string, T[]>();
  for (const f of findings) groups.set(placeKey(f), [...(groups.get(placeKey(f)) ?? []), f]);
  const ordered = [...groups.values()]
    .map((group) => [...group].sort((a, b) => severityOf(a) - severityOf(b)))
    .sort((a, b) => {
      const [x, y] = [a[0], b[0]] as [T, T];
      const [px, py] = [firstPlace(x), firstPlace(y)];
      if (severityOf(x) !== severityOf(y)) return severityOf(x) - severityOf(y);
      if (px === null || py === null) return px === null ? (py === null ? 0 : 1) : -1;
      return px.file < py.file ? -1 : px.file > py.file ? 1 : px.line - py.line;
    });
  const cut = (part: readonly T[][]): T[][] =>
    cutOnBoundaries(
      part.flatMap((group) => (group.length > size ? fixBatches(group, size) : [group])),
      size,
    );
  return [...cut(ordered.filter((group) => !group.every(isMinor))), ...cut(ordered.filter((group) => group.every(isMinor)))];
}

/** The batches, by index, that hold only minors at places no blocker or major of the round shares: the writer's note counts them and prices them. */
export function minorsAlone(batches: readonly (readonly ToFix[])[]): ReadonlySet<number> {
  const serious = new Set(
    batches
      .flat()
      .filter((f) => !isMinor(f))
      .map(placeKey),
  );
  const alone = new Set<number>();
  batches.forEach((batch, n) => {
    if (batch.length > 0 && batch.every((f) => isMinor(f) && !serious.has(placeKey(f)))) alone.add(n);
  });
  return alone;
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
  const alone = source === "review" ? minorsAlone(batches) : new Set<number>();
  if (batches.length > 1) {
    const count = batches.reduce((n, batch) => n + batch.length, 0);
    const order =
      source === "review" ? `; a place's findings together, the most severe first, and ${alone.size === 1 ? "1 batch holds" : `${String(alone.size)} batches hold`} only minors (C-2²⁷)` : "";
    deps.note?.(
      `VALIDATE's writer, ${label}: ${String(count)} findings in ${String(batches.length)} batches of at most ${String(VALIDATE_FIX_BATCH)}, one after another (C-2²⁴)${order}`,
    );
  }
  /** C-2²⁷ (PRDR-323): what the batches of minors alone cost, read from the ledger rows their sessions wrote. */
  let minorsSpent = 0;
  const outcome = new Map<string, Outcome>();
  let stood = true;
  const step =
    source === "review"
      ? deps.estimate?.begin({
          phase: "VALIDATE",
          step: `VALIDATE's writer, ${label}`,
          said: `VALIDATE's writer, ${label}: ${String(batches.length)} batch${batches.length === 1 ? "" : "es"} to run`,
          units: batches.map(() => ({ role: "spec_write", task: "fix" })),
          atOnce: 1,
        })
      : undefined;
  try {
    for (const [i, batch] of batches.entries()) {
      const unit = step?.start();
      const stage = batches.length === 1 ? `VALIDATE's writer, ${label}` : `VALIDATE's writer, ${label}, batch ${String(i + 1)} of ${String(batches.length)}`;
      const rowsBefore = alone.has(i) ? readLedgerRows(deps.root).length : 0;
      const fixed = await fixBatch(deps, stage, batch, source);
      if (alone.has(i)) minorsSpent += readLedgerRows(deps.root).slice(rowsBefore).reduce((usd, row) => usd + row.cost_estimate_usd, 0);
      for (const [id, left] of fixed.outcome) outcome.set(id, left);
      stood &&= fixed.stood;
      if (fixed.stood) noteUnitComplete(deps.root);
      unit?.done();
    }
    step?.end();
  } catch (err) {
    rollback(deps.root, before);
    throw err;
  }
  if (alone.size > 0) {
    deps.note?.(`VALIDATE's writer, ${label}: the ${alone.size === 1 ? "batch" : `${String(alone.size)} batches`} of minors alone cost $${minorsSpent.toFixed(2)}, by their ledger rows (C-2²⁷)`);
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
