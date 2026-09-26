import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * C-2⁷ (PRDR-279) — the markdown a pack is written in, read the way its
 * grammar needs: numbered lines, `##` sections, table rows and bold-headed
 * bullets. No markdown library: the grammar is small, and the checker's
 * determinism (the same bytes give the same entries at the same lines) is
 * easier to keep than to verify in someone else's parser.
 */

export interface Line {
  readonly n: number;
  readonly text: string;
}

export interface Row {
  readonly n: number;
  readonly text: string;
  readonly cells: readonly string[];
}

export interface Bullet {
  readonly n: number;
  /** The bullet's first line as written, trimmed: what a finding quotes. */
  readonly text: string;
  readonly head: string;
  /** What follows the bold head on its line, then every continuation line, joined by one space. */
  readonly rest: string;
}

/**
 * A document's lines, 1-based. YAML frontmatter is dropped and still counted,
 * so lines stay true, and a fenced code block reads as blank lines: a table or
 * a requirement shown there is an example, never an entry.
 */
export function readLines(root: string, rel: string): Line[] {
  const all = readFileSync(path.join(root, ...rel.split("/")), "utf8").split(/\r?\n/u);
  let start = 0;
  if (all[0] === "---") {
    const end = all.indexOf("---", 1);
    if (end > 0) start = end + 1;
  }
  let fence: string | null = null;
  return all.slice(start).map((text, i) => {
    const n = start + i + 1;
    if (fence === null) {
      fence = /^\s*(`{3,}|~{3,})/u.exec(text)?.[1] ?? null;
      return { n, text: fence === null ? text : "" };
    }
    /* CommonMark: the same character, at least as long, and nothing after it. */
    const close = /^\s*(`{3,}|~{3,})\s*$/u.exec(text)?.[1];
    if (close !== undefined && close[0] === fence[0] && close.length >= fence.length) fence = null;
    return { n, text: "" };
  });
}

/**
 * The `##` sections by lower-cased title, a leading number dropped, so
 * `## 3. Codes` is `codes`. A section runs to the next `##` and holds its
 * `###` subsections, which is how a long decision log groups its entries.
 * Lines before the first `##` are the section named "".
 */
export function sections(lines: readonly Line[]): Map<string, Line[]> {
  const out = new Map<string, Line[]>([["", []]]);
  let current: Line[] = out.get("") ?? [];
  for (const line of lines) {
    const title = /^##\s+(?:\d+(?:\.\d+)*\.?\s+)?(.+?)\s*$/u.exec(line.text)?.[1];
    if (title === undefined) {
      current.push(line);
      continue;
    }
    const key = title.toLowerCase();
    current = out.get(key) ?? [];
    out.set(key, current);
  }
  return out;
}

const isRow = (line: Line | undefined): line is Line => line !== undefined && line.text.trim().startsWith("|");
/** `|---|:--:|`, with or without the closing bar: any run of dashes marks a table, as GitHub renders one. */
const isSeparator = (line: Line | undefined): boolean =>
  line !== undefined && /^\s*\|\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/u.test(line.text);

/** A row's cells, trimmed; `\|` is a literal bar inside a cell. */
function cellsOf(text: string): string[] {
  return text
    .trim()
    .replace(/^\|/u, "")
    .replace(/(?<!\\)\|$/u, "")
    .split(/(?<!\\)\|/u)
    .map((c) => c.trim().replaceAll("\\|", "|"));
}

/** The body rows of every table in `lines`: a header row, a `---` separator, then rows until the table ends. */
export function tableRows(lines: readonly Line[]): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isRow(lines[i]) || !isSeparator(lines[i + 1])) continue;
    let j = i + 2;
    for (let line = lines[j]; isRow(line); line = lines[++j]) rows.push({ n: line.n, text: line.text.trim(), cells: cellsOf(line.text) });
    i = j - 1;
  }
  return rows;
}

const BOLD_BULLET = /^\s*[-*]\s+\*\*([^*]+)\*\*(.*)$/u;

/** An indented, non-blank line that does not open a bullet of its own. */
const continues = (line: Line | undefined): line is Line => line !== undefined && /^\s{2,}\S/u.test(line.text) && !BOLD_BULLET.test(line.text);

/**
 * Every `- **HEAD** rest` bullet, indented or not, with its continuation
 * lines. An indented bold bullet opens an entry of its own rather than
 * vanishing into the text of the one above it.
 */
export function boldBullets(lines: readonly Line[]): Bullet[] {
  const bullets: Bullet[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = BOLD_BULLET.exec(lines[i]?.text ?? "");
    if (head === null) continue;
    const n = lines[i]?.n ?? 0;
    const parts = [head[2]?.trim() ?? ""];
    for (let line = lines[i + 1]; continues(line); line = lines[++i + 1]) parts.push(line.text.trim());
    bullets.push({ n, text: head[0].trim(), head: head[1]?.trim() ?? "", rest: parts.filter((p) => p !== "").join(" ") });
  }
  return bullets;
}

/** `## 1. Modules` and `### 1.1 Money` give "1" and "1.1": what a `§` reference resolves against. */
export function numberedSections(lines: readonly Line[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const n = /^#{2,4}\s+(\d+(?:\.\d+)*)\.?\s+\S/u.exec(line.text)?.[1];
    if (n !== undefined) out.push(n);
  }
  return out;
}

/** A cell's content without the backticks that quote it. */
export function unquote(cell: string): string {
  return /^`([^`]*)`$/u.exec(cell)?.[1] ?? cell;
}
