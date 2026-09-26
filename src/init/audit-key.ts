import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import path from "node:path";
import { git } from "../kernel/git.js";
import { ARCHIVE_DIR, DECISION_LOG_PATH } from "../schemas/pack.js";
import { SKIP_DIRS } from "./discover-docs.js";
import { contentsDigest, valueDigest } from "./machine.js";

/**
 * C-2¹¹ (PRDR-281) — what AUDIT's checkpoint is keyed by, which is what its
 * survey reads: the documents, the code, and the prompt it reads them by.
 *
 * Never the decision log. C-2⁶ gives it to DECIDE to write, and the founder's
 * answers go into it, so a key that covered it would re-run the audit those
 * answers settle: the survey and every claim paid for again, and the settled
 * contradictions raised a second time. The survey is not given the log
 * either, so nothing it was given escapes its key.
 *
 * The code is every file git tracks or would track, in the working tree rather
 * than the last commit, because a drift finding is about the code as it
 * stands. Not `.detent/`, which is Detent's own state and moves while `init`
 * runs, and not `archive/`, which holds the originals a pack replaced.
 */

/** The documents the survey is given: every discovered one but the decision log. */
export function auditedDocuments(docs: readonly string[]): string[] {
  return docs.filter((doc) => doc !== DECISION_LOG_PATH);
}

/** Every file under the root, as discovery walks them, for a root git cannot list; `codeFiles` drops the archive after. */
function walked(root: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, prefix: string): void => {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      /* Unreadable: nothing in it can be listed, so nothing in it is keyed. */
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(abs, entry.name), rel);
      else out.push(rel);
    }
  };
  walk(root, "");
  return out;
}

/** The code, by path from the root, sorted: tracked or untracked-and-not-ignored, less the documents and Detent's own paths. */
export function codeFiles(root: string, documents: readonly string[]): string[] {
  let listed: string[];
  try {
    listed = git(root, "ls-files", "-z", "--cached", "--others", "--exclude-standard").split("\0");
  } catch {
    /* Not a repository, which `init` allows before C-6's consent: the walk sees what git would have. */
    listed = walked(root);
  }
  const docs = new Set([...documents, DECISION_LOG_PATH]);
  return [...new Set(listed)]
    .filter((rel) => rel !== "" && !docs.has(rel) && !rel.startsWith(".detent/") && !rel.startsWith(`${ARCHIVE_DIR}/`))
    .sort();
}

/** A file's contents, a link's target, or a marker for what is neither, so a deletion or a retype is a change. */
function fileDigest(abs: string): string {
  try {
    const stats = lstatSync(abs);
    if (stats.isSymbolicLink()) return `link:${readlinkSync(abs)}`;
    return stats.isFile() ? createHash("sha256").update(readFileSync(abs)).digest("hex") : "other";
  } catch {
    /* A tracked file deleted from the working tree. */
    return "absent";
  }
}

function codeDigest(root: string, documents: readonly string[]): string {
  const h = createHash("sha256");
  for (const rel of codeFiles(root, documents)) h.update(`${rel}\0${fileDigest(path.join(root, ...rel.split("/")))}\n`);
  return `code:${h.digest("hex")}`;
}

/** C-2¹¹: the key. `inputs` is the rest of what decides what AUDIT does: the pack's kind, the stack markers and the prompt's hash. */
export function auditKey(root: string, docs: readonly string[], inputs: unknown): string {
  return `${contentsDigest(root, auditedDocuments(docs))}|${codeDigest(root, docs)}|${valueDigest(inputs)}`;
}
