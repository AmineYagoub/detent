import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { ARCHIVE_DIR, PACK_PATHS } from "../schemas/pack.js";

/**
 * C-2¹³ (PRDR-283) — what WRITE does to the tree around its session: the
 * snapshot it takes first, the rollback when no pack comes of the session,
 * and the move of the originals to `archive/`.
 *
 * The session writes only the pack's paths (`PACK_PATHS`), so those and the
 * originals it was given are everything the snapshot holds. Nothing here
 * deletes a byte that was there before WRITE ran: an original leaves its path
 * only once its copy is in `archive/`, and `archive/` is never overwritten.
 */

const abs = (root: string, rel: string): string => path.join(root, ...rel.split("/"));

const isFile = (file: string): boolean => existsSync(file) && statSync(file).isFile();

/** The directories the pack's paths live in, and the directories above them, deepest first. */
const PACK_DIRS: readonly string[] = [
  ...new Set(
    PACK_PATHS.flatMap((glob) => {
      const dirs: string[] = [];
      for (let dir = path.posix.dirname(glob); dir !== "."; dir = path.posix.dirname(dir)) dirs.push(dir);
      return dirs;
    }),
  ),
].sort((a, b) => b.split("/").length - a.split("/").length);

/** Every file at one of the pack's paths, as the session's surface matches them. */
export function packPathFiles(root: string): string[] {
  const found = new Set<string>();
  for (const glob of PACK_PATHS) {
    const dir = path.posix.dirname(glob);
    if (!existsSync(abs(root, dir))) continue;
    for (const name of readdirSync(abs(root, dir))) {
      const rel = `${dir}/${name}`;
      if (picomatch.isMatch(rel, glob, { dot: true }) && isFile(abs(root, rel))) found.add(rel);
    }
  }
  return [...found].sort();
}

export interface Snapshot {
  /** The bytes of every file at the pack's paths and of every original the session was given. */
  readonly files: ReadonlyMap<string, Buffer>;
  /** Which of the pack's directories existed. */
  readonly dirs: ReadonlySet<string>;
}

export function snapshot(root: string, originals: readonly string[]): Snapshot {
  const files = new Map<string, Buffer>();
  for (const rel of [...packPathFiles(root), ...originals]) if (isFile(abs(root, rel))) files.set(rel, readFileSync(abs(root, rel)));
  return { files, dirs: new Set(PACK_DIRS.filter((dir) => existsSync(abs(root, dir)))) };
}

/** Whether `rel` no longer holds the bytes it held at the snapshot. */
export function changedSince(root: string, before: Snapshot, rel: string): boolean {
  const was = before.files.get(rel);
  const file = abs(root, rel);
  return was === undefined ? isFile(file) : !isFile(file) || !readFileSync(file).equals(was);
}

/** Put one file back as the snapshot held it: its bytes, or its absence. */
export function restoreFile(root: string, before: Snapshot, rel: string): void {
  const was = before.files.get(rel);
  if (was === undefined) {
    rmSync(abs(root, rel), { force: true });
    return;
  }
  mkdirSync(path.dirname(abs(root, rel)), { recursive: true });
  writeFileSync(abs(root, rel), was);
}

/** The tree as it was at the snapshot, wherever the session could write: what it added removed, what it changed restored. */
export function rollback(root: string, before: Snapshot): void {
  for (const rel of packPathFiles(root)) if (!before.files.has(rel)) rmSync(abs(root, rel), { force: true });
  for (const rel of before.files.keys()) if (changedSince(root, before, rel)) restoreFile(root, before, rel);
  for (const dir of PACK_DIRS) {
    const at = abs(root, dir);
    if (!before.dirs.has(dir) && existsSync(at) && readdirSync(at).length === 0) rmdirSync(at);
  }
}

/** A free path under `archive/` for `rel`: its own, or `name.2.ext`, `name.3.ext` beside an earlier original of that name. */
function archivePath(root: string, rel: string): string {
  const own = `${ARCHIVE_DIR}/${rel}`;
  if (!existsSync(abs(root, own))) return own;
  const ext = path.posix.extname(own);
  const stem = own.slice(0, own.length - ext.length);
  for (let n = 2; ; n += 1) {
    const next = `${stem}.${String(n)}${ext}`;
    if (!existsSync(abs(root, next))) return next;
  }
}

/**
 * The original of `rel` into `archive/`, and where it went. An original the
 * session left as it was is moved; one it rewrote in place stays, rewritten,
 * and its snapshot's bytes are what `archive/` keeps.
 */
export function archiveOriginal(root: string, before: Snapshot, rel: string): string {
  const was = before.files.get(rel);
  if (was === undefined) throw new Error(`WRITE has no original of ${rel} to archive: it was not there when WRITE began`);
  const to = archivePath(root, rel);
  mkdirSync(path.dirname(abs(root, to)), { recursive: true });
  if (changedSince(root, before, rel)) writeFileSync(abs(root, to), was);
  else renameSync(abs(root, rel), abs(root, to));
  return to;
}
