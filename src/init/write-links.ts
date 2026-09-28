import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { packKindOf } from "../schemas/pack.js";
import { LINK, SCHEME, resolve, safeDecode, withoutCode } from "./pack-check-refs.js";
import { readLines } from "./pack-markdown.js";

/**
 * C-2²² (PRDR-312) — the links WRITE's archiving would break.
 *
 * WRITE moves the originals it rewrote into the pack to `archive/`, and leaves
 * context where it is (C-2⁹). The checker reads every document it is given,
 * context included, for relative links (C-2¹⁰), and VALIDATE's writer may
 * write only the pack's paths (C-2¹⁴), so a README's link to the PRD WRITE
 * moved was a blocking finding no session could clear: tabachir's test clone
 * had 80. Code moved the file, so code repoints the links to it.
 *
 * A link is read as the checker reads it: fenced blocks and inline code are
 * text, and a link with a scheme is not relative. One that resolves to a moved
 * original is rewritten to the original's place under `archive/`, relative
 * where it was relative and from the root where it was from the root, with its
 * anchor and title kept, so it names the text it named before the move.
 */

export interface Repointed {
  readonly file: string;
  readonly links: number;
}

/** One link to rewrite: the line's index in the file's lines, where its target starts, and what replaces it. */
interface Edit {
  readonly line: number;
  readonly column: number;
  readonly length: number;
  readonly next: string;
}

function targetFor(from: string, target: string, to: string): string {
  const next = target.startsWith("/") ? `/${to}` : path.posix.relative(path.posix.dirname(from), to);
  return safeDecode(target) === target ? next : encodeURI(next);
}

/** The links in `rel` that resolve to a key of `moved`, each with where its target sits in the file. */
function editsIn(root: string, rel: string, moved: ReadonlyMap<string, string>): Edit[] {
  const lines = readLines(root, rel);
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.text.length + 1;
  }
  const body = withoutCode(lines.map((l) => l.text).join("\n"));
  const edits: Edit[] = [];
  for (const m of body.matchAll(new RegExp(LINK.source, "gud"))) {
    const target = m[1] ?? "";
    const at = m.indices?.[1]?.[0];
    if (at === undefined || SCHEME.test(target)) continue;
    const resolved = resolve(rel, safeDecode(target));
    const to = resolved === null ? undefined : moved.get(resolved);
    if (to === undefined) continue;
    /* A target holds no whitespace, so it lies on one line; the last line that starts at or before it. */
    let i = starts.length - 1;
    while (i > 0 && (starts[i] ?? 0) > at) i -= 1;
    edits.push({ line: (lines[i]?.n ?? 1) - 1, column: at - (starts[i] ?? 0), length: target.length, next: targetFor(rel, target, to) });
  }
  return edits;
}

/**
 * Repoint, in each of `documents` the checker reads, every link to an original
 * `moved` names (repo-relative, from its old path to its place in `archive/`).
 * Line endings, and every byte but the targets, are kept.
 */
export function repointLinks(root: string, documents: readonly string[], moved: ReadonlyMap<string, string>): Repointed[] {
  const out: Repointed[] = [];
  if (moved.size === 0) return out;
  for (const rel of documents) {
    if (packKindOf(rel) === null || !rel.endsWith(".md")) continue;
    const edits = editsIn(root, rel, moved);
    if (edits.length === 0) continue;
    const file = path.join(root, ...rel.split("/"));
    /* Lines at the even indexes, each followed by the ending that closed it. */
    const parts = readFileSync(file, "utf8").split(/(\r?\n)/u);
    for (const e of [...edits].sort((a, b) => b.line - a.line || b.column - a.column)) {
      const text = parts[e.line * 2] ?? "";
      parts[e.line * 2] = text.slice(0, e.column) + e.next + text.slice(e.column + e.length);
    }
    writeFileSync(file, parts.join(""));
    out.push({ file: rel, links: edits.length });
  }
  return out;
}
